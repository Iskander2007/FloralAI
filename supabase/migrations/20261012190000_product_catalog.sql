create table public.catalog_products (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users (id) on delete cascade,
    name text not null check (char_length(name) between 1 and 120),
    price_kzt integer not null check (price_kzt >= 0),
    description text not null default '' check (char_length(description) <= 1000),
    image_path text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

grant select, insert, update, delete
    on table public.catalog_products to authenticated;

create index catalog_products_owner_created_idx
    on public.catalog_products (owner_id, created_at desc);

alter table public.catalog_products enable row level security;

create policy "Owners can read their catalog products"
    on public.catalog_products for select
    using (auth.uid() = owner_id);

create policy "Owners can add catalog products"
    on public.catalog_products for insert
    with check (auth.uid() = owner_id);

create policy "Owners can update their catalog products"
    on public.catalog_products for update
    using (auth.uid() = owner_id)
    with check (auth.uid() = owner_id);

create policy "Owners can delete their catalog products"
    on public.catalog_products for delete
    using (auth.uid() = owner_id);

create function public.set_catalog_product_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at = pg_catalog.now();
    return new;
end;
$$;

create trigger set_catalog_products_updated_at
    before update on public.catalog_products
    for each row execute function public.set_catalog_product_updated_at();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'product-images',
    'product-images',
    true,
    5242880,
    array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Owners can upload product images"
    on storage.objects for insert
    with check (
        bucket_id = 'product-images'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

create policy "Owners can replace their product images"
    on storage.objects for update
    using (
        bucket_id = 'product-images'
        and (storage.foldername(name))[1] = auth.uid()::text
    )
    with check (
        bucket_id = 'product-images'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

create policy "Owners can delete their product images"
    on storage.objects for delete
    using (
        bucket_id = 'product-images'
        and (storage.foldername(name))[1] = auth.uid()::text
    );
