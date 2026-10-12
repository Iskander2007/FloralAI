begin;
select set_config('floral.test_owner', (select u.id::text from auth.users u where u.email_confirmed_at is not null and not exists (select 1 from public.billing_operators b where b.user_id=u.id) limit 1), true),
       set_config('floral.test_operator', (select user_id::text from public.billing_operators limit 1), true);
select set_config('request.jwt.claim.sub', current_setting('floral.test_owner'), true);
set local role authenticated;
do $$
declare payment public.subscription_payment_requests; duplicate public.subscription_payment_requests;
begin
    if public.is_subscription_operator() then raise exception 'Customer became operator'; end if;
    select * into payment from public.request_subscription_payment('starter','monthly','+77771234567');
    select * into duplicate from public.request_subscription_payment('business','annual','+77771234567');
    if payment.id is distinct from duplicate.id or payment.amount_kzt <> 9950 or payment.owner_id <> auth.uid() then raise exception 'Forged or duplicate invoice'; end if;
    if not public.has_workspace_access() then raise exception 'Trial access missing'; end if;
    perform set_config('floral.test_payment',payment.id::text,true);
    perform set_config('floral.test_trial_end',(select ends_at::text from public.business_trials where owner_id=auth.uid()),true);
    begin
        perform public.change_subscription_payment(payment.id,'mark_sent');
        raise exception 'Customer sent bank invoice';
    exception when insufficient_privilege then null; end;
    begin
        perform public.change_subscription_payment(payment.id,'approve',9950,'test-receipt-1');
        raise exception 'Customer approved own payment';
    exception when insufficient_privilege then null; end;
    begin
        perform public.change_subscription_payment(payment.id,'mark_paid');
        raise exception 'Unsent invoice marked paid';
    exception when raise_exception then
        if sqlerrm = 'Unsent invoice marked paid' then raise; end if;
    end;
    begin
        insert into public.billing_operators(user_id) values(auth.uid());
        raise exception 'Customer escalated operator privilege';
    exception when insufficient_privilege then null; end;
end;
$$;
reset role;
select set_config('request.jwt.claim.sub', current_setting('floral.test_operator'), true);
set local role authenticated;
do $$
declare payment public.subscription_payment_requests; paid_end timestamptz;
begin
    if not public.is_subscription_operator() then raise exception 'Operator membership unavailable'; end if;
    select * into payment from public.change_subscription_payment(current_setting('floral.test_payment')::uuid,'mark_sent');
    if payment.status <> 'invoice_sent' then raise exception 'Invoice was not sent'; end if;
    begin
        perform public.change_subscription_payment(payment.id,'approve',1,'test-receipt-1');
        raise exception 'Wrong amount accepted';
    exception when invalid_parameter_value then null; end;
    select * into payment from public.change_subscription_payment(payment.id,'approve',9950,'test-receipt-1');
    if payment.status <> 'approved' then raise exception 'Payment not approved'; end if;
end;
$$;
reset role;
select period_end::text as paid_until from public.business_subscriptions where owner_id=current_setting('floral.test_owner')::uuid;
do $$
declare paid public.business_subscriptions; repeated public.business_subscriptions;
begin
    select * into paid from public.business_subscriptions where owner_id=current_setting('floral.test_owner')::uuid;
    if paid.period_start < current_setting('floral.test_trial_end')::timestamptz then raise exception 'Trial week lost'; end if;
    perform public.change_subscription_payment(current_setting('floral.test_payment')::uuid,'approve',9950,'TEST-RECEIPT-1');
    select * into repeated from public.business_subscriptions where owner_id=paid.owner_id;
    if paid is distinct from repeated then raise exception 'Duplicate approval extended subscription'; end if;
    perform set_config('floral.test_paid_end',paid.period_end::text,true);
end;
$$;
select set_config('request.jwt.claim.sub', current_setting('floral.test_owner'), true);
set local role authenticated;
do $$
declare payment public.subscription_payment_requests;
begin
    select * into payment from public.request_subscription_payment('business','annual','+77771234567');
    if payment.amount_kzt <> 239520 then raise exception 'Annual price incorrect'; end if;
    perform set_config('floral.test_payment_2',payment.id::text,true);
end;
$$;
reset role;
select set_config('request.jwt.claim.sub', current_setting('floral.test_operator'), true);
set local role authenticated;
do $$
begin
    perform public.change_subscription_payment(current_setting('floral.test_payment_2')::uuid,'mark_sent');
    begin
        perform public.change_subscription_payment(current_setting('floral.test_payment_2')::uuid,'approve',239520,'test-receipt-1');
        raise exception 'Bank receipt was reused';
    exception when unique_violation then null; end;
    perform public.change_subscription_payment(current_setting('floral.test_payment_2')::uuid,'approve',239520,'test-receipt-2');
end;
$$;
reset role;
do $$
begin
    if not exists(select 1 from public.business_subscriptions where owner_id=current_setting('floral.test_owner')::uuid
        and period_end = current_setting('floral.test_paid_end')::timestamptz + interval '12 months') then raise exception 'Renewal not extended correctly'; end if;
end;
$$;
select set_config('request.jwt.claim.sub', current_setting('floral.test_owner'), true);
set local role authenticated;
select set_config('floral.test_payment_3',(select id::text from public.request_subscription_payment('starter','annual','+77771234567')),true);
reset role;
select set_config('request.jwt.claim.sub', current_setting('floral.test_operator'), true);
set local role authenticated;
do $$
declare payment public.subscription_payment_requests;
begin
    select * into payment from public.change_subscription_payment(current_setting('floral.test_payment_3')::uuid,'reject',null,null,'Поступление не найдено');
    if payment.status <> 'rejected' or payment.rejection_reason <> 'Поступление не найдено' then raise exception 'Rejection broken'; end if;
end;
$$;
reset role;
select true as customer_cannot_approve, true as exact_amount_checked, true as duplicate_receipt_blocked,
       true as duplicate_approval_idempotent, true as free_week_preserved, true as annual_renewal_correct, true as rejection_works;
rollback;
