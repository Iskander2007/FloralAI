begin;
select set_config('floral.test_owner', (select u.id::text from auth.users u where u.email_confirmed_at is not null and not exists (select 1 from public.billing_operators b where b.user_id=u.id) limit 1), true),
       set_config('floral.test_operator', (select user_id::text from public.billing_operators limit 1), true);
select set_config('request.jwt.claim.sub', current_setting('floral.test_operator'), true);
select * from public.request_subscription_payment('starter','monthly','+77771234567');
insert into public.business_trials(owner_id,selected_plan,started_at,ends_at)
    values(current_setting('floral.test_owner')::uuid,'starter',now()-interval '10 days',now()-interval '3 days')
    on conflict(owner_id) do update set started_at=excluded.started_at,ends_at=excluded.ends_at;
insert into public.business_profiles(owner_id,profile) values(current_setting('floral.test_owner')::uuid,'{}') on conflict(owner_id) do nothing;
select set_config('request.jwt.claim.sub', current_setting('floral.test_owner'), true);
set local role authenticated;
do $$
declare affected integer; trial public.business_trials;
begin
    if public.has_workspace_access() then raise exception 'Expired account still has new business access'; end if;
    if exists(select 1 from public.subscription_payment_requests where owner_id <> auth.uid()) then raise exception 'Customer read another account invoice'; end if;
    select * into trial from public.start_business_trial('business');
    if trial.ends_at > now() then raise exception 'Expired trial restarted'; end if;
    begin
        insert into public.catalog_products(owner_id,name,price_kzt) values(auth.uid(),'test expired access',1000);
        raise exception 'Expired user inserted product';
    exception when insufficient_privilege then null; end;
    update public.business_profiles set profile = profile where owner_id=auth.uid();
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'Expired user changed profile'; end if;
    if not exists(select 1 from public.business_profiles where owner_id=auth.uid()) then raise exception 'Existing profile cannot be read'; end if;
end;
$$;
reset role;
do $$
declare saved_order public.sales_orders;
begin
    select * into saved_order from public.sales_orders limit 1;
    if saved_order.id is not null then
        begin
            insert into public.sales_orders(id,owner_id,business_id,chat_id,source_update_id,customer_name,customer_phone,delivery_address,delivery_date,product_name,product_price_kzt,delivery_fee_kzt,total_kzt,business_snapshot)
                values(gen_random_uuid(),current_setting('floral.test_owner')::uuid,saved_order.business_id,saved_order.chat_id,-999999,
                'Test rollback','+77771234567','Test rollback','Test rollback','Test rollback',1,0,1,'{}'::jsonb);
            raise exception 'Expired Telegram shop created order';
        exception when insufficient_privilege then null; end;
    end if;
end;
$$;
select true as expired_trial_cannot_restart, true as tenant_invoice_isolation,
       true as expired_catalog_writes_blocked, true as existing_profile_readable, true as transaction_order_guard_checked;
rollback;
