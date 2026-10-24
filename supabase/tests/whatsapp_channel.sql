-- Integration checks use temporary fixtures and always roll back all rows.
begin;
select set_config('floral_test.whatsapp_owner', gen_random_uuid()::text, true);
insert into auth.users(id) values (current_setting('floral_test.whatsapp_owner')::uuid);
insert into public.business_trials(owner_id, selected_plan)
    values (current_setting('floral_test.whatsapp_owner')::uuid, 'starter');
insert into public.whatsapp_connections(owner_id, waba_id, phone_number_id, display_phone, token_ciphertext, active, connected_at)
    values (current_setting('floral_test.whatsapp_owner')::uuid, '999999999999991', '999999999999992', '+19999999999', 'test-ciphertext', true, now());
set local role service_role;
do $$
declare
    v_connection uuid;
    v_event bigint;
    v_lease uuid := gen_random_uuid();
    v_retry uuid := gen_random_uuid();
    v_result jsonb;
    v_blocked boolean := false;
begin
    if has_table_privilege('anon', 'public.whatsapp_connections', 'SELECT')
        or has_table_privilege('authenticated', 'public.whatsapp_connections', 'SELECT')
        or has_function_privilege('anon', 'public.claim_whatsapp_turn(uuid,text,uuid)', 'EXECUTE')
        or has_function_privilege('authenticated', 'public.prepare_whatsapp_reply(uuid,text,uuid,bigint,text,boolean)', 'EXECUTE') then
        raise exception 'WhatsApp backend storage or functions exposed to browser roles';
    end if;
    select id into strict v_connection from public.whatsapp_connections
        where owner_id = current_setting('floral_test.whatsapp_owner')::uuid;
    insert into public.whatsapp_events(message_id, connection_id, customer_phone, content, message_timestamp)
        values ('whatsapp-sql-test-1', v_connection, '19999999999', 'test question', now()) returning id into v_event;
    insert into public.whatsapp_events(message_id, connection_id, customer_phone, content, message_timestamp)
        values ('whatsapp-sql-test-1', v_connection, '19999999999', 'duplicate', now()) on conflict(message_id) do nothing;
    if (select count(*) from public.whatsapp_events where connection_id = v_connection) <> 1 then
        raise exception 'Duplicate delivery inserted another event';
    end if;
    v_result := public.claim_whatsapp_turn(v_connection, '19999999999', v_lease);
    if v_result->>'outcome' <> 'claimed' then raise exception 'Unable to claim first event: %', v_result; end if;
    if public.claim_whatsapp_turn(v_connection, '19999999999', v_retry)->>'outcome' <> 'busy' then
        raise exception 'Concurrent worker acquired the same conversation';
    end if;
    if not public.prepare_whatsapp_reply(v_connection, '19999999999', v_lease, v_event, 'approved reply', false) then
        raise exception 'Unable to prepare reply';
    end if;
    if not public.finish_whatsapp_turn(v_connection, '19999999999', v_lease, v_event, 'outgoing-sql-1') then
        raise exception 'Unable to mark reply sent';
    end if;
    if public.claim_whatsapp_turn(v_connection, '19999999999', v_retry)->>'outcome' <> 'empty' then
        raise exception 'Successful send was replayed';
    end if;
    insert into public.whatsapp_events(message_id, connection_id, customer_phone, content, message_timestamp)
        values ('whatsapp-sql-test-2', v_connection, '19999999999', 'operator', now()) returning id into v_event;
    perform public.claim_whatsapp_turn(v_connection, '19999999999', v_lease);
    if not public.prepare_whatsapp_reply(v_connection, '19999999999', v_lease, v_event, 'handoff acknowledgment', true) then
        raise exception 'Unable to prepare handoff';
    end if;
    perform public.finish_whatsapp_turn(v_connection, '19999999999', v_lease, v_event);
    v_result := public.claim_whatsapp_turn(v_connection, '19999999999', v_retry);
    if v_result->>'outcome' <> 'claimed' or v_result->'event'->>'reply' <> 'handoff acknowledgment' then
        raise exception 'Handoff acknowledgment lost after transport failure: %', v_result;
    end if;
    perform public.finish_whatsapp_turn(v_connection, '19999999999', v_retry, v_event, 'outgoing-sql-2');
    insert into public.whatsapp_events(message_id, connection_id, customer_phone, content, message_timestamp)
        values ('whatsapp-sql-test-3', v_connection, '19999999999', 'private question for person', now());
    if public.claim_whatsapp_turn(v_connection, '19999999999', v_lease)->>'outcome' <> 'paused' then
        raise exception 'Bot did not honor human takeover';
    end if;
    update public.whatsapp_chats set paused = false where connection_id = v_connection;
    insert into public.whatsapp_events(message_id, connection_id, customer_phone, content, message_timestamp)
        values ('whatsapp-sql-test-4', v_connection, '19999999999', 'new question', now()) returning id into v_event;
    perform public.claim_whatsapp_turn(v_connection, '19999999999', v_lease);
    update public.whatsapp_chats set lease_until = now() - interval '1 second' where connection_id = v_connection;
    if public.claim_whatsapp_turn(v_connection, '19999999999', v_retry)->>'outcome' <> 'claimed' then
        raise exception 'Expired worker lease did not recover';
    end if;
    if public.prepare_whatsapp_reply(v_connection, '19999999999', v_lease, v_event, 'stale worker', false) then
        raise exception 'Stale worker overwrote new worker';
    end if;
    update public.whatsapp_chats set paused = true where connection_id = v_connection;
    if public.prepare_whatsapp_reply(v_connection, '19999999999', v_retry, v_event, 'should not send', false) then
        raise exception 'Owner pause during generation was ignored';
    end if;
    update public.whatsapp_chats set paused = false where connection_id = v_connection;
    insert into public.whatsapp_events(message_id, connection_id, customer_phone, content, message_timestamp)
        values ('whatsapp-sql-test-5', v_connection, '19999999999', 'too old', now() - interval '25 hours');
    if public.claim_whatsapp_turn(v_connection, '19999999999', v_lease)->>'outcome' <> 'empty' then
        raise exception 'Expired customer service window was ignored';
    end if;
    begin
        update public.whatsapp_connections set phone_number_id = '999999999999993' where id = v_connection;
    exception when raise_exception then v_blocked := true;
    end;
    if not v_blocked then raise exception 'Connection phone could be rebound with existing customer history'; end if;
    delete from public.business_trials where owner_id = current_setting('floral_test.whatsapp_owner')::uuid;
    if public.claim_whatsapp_turn(v_connection, '19999999999', v_lease)->>'outcome' <> 'inactive' then
        raise exception 'Subscription expiry was ignored';
    end if;
end;
$$;
reset role;
rollback;
