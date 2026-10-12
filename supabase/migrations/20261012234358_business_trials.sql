-- One immutable seven-day trial per authenticated account. Payment activation
-- is intentionally separate: no card details or client-declared paid statuses.
create table public.business_trials (
    owner_id uuid primary key references auth.users (id) on delete cascade,
    started_at timestamptz not null default now(),
    ends_at timestamptz not null default (now() + interval '168 hours'),
    selected_plan text not null check (selected_plan in ('starter', 'business')),
    check (ends_at = started_at + interval '168 hours')
);

alter table public.business_trials enable row level security;
revoke all on public.business_trials from public, anon, authenticated;
grant select on public.business_trials to authenticated;
grant select, insert, update, delete on public.business_trials to service_role;
create policy "Owners read their subscription trial" on public.business_trials
    for select to authenticated using ((select auth.uid()) = owner_id);

create function public.start_business_trial(requested_plan text)
returns setof public.business_trials
language plpgsql security definer set search_path = '' as $$
declare
    trial_owner uuid := auth.uid();
begin
    if trial_owner is null then
        raise exception 'Authentication required' using errcode = '28000';
    end if;
    if requested_plan is null or requested_plan not in ('starter', 'business') then
        raise exception 'Invalid subscription plan' using errcode = '22023';
    end if;
    insert into public.business_trials (owner_id, selected_plan)
        values (trial_owner, requested_plan)
        on conflict (owner_id) do nothing;
    return query select * from public.business_trials where owner_id = trial_owner;
end;
$$;
revoke all on function public.start_business_trial(text) from public, anon, authenticated;
grant execute on function public.start_business_trial(text) to authenticated;
comment on function public.start_business_trial(text) is
    'Intentionally authenticated: starts only auth.uid() trial, once; accepts no owner or dates.';
