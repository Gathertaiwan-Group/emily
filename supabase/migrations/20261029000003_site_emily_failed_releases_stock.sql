-- site_emily: a failed payment releases the stock it held (2026-10-29 final review, Medium).
-- Before: 信用卡一次付清 (ry_newebpay_credit) reduces stock at checkout; a declined card turns the order
-- pending -> failed, but failed had no stock effect, is not cancelled by the hold-expiry cron (pending
-- only) and was not counted by checkout_guard -> every declined card locked its items for good.
-- Now:
--  1. order_status_effects: 'failed' restores stock like cancelled/pending. order_restore_stock is
--     once-only (meta.order_stock_reduced), and a later processing/completed/on-hold (late paid notify or
--     admin) reduces again via the same flag — the decision is "is stock currently reduced on this order"
--     + "does the new status hold stock", never the previous status, so detours through on-hold etc. are
--     covered.
--  2. checkout_guard: failed online orders inside the hold window count toward the per-IP / per-e-mail
--     cap of 3 unpaid orders, so repeatedly declined cards are capped like unpaid ones.
-- Everything is scoped to schema site_emily. Functions are callable by service_role only.

create or replace function site_emily.order_status_effects(p_order_id bigint, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_status in ('processing', 'completed', 'on-hold') then
    perform site_emily.order_reduce_stock(p_order_id);
    perform site_emily.order_record_sales(p_order_id);
  elsif p_status in ('cancelled', 'pending', 'failed') then
    perform site_emily.order_restore_stock(p_order_id);
  end if;
end $$;

create or replace function site_emily.checkout_guard(
  p_ip inet, p_email text, p_online boolean, p_methods text[], p_hold_minutes int default 60
) returns text
language plpgsql security definer set search_path = '' as $$
declare em text := lower(trim(coalesce(p_email, ''))); n int;
begin
  if p_ip is not null then perform pg_advisory_xact_lock(hashtextextended('site_emily.checkout.ip:' || host(p_ip), 0)); end if;
  perform pg_advisory_xact_lock(hashtextextended('site_emily.checkout.email:' || em, 0));

  if p_ip is not null then
    select count(*) into n from site_emily.checkout_attempts where ip = p_ip and at > now() - interval '10 minutes';
    if n >= 6 then return 'rate_limited'; end if;
    select count(*) into n from site_emily.checkout_attempts where ip = p_ip and at > now() - interval '1 hour';
    if n >= 20 then return 'rate_limited'; end if;
  end if;
  select count(*) into n from site_emily.checkout_attempts where email = em and at > now() - interval '10 minutes';
  if n >= 6 then return 'rate_limited'; end if;

  if p_online then
    select count(*) into n from site_emily.orders
     where type = 'shop_order' and status in ('pending', 'failed') and created_via = 'checkout'
       and payment_method = any(p_methods)
       and date_created > now() - make_interval(mins => p_hold_minutes)
       and ((p_ip is not null and customer_ip = p_ip) or lower(billing_email) = em);
    if n >= 3 then return 'too_many_unpaid'; end if;
  end if;

  insert into site_emily.checkout_attempts (ip, email, online) values (p_ip, em, coalesce(p_online, false));
  delete from site_emily.checkout_attempts where at < now() - interval '1 day';
  return 'ok';
end $$;

create index if not exists orders_unpaid_failed_online_idx on site_emily.orders (status, date_created) where status in ('pending', 'failed');

do $$
declare f text;
begin
  foreach f in array array['order_status_effects(bigint, text)', 'checkout_guard(inet, text, boolean, text[], int)']
  loop
    execute format('revoke all on function site_emily.%s from public, anon, authenticated', f);
    execute format('grant execute on function site_emily.%s to service_role', f);
  end loop;
end $$;
