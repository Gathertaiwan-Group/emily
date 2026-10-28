// DB-level concurrency tests for the payment SQL functions (supabase/migrations/20261029000001_*).
// They run against the real site_emily schema and clean up everything they create, so they only run
// when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are in the environment (otherwise skipped):
//   source ~/.config/gather-migrate/env && npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const skip = !URL_ || !KEY ? "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set" : false;
const db = skip ? null : createClient(URL_, KEY, { db: { schema: "site_emily" }, auth: { persistSession: false } });
const ONLINE = ["newebpay", "ry_newebpay_credit"];
const tag = () => randomBytes(4).toString("hex");
const testIp = () => `198.51.100.${1 + (randomBytes(1)[0] % 250)}`; // TEST-NET-2, never a real customer

async function newOrder(fields) {
  const r = await db.from("orders").insert({ order_key: "wc_order_test_" + tag(), status: "pending", total: 100, created_via: "test", meta: {}, ...fields }).select("id").single();
  assert.ifError(r.error);
  return r.data.id;
}
async function dropOrders(ids) {
  if (ids.length) await db.from("orders").delete().in("id", ids);
}

test("newebpay_register_order_no: 12 parallel pay requests keep all 12 numbers", { skip }, async () => {
  const id = await newOrder({ payment_method: "ry_newebpay_credit", billing_email: `t-${tag()}@example.invalid` });
  try {
    const nos = Array.from({ length: 12 }, (_, i) => `${id}TS${Date.now()}${String(i).padStart(3, "0")}`);
    const res = await Promise.all(nos.map((no) => db.rpc("newebpay_register_order_no", { p_order_id: id, p_no: no, p_keep: 20 })));
    for (const r of res) {
      assert.ifError(r.error);
      assert.equal(r.data, true);
    }
    const o = (await db.from("orders").select("meta").eq("id", id).single()).data;
    assert.deepEqual([...o.meta.newebpay_order_nos].sort(), [...nos].sort());
    assert.ok(nos.includes(o.meta.newebpay_MerchantOrderNo));
    // keeps only the newest p_keep, and refuses once the order is no longer pending
    const r2 = await db.rpc("newebpay_register_order_no", { p_order_id: id, p_no: "X1", p_keep: 3 });
    assert.equal(r2.data, true);
    const o2 = (await db.from("orders").select("meta").eq("id", id).single()).data;
    assert.equal(o2.meta.newebpay_order_nos.length, 3);
    assert.equal(o2.meta.newebpay_order_nos.at(-1), "X1");
    await db.from("orders").update({ status: "processing" }).eq("id", id);
    const r3 = await db.rpc("newebpay_register_order_no", { p_order_id: id, p_no: "X2" });
    assert.equal(r3.data, false);
  } finally {
    await dropOrders([id]);
  }
});

test("checkout_guard: 10 parallel checkouts from one IP -> exactly 6 allowed", { skip }, async () => {
  const ip = testIp();
  const emails = Array.from({ length: 10 }, () => `t-${tag()}@example.invalid`);
  try {
    const res = await Promise.all(emails.map((e) => db.rpc("checkout_guard", { p_ip: ip, p_email: e, p_online: false, p_methods: ONLINE })));
    for (const r of res) assert.ifError(r.error);
    const out = res.map((r) => r.data);
    assert.equal(out.filter((x) => x === "ok").length, 6);
    assert.equal(out.filter((x) => x === "rate_limited").length, 4);
    // a different visitor is unaffected
    const other = await db.rpc("checkout_guard", { p_ip: testIp().replace(/\.\d+$/, ".251"), p_email: `t-${tag()}@example.invalid`, p_online: true, p_methods: ONLINE });
    assert.equal(other.data, "ok");
  } finally {
    await db.from("checkout_attempts").delete().like("email", "t-%@example.invalid");
  }
});

test("checkout_guard: same e-mail from many IPs is rate limited too", { skip }, async () => {
  const email = `t-${tag()}@example.invalid`;
  try {
    const out = [];
    for (let i = 0; i < 8; i++) out.push((await db.rpc("checkout_guard", { p_ip: `198.51.100.${10 + i}`, p_email: email.toUpperCase(), p_online: false, p_methods: ONLINE })).data);
    assert.deepEqual(out, ["ok", "ok", "ok", "ok", "ok", "ok", "rate_limited", "rate_limited"]);
  } finally {
    await db.from("checkout_attempts").delete().like("email", "t-%@example.invalid");
  }
});

test("checkout_guard: at most 3 unpaid online orders per IP or e-mail; offline checkout still allowed", { skip }, async () => {
  const ip = testIp();
  const email = `t-${tag()}@example.invalid`;
  const ids = [];
  try {
    for (let i = 0; i < 3; i++) ids.push(await newOrder({ payment_method: "ry_newebpay_credit", created_via: "checkout", customer_ip: ip, billing_email: i === 0 ? email : `t-${tag()}@example.invalid` }));
    const byIp = await db.rpc("checkout_guard", { p_ip: ip, p_email: `t-${tag()}@example.invalid`, p_online: true, p_methods: ONLINE });
    assert.equal(byIp.data, "too_many_unpaid");
    const offline = await db.rpc("checkout_guard", { p_ip: ip, p_email: `t-${tag()}@example.invalid`, p_online: false, p_methods: ONLINE });
    assert.equal(offline.data, "ok");
    // once one is paid, the visitor can place another online order
    await db.from("orders").update({ status: "processing" }).eq("id", ids[1]);
    const again = await db.rpc("checkout_guard", { p_ip: ip, p_email: `t-${tag()}@example.invalid`, p_online: true, p_methods: ONLINE });
    assert.equal(again.data, "ok");
    // e-mail based: 2 pending with this e-mail from other IPs + 1 → cap
    ids.push(await newOrder({ payment_method: "newebpay", created_via: "checkout", customer_ip: "198.51.100.252", billing_email: email }));
    ids.push(await newOrder({ payment_method: "newebpay", created_via: "checkout", customer_ip: "198.51.100.253", billing_email: email }));
    const byEmail = await db.rpc("checkout_guard", { p_ip: "198.51.100.254", p_email: email, p_online: true, p_methods: ONLINE });
    assert.equal(byEmail.data, "too_many_unpaid");
  } finally {
    await dropOrders(ids);
    await db.from("checkout_attempts").delete().like("email", "t-%@example.invalid");
  }
});
