-- site_emily: (1) restock note when stock goes negative, (2) pg_cron job releasing expired unpaid holds.
-- Only touches schema site_emily and the single cron job named 'site_emily_expire_holds'.

-- ---------------------------------------------------------------- 1. order_reduce_stock + negative-stock note
-- Same WooCommerce semantics as 20261028000001 (once per order via meta.order_stock_reduced; no
-- availability check — an order coming back from cancelled/failed to processing/completed is reduced
-- again even if that takes stock below zero). New: when a reduction leaves stock < 0 an order note
-- lists the affected items, so the shop owner sees it on the order.
create or replace function site_emily.order_reduce_stock(p_order_id bigint) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  o record; it record; done jsonb := '[]'::jsonb; n int; left_qty int; neg text[] := '{}';
begin
  select id, meta into o from site_emily.orders where id = p_order_id for update;
  if not found or coalesce(o.meta->>'order_stock_reduced', 'no') = 'yes' then return false; end if;
  for it in select id, name, product_id, variation_id, quantity from site_emily.order_items
            where order_id = p_order_id and item_type = 'line_item' and product_id is not null loop
    n := 0;
    if it.variation_id is not null then
      update site_emily.product_variations v
         set stock_quantity = v.stock_quantity - it.quantity,
             stock_status = case when v.stock_quantity - it.quantity > 0 then 'instock'
                                 when v.backorders <> 'no' then 'onbackorder' else 'outofstock' end
       where v.id = it.variation_id and v.manage_stock and v.stock_quantity is not null
      returning v.stock_quantity into left_qty;
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
       where p.id = it.product_id and p.manage_stock and p.stock_quantity is not null
      returning p.stock_quantity into left_qty;
      get diagnostics n = row_count;
      if n > 0 then
        done := done || jsonb_build_object('item', it.id, 'target', 'product', 'id', it.product_id, 'qty', it.quantity);
      end if;
    end if;
    if n > 0 and left_qty < 0 then
      neg := neg || format('%s（-%s，剩餘 %s）', coalesce(it.name, '#' || it.product_id), it.quantity, left_qty);
    end if;
  end loop;
  update site_emily.orders
     set meta = meta || jsonb_build_object('order_stock_reduced', 'yes', 'order_stock_reductions', done)
   where id = p_order_id;
  if cardinality(neg) > 0 then
    insert into site_emily.order_notes (order_id, content, is_customer_note, added_by)
    values (p_order_id, '庫存已扣減為負數，請確認是否能出貨或補貨：' || array_to_string(neg, '、'), false, 'system');
  end if;
  return true;
end $$;
revoke all on function site_emily.order_reduce_stock(bigint) from public, anon, authenticated;
grant execute on function site_emily.order_reduce_stock(bigint) to service_role;

-- ---------------------------------------------------------------- 2. pg_cron: release expired holds
-- 信用卡一次付清 (ry_newebpay_credit) reduces stock at checkout; until now the 60-minute hold was only
-- released lazily (checkout / admin orders page). Every 5 minutes, cancel unpaid online orders older
-- than woocommerce_hold_stock_minutes (60) and restore their stock. Methods = ONLINE_METHODS in
-- src/lib/payments.ts. Re-runnable: drop the same-named job first.
select cron.unschedule(jobid) from cron.job where jobname = 'site_emily_expire_holds';
select cron.schedule(
  'site_emily_expire_holds',
  '*/5 * * * *',
  $cron$select site_emily.cancel_unpaid_orders(60, array['newebpay','ry_newebpay_credit']::text[])$cron$
);
