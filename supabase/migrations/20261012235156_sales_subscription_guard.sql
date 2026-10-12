-- Recheck access inside the sales transaction so expiry cannot race order creation.
create function public.require_sales_business_access() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
    if not public.business_has_paid_access(new.owner_id) then
        raise exception 'Business subscription required' using errcode = '42501';
    end if;
    return new;
end;
$$;
revoke all on function public.require_sales_business_access() from public, anon, authenticated;
grant execute on function public.require_sales_business_access() to service_role;
create trigger require_order_subscription before insert on public.sales_orders
    for each row execute function public.require_sales_business_access();
create trigger require_message_subscription before insert on public.sales_messages
    for each row execute function public.require_sales_business_access();
