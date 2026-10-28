// Pure checkout / config policy tests (no network). Run: npm test
// Keys below are made-up test values, not real 藍新 credentials.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveNewebpayConfig } from "../src/lib/newebpay/core.ts";
import { guardVerdict, stockProblems } from "../src/lib/checkout-policy.ts";
import { GATEWAYS, HOLD_STOCK_MINUTES, ONLINE_METHODS, availableGateways } from "../src/lib/payments.ts";

const K = { NEWEBPAY_MERCHANT_ID: "MS000000001", NEWEBPAY_HASH_KEY: "abcdefghijklmnopqrstuvwxyz012345", NEWEBPAY_HASH_IV: "0123456789ABCDEF" };

/* ---------------------------------------------------------------- 1. test mode refused in production */
test("1: VERCEL_ENV=production + NEWEBPAY_ENV=test -> 藍新 refused with issue", () => {
  const r = resolveNewebpayConfig({ ...K, NEWEBPAY_ENV: "test", VERCEL_ENV: "production" });
  assert.equal(r.config, null);
  assert.equal(r.issue, "test_env_in_production");
  // refused even with whitespace / without keys (no way to slip a test config into production)
  assert.equal(resolveNewebpayConfig({ ...K, NEWEBPAY_ENV: " test ", VERCEL_ENV: "production " }).config, null);
  assert.equal(resolveNewebpayConfig({ NEWEBPAY_ENV: "test", VERCEL_ENV: "production" }).issue, "test_env_in_production");
  // checkout then offers offline methods only (no 藍新 radio)
  const ids = availableGateways(r.config !== null).map((g) => g.id);
  assert.deepEqual(ids, GATEWAYS.filter((g) => !g.online).map((g) => g.id));
  for (const m of ONLINE_METHODS) assert.ok(!ids.includes(m));
});

test("1: test mode allowed on Preview / local, production mode allowed on production", () => {
  for (const VERCEL_ENV of ["preview", "development", undefined]) {
    const r = resolveNewebpayConfig({ ...K, NEWEBPAY_ENV: "test", VERCEL_ENV });
    assert.equal(r.issue, null);
    assert.equal(r.config?.env, "test");
    assert.equal(r.config?.endpoint, "https://ccore.newebpay.com/MPG/mpg_gateway");
  }
  const p = resolveNewebpayConfig({ ...K, NEWEBPAY_ENV: "production", VERCEL_ENV: "production" });
  assert.equal(p.issue, null);
  assert.equal(p.config?.endpoint, "https://core.newebpay.com/MPG/mpg_gateway");
  // no keys at all -> disabled silently (current production state)
  assert.deepEqual(resolveNewebpayConfig({ VERCEL_ENV: "production" }), { config: null, issue: null });
});

test("1: pay + notify routes go through newebpayConfig(), which uses resolveNewebpayConfig", () => {
  const idx = readFileSync(new URL("../src/lib/newebpay/index.ts", import.meta.url), "utf8");
  assert.match(idx, /resolveNewebpayConfig\(process\.env\)/);
  assert.doesNotMatch(idx, /process\.env\.NEWEBPAY_/); // no second, unguarded reader
  for (const f of ["../src/app/api/newebpay/pay/route.ts", "../src/app/api/newebpay/notify/route.ts"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.match(src, /const cfg = newebpayConfig\(\);\s*\n\s*if \(!cfg\)/);
  }
});

/* ---------------------------------------------------------------- 3. guard failure */
test("3: guard RPC error blocks online methods only; offline methods proceed", () => {
  const err = { error: { message: "boom" }, data: null };
  const online = guardVerdict(err, true);
  assert.equal(online.proceed, false);
  assert.equal(online.http, 503);
  assert.deepEqual(guardVerdict(err, false), { proceed: true, degraded: true });
  // every offline gateway (cod / bacs / cheque) is allowed through
  for (const g of GATEWAYS.filter((x) => !x.online)) assert.equal(guardVerdict(err, g.online).proceed, true);
  for (const g of GATEWAYS.filter((x) => x.online)) assert.equal(guardVerdict(err, g.online).proceed, false);
});

test("3: guard results ok / too_many_unpaid / rate_limited unchanged", () => {
  assert.deepEqual(guardVerdict({ error: null, data: "ok" }, true), { proceed: true });
  assert.equal(guardVerdict({ error: null, data: "too_many_unpaid" }, true).http, 429);
  assert.equal(guardVerdict({ error: null, data: "rate_limited" }, false).http, 429);
});

/* ---------------------------------------------------------------- 2. checkout stock check (after expiry) */
const row = (q, extra = {}) => ({ manage_stock: true, stock_quantity: q, stock_status: q > 0 ? "instock" : "outofstock", backorders: "no", ...extra });
test("2: checkout stock check uses fresh rows, sums shared parent stock", () => {
  assert.deepEqual(stockProblems([{ name: "A", quantity: 2, product_id: 1, variation_id: null, product: row(2), variation: null }]), []);
  assert.equal(stockProblems([{ name: "A", quantity: 3, product_id: 1, variation_id: null, product: row(2), variation: null }]).length, 1);
  assert.equal(stockProblems([{ name: "A", quantity: 1, product_id: 1, variation_id: null, product: row(0), variation: null }]).length, 1);
  // two variations without own stock share the parent's 3
  const shared = [
    { name: "A-紅", quantity: 2, product_id: 1, variation_id: 11, product: row(3), variation: { manage_stock: false, stock_quantity: null, stock_status: "instock", backorders: "no" } },
    { name: "A-藍", quantity: 2, product_id: 1, variation_id: 12, product: row(3), variation: { manage_stock: false, stock_quantity: null, stock_status: "instock", backorders: "no" } },
  ];
  assert.equal(stockProblems(shared).length, 2);
  // variation with own stock
  assert.deepEqual(stockProblems([{ name: "B", quantity: 4, product_id: 2, variation_id: 21, product: row(0, { stock_status: "instock" }), variation: row(4) }]), []);
  // backorders allowed / unmanaged stock -> no problem; unpublished product -> problem
  assert.deepEqual(stockProblems([{ name: "C", quantity: 9, product_id: 3, variation_id: null, product: row(1, { backorders: "yes" }), variation: null }]), []);
  assert.deepEqual(stockProblems([{ name: "D", quantity: 9, product_id: 4, variation_id: null, product: { manage_stock: false, stock_quantity: null, stock_status: "instock", backorders: "no" }, variation: null }]), []);
  assert.equal(stockProblems([{ name: "E", quantity: 1, product_id: 5, variation_id: null, product: null, variation: null }]).length, 1);
});

test("2: expiry runs before every stock check (cart add/set, checkout) and cron matches ONLINE_METHODS", () => {
  const cart = readFileSync(new URL("../src/lib/cart.ts", import.meta.url), "utf8");
  const fresh = cart.slice(cart.indexOf("async function withFreshStock"));
  assert.ok(fresh.indexOf("await cancelUnpaidOrders()") < fresh.indexOf('from("products")'));
  for (const fn of ["export async function addToCart", "export async function setQty"]) {
    const body = cart.slice(cart.indexOf(fn), cart.indexOf("\n}\n", cart.indexOf(fn)));
    assert.ok(body.includes("await withFreshStock(") && body.indexOf("await withFreshStock(") < body.indexOf("stockOk("), fn);
  }
  const co = readFileSync(new URL("../src/app/api/checkout/route.ts", import.meta.url), "utf8");
  assert.ok(co.indexOf("await cancelUnpaidOrders()") > 0 && co.indexOf("await cancelUnpaidOrders()") < co.indexOf("stockProblems("));
  assert.ok(co.indexOf("stockProblems(") < co.indexOf('from("orders")'));
  const mig = readFileSync(new URL("../supabase/migrations/20261029000002_site_emily_expire_holds_restock_note.sql", import.meta.url), "utf8");
  assert.match(mig, /cron\.unschedule\(jobid\) from cron\.job where jobname = 'site_emily_expire_holds'/);
  assert.equal(HOLD_STOCK_MINUTES, 60);
  assert.ok(mig.includes(`cancel_unpaid_orders(${HOLD_STOCK_MINUTES}, array[${ONLINE_METHODS.map((m) => `'${m}'`).join(",")}]::text[])`));
});
