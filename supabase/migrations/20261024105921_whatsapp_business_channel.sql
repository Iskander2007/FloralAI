-- WhatsApp is independent of the shared Telegram bot: one authorized phone per owner.
create table public.whatsapp_connections (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null unique references auth.users(id) on delete cascade,
    waba_id text not null check (waba_id ~ '^[0-9]{1,30}$'),
    phone_number_id text not null unique check (phone_number_id ~ '^[0-9]{1,30}$'),
    display_phone text not null,
    verified_name text not null default '',
    token_ciphertext text not null,
    token_expires_at timestamptz,
    active boolean not null default false,
    connected_at timestamptz,
    created_at timestamptz not null default now()
);
create index whatsapp_connections_waba_idx on public.whatsapp_connections(waba_id);

create table public.whatsapp_signup_attempts (
    owner_id uuid primary key references auth.users(id) on delete cascade,
    nonce_hash text not null check (nonce_hash ~ '^[a-f0-9]{64}$'),
    mode text not null check (mode in ('cloud', 'coexistence')),
    expires_at timestamptz not null
);

create table public.whatsapp_chats (
    connection_id uuid not null references public.whatsapp_connections(id) on delete cascade,
    customer_phone text not null check (customer_phone ~ '^[0-9]{7,15}$'),
    paused boolean not null default false,
    lease_id uuid,
    lease_until timestamptz,
    updated_at timestamptz not null default now(),
    primary key (connection_id, customer_phone)
);

create table public.whatsapp_events (
    id bigint generated always as identity primary key,
    message_id text not null unique check (char_length(message_id) between 1 and 500),
    connection_id uuid not null references public.whatsapp_connections(id) on delete cascade,
    customer_phone text not null check (customer_phone ~ '^[0-9]{7,15}$'),
    content text not null check (char_length(content) <= 4000),
    message_timestamp timestamptz not null,
    reply text check (char_length(reply) between 1 and 4000),
    handoff boolean not null default false,
    status text not null default 'pending' check (status in ('pending', 'ready', 'sent', 'ignored')),
    outgoing_message_id text,
    created_at timestamptz not null default now()
);
create index whatsapp_events_chat_idx on public.whatsapp_events(connection_id, customer_phone, id);
create index whatsapp_events_pending_idx on public.whatsapp_events(connection_id, customer_phone, id)
    where status in ('pending', 'ready');
create index whatsapp_chats_recent_idx on public.whatsapp_chats(connection_id, updated_at desc);

-- Only authenticated server endpoints may read these tables. In particular, the
-- encrypted token is never exposed through client-side SELECT or a definer view.
alter table public.whatsapp_connections enable row level security;
alter table public.whatsapp_signup_attempts enable row level security;
alter table public.whatsapp_chats enable row level security;
alter table public.whatsapp_events enable row level security;
revoke all on public.whatsapp_connections, public.whatsapp_signup_attempts,
    public.whatsapp_chats, public.whatsapp_events from public, anon, authenticated;
grant select, insert, update, delete on public.whatsapp_connections, public.whatsapp_signup_attempts,
    public.whatsapp_chats, public.whatsapp_events to service_role;
grant usage, select on sequence public.whatsapp_events_id_seq to service_role;

create function public.preserve_whatsapp_binding() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
    if new.id <> old.id or new.owner_id <> old.owner_id
        or new.waba_id <> old.waba_id or new.phone_number_id <> old.phone_number_id then
        raise exception 'WhatsApp connection identity cannot be reassigned';
    end if;
    return new;
end;
$$;
revoke all on function public.preserve_whatsapp_binding() from public, anon, authenticated;
grant execute on function public.preserve_whatsapp_binding() to service_role;
create trigger preserve_whatsapp_connection_binding before update on public.whatsapp_connections
    for each row execute function public.preserve_whatsapp_binding();

-- A per-chat lease serializes work across concurrent webhook deliveries. The
-- generated reply commits before transport, and retries reuse the same reply.
create function public.claim_whatsapp_turn(p_connection uuid, p_customer text, p_lease uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
    v_connection public.whatsapp_connections%rowtype;
    v_chat public.whatsapp_chats%rowtype;
    v_event public.whatsapp_events%rowtype;
begin
    select * into v_connection from public.whatsapp_connections where id = p_connection for share;
    if not found or not v_connection.active or v_connection.connected_at is null
        or (v_connection.token_expires_at is not null and v_connection.token_expires_at <= now()) then
        update public.whatsapp_events set status = 'ignored'
            where connection_id = p_connection and customer_phone = p_customer and status in ('pending', 'ready');
        return jsonb_build_object('outcome', 'inactive');
    end if;
    if not public.business_has_paid_access(v_connection.owner_id) then
        update public.whatsapp_events set status = 'ignored'
            where connection_id = p_connection and customer_phone = p_customer and status in ('pending', 'ready');
        return jsonb_build_object('outcome', 'inactive');
    end if;
    insert into public.whatsapp_chats(connection_id, customer_phone) values (p_connection, p_customer)
        on conflict do nothing;
    select * into strict v_chat from public.whatsapp_chats
        where connection_id = p_connection and customer_phone = p_customer for update;
    if v_chat.lease_until > now() then return jsonb_build_object('outcome', 'busy'); end if;
    update public.whatsapp_chats set updated_at = now()
        where connection_id = p_connection and customer_phone = p_customer;
    if v_chat.paused then
        update public.whatsapp_events set status = 'ignored'
            where connection_id = p_connection and customer_phone = p_customer
                and (status = 'pending' or (status = 'ready' and not handoff));
        if not exists (select 1 from public.whatsapp_events where connection_id = p_connection
            and customer_phone = p_customer and status = 'ready' and handoff) then
            return jsonb_build_object('outcome', 'paused');
        end if;
    end if;
    update public.whatsapp_events set status = 'ignored'
        where connection_id = p_connection and customer_phone = p_customer
        and status in ('pending', 'ready') and message_timestamp <= now() - interval '24 hours';
    select * into v_event from public.whatsapp_events
        where connection_id = p_connection and customer_phone = p_customer and status in ('pending', 'ready')
        order by id limit 1 for update;
    if not found then return jsonb_build_object('outcome', 'empty'); end if;
    update public.whatsapp_chats set lease_id = p_lease, lease_until = now() + interval '90 seconds', updated_at = now()
        where connection_id = p_connection and customer_phone = p_customer;
    return jsonb_build_object('outcome', 'claimed', 'event', to_jsonb(v_event));
end;
$$;

create function public.prepare_whatsapp_reply(p_connection uuid, p_customer text, p_lease uuid,
    p_event bigint, p_reply text, p_handoff boolean)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_chat public.whatsapp_chats%rowtype; v_connection public.whatsapp_connections%rowtype;
begin
    select * into v_connection from public.whatsapp_connections where id = p_connection for share;
    select * into v_chat from public.whatsapp_chats
        where connection_id = p_connection and customer_phone = p_customer for update;
    if v_chat.lease_id is distinct from p_lease or v_chat.lease_until <= now() then return false; end if;
    if not v_connection.active or v_chat.paused or not public.business_has_paid_access(v_connection.owner_id) then
        update public.whatsapp_events set status = 'ignored' where id = p_event and connection_id = p_connection;
        update public.whatsapp_chats set lease_id = null, lease_until = null
            where connection_id = p_connection and customer_phone = p_customer;
        return false;
    end if;
    update public.whatsapp_events set reply = p_reply, status = 'ready', handoff = p_handoff
        where id = p_event and connection_id = p_connection and customer_phone = p_customer and status = 'pending';
    if not found then return false; end if;
    if p_handoff then update public.whatsapp_chats set paused = true
        where connection_id = p_connection and customer_phone = p_customer; end if;
    return true;
end;
$$;

create function public.finish_whatsapp_turn(p_connection uuid, p_customer text, p_lease uuid,
    p_event bigint, p_outgoing text default null)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_chat public.whatsapp_chats%rowtype;
begin
    select * into v_chat from public.whatsapp_chats
        where connection_id = p_connection and customer_phone = p_customer for update;
    if v_chat.lease_id is distinct from p_lease then return false; end if;
    if p_outgoing is not null then
        update public.whatsapp_events set status = 'sent', outgoing_message_id = p_outgoing
            where id = p_event and connection_id = p_connection and customer_phone = p_customer and status = 'ready';
        if not found then return false; end if;
    end if;
    update public.whatsapp_chats set lease_id = null, lease_until = null, updated_at = now()
        where connection_id = p_connection and customer_phone = p_customer;
    return true;
end;
$$;

revoke all on function public.claim_whatsapp_turn(uuid, text, uuid),
    public.prepare_whatsapp_reply(uuid, text, uuid, bigint, text, boolean),
    public.finish_whatsapp_turn(uuid, text, uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.claim_whatsapp_turn(uuid, text, uuid),
    public.prepare_whatsapp_reply(uuid, text, uuid, bigint, text, boolean),
    public.finish_whatsapp_turn(uuid, text, uuid, bigint, text) to service_role;
