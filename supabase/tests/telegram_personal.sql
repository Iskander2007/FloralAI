-- Creates temporary merchants, conversations and orders; all fixtures are rolled back.
begin;
select set_config('telegram_test.owner_a', gen_random_uuid()::text, true),
       set_config('telegram_test.owner_b', gen_random_uuid()::text, true),
       set_config('telegram_test.bot_a', (9000000000000 + floor(random() * 1000000000))::bigint::text, true),
       set_config('telegram_test.bot_b', (9100000000000 + floor(random() * 1000000000))::bigint::text, true);
insert into auth.users(id) values(current_setting('telegram_test.owner_a')::uuid), (current_setting('telegram_test.owner_b')::uuid);
insert into public.business_trials(owner_id, selected_plan)
    values(current_setting('telegram_test.owner_a')::uuid, 'starter'), (current_setting('telegram_test.owner_b')::uuid, 'starter');
insert into public.business_profiles(owner_id, profile)
    values(current_setting('telegram_test.owner_a')::uuid, '{"name":"Temporary A","deliveryFeeKzt":1000}'),
          (current_setting('telegram_test.owner_b')::uuid, '{"name":"Temporary B","deliveryFeeKzt":1000}');
set local role service_role;

do $$
declare
    owner_a uuid := current_setting('telegram_test.owner_a')::uuid;
    owner_b uuid := current_setting('telegram_test.owner_b')::uuid;
    bot_a bigint := current_setting('telegram_test.bot_a')::bigint;
    bot_b bigint := current_setting('telegram_test.bot_b')::bigint;
    shop_a uuid;
    shop_b uuid;
    product_a uuid;
    profile_a jsonb;
    profile_b jsonb;
    result jsonb;
    order_data jsonb;
begin
    if has_table_privilege('authenticated', 'public.telegram_bot_credentials', 'SELECT')
       or has_table_privilege('anon', 'public.telegram_bot_credentials', 'SELECT')
       or has_function_privilege('authenticated', 'public.connect_personal_telegram(uuid,bigint,text,text)', 'EXECUTE')
       or has_function_privilege('anon', 'public.commit_telegram_sales_turn(bigint,bigint,bigint,uuid,uuid,text,jsonb,text,jsonb,jsonb,bigint)', 'EXECUTE') then
        raise exception 'Telegram credentials or service RPCs exposed';
    end if;
    -- Existing shared-bot calls still work with the original ten-argument signature.
    insert into public.telegram_businesses(owner_id, business_name, start_code, active)
        values(owner_a, 'Temporary A', replace(gen_random_uuid()::text, '-', ''), true) returning id into shop_a;
    select profile into profile_a from public.business_profiles where owner_id = owner_a;
    result := public.commit_telegram_sales_turn(555, 12, -1, null, shop_a, 'Shared question', '{}', 'Shared answer', profile_a);
    if result->>'outcome' <> 'committed' then raise exception 'Shared bot compatibility failed: %', result; end if;
    result := public.connect_personal_telegram(owner_a, bot_a, 'test_florist_a_bot', 'encrypted-test-a');
    shop_a := (result->>'id')::uuid;
    result := public.connect_personal_telegram(owner_b, bot_b, 'test_florist_b_bot', 'encrypted-test-b');
    shop_b := (result->>'id')::uuid;
    begin
        perform public.connect_personal_telegram(owner_b, bot_a, 'test_florist_a_bot', 'forged');
        raise exception 'Merchant stole another merchant bot';
    exception when unique_violation then null; end;
    if (select owner_id from public.telegram_bot_credentials where bot_id = bot_a) <> owner_a then raise exception 'Bot ownership changed'; end if;
    update public.telegram_businesses set active = true where id in (shop_a, shop_b);
    select profile into profile_a from public.business_profiles where owner_id = owner_a;
    select profile into profile_b from public.business_profiles where owner_id = owner_b;
    result := public.commit_telegram_sales_turn(555, 12, -1, null, shop_a, 'Question A', '{}', 'Answer A', profile_a, null, bot_a);
    if result->>'outcome' <> 'committed' then raise exception 'First bot failed: %', result; end if;
    result := public.commit_telegram_sales_turn(555, 12, -1, null, shop_b, 'Question B', '{}', 'Answer B', profile_b, null, bot_b);
    if result->>'outcome' <> 'committed' then raise exception 'Second bot same chat/update collided: %', result; end if;
    if (select count(*) from public.telegram_chats where bot_id in (bot_a, bot_b) and chat_id = 555) <> 2 then raise exception 'Conversations are not isolated by bot'; end if;
    result := public.commit_telegram_sales_turn(555, 12, 1, shop_a, shop_a, 'Retry', '{}', 'Wrong duplicate', profile_a, null, bot_a);
    if result->>'outcome' <> 'duplicate' or result->>'reply' <> 'Answer A' then raise exception 'Duplicate did not replay original answer'; end if;
    result := public.commit_telegram_sales_turn(555, 13, 1, shop_a, shop_b, 'Wrong shop', '{}', 'Wrong answer', profile_b, null, bot_a);
    if result->>'outcome' <> 'inactive' then raise exception 'Personal bot switched merchants'; end if;
    result := public.commit_telegram_sales_turn(555, 13, -1, null, shop_a, 'Shared bypass', '{}', 'Wrong answer', profile_a);
    if result->>'outcome' <> 'inactive' then raise exception 'Shared channel accepted personal business'; end if;

    insert into public.catalog_products(owner_id, name, price_kzt, description) values(owner_a, 'Test roses', 12000, 'Test') returning id into product_a;
    order_data := jsonb_build_object('id', gen_random_uuid(), 'product_id', product_a, 'expected_product_name', 'Test roses',
        'expected_price_kzt', 12000, 'expected_delivery_fee_kzt', 1000, 'draft', jsonb_build_object(
            'customerName', 'Test Customer', 'customerPhone', '+77771234567', 'deliveryAddress', 'Test address 1', 'deliveryDate', 'Tomorrow 15:00', 'occasion', 'Birthday', 'note', ''));
    result := public.commit_telegram_sales_turn(555, 13, 1, shop_a, shop_a, 'Confirm', '{"step":"submitted"}', 'Saving', profile_a, order_data, bot_a);
    if result->>'outcome' <> 'committed' then raise exception 'Personal order failed: %', result; end if;
    if not exists(select 1 from public.sales_orders where id = (order_data->>'id')::uuid and owner_id = owner_a and bot_id = bot_a and total_kzt = 13000) then
        raise exception 'Personal order lost tenant, bot or price';
    end if;
    result := public.commit_telegram_sales_turn(555, 13, 2, shop_a, shop_a, 'Retry confirmation', '{}', 'Wrong duplicate', profile_a, order_data, bot_a);
    if result->>'outcome' <> 'duplicate' then raise exception 'Order retry was not deduplicated'; end if;
    if (select count(*) from public.sales_orders where business_id = shop_a) <> 1 then raise exception 'Duplicate personal order inserted'; end if;
end;
$$;
select true as personal_bot_isolation, true as credentials_private, true as order_retry_idempotent;
rollback;
