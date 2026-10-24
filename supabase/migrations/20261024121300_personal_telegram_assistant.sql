-- Credentials are never exposed to authenticated clients, even the owner.
create table public.telegram_bot_credentials (
    bot_id bigint primary key check (bot_id > 0),
    owner_id uuid not null unique references auth.users(id) on delete cascade,
    business_id uuid not null unique references public.telegram_businesses(id) on delete cascade,
    username text not null check (username ~ '^[A-Za-z0-9_]{5,32}$'),
    encrypted_token text not null,
    updated_at timestamptz not null default now()
);
alter table public.telegram_bot_credentials enable row level security;
revoke all on public.telegram_bot_credentials from public, anon, authenticated;
grant select, insert, update, delete on public.telegram_bot_credentials to service_role;
grant select, insert, update on public.telegram_businesses to service_role;

-- Telegram update IDs and chat IDs belong to a particular bot, not to the platform.
alter table public.telegram_chats add column bot_id bigint not null default 0;
alter table public.telegram_chats drop constraint telegram_chats_pkey;
alter table public.telegram_chats add primary key (bot_id, chat_id);
alter table public.sales_orders add column bot_id bigint not null default 0;
alter table public.sales_messages add column bot_id bigint not null default 0;
alter table public.sales_orders drop constraint sales_orders_business_id_chat_id_source_update_id_key;
alter table public.sales_orders add unique (business_id, bot_id, chat_id, source_update_id);
alter table public.sales_messages drop constraint sales_messages_business_id_chat_id_source_update_id_role_key;
alter table public.sales_messages add unique (business_id, bot_id, chat_id, source_update_id, role);

create function public.connect_personal_telegram(p_owner_id uuid, p_bot_id bigint, p_username text, p_encrypted_token text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
    v_business public.telegram_businesses%rowtype;
    v_profile jsonb;
begin
    perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text, 411));
    if not public.business_has_paid_access(p_owner_id) then raise exception 'Subscription required' using errcode = '42501'; end if;
    select profile into v_profile from public.business_profiles where owner_id = p_owner_id;
    if v_profile is null then raise exception 'Business profile required'; end if;
    -- A bot is permanently bound to its merchant. Reconnects can rotate its token.
    if exists(select 1 from public.telegram_bot_credentials where owner_id = p_owner_id and bot_id <> p_bot_id)
       or exists(select 1 from public.telegram_bot_credentials where bot_id = p_bot_id and owner_id <> p_owner_id) then
        raise exception 'Bot already connected' using errcode = '23505';
    end if;
    insert into public.telegram_businesses(owner_id, business_name, start_code, active)
        values(p_owner_id, left(v_profile->>'name', 120), replace(gen_random_uuid()::text, '-', ''), false)
        on conflict(owner_id) do update set business_name = excluded.business_name, active = false
        returning * into v_business;
    insert into public.telegram_bot_credentials(bot_id, owner_id, business_id, username, encrypted_token)
        values(p_bot_id, p_owner_id, v_business.id, p_username, p_encrypted_token)
        on conflict(bot_id) do update set username = excluded.username, encrypted_token = excluded.encrypted_token, updated_at = now();
    return jsonb_build_object('id', v_business.id, 'start_code', v_business.start_code);
end;
$$;
revoke all on function public.connect_personal_telegram(uuid, bigint, text, text) from public, anon, authenticated;
grant execute on function public.connect_personal_telegram(uuid, bigint, text, text) to service_role;


drop function public.commit_telegram_sales_turn(bigint, bigint, bigint, uuid, uuid, text, jsonb, text, jsonb, jsonb);

create function public.commit_telegram_sales_turn(
    p_chat_id bigint,
    p_update_id bigint,
    p_expected_revision bigint,
    p_expected_business_id uuid,
    p_business_id uuid,
    p_message text,
    p_state jsonb,
    p_reply text,
    p_expected_profile jsonb,
    p_order jsonb default null,
    p_bot_id bigint default 0
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
    v_chat public.telegram_chats%rowtype;
    v_business public.telegram_businesses%rowtype;
    v_product public.catalog_products%rowtype;
    v_order public.sales_orders%rowtype;
    v_profile jsonb;
    v_draft jsonb;
    v_state jsonb := p_state;
    v_reply text := p_reply;
    v_inserted boolean := false;
    v_delivery integer;
begin
    if p_state is null or jsonb_typeof(p_state) <> 'object'
       or p_message is null or char_length(p_message) > 2000
       or p_reply is null or char_length(p_reply) not between 1 and 4000
       or p_update_id is null or p_update_id < 0 or p_expected_revision is null then
        raise exception 'Invalid sales turn';
    end if;

    select * into v_business from public.telegram_businesses
        where id = p_business_id and active = true for share;
    if not found then return jsonb_build_object('outcome', 'inactive'); end if;
    if p_bot_id < 0 or (p_bot_id <> 0 and not exists(select 1 from public.telegram_bot_credentials where bot_id = p_bot_id and business_id = p_business_id))
       or (p_bot_id = 0 and exists(select 1 from public.telegram_bot_credentials where business_id = p_business_id)) then
        return jsonb_build_object('outcome', 'inactive');
    end if;

    insert into public.telegram_chats (bot_id, chat_id, business_id, last_update_id)
        values (p_bot_id, p_chat_id, p_business_id, -1)
        on conflict (bot_id, chat_id) do nothing returning true into v_inserted;
    select * into strict v_chat from public.telegram_chats where bot_id = p_bot_id and chat_id = p_chat_id for update;

    if p_update_id = v_chat.last_update_id then
        return jsonb_build_object('outcome', 'duplicate', 'reply', v_chat.last_reply);
    elsif p_update_id < v_chat.last_update_id then
        return jsonb_build_object('outcome', 'stale');
    end if;
    if (coalesce(v_inserted, false) and p_expected_revision <> -1)
       or (not coalesce(v_inserted, false) and (
           p_expected_revision <> v_chat.revision
           or p_expected_business_id is distinct from v_chat.business_id
       )) then
        return jsonb_build_object('outcome', 'conflict');
    end if;

    select profile into v_profile from public.business_profiles
        where owner_id = v_business.owner_id for share;
    if v_profile is distinct from p_expected_profile then
        return jsonb_build_object('outcome', 'quote_changed');
    end if;

    if p_order is not null then
        v_draft := p_order->'draft';
        select * into v_product from public.catalog_products
            where id = (p_order->>'product_id')::uuid and owner_id = v_business.owner_id for share;
        if not found then return jsonb_build_object('outcome', 'quote_changed'); end if;

        if jsonb_typeof(v_profile->'deliveryFeeKzt') = 'number'
           and (v_profile->>'deliveryFeeKzt')::numeric between 0 and 10000000
           and (v_profile->>'deliveryFeeKzt')::numeric = trunc((v_profile->>'deliveryFeeKzt')::numeric) then
            v_delivery := (v_profile->>'deliveryFeeKzt')::integer;
        end if;
        if v_product.price_kzt is distinct from (p_order->>'expected_price_kzt')::integer
           or v_product.name is distinct from p_order->>'expected_product_name'
           or v_delivery is distinct from (p_order->>'expected_delivery_fee_kzt')::integer then
            return jsonb_build_object('outcome', 'quote_changed');
        end if;

        insert into public.sales_orders (
            id, owner_id, business_id, bot_id, chat_id, source_update_id, status,
            customer_name, customer_phone, delivery_address, delivery_date, occasion, note,
            product_id, product_name, product_price_kzt, delivery_fee_kzt, total_kzt,
            business_snapshot
        ) values (
            (p_order->>'id')::uuid, v_business.owner_id, v_business.id, p_bot_id, p_chat_id, p_update_id,
            'awaiting_confirmation',
            trim(v_draft->>'customerName'), regexp_replace(trim(v_draft->>'customerPhone'), '[^0-9+]', '', 'g'),
            trim(v_draft->>'deliveryAddress'), trim(v_draft->>'deliveryDate'),
            coalesce(v_draft->>'occasion', ''), coalesce(v_draft->>'note', ''),
            v_product.id, v_product.name, v_product.price_kzt, v_delivery,
            v_product.price_kzt::bigint + v_delivery,
            coalesce(v_profile, '{}'::jsonb) - 'paymentPhone' - 'paymentRecipient' - 'paymentBank'
        ) returning * into v_order;

        v_reply := 'Заявка №' || upper(left(v_order.id::text, 8)) || ' сохранена.' || E'\n'
            || v_order.product_name || ' — ' || v_order.product_price_kzt || ' ₸' || E'\n'
            || 'Имя: ' || v_order.customer_name || E'\n'
            || 'Телефон: ' || v_order.customer_phone || E'\n'
            || 'Адрес: ' || v_order.delivery_address || E'\n'
            || 'Доставка: ' || v_order.delivery_date || E'\n';
        if v_order.delivery_fee_kzt is not null then
            v_reply := v_reply || 'Стоимость доставки: ' || v_order.delivery_fee_kzt || ' ₸' || E'\n'
                || 'Предварительно итого: ' || v_order.total_kzt || ' ₸' || E'\n';
        else
            v_reply := v_reply || 'Стоимость доставки уточнит магазин.' || E'\n';
        end if;
        v_reply := v_reply || E'\n'
            || 'Магазин подтвердит наличие, доставку и итоговую стоимость. '
            || 'Оплата через бота пока не принимается. Владелец свяжется с вами по указанному номеру.';
        v_state := v_state || jsonb_build_object('orderId', v_order.id);
    end if;

    insert into public.sales_messages (owner_id, business_id, bot_id, chat_id, source_update_id, role, content)
        values (v_business.owner_id, v_business.id, p_bot_id, p_chat_id, p_update_id, 'customer', p_message),
               (v_business.owner_id, v_business.id, p_bot_id, p_chat_id, p_update_id, 'assistant', v_reply);
    update public.telegram_chats set business_id = v_business.id, state = v_state,
        last_update_id = p_update_id, last_reply = v_reply, revision = revision + 1, updated_at = now()
        where bot_id = p_bot_id and chat_id = p_chat_id;
    return jsonb_build_object('outcome', 'committed', 'reply', v_reply, 'order', to_jsonb(v_order));
end;
$$;

revoke all on function public.commit_telegram_sales_turn(bigint, bigint, bigint, uuid, uuid, text, jsonb, text, jsonb, jsonb, bigint)
    from public, anon, authenticated;
grant execute on function public.commit_telegram_sales_turn(bigint, bigint, bigint, uuid, uuid, text, jsonb, text, jsonb, jsonb, bigint)
    to service_role;
