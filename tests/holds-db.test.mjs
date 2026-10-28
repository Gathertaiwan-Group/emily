// DB integration tests for expired-hold release (pg_cron), restock-after-cancel
// (supabase/migrations/20261029000002_*) and failed-payment stock release (20261029000003_*). Runs against the real site_emily schema with fixed test ids
// (product 990000001, orders 990000101..990000199), deletes everything afterwards and checks that every
// real product / variation stock + total_sales, the order count and the max order id equal the snapshot
// taken before. Skipped without credentials:
//   source ~/.config/gather-migrate/env && npm test
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { HOLD_STOCK_MINUTES, ONLINE_METHODS } from "../src/lib/payments.ts";

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const skip = !URL_ || !KEY ? "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set" : false;
const db = skip ? null : createClient(URL_, KEY, { db: { schema: "site_emily" }, auth: { persistSession: false } });

const PID = 990000001;
const OID = (n) => 990000100 + n; // 990000101..
const ORDER_IDS = Array.from({ length: 20 }, (_, i) => OID(i + 1));
let snapshot = null;

async function stockSnapshot() {
  const all = async (table) => {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const r = await db.from(table).select(table === "products" ? "id,stock_quantity,stock_status,total_sales" : "id,stock_quantity,stock_status").neq("id", PID).order("id").range(from, from + 999);
      assert.ifError(r.error);
      out.push(...r.data);
      if (r.data.length < 1000) break;
    }
    return out;
  };
  const cnt = await db.from("orders").select("id", { count: "exact", head: true });
  assert.ifError(cnt.error);
  const max = await db.from("orders").select("id").order("id", { ascending: false }).limit(1);
  assert.ifError(max.error);
  return { products: await all("products"), variations: (await all("product_variations")).filter((v) => v.id !== PID), orders: { count: cnt.count, maxId: max.data[0]?.id ?? null } };
}
async function cleanup() {
  await db.from("orders").delete().in("id", ORDER_IDS); // order_items / order_notes cascade
  await db.from("audit_log").delete().eq("entity_type", "order").in("entity_id", ORDER_IDS.map(String));
  await db.from("products").delete().eq("id", PID);
  await db.from("checkout_attempts").delete().like("email", "t-9900001%@example.invalid");
}
async function setStock(q) {
  const r = await db.from("products").update({ stock_quantity: q, stock_status: q > 0 ? "instock" : "outofstock" }).eq("id", PID);
  assert.ifError(r.error);
}
async function stock() {
  const r = await db.from("products").select("stock_quantity,stock_status").eq("id", PID).single();
  assert.ifError(r.error);
  return r.data;
}
async function order(n, fields, qty = 2) {
  const id = OID(n);
  const r = await db.from("orders").insert({ id, order_key: `wc_order_test_${id}`, status: "pending", total: 100, payment_method: "ry_newebpay_credit", created_via: "checkout", billing_email: `t-${id}@example.invalid`, meta: {}, ...fields });
  assert.ifError(r.error);
  const li = await db.from("order_items").insert({ order_id: id, item_type: "line_item", name: "TEST 測試商品", product_id: PID, quantity: qty, unit_price: 50, subtotal: 100, total: 100 });
  assert.ifError(li.error);
  return id;
}
const rpc = async (fn, args) => {
  const r = await db.rpc(fn, args);
  assert.ifError(r.error);
  return r.data;
};
const status = async (id) => (await db.from("orders").select("status").eq("id", id).single()).data.status;
const notes = async (id) => ((await db.from("order_notes").select("content").eq("order_id", id)).data ?? []).map((n) => n.content);

before(async () => {
  if (skip) return;
  // test ids must be free (never reuse real data)
  const p = await db.from("products").select("id").eq("id", PID);
  const o = await db.from("orders").select("id").in("id", ORDER_IDS);
  assert.equal(p.data.length + o.data.length, 0, "test ids already in use");
  // settle real expired holds first so the snapshot is stable
  await rpc("cancel_unpaid_orders", { p_minutes: HOLD_STOCK_MINUTES, p_methods: ONLINE_METHODS });
  snapshot = await stockSnapshot();
  const ins = await db.from("products").insert({ id: PID, slug: `zz-test-${PID}`, name: "TEST 測試商品", status: "draft", manage_stock: true, stock_quantity: 5, stock_status: "instock", backorders: "no", purchasable: false });
  assert.ifError(ins.error);
});

after(async () => {
  if (skip) return;
  await cleanup();
  const left = await db.from("orders").select("id").in("id", ORDER_IDS);
  assert.equal(left.data.length, 0);
  assert.deepEqual(await stockSnapshot(), snapshot, "real stock changed during the test");
  console.log(`# snapshot unchanged: ${snapshot.products.length} products (stock+total_sales), ${snapshot.variations.length} variations, ${snapshot.orders.count} orders, max id ${snapshot.orders.maxId}`);
});

test("2: expired 信用卡一次付清 hold is cancelled and its stock restored; fresh hold kept", { skip }, async () => {
  await setStock(5);
  const old = await order(1, { date_created: new Date(Date.now() - (HOLD_STOCK_MINUTES + 1) * 60_000).toISOString() });
  const fresh = await order(2, { date_created: new Date(Date.now() - 10 * 60_000).toISOString() });
  assert.equal(await rpc("order_reduce_stock", { p_order_id: old }), true); // checkout-time reduction
  assert.equal(await rpc("order_reduce_stock", { p_order_id: fresh }), true);
  assert.equal((await stock()).stock_quantity, 1);
  // exactly what the cron job runs
  await rpc("cancel_unpaid_orders", { p_minutes: HOLD_STOCK_MINUTES, p_methods: ONLINE_METHODS });
  assert.equal(await status(old), "cancelled");
  assert.equal(await status(fresh), "pending");
  assert.equal((await stock()).stock_quantity, 3);
  assert.ok((await notes(old)).some((n) => n.includes("已達時間限制")));
  // idempotent: a second run (next cron tick) changes nothing
  await rpc("cancel_unpaid_orders", { p_minutes: HOLD_STOCK_MINUTES, p_methods: ONLINE_METHODS });
  assert.equal((await stock()).stock_quantity, 3);
});

test("4: cancelled -> processing (admin path) reduces stock again without availability check; negative -> note", { skip }, async () => {
  await setStock(2);
  const id = await order(3, { status: "processing", payment_method: "cod" });
  await rpc("order_status_effects", { p_order_id: id, p_status: "processing" });
  assert.equal((await stock()).stock_quantity, 0);
  await db.from("orders").update({ status: "cancelled" }).eq("id", id);
  await rpc("order_status_effects", { p_order_id: id, p_status: "cancelled" });
  assert.equal((await stock()).stock_quantity, 2);
  await setStock(1); // sold elsewhere meanwhile
  await db.from("orders").update({ status: "processing" }).eq("id", id); // = updateOrderStatus (commerce.ts)
  await rpc("order_status_effects", { p_order_id: id, p_status: "processing" });
  const s = await stock();
  assert.equal(s.stock_quantity, -1);
  assert.equal(s.stock_status, "outofstock");
  assert.ok((await notes(id)).some((n) => n.startsWith("庫存已扣減為負數") && n.includes("剩餘 -1")));
  // completed afterwards does not reduce a second time
  await rpc("order_status_effects", { p_order_id: id, p_status: "completed" });
  assert.equal((await stock()).stock_quantity, -1);
});

test("4: late paid notify on an expired (cancelled) hold -> processing reduces again, note when negative", { skip }, async () => {
  await setStock(2);
  const id = await order(4, { date_created: new Date(Date.now() - (HOLD_STOCK_MINUTES + 5) * 60_000).toISOString() });
  await rpc("order_reduce_stock", { p_order_id: id });
  await rpc("cancel_unpaid_orders", { p_minutes: HOLD_STOCK_MINUTES, p_methods: ONLINE_METHODS });
  assert.equal(await status(id), "cancelled");
  assert.equal((await stock()).stock_quantity, 2);
  await setStock(0);
  const r = await rpc("payment_transition", { p_order_id: id, p_from: "cancelled", p_to: "processing", p_trade_no: "TESTTRADE", p_meta: {}, p_note: "test paid", p_actor: "newebpay" });
  assert.equal(r, "ok");
  assert.equal((await stock()).stock_quantity, -2);
  assert.ok((await notes(id)).some((n) => n.startsWith("庫存已扣減為負數")));
});

const pay = (id, from, to, trade = "") => rpc("payment_transition", { p_order_id: id, p_from: from, p_to: to, p_trade_no: trade, p_meta: {}, p_note: null, p_actor: "newebpay" });
const adminStatus = async (id, to) => {
  // = commerce.updateOrderStatus: update the row, then the status hook
  const r = await db.from("orders").update({ status: to }).eq("id", id);
  assert.ifError(r.error);
  await rpc("order_status_effects", { p_order_id: id, p_status: to });
};
const reduced = async (id) => (await db.from("orders").select("meta").eq("id", id).single()).data.meta.order_stock_reduced;

test("5: declined card (pending -> failed) releases the checkout hold exactly once", { skip }, async () => {
  await setStock(5);
  const id = await order(5, {});
  await rpc("order_reduce_stock", { p_order_id: id }); // 信用卡一次付清 reduces at checkout
  assert.equal((await stock()).stock_quantity, 3);
  assert.equal(await pay(id, "pending", "failed"), "ok");
  assert.equal((await stock()).stock_quantity, 5);
  assert.equal(await reduced(id), "no");
  // repeated failure hooks / admin re-saving failed never restore twice
  await rpc("order_status_effects", { p_order_id: id, p_status: "failed" });
  assert.equal(await rpc("order_restore_stock", { p_order_id: id }), false);
  assert.equal((await stock()).stock_quantity, 5);
});

test("5: failed -> paid notify (processing) reduces again once; completed does not reduce twice", { skip }, async () => {
  await setStock(5);
  const id = await order(6, {});
  await rpc("order_reduce_stock", { p_order_id: id });
  await pay(id, "pending", "failed");
  assert.equal((await stock()).stock_quantity, 5);
  assert.equal(await pay(id, "failed", "processing", "T2"), "ok");
  assert.equal((await stock()).stock_quantity, 3);
  assert.equal(await reduced(id), "yes");
  await adminStatus(id, "completed"); // processing -> completed
  assert.equal((await stock()).stock_quantity, 3);
  assert.ok(!(await notes(id)).some((n) => n.startsWith("庫存已扣減為負數")));
});

test("5: failed -> processing set by admin reduces again once", { skip }, async () => {
  await setStock(5);
  const id = await order(7, {});
  await rpc("order_reduce_stock", { p_order_id: id });
  await pay(id, "pending", "failed");
  await adminStatus(id, "processing");
  assert.equal((await stock()).stock_quantity, 3);
  await adminStatus(id, "processing");
  assert.equal((await stock()).stock_quantity, 3);
});

test("5: failed online orders count toward the 3-unpaid cap per IP and per e-mail", { skip }, async () => {
  const ip = "198.51.100.77";
  const email = "t-990000108@example.invalid";
  for (const n of [8, 9, 10]) await order(n, { status: "failed", customer_ip: ip, billing_email: n === 8 ? email : `t-${OID(n)}@example.invalid` });
  const byIp = await rpc("checkout_guard", { p_ip: ip, p_email: "t-990000111@example.invalid", p_online: true, p_methods: ONLINE_METHODS, p_hold_minutes: HOLD_STOCK_MINUTES });
  assert.equal(byIp, "too_many_unpaid");
  // e-mail based: 1 failed (above) + 1 pending + 1 failed from other IPs with the same e-mail -> cap
  await order(11, { status: "pending", customer_ip: "198.51.100.78", billing_email: email });
  await order(12, { status: "failed", customer_ip: "198.51.100.79", billing_email: email });
  const byEmail = await rpc("checkout_guard", { p_ip: "198.51.100.80", p_email: email.toUpperCase(), p_online: true, p_methods: ONLINE_METHODS, p_hold_minutes: HOLD_STOCK_MINUTES });
  assert.equal(byEmail, "too_many_unpaid");
  // offline checkout still allowed; failed orders older than the window no longer count
  assert.equal(await rpc("checkout_guard", { p_ip: ip, p_email: "t-990000112@example.invalid", p_online: false, p_methods: ONLINE_METHODS, p_hold_minutes: HOLD_STOCK_MINUTES }), "ok");
  await db.from("orders").update({ date_created: new Date(Date.now() - (HOLD_STOCK_MINUTES + 1) * 60_000).toISOString() }).in("id", [OID(9), OID(10)]);
  assert.equal(await rpc("checkout_guard", { p_ip: ip, p_email: "t-990000113@example.invalid", p_online: true, p_methods: ONLINE_METHODS, p_hold_minutes: HOLD_STOCK_MINUTES }), "ok");
});

test("6: cancelled -> on-hold -> processing reduces exactly once (decision = currently reduced + new status)", { skip }, async () => {
  await setStock(5);
  const id = await order(13, { status: "processing", payment_method: "bacs" });
  await rpc("order_status_effects", { p_order_id: id, p_status: "processing" });
  assert.equal((await stock()).stock_quantity, 3);
  await adminStatus(id, "cancelled");
  assert.equal((await stock()).stock_quantity, 5);
  await adminStatus(id, "on-hold");
  assert.equal((await stock()).stock_quantity, 3);
  await adminStatus(id, "processing");
  assert.equal((await stock()).stock_quantity, 3);
  await adminStatus(id, "completed");
  assert.equal((await stock()).stock_quantity, 3);
});

test("6: failed -> on-hold -> processing and pending -> on-hold -> processing reduce exactly once", { skip }, async () => {
  await setStock(5);
  const a = await order(14, {});
  await rpc("order_reduce_stock", { p_order_id: a });
  await pay(a, "pending", "failed");
  await adminStatus(a, "on-hold");
  await adminStatus(a, "processing");
  assert.equal((await stock()).stock_quantity, 3);
  const b = await order(15, { payment_method: "newebpay" }); // non-RY gateway: nothing reduced while pending
  await adminStatus(b, "on-hold");
  await adminStatus(b, "processing");
  assert.equal((await stock()).stock_quantity, 1);
});

test("6: refunded -> processing does not reduce again (refund keeps stock reduced, as WooCommerce)", { skip }, async () => {
  await setStock(5);
  const id = await order(16, { status: "processing", payment_method: "cod" });
  await rpc("order_status_effects", { p_order_id: id, p_status: "processing" });
  assert.equal((await stock()).stock_quantity, 3);
  await adminStatus(id, "refunded");
  assert.equal((await stock()).stock_quantity, 3);
  await adminStatus(id, "processing");
  assert.equal((await stock()).stock_quantity, 3);
  // refunded -> cancelled -> on-hold -> processing: restored once, reduced once
  await adminStatus(id, "refunded");
  await adminStatus(id, "cancelled");
  assert.equal((await stock()).stock_quantity, 5);
  await adminStatus(id, "on-hold");
  await adminStatus(id, "processing");
  assert.equal((await stock()).stock_quantity, 3);
});

test("2: pg_cron job site_emily_expire_holds exists, every 5 min, runs the expiry function", { skip: skip || (!process.env.SUPABASE_ACCESS_TOKEN && "SUPABASE_ACCESS_TOKEN not set") }, async () => {
  const r = await fetch("https://api.supabase.com/v1/projects/ozwftlkgqmewtadypsfi/database/query", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ query: "select jobname, schedule, command, active from cron.job where jobname = 'site_emily_expire_holds'" }),
  });
  assert.equal(r.status, 201);
  const rows = await r.json();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].schedule, "*/5 * * * *");
  assert.equal(rows[0].active, true);
  assert.equal(rows[0].command, `select site_emily.cancel_unpaid_orders(${HOLD_STOCK_MINUTES}, array[${ONLINE_METHODS.map((m) => `'${m}'`).join(",")}]::text[])`);
});
