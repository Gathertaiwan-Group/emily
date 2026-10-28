-- site_emily: payment gateways (藍新金流 NewebPay MPG) + WooCommerce-style stock handling.
-- Everything here is scoped to schema site_emily. Functions are callable by service_role only.

-- ---------------------------------------------------------------- payment events (raw notify log)
create table if not exists site_emily.payment_events (
  id            bigint generated always as identity primary key,
  received_at   timestamptz not null default now(),
  gateway       text not null,                 -- 'newebpay'
  kind          text not null,                 -- 'notify' | 'return'
  order_id      bigint,                        -- no FK: keep the log even if an order is deleted
  merchant_order_no text,
  trade_no      text,
  status        text,                          -- gateway Status (SUCCESS / error code)
  amount        numeric(12,2),
  outcome       text not null,                 -- paid | failed | duplicate | ignored | rejected:<reason>
  info          jsonb not null default '{}'::jsonb, -- decrypted Result (no card number beyond first6/last4)
  ip            inet
);
create index if not exists payment_events_order_idx on site_emily.payment_events (order_id, received_at desc);
alter table site_emily.payment_events enable row level security;
revoke all on site_emily.payment_events from anon, authenticated;
grant all on site_emily.payment_events to service_role;

-- ---------------------------------------------------------------- stock (WooCommerce semantics)
-- wc_maybe_reduce_stock_levels: once per order (meta.order_stock_reduced = 'yes'); remembers exactly what
-- it reduced in meta.order_stock_reductions so wc_maybe_increase_stock_levels can put it back.
create or replace function site_emily.order_reduce_stock(p_order_id bigint) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  o record; it record; done jsonb := '[]'::jsonb; n int;
begin
  select id, meta into o from site_emily.orders where id = p_order_id for update;
  if not found or coalesce(o.meta->>'order_stock_reduced', 'no') = 'yes' then return false; end if;
  for it in select id, product_id, variation_id, quantity from site_emily.order_items
            where order_id = p_order_id and item_type = 'line_item' and product_id is not null loop
    n := 0;
    if it.variation_id is not null then
      update site_emily.product_variations v
         set stock_quantity = v.stock_quantity - it.quantity,
             stock_status = case when v.stock_quantity - it.quantity > 0 then 'instock'
                                 when v.backorders <> 'no' then 'onbackorder' else 'outofstock' end
       where v.id = it.variation_id and v.manage_stock and v.stock_quantity is not null;
      get diagnostics n = row_count;
      if n > 0 then
        done := done || jsonb_build_object('item', it.id, 'target', 'variation', 'id', it.variation_id, 'qty', it.quantity);
      end if;
    end if;
    if n = 0 then
      update site_emily.products p
         set stock_quantity = p.stock_quantity - it.quantity,
             stock_status = case when p.stock_quantity - it.quantity > 0 then 'instock'
                                 when p.backorders <> 'no' then 'onbackorder' else 'outofstock' end
       where p.id = it.product_id and p.manage_stock and p.stock_quantity is not null;
      get diagnostics n = row_count;
      if n > 0 then
        done := done || jsonb_build_object('item', it.id, 'target', 'product', 'id', it.product_id, 'qty', it.quantity);
      end if;
    end if;
  end loop;
  update site_emily.orders
     set meta = meta || jsonb_build_object('order_stock_reduced', 'yes', 'order_stock_reductions', done)
   where id = p_order_id;
  return true;
end $$;

create or replace function site_emily.order_restore_stock(p_order_id bigint) returns boolean
language plpgsql security definer set search_path = '' as $$
declare o record; r jsonb;
begin
  select id, meta into o from site_emily.orders where id = p_order_id for update;
  if not found or coalesce(o.meta->>'order_stock_reduced', 'no') <> 'yes' then return false; end if;
  for r in select * from jsonb_array_elements(coalesce(o.meta->'order_stock_reductions', '[]'::jsonb)) loop
    if r->>'target' = 'variation' then
      update site_emily.product_variations v
         set stock_quantity = v.stock_quantity + (r->>'qty')::int,
             stock_status = case when v.stock_quantity + (r->>'qty')::int > 0 then 'instock'
                                 when v.backorders <> 'no' then 'onbackorder' else 'outofstock' end
       where v.id = (r->>'id')::bigint and v.stock_quantity is not null;
    else
      update site_emily.products p
         set stock_quantity = p.stock_quantity + (r->>'qty')::int,
             stock_status = case when p.stock_quantity + (r->>'qty')::int > 0 then 'instock'
                                 when p.backorders <> 'no' then 'onbackorder' else 'outofstock' end
       where p.id = (r->>'id')::bigint and p.stock_quantity is not null;
    end if;
  end loop;
  update site_emily.orders
     set meta = (meta - 'order_stock_reductions') || jsonb_build_object('order_stock_reduced', 'no')
   where id = p_order_id;
  return true;
end $$;

-- wc_update_total_sales_counts: once per order (meta.recorded_sales = 'yes').
create or replace function site_emily.order_record_sales(p_order_id bigint) returns boolean
language plpgsql security definer set search_path = '' as $$
declare o record;
begin
  select id, meta into o from site_emily.orders where id = p_order_id for update;
  if not found or coalesce(o.meta->>'recorded_sales', 'no') = 'yes' then return false; end if;
  update site_emily.products p set total_sales = p.total_sales + s.qty
    from (select product_id, sum(quantity)::int qty from site_emily.order_items
           where order_id = p_order_id and item_type = 'line_item' and product_id is not null group by product_id) s
   where p.id = s.product_id;
  update site_emily.orders set meta = meta || '{"recorded_sales":"yes"}'::jsonb where id = p_order_id;
  return true;
end $$;

-- Status side effects, as WooCommerce hooks them:
--   payment_complete / processing / completed / on-hold -> reduce stock + record sales
--   cancelled / pending                                 -> restore stock
create or replace function site_emily.order_status_effects(p_order_id bigint, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_status in ('processing', 'completed', 'on-hold') then
    perform site_emily.order_reduce_stock(p_order_id);
    perform site_emily.order_record_sales(p_order_id);
  elsif p_status in ('cancelled', 'pending') then
    perform site_emily.order_restore_stock(p_order_id);
  end if;
end $$;

-- ---------------------------------------------------------------- gateway transition (compare-and-set)
-- The notify handler decides the transition in TypeScript (pure, unit-tested) and applies it here
-- atomically: the order row is locked and the change only happens if the status is still p_from
-- (otherwise 'conflict' and the caller re-reads). Order note + audit_log are written in the same tx.
create or replace function site_emily.payment_transition(
  p_order_id bigint, p_from text, p_to text, p_trade_no text, p_meta jsonb, p_note text, p_actor text
) returns text
language plpgsql security definer set search_path = '' as $$
declare o record;
begin
  select id, status, date_paid, transaction_id into o from site_emily.orders where id = p_order_id for update;
  if not found then return 'not_found'; end if;
  if o.status <> p_from then return 'conflict'; end if;
  update site_emily.orders set
    status = p_to,
    date_modified = now(),
    date_paid = case when p_to in ('processing', 'completed') then coalesce(date_paid, now()) else date_paid end,
    transaction_id = coalesce(nullif(p_trade_no, ''), transaction_id),
    meta = meta || coalesce(p_meta, '{}'::jsonb)
  where id = p_order_id;
  perform site_emily.order_status_effects(p_order_id, p_to);
  if p_note is not null then
    insert into site_emily.order_notes (order_id, content, is_customer_note, added_by) values (p_order_id, p_note, false, p_actor);
  end if;
  insert into site_emily.audit_log (actor, source, action, entity_type, entity_id, before, after)
  values (p_actor, 'system', 'order.payment', 'order', p_order_id::text,
          jsonb_build_object('status', o.status, 'transaction_id', o.transaction_id),
          jsonb_build_object('status', p_to, 'transaction_id', p_trade_no, 'meta', p_meta));
  return 'ok';
end $$;

-- WooCommerce wc_cancel_unpaid_orders (hold stock minutes): unpaid online-gateway orders created at
-- checkout are cancelled after p_minutes and their stock is restored.
create or replace function site_emily.cancel_unpaid_orders(p_minutes int, p_methods text[]) returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select id from site_emily.orders
            where type = 'shop_order' and status = 'pending' and created_via = 'checkout'
              and payment_method = any(p_methods) and date_created < now() - make_interval(mins => p_minutes)
            for update skip locked loop
    update site_emily.orders set status = 'cancelled', date_modified = now() where id = r.id and status = 'pending';
    perform site_emily.order_status_effects(r.id, 'cancelled');
    insert into site_emily.order_notes (order_id, content, is_customer_note, added_by)
      values (r.id, '未付款訂單已取消 - 已達時間限制。訂單狀態已從 待付款 變更為 已取消。', false, 'system');
    insert into site_emily.audit_log (actor, source, action, entity_type, entity_id, before, after)
      values ('system', 'system', 'order.cancel_unpaid', 'order', r.id::text, '{"status":"pending"}'::jsonb, '{"status":"cancelled"}'::jsonb);
    n := n + 1;
  end loop;
  return n;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'order_reduce_stock(bigint)', 'order_restore_stock(bigint)', 'order_record_sales(bigint)',
    'order_status_effects(bigint, text)', 'payment_transition(bigint, text, text, text, jsonb, text, text)',
    'cancel_unpaid_orders(int, text[])']
  loop
    execute format('revoke all on function site_emily.%s from public, anon, authenticated', f);
    execute format('grant execute on function site_emily.%s to service_role', f);
  end loop;
end $$;
