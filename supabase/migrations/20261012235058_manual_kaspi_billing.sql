create table public.billing_operators (
    user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.billing_operators enable row level security;
revoke all on public.billing_operators from public, anon, authenticated;
grant select on public.billing_operators to authenticated;
grant select, insert, update, delete on public.billing_operators to service_role;
create policy "Operators read their own membership" on public.billing_operators
    for select to authenticated using ((select auth.uid()) = user_id);

create function public.is_subscription_operator() returns boolean
language sql stable security invoker set search_path = '' as $$
    select exists (select 1 from public.billing_operators where user_id = (select auth.uid()));
$$;
revoke all on function public.is_subscription_operator() from public, anon;
grant execute on function public.is_subscription_operator() to authenticated, service_role;

create table public.subscription_payment_requests (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    owner_email text not null,
    plan text not null check (plan in ('starter', 'business')),
    billing_cycle text not null check (billing_cycle in ('monthly', 'annual')),
    amount_kzt integer not null check (amount_kzt > 0),
    kaspi_phone text not null check (kaspi_phone ~ '^\+7[0-9]{10}$'),
    status text not null default 'requested' check (status in (
        'requested', 'invoice_sent', 'verification_requested', 'approved', 'rejected'
    )),
    bank_reference text check (char_length(bank_reference) between 1 and 120),
    rejection_reason text check (char_length(rejection_reason) between 1 and 500),
    approved_by uuid references auth.users(id) on delete set null,
    approved_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check ((status = 'approved') = (approved_at is not null)),
    check (status <> 'approved' or bank_reference is not null)
);
alter table public.subscription_payment_requests enable row level security;
revoke all on public.subscription_payment_requests from public, anon, authenticated;
grant select on public.subscription_payment_requests to authenticated;
grant select, insert, update, delete on public.subscription_payment_requests to service_role;
create policy "Owners or operators read subscription payments" on public.subscription_payment_requests
    for select to authenticated using (
        (select auth.uid()) = owner_id or (select public.is_subscription_operator())
    );
create unique index one_open_subscription_payment_per_owner
    on public.subscription_payment_requests(owner_id)
    where status in ('requested', 'invoice_sent', 'verification_requested');
create unique index subscription_payment_unique_bank_reference
    on public.subscription_payment_requests(lower(bank_reference)) where status = 'approved';
create index subscription_payment_owner_created_idx on public.subscription_payment_requests(owner_id, created_at desc);
create index subscription_payment_open_created_idx on public.subscription_payment_requests(created_at desc)
    where status in ('requested', 'invoice_sent', 'verification_requested');
create index subscription_payment_approved_by_idx on public.subscription_payment_requests(approved_by);

create table public.business_subscriptions (
    owner_id uuid primary key references auth.users(id) on delete cascade,
    plan text not null check (plan in ('starter', 'business')),
    period_start timestamptz not null,
    period_end timestamptz not null check (period_end > period_start),
    last_payment_id uuid not null references public.subscription_payment_requests(id)
);
alter table public.business_subscriptions enable row level security;
revoke all on public.business_subscriptions from public, anon, authenticated;
grant select on public.business_subscriptions to authenticated;
grant select, insert, update, delete on public.business_subscriptions to service_role;
create policy "Owners read their subscription" on public.business_subscriptions
    for select to authenticated using ((select auth.uid()) = owner_id);
create index business_subscription_last_payment_idx on public.business_subscriptions(last_payment_id);

create function public.request_subscription_payment(requested_plan text, requested_cycle text, customer_phone text)
returns setof public.subscription_payment_requests
language plpgsql security definer set search_path = '' as $$
declare
    payment_owner uuid := auth.uid();
    verified_email text;
    price integer;
begin
    if payment_owner is null then raise exception 'Authentication required' using errcode = '42501'; end if;
    select email into verified_email from auth.users where id = payment_owner and email_confirmed_at is not null;
    if verified_email is null then raise exception 'Verified email required' using errcode = '42501'; end if;
    if requested_plan is null or requested_plan not in ('starter', 'business')
       or requested_cycle is null or requested_cycle not in ('monthly', 'annual')
       or customer_phone is null or customer_phone !~ '^\+7[0-9]{10}$' then
        raise exception 'Invalid payment details' using errcode = '22023';
    end if;
    price := case when requested_plan = 'starter' then 9950 else 24950 end;
    if requested_cycle = 'annual' then price := price * 12 * 80 / 100; end if;
    -- Requesting payment also starts the single free week, if not started yet.
    perform public.start_business_trial(requested_plan);
    insert into public.subscription_payment_requests(owner_id, owner_email, plan, billing_cycle, amount_kzt, kaspi_phone)
        values (payment_owner, verified_email, requested_plan, requested_cycle, price, customer_phone)
        on conflict (owner_id) where status in ('requested', 'invoice_sent', 'verification_requested') do nothing;
    return query select * from public.subscription_payment_requests
        where owner_id = payment_owner and status in ('requested', 'invoice_sent', 'verification_requested');
end;
$$;
revoke all on function public.request_subscription_payment(text,text,text) from public, anon, authenticated;
grant execute on function public.request_subscription_payment(text,text,text) to authenticated;

create function public.change_subscription_payment(
    payment_id uuid, requested_action text, received_amount integer default null,
    payment_reference text default null, rejection_reason text default null
) returns setof public.subscription_payment_requests
language plpgsql security definer set search_path = '' as $$
declare
    payment public.subscription_payment_requests;
    caller uuid := auth.uid();
    operator_allowed boolean := public.is_subscription_operator();
    paid_start timestamptz;
    existing_subscription public.business_subscriptions;
begin
    if caller is null then raise exception 'Authentication required' using errcode = '42501'; end if;
    select * into payment from public.subscription_payment_requests where id = payment_id for update;
    if not found then raise exception 'Payment unavailable' using errcode = '42501'; end if;
    if requested_action = 'mark_paid' then
        if payment.owner_id <> caller then raise exception 'Payment unavailable' using errcode = '42501'; end if;
        if payment.status = 'verification_requested' then return next payment; return; end if;
        if payment.status <> 'invoice_sent' then raise exception 'Invoice not payable' using errcode = 'P0001'; end if;
        update public.subscription_payment_requests set status = 'verification_requested', updated_at = now() where id = payment.id;
    elsif requested_action in ('mark_sent', 'approve', 'reject') then
        if not operator_allowed then raise exception 'Operator required' using errcode = '42501'; end if;
        if requested_action = 'mark_sent' then
            if payment.status = 'invoice_sent' then return next payment; return; end if;
            if payment.status <> 'requested' then raise exception 'Invalid payment state' using errcode = 'P0001'; end if;
            update public.subscription_payment_requests set status = 'invoice_sent', updated_at = now() where id = payment.id;
        elsif requested_action = 'reject' then
            if payment.status = 'rejected' then return next payment; return; end if;
            if payment.status = 'approved' then raise exception 'Approved payment is immutable' using errcode = 'P0001'; end if;
            if rejection_reason is null or char_length(btrim(rejection_reason)) not between 1 and 500 then
                raise exception 'Rejection reason required' using errcode = '22023';
            end if;
            update public.subscription_payment_requests set status = 'rejected',
                rejection_reason = btrim(change_subscription_payment.rejection_reason), updated_at = now() where id = payment.id;
        else
            if received_amount is distinct from payment.amount_kzt
               or payment_reference is null or char_length(btrim(payment_reference)) not between 1 and 120 then
                raise exception 'Exact received amount and bank reference required' using errcode = '22023';
            end if;
            if payment.status = 'approved' then
                if lower(payment.bank_reference) <> lower(btrim(payment_reference)) then
                    raise exception 'Approved payment is immutable' using errcode = 'P0001';
                end if;
                return next payment; return;
            end if;
            if payment.status not in ('invoice_sent', 'verification_requested') then
                raise exception 'Invoice must be sent before approval' using errcode = 'P0001';
            end if;
            -- Serialize approvals for the same owner before extending paid time.
            perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(payment.owner_id::text, 0));
            select * into existing_subscription from public.business_subscriptions where owner_id = payment.owner_id for update;
            paid_start := greatest(now(), existing_subscription.period_end,
                (select ends_at from public.business_trials where owner_id = payment.owner_id));
            update public.subscription_payment_requests set status = 'approved',
                bank_reference = btrim(payment_reference), approved_by = caller, approved_at = now(), updated_at = now()
                where id = payment.id;
            insert into public.business_subscriptions(owner_id, plan, period_start, period_end, last_payment_id)
                values (payment.owner_id, payment.plan, paid_start,
                    paid_start + pg_catalog.make_interval(months => case when payment.billing_cycle = 'annual' then 12 else 1 end), payment.id)
                on conflict (owner_id) do update set
                    plan = excluded.plan,
                    period_start = case when business_subscriptions.period_end > now()
                        then business_subscriptions.period_start else excluded.period_start end,
                    period_end = excluded.period_end, last_payment_id = excluded.last_payment_id;
        end if;
    else
        raise exception 'Unknown payment action' using errcode = '22023';
    end if;
    return query select * from public.subscription_payment_requests where id = payment.id;
end;
$$;
revoke all on function public.change_subscription_payment(uuid,text,integer,text,text) from public, anon, authenticated;
grant execute on function public.change_subscription_payment(uuid,text,integer,text,text) to authenticated;

create function public.has_workspace_access() returns boolean
language sql stable security invoker set search_path = '' as $$
    select public.is_subscription_operator()
        or exists (select 1 from public.business_trials where owner_id = (select auth.uid()) and ends_at > now())
        or exists (select 1 from public.business_subscriptions where owner_id = (select auth.uid()) and period_end > now());
$$;
revoke all on function public.has_workspace_access() from public, anon;
grant execute on function public.has_workspace_access() to authenticated, service_role;

-- Existing shops receive their first week at rollout; old orders stay readable.
insert into public.business_trials(owner_id, selected_plan)
    select owner_id, 'starter' from public.business_profiles on conflict (owner_id) do nothing;

create policy "Trial or subscription needed to create business profile" on public.business_profiles
    as restrictive for insert to authenticated with check ((select public.has_workspace_access()));
create policy "Trial or subscription needed to edit business profile" on public.business_profiles
    as restrictive for update to authenticated using ((select public.has_workspace_access())) with check ((select public.has_workspace_access()));
create policy "Trial or subscription needed to add catalog product" on public.catalog_products
    as restrictive for insert to authenticated with check ((select public.has_workspace_access()));
create policy "Trial or subscription needed to edit catalog product" on public.catalog_products
    as restrictive for update to authenticated using ((select public.has_workspace_access())) with check ((select public.has_workspace_access()));
create policy "Trial or subscription needed to delete catalog product" on public.catalog_products
    as restrictive for delete to authenticated using ((select public.has_workspace_access()));
create policy "Trial or subscription needed to connect Telegram" on public.telegram_businesses
    as restrictive for insert to authenticated with check ((select public.has_workspace_access()));
create policy "Trial or subscription needed to change Telegram" on public.telegram_businesses
    as restrictive for update to authenticated using ((select public.has_workspace_access())) with check ((select public.has_workspace_access()));
-- Restrict only this app's image bucket; do not affect unrelated buckets.
create policy "Trial or subscription needed to upload product image" on storage.objects
    as restrictive for insert to authenticated with check (bucket_id <> 'product-images' or (select public.has_workspace_access()));
create policy "Trial or subscription needed to replace product image" on storage.objects
    as restrictive for update to authenticated using (bucket_id <> 'product-images' or (select public.has_workspace_access()))
    with check (bucket_id <> 'product-images' or (select public.has_workspace_access()));

-- The Telegram service can check a shop without exposing other owners' records.
create function public.business_has_paid_access(business_owner uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
    select exists (select 1 from public.billing_operators where user_id = business_owner)
        or exists (select 1 from public.business_trials where owner_id = business_owner and ends_at > now())
        or exists (select 1 from public.business_subscriptions where owner_id = business_owner and period_end > now());
$$;
revoke all on function public.business_has_paid_access(uuid) from public, anon, authenticated;
grant execute on function public.business_has_paid_access(uuid) to service_role;
comment on function public.request_subscription_payment(text,text,text) is 'Authenticated users request their own invoice; prices are set by the server.';
comment on function public.change_subscription_payment(uuid,text,integer,text,text) is 'Owner may report payment; only allowlisted operators approve bank-verified amounts, atomically.';
