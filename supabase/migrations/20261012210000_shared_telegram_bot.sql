create table public.telegram_businesses (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users (id) on delete cascade,
    business_name text not null check (char_length(business_name) between 1 and 120),
    start_code text not null unique check (char_length(start_code) between 32 and 64),
    active boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint telegram_businesses_owner_unique unique (owner_id)
);

grant select, insert, update, delete
    on table public.telegram_businesses to authenticated;

alter table public.telegram_businesses enable row level security;

create policy "Owners can read their Telegram setup"
    on public.telegram_businesses for select
    using (auth.uid() = owner_id);

create policy "Owners can create their Telegram setup"
    on public.telegram_businesses for insert
    with check (auth.uid() = owner_id);

create policy "Owners can update their Telegram setup"
    on public.telegram_businesses for update
    using (auth.uid() = owner_id)
    with check (auth.uid() = owner_id);

create policy "Owners can delete their Telegram setup"
    on public.telegram_businesses for delete
    using (auth.uid() = owner_id);

create trigger set_telegram_businesses_updated_at
    before update on public.telegram_businesses
    for each row execute function public.set_catalog_product_updated_at();

create table public.telegram_chats (
    chat_id bigint primary key,
    business_id uuid not null references public.telegram_businesses (id) on delete cascade,
    last_update_id bigint not null default 0,
    last_reply text not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

grant select on table public.telegram_businesses, public.catalog_products to service_role;
grant select, insert, update, delete
    on table public.telegram_chats to service_role;

create index telegram_chats_business_idx
    on public.telegram_chats (business_id);

alter table public.telegram_chats enable row level security;

revoke all on table public.telegram_chats from anon, authenticated;
