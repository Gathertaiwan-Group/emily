-- site_emily: payment hardening after security review (2026-10-29).
--  1. newebpay_register_order_no: atomic append of a MerchantOrderNo to orders.meta (was read-modify-write
--     in the pay route, so two tabs hitting /api/newebpay/pay at once could drop one number and the later
--     paid notify for it was rejected as order_no_mismatch).
--  2. checkout_guard: DB-counted checkout rate limit + cap on unpaid online (藍新) orders per IP / email,
--     so nobody can lock stock by spamming checkouts that reduce stock and are only released after the
--     60-minute hold.
-- Everything is scoped to schema site_emily. Functions are callable by service_role only.

-- ---------------------------------------------------------------- 1. MerchantOrderNo registry
create or replace function site_emily.newebpay_register_order_no(p_order_id bigint, p_no text, p_keep int default 20)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare o record; hist jsonb;
begin
  -- row lock: concurrent callers for the same order run one after another and each sees the previous append
  select id, meta into o from site_emily.orders
   where id = p_order_id and type = 'shop_order' and status = 'pending' for update;
  if not found then return false; end if;
  hist := case when jsonb_typeof(o.meta->'newebpay_order_nos') = 'array' then o.meta->'newebpay_order_nos' else '[]'::jsonb end;
  hist := hist || to_jsonb(p_no);
  -- keep the newest p_keep numbers
  select coalesce(jsonb_agg(x order by ord), '[]'::jsonb) into hist
    from (select x, ord from jsonb_array_elements(hist) with ordinality t(x, ord) order by ord desc limit greatest(p_keep, 1)) s;
  update site_emily.orders
     set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('newebpay_MerchantOrderNo', p_no, 'newebpay_order_nos', hist)
   where id = p_order_id;
  return true;
end $$;

-- ---------------------------------------------------------------- 2. checkout guard
create table if not exists site_emily.checkout_attempts (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  ip         inet,
  email      text not null,
  online     boolean not null
);
create index if not exists checkout_attempts_ip_idx on site_emily.checkout_attempts (ip, at desc);
create index if not exists checkout_attempts_email_idx on site_emily.checkout_attempts (email, at desc);
create index if not exists checkout_attempts_at_idx on site_emily.checkout_attempts (at);
alter table site_emily.checkout_attempts enable row level security;
revoke all on site_emily.checkout_attempts from anon, authenticated;
grant all on site_emily.checkout_attempts to service_role;

create index if not exists orders_unpaid_online_idx on site_emily.orders (status, date_created) where status = 'pending';

-- Returns 'ok' (and records the attempt) or 'rate_limited' / 'too_many_unpaid'.
-- Limits (per IP, and per e-mail): 6 checkouts / 10 min, 20 / hour per IP; and at most 3 unpaid online
-- orders still holding stock (pending, created at checkout within the hold window) per IP or e-mail.
create or replace function site_emily.checkout_guard(
  p_ip inet, p_email text, p_online boolean, p_methods text[], p_hold_minutes int default 60
) returns text
language plpgsql security definer set search_path = '' as $$
declare em text := lower(trim(coalesce(p_email, ''))); n int;
begin
  -- serialise checkouts sharing an IP / e-mail so parallel requests cannot all slip under a limit.
  -- Always ip-lock first, then e-mail lock -> no lock-order cycle.
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
     where type = 'shop_order' and status = 'pending' and created_via = 'checkout'
       and payment_method = any(p_methods)
       and date_created > now() - make_interval(mins => p_hold_minutes)
       and ((p_ip is not null and customer_ip = p_ip) or lower(billing_email) = em);
    if n >= 3 then return 'too_many_unpaid'; end if;
  end if;

  insert into site_emily.checkout_attempts (ip, email, online) values (p_ip, em, coalesce(p_online, false));
  delete from site_emily.checkout_attempts where at < now() - interval '1 day';
  return 'ok';
end $$;

do $$
declare f text;
begin
  foreach f in array array['newebpay_register_order_no(bigint, text, int)', 'checkout_guard(inet, text, boolean, text[], int)']
  loop
    execute format('revoke all on function site_emily.%s from public, anon, authenticated', f);
    execute format('grant execute on function site_emily.%s to service_role', f);
  end loop;
end $$;
