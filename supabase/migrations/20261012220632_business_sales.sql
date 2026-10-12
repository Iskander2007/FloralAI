create table public.business_profiles (
    owner_id uuid primary key references auth.users (id) on delete cascade,
    profile jsonb not null check (jsonb_typeof(profile) = 'object'),
    updated_at timestamptz not null default now()
);

alter table public.business_profiles enable row level security;
revoke all on public.business_profiles from anon, authenticated;
grant select, insert, update on public.business_profiles to authenticated;
grant select on public.business_profiles to service_role;
create policy "Owners read their business profile" on public.business_profiles
    for select to authenticated using (auth.uid() = owner_id);
create policy "Owners create their business profile" on public.business_profiles
    for insert to authenticated with check (auth.uid() = owner_id);
create policy "Owners update their business profile" on public.business_profiles
    for update to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create trigger set_business_profiles_updated_at before update on public.business_profiles
    for each row execute function public.set_catalog_product_updated_at();

alter table public.telegram_chats
    add column state jsonb not null default '{}'::jsonb,
    add column revision bigint not null default 0;

create table public.sales_orders (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users (id) on delete cascade,
    business_id uuid not null references public.telegram_businesses (id) on delete cascade,
    chat_id bigint not null,
    source_update_id bigint not null,
    status text not null default 'awaiting_confirmation' check (status in (
        'awaiting_confirmation', 'confirmed', 'cancelled', 'fulfilled'
    )),
    customer_name text not null check (char_length(customer_name) between 1 and 120),
    customer_phone text not null check (customer_phone ~ '^\+?[0-9]{10,15}$'),
    delivery_address text not null check (char_length(delivery_address) between 1 and 500),
    delivery_date text not null check (char_length(delivery_date) between 1 and 300),
    occasion text not null default '' check (char_length(occasion) <= 300),
    note text not null default '' check (char_length(note) <= 1000),
    product_id uuid,
    product_name text not null,
    product_price_kzt integer not null check (product_price_kzt >= 0),
    delivery_fee_kzt integer check (delivery_fee_kzt >= 0),
    total_kzt bigint check (total_kzt >= 0),
    business_snapshot jsonb not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (business_id, chat_id, source_update_id),
    check (total_kzt is not distinct from (product_price_kzt::bigint + delivery_fee_kzt))
);

alter table public.sales_orders enable row level security;
revoke all on public.sales_orders from anon, authenticated;
grant select on public.sales_orders to authenticated;
grant update (status) on public.sales_orders to authenticated;
grant select, insert, update on public.sales_orders to service_role;
create policy "Owners read their sales orders" on public.sales_orders
    for select to authenticated using (auth.uid() = owner_id);
create policy "Owners update their sales order status" on public.sales_orders
    for update to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create index sales_orders_owner_created_idx on public.sales_orders (owner_id, created_at desc, id desc);

-- Request receipts retain the prices and customer details shown at confirmation.
create function public.preserve_sales_order_snapshot() returns trigger
language plpgsql set search_path = '' as $$
begin
    if (to_jsonb(new) - 'status' - 'updated_at') is distinct from
       (to_jsonb(old) - 'status' - 'updated_at') then
        raise exception 'Order receipt fields are immutable';
    end if;
    if new.status <> old.status and not (
        (old.status = 'awaiting_confirmation' and new.status in ('confirmed', 'cancelled'))
        or (old.status = 'confirmed' and new.status in ('fulfilled', 'cancelled'))
    ) then
        raise exception 'Invalid order status transition';
    end if;
    new.updated_at = now();
    return new;
end;
$$;
create trigger preserve_sales_order_snapshot before update on public.sales_orders
    for each row execute function public.preserve_sales_order_snapshot();

create table public.sales_messages (
    id bigint generated always as identity primary key,
    owner_id uuid not null references auth.users (id) on delete cascade,
    business_id uuid not null references public.telegram_businesses (id) on delete cascade,
    chat_id bigint not null,
    source_update_id bigint not null,
    role text not null check (role in ('customer', 'assistant')),
    content text not null check (char_length(content) <= 4000),
    created_at timestamptz not null default now(),
    unique (business_id, chat_id, source_update_id, role)
);
alter table public.sales_messages enable row level security;
revoke all on public.sales_messages from anon, authenticated;
grant select on public.sales_messages to authenticated;
grant select, insert on public.sales_messages to service_role;
grant usage, select on sequence public.sales_messages_id_seq to service_role;
create policy "Owners read their sales conversations" on public.sales_messages
    for select to authenticated using (auth.uid() = owner_id);
create index sales_messages_owner_chat_idx on public.sales_messages (owner_id, chat_id, created_at);

-- All writes for one Telegram turn commit together. Only the backend service role can call this.
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
    p_order jsonb default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
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

    insert into public.telegram_chats (chat_id, business_id, last_update_id)
        values (p_chat_id, p_business_id, -1)
        on conflict (chat_id) do nothing returning true into v_inserted;
    select * into strict v_chat from public.telegram_chats where chat_id = p_chat_id for update;

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
            id, owner_id, business_id, chat_id, source_update_id, status,
            customer_name, customer_phone, delivery_address, delivery_date, occasion, note,
            product_id, product_name, product_price_kzt, delivery_fee_kzt, total_kzt,
            business_snapshot
        ) values (
            (p_order->>'id')::uuid, v_business.owner_id, v_business.id, p_chat_id, p_update_id,
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

    insert into public.sales_messages (owner_id, business_id, chat_id, source_update_id, role, content)
        values (v_business.owner_id, v_business.id, p_chat_id, p_update_id, 'customer', p_message),
               (v_business.owner_id, v_business.id, p_chat_id, p_update_id, 'assistant', v_reply);
    update public.telegram_chats set business_id = v_business.id, state = v_state,
        last_update_id = p_update_id, last_reply = v_reply, revision = revision + 1, updated_at = now()
        where chat_id = p_chat_id;
    return jsonb_build_object('outcome', 'committed', 'reply', v_reply, 'order', to_jsonb(v_order));
end;
$$;

revoke all on function public.commit_telegram_sales_turn(bigint, bigint, bigint, uuid, uuid, text, jsonb, text, jsonb, jsonb)
    from public, anon, authenticated;
grant execute on function public.commit_telegram_sales_turn(bigint, bigint, bigint, uuid, uuid, text, jsonb, text, jsonb, jsonb)
    to service_role;
