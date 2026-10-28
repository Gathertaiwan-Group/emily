import "server-only";
import { db } from "@/lib/db";
import { CmsError, audit, changed, ilikeTerm, must, type Actor } from "./core";

/* ------------------------------------------------------------------ orders */
export const ORDER_STATUSES: Record<string, string> = {
  pending: "待付款",
  processing: "處理中",
  "on-hold": "保留",
  completed: "已完成",
  cancelled: "已取消",
  refunded: "已退款",
  failed: "失敗",
  "checkout-draft": "草稿",
};

export async function listOrders(opts: { status?: string; search?: string; customerId?: number; page?: number; per?: number } = {}) {
  const per = Math.min(Math.max(opts.per ?? 20, 1), 200);
  const page = Math.max(opts.page ?? 1, 1);
  let q = db()
    .from("orders")
    .select("id,number,status,currency,total,billing_email,billing,payment_method_title,customer_id,date_created,date_paid", { count: "exact" })
    .eq("type", "shop_order");
  if (opts.status && opts.status !== "all") q = q.eq("status", opts.status);
  if (opts.customerId) q = q.eq("customer_id", opts.customerId);
  if (opts.search) {
    const t = ilikeTerm(opts.search);
    const asNum = Number(opts.search);
    q = q.or(`billing_email.ilike.%${t}%,number.ilike.%${t}%${Number.isInteger(asNum) && asNum > 0 ? `,id.eq.${asNum}` : ""}`);
  }
  const r = await q.order("date_created", { ascending: false }).range((page - 1) * per, page * per - 1);
  return { rows: must(r, "orders") as any[], total: r.count ?? 0, page, per };
}

export async function orderStatusCounts() {
  const out: Record<string, number> = {};
  await Promise.all(
    Object.keys(ORDER_STATUSES).map(async (s) => {
      const r = await db().from("orders").select("id", { count: "exact", head: true }).eq("type", "shop_order").eq("status", s);
      out[s] = r.count ?? 0;
    }),
  );
  return out;
}

export async function getOrder(id: number) {
  const o = must(await db().from("orders").select("*").eq("id", id).maybeSingle(), "orders") as any;
  if (!o) return null;
  const [items, notes, refunds, payments] = await Promise.all([
    db().from("order_items").select("*").eq("order_id", id).order("id"),
    db().from("order_notes").select("*").eq("order_id", id).order("date", { ascending: false }),
    db().from("orders").select("id,total,date_created,meta").eq("parent_id", id).eq("type", "shop_order_refund"),
    db().from("payment_events").select("received_at,gateway,merchant_order_no,trade_no,status,amount,outcome,info").eq("order_id", id).order("received_at", { ascending: false }).limit(50),
  ]);
  return { ...o, items: must(items, "order_items") as any[], notes: must(notes, "order_notes") as any[], refunds: must(refunds, "orders") as any[], payments: (payments.data ?? []) as any[] };
}

export async function updateOrderStatus(actor: Actor, id: number, status: string, note?: string) {
  if (!ORDER_STATUSES[status]) throw new CmsError(`不支援的訂單狀態：${status}`);
  const before = must(await db().from("orders").select("id,status,date_paid,date_completed").eq("id", id).maybeSingle(), "orders") as any;
  if (!before) throw new CmsError(`找不到訂單 ${id}`, 404);
  const now = new Date().toISOString();
  const row: Record<string, any> = { status, date_modified: now };
  if ((status === "processing" || status === "completed") && !before.date_paid) row.date_paid = now;
  if (status === "completed") row.date_completed = now;
  must(await db().from("orders").update(row).eq("id", id), "orders");
  // Stock hooks (reduce on processing/completed/on-hold, restore on cancelled/pending/failed); idempotent via
  // meta.order_stock_reduced, so any path (e.g. cancelled -> on-hold -> processing) reduces exactly once.
  if (before.status !== status) must(await db().rpc("order_status_effects", { p_order_id: id, p_status: status }), "order_status_effects");
  const text = `訂單狀態已從 ${ORDER_STATUSES[before.status] ?? before.status} 變更為 ${ORDER_STATUSES[status]}。${note ? " " + note : ""}`;
  await db().from("order_notes").insert({ order_id: id, content: text, is_customer_note: false, added_by: actor.label });
  await audit(actor, "order.status", "order", id, { status: before.status }, { status, note: note ?? null });
  return getOrder(id);
}

export async function addOrderNote(actor: Actor, id: number, content: string, isCustomerNote = false) {
  if (!content.trim()) throw new CmsError("備註內容不可為空");
  const n = must(await db().from("order_notes").insert({ order_id: id, content: content.trim(), is_customer_note: isCustomerNote, added_by: actor.label }).select("*").single(), "order_notes");
  await audit(actor, "order.note", "order", id, null, { content: content.trim(), is_customer_note: isCustomerNote });
  return n;
}

export async function updateOrderAddresses(actor: Actor, id: number, patch: { billing?: Record<string, string>; shipping?: Record<string, string>; customer_note?: string }) {
  const before = must(await db().from("orders").select("billing,shipping,customer_note").eq("id", id).maybeSingle(), "orders") as any;
  if (!before) throw new CmsError(`找不到訂單 ${id}`, 404);
  const row: Record<string, any> = { date_modified: new Date().toISOString() };
  if (patch.billing) {
    row.billing = { ...before.billing, ...patch.billing };
    if (patch.billing.email !== undefined) row.billing_email = patch.billing.email || null;
  }
  if (patch.shipping) row.shipping = { ...before.shipping, ...patch.shipping };
  if (patch.customer_note !== undefined) row.customer_note = patch.customer_note;
  must(await db().from("orders").update(row).eq("id", id), "orders");
  await audit(actor, "order.update", "order", id, before, row);
  return getOrder(id);
}

/* ------------------------------------------------------------------ customers */
export async function listCustomers(opts: { search?: string; page?: number; per?: number } = {}) {
  const per = Math.min(Math.max(opts.per ?? 20, 1), 200);
  const page = Math.max(opts.page ?? 1, 1);
  let q = db().from("customers").select("id,email,username,first_name,last_name,display_name,order_count,total_spent,date_created,date_last_active,billing", { count: "exact" });
  if (opts.search) {
    const t = ilikeTerm(opts.search);
    q = q.or(`email.ilike.%${t}%,first_name.ilike.%${t}%,last_name.ilike.%${t}%,display_name.ilike.%${t}%,username.ilike.%${t}%`);
  }
  const r = await q.order("date_created", { ascending: false, nullsFirst: false }).order("id", { ascending: false }).range((page - 1) * per, page * per - 1);
  return { rows: must(r, "customers") as any[], total: r.count ?? 0, page, per };
}

export async function getCustomer(id: number) {
  const c = must(await db().from("customers").select("*").eq("id", id).maybeSingle(), "customers") as any;
  if (!c) return null;
  const orders = await listOrders({ customerId: id, per: 50 });
  return { ...c, orders: orders.rows };
}

export async function updateCustomer(actor: Actor, id: number, patch: { first_name?: string; last_name?: string; display_name?: string; email?: string; billing?: Record<string, string>; shipping?: Record<string, string> }) {
  const before = must(await db().from("customers").select("*").eq("id", id).maybeSingle(), "customers") as any;
  if (!before) throw new CmsError(`找不到顧客 ${id}`, 404);
  const row: Record<string, any> = {};
  for (const k of ["first_name", "last_name", "display_name", "email"] as const) if (patch[k] !== undefined) row[k] = patch[k];
  if (patch.billing) row.billing = { ...before.billing, ...patch.billing };
  if (patch.shipping) row.shipping = { ...before.shipping, ...patch.shipping };
  must(await db().from("customers").update(row).eq("id", id), "customers");
  await audit(actor, "customer.update", "customer", id, Object.fromEntries(Object.keys(row).map((k) => [k, before[k]])), row);
  return getCustomer(id);
}

/* ------------------------------------------------------------------ coupons */
export type CouponInput = {
  code?: string;
  status?: "publish" | "draft" | "trash";
  description?: string;
  discount_type?: "percent" | "fixed_cart" | "fixed_product";
  amount?: number;
  date_expires?: string | null;
  usage_limit?: number | null;
  usage_limit_per_user?: number | null;
  limit_usage_to_x_items?: number | null;
  individual_use?: boolean;
  free_shipping?: boolean;
  exclude_sale_items?: boolean;
  product_ids?: number[];
  excluded_product_ids?: number[];
  product_category_ids?: number[];
  excluded_product_category_ids?: number[];
  minimum_amount?: number | null;
  maximum_amount?: number | null;
  email_restrictions?: string[];
};
const COUPON_KEYS = [
  "code", "status", "description", "discount_type", "amount", "usage_limit", "usage_limit_per_user", "limit_usage_to_x_items", "individual_use",
  "free_shipping", "exclude_sale_items", "product_ids", "excluded_product_ids", "product_category_ids", "excluded_product_category_ids",
  "minimum_amount", "maximum_amount", "email_restrictions",
] as const;

export async function listCoupons() {
  return must(await db().from("coupons").select("*").neq("status", "trash").order("date_created", { ascending: false, nullsFirst: true }).order("id", { ascending: false }), "coupons") as any[];
}
export async function getCoupon(id: number) {
  return must(await db().from("coupons").select("*").eq("id", id).maybeSingle(), "coupons") as any;
}
function couponRow(input: CouponInput) {
  const row: Record<string, any> = {};
  for (const k of COUPON_KEYS) if (input[k] !== undefined) row[k] = input[k];
  if (row.code !== undefined) {
    row.code = String(row.code).trim().toLowerCase();
    if (!row.code) throw new CmsError("優惠碼不可為空");
  }
  if (row.discount_type === "percent" && row.amount != null && (row.amount < 0 || row.amount > 100)) throw new CmsError("百分比折扣需介於 0–100");
  if (row.amount != null && row.amount < 0) throw new CmsError("折扣金額不可為負");
  if (input.date_expires !== undefined) row.date_expires = input.date_expires ? new Date(input.date_expires).toISOString() : null;
  return row;
}
export async function saveCoupon(actor: Actor, id: number | null, input: CouponInput) {
  const row = couponRow(input);
  if (row.code) {
    const dup = must(await db().from("coupons").select("id").ilike("code", row.code.replace(/[%_\\]/g, "\\$&")).limit(2), "coupons") as any[];
    if (dup.some((d) => d.id !== id)) throw new CmsError(`優惠碼 ${row.code} 已存在`);
  }
  if (id == null) {
    if (!row.code) throw new CmsError("優惠碼必填");
    row.date_created = new Date().toISOString();
    const c = must(await db().from("coupons").insert({ status: "publish", ...row }).select("*").single(), "coupons") as any;
    await audit(actor, "coupon.create", "coupon", c.id, null, row);
    return c;
  }
  const before = await getCoupon(id);
  if (!before) throw new CmsError(`找不到優惠券 ${id}`, 404);
  const c = must(await db().from("coupons").update(row).eq("id", id).select("*").single(), "coupons");
  await audit(actor, "coupon.update", "coupon", id, Object.fromEntries(Object.keys(row).map((k) => [k, before[k]])), row);
  return c;
}
export async function deleteCoupon(actor: Actor, id: number) {
  const before = await getCoupon(id);
  if (!before) throw new CmsError(`找不到優惠券 ${id}`, 404);
  must(await db().from("coupons").delete().eq("id", id), "coupons");
  await audit(actor, "coupon.delete", "coupon", id, before, null);
  return { id, deleted: true };
}

/* ------------------------------------------------------------------ quantity discount rules */
export type RuleInput = {
  name?: string;
  enabled?: boolean;
  priority?: number;
  applies_to?: "all" | "products" | "categories";
  product_ids?: number[];
  category_ids?: number[];
  min_qty?: number;
  max_qty?: number | null;
  discount_type?: "percent" | "fixed_per_item" | "fixed_price";
  amount?: number;
  date_from?: string | null;
  date_to?: string | null;
};
export async function listRules() {
  return must(await db().from("quantity_discount_rules").select("*").order("priority").order("min_qty"), "quantity_discount_rules") as any[];
}
export async function saveRule(actor: Actor, id: number | null, input: RuleInput) {
  const row: Record<string, any> = { ...input };
  for (const k of ["date_from", "date_to"] as const) if (input[k] !== undefined) row[k] = input[k] ? new Date(input[k]!).toISOString() : null;
  if (row.min_qty !== undefined && !(row.min_qty > 0)) throw new CmsError("最低數量需大於 0");
  if (row.discount_type === "percent" && row.amount != null && (row.amount < 0 || row.amount > 100)) throw new CmsError("百分比折扣需介於 0–100");
  if (id == null) {
    if (!row.name || !row.min_qty || !row.discount_type || row.amount == null) throw new CmsError("名稱、最低數量、折扣類型與金額必填");
    const r = must(await db().from("quantity_discount_rules").insert(row).select("*").single(), "quantity_discount_rules") as any;
    await audit(actor, "discount_rule.create", "discount_rule", r.id, null, row);
    changed("qtyrules");
    return r;
  }
  const before = must(await db().from("quantity_discount_rules").select("*").eq("id", id).maybeSingle(), "quantity_discount_rules") as any;
  if (!before) throw new CmsError(`找不到折扣規則 ${id}`, 404);
  const r = must(await db().from("quantity_discount_rules").update(row).eq("id", id).select("*").single(), "quantity_discount_rules");
  await audit(actor, "discount_rule.update", "discount_rule", id, Object.fromEntries(Object.keys(row).map((k) => [k, before[k]])), row);
  changed("qtyrules");
  return r;
}
export async function deleteRule(actor: Actor, id: number) {
  const before = must(await db().from("quantity_discount_rules").select("*").eq("id", id).maybeSingle(), "quantity_discount_rules") as any;
  if (!before) throw new CmsError(`找不到折扣規則 ${id}`, 404);
  must(await db().from("quantity_discount_rules").delete().eq("id", id), "quantity_discount_rules");
  await audit(actor, "discount_rule.delete", "discount_rule", id, before, null);
  changed("qtyrules");
  return { id, deleted: true };
}
