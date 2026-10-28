// Run: npm test  (node --test; Node ≥22.18 strips TypeScript types natively)
// Keys below are made-up test values, not real 藍新 credentials.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildMpgForm,
  decideNotify,
  decryptTradeInfo,
  encryptTradeInfo,
  handleNotify,
  makeMerchantOrderNo,
  orderIdFromMerchantOrderNo,
  parseNotify,
  tradeSha,
  verifyTradeSha,
} from "../src/lib/newebpay/core.ts";

const KEYS = { merchantId: "MS000000001", hashKey: "abcdefghijklmnopqrstuvwxyz012345", hashIv: "0123456789ABCDEF" };

function signedNotify(result, status = "SUCCESS", keys = KEYS) {
  const TradeInfo = encryptTradeInfo(JSON.stringify({ Status: status, Message: status === "SUCCESS" ? "授權成功" : "授權失敗", Result: result }), keys);
  return { Status: status, MerchantID: keys.merchantId, Version: "2.0", TradeInfo, TradeSha: tradeSha(TradeInfo, keys) };
}

test("AES-256-CBC encrypt/decrypt round-trip (incl. UTF-8 and block-size inputs)", () => {
  for (const s of ["", "a", "MerchantID=MS1&Amt=100&ItemDesc=測試商品", "x".repeat(16), "y".repeat(32)]) {
    const hex = encryptTradeInfo(s, KEYS);
    assert.match(hex, /^[0-9a-f]+$/);
    assert.equal(hex.length % 32, 0);
    assert.equal(decryptTradeInfo(hex, KEYS), s);
  }
});

test("decrypt rejects wrong key, non-hex and truncated input", () => {
  const hex = encryptTradeInfo("Status=SUCCESS", KEYS);
  assert.throws(() => decryptTradeInfo(hex, { ...KEYS, hashKey: "Z".repeat(32) }));
  assert.throws(() => decryptTradeInfo("zz" + hex.slice(2), KEYS));
  assert.throws(() => decryptTradeInfo(hex.slice(0, -2), KEYS));
});

test("TradeSha matches the documented formula and verifies", () => {
  const ti = encryptTradeInfo("Amt=100", KEYS);
  const sha = tradeSha(ti, KEYS);
  assert.match(sha, /^[0-9A-F]{64}$/);
  assert.equal(verifyTradeSha(ti, sha, KEYS), true);
  assert.equal(verifyTradeSha(ti, sha.toLowerCase(), KEYS), true);
  assert.equal(verifyTradeSha(ti, sha.slice(0, -1) + (sha.endsWith("A") ? "B" : "A"), KEYS), false);
  assert.equal(verifyTradeSha(ti, "", KEYS), false);
});

test("MPG form: TradeInfo decrypts to the order params, TradeSha signs it", () => {
  const f = buildMpgForm({ merchantOrderNo: "1000123TS1", amount: 880, itemDesc: "商品Ax2", email: "a@b.c", notifyUrl: "https://x/n", returnUrl: "https://x/r?order=1&key=k", clientBackUrl: "https://x/b", methods: { CREDIT: 1 }, timestamp: 1700000000 }, KEYS);
  assert.equal(f.MerchantID, KEYS.merchantId);
  assert.equal(f.TradeSha, tradeSha(f.TradeInfo, KEYS));
  const q = new URLSearchParams(decryptTradeInfo(f.TradeInfo, KEYS));
  assert.equal(q.get("Amt"), "880");
  assert.equal(q.get("MerchantOrderNo"), "1000123TS1");
  assert.equal(q.get("CREDIT"), "1");
  assert.equal(q.get("ReturnURL"), "https://x/r?order=1&key=k");
  assert.equal(q.get("RespondType"), "JSON");
});

test("MerchantOrderNo format round-trips the order id", () => {
  const no = makeMerchantOrderNo(1000123);
  assert.match(no, /^1000123TS\d+$/);
  assert.ok(no.length <= 30);
  assert.equal(orderIdFromMerchantOrderNo(no), 1000123);
  assert.equal(orderIdFromMerchantOrderNo("abc"), null);
});

test("parseNotify accepts a correctly signed notify", () => {
  const p = parseNotify(signedNotify({ MerchantID: KEYS.merchantId, Amt: 880, MerchantOrderNo: "1TS1", TradeNo: "T1" }), KEYS);
  assert.equal(p.ok, true);
  assert.equal(p.data.Status, "SUCCESS");
  assert.equal(p.data.Result.TradeNo, "T1");
});

test("bad signature is rejected (tampered TradeInfo, tampered TradeSha, foreign key, wrong merchant)", () => {
  const n = signedNotify({ MerchantID: KEYS.merchantId, Amt: 880, MerchantOrderNo: "1TS1" });
  const forged = encryptTradeInfo(JSON.stringify({ Status: "SUCCESS", Result: { MerchantID: KEYS.merchantId, Amt: 1, MerchantOrderNo: "1TS1" } }), KEYS);
  assert.deepEqual(parseNotify({ ...n, TradeInfo: forged }, KEYS), { ok: false, reason: "bad_sha" });
  assert.deepEqual(parseNotify({ ...n, TradeSha: "0".repeat(64) }, KEYS), { ok: false, reason: "bad_sha" });
  const other = { merchantId: KEYS.merchantId, hashKey: "Q".repeat(32), hashIv: "W".repeat(16) };
  assert.deepEqual(parseNotify(signedNotify({ MerchantID: KEYS.merchantId, Amt: 880 }, "SUCCESS", other), KEYS), { ok: false, reason: "bad_sha" });
  assert.deepEqual(parseNotify({ ...n, MerchantID: "MS999" }, KEYS), { ok: false, reason: "bad_merchant" });
  assert.deepEqual(parseNotify(signedNotify({ MerchantID: "MS999", Amt: 880 }), KEYS), { ok: false, reason: "bad_merchant" });
  assert.deepEqual(parseNotify({ Status: "SUCCESS" }, KEYS), { ok: false, reason: "missing_fields" });
});

const order = (o = {}) => ({ id: 1000123, status: "pending", payment_method: "ry_newebpay_credit", total: "880.00", transaction_id: null, meta: { newebpay_MerchantOrderNo: "1000123TS1" }, ...o });
const ok = (r = {}) => ({ Status: "SUCCESS", Message: "", Result: { MerchantOrderNo: "1000123TS1", Amt: 880, TradeNo: "T1", ...r } });

test("amount mismatch is rejected", () => {
  assert.deepEqual(decideNotify(order(), ok({ Amt: 879 })), { kind: "reject", reason: "amount_mismatch" });
  assert.deepEqual(decideNotify(order(), ok({ Amt: "abc" })), { kind: "reject", reason: "amount_mismatch" });
  assert.deepEqual(decideNotify(order({ total: "1880.00" }), ok()), { kind: "reject", reason: "amount_mismatch" });
});

test("order number / gateway / missing order are rejected", () => {
  assert.deepEqual(decideNotify(order(), ok({ MerchantOrderNo: "1000123TS2" })), { kind: "reject", reason: "order_no_mismatch" });
  assert.deepEqual(decideNotify(order({ payment_method: "bacs" }), ok()), { kind: "reject", reason: "wrong_gateway" });
  assert.deepEqual(decideNotify(null, ok()), { kind: "reject", reason: "order_not_found" });
});

test("decision is idempotent: paid/failed orders yield duplicate", () => {
  assert.deepEqual(decideNotify(order(), ok()), { kind: "paid", from: "pending", tradeNo: "T1" });
  assert.deepEqual(decideNotify(order({ status: "processing" }), ok()), { kind: "duplicate" });
  assert.deepEqual(decideNotify(order({ status: "completed" }), ok()), { kind: "duplicate" });
  const fail = { Status: "MPG03008", Message: "授權失敗", Result: ok().Result };
  assert.equal(decideNotify(order(), fail).kind, "failed");
  assert.deepEqual(decideNotify(order({ status: "failed" }), fail), { kind: "duplicate" });
  assert.equal(decideNotify(order({ status: "processing" }), fail).kind, "ignore");
  // late success after a failure or after the 60-minute cancel still completes payment (WooCommerce)
  assert.equal(decideNotify(order({ status: "failed" }), ok()).kind, "paid");
  assert.equal(decideNotify(order({ status: "cancelled" }), ok()).kind, "paid");
});

function fakeStore(initial) {
  const o = { ...initial };
  const calls = { transitions: 0, events: [] };
  return {
    o,
    calls,
    deps: {
      keys: KEYS,
      loadOrder: async (id) => (id === o.id ? { ...o, meta: { ...o.meta } } : null),
      transition: async (id, from, to, tradeNo) => {
        if (o.status !== from) return "conflict";
        calls.transitions++;
        o.status = to;
        if (tradeNo) o.transaction_id = tradeNo;
        return "ok";
      },
      logEvent: async (e) => void calls.events.push(e.outcome),
    },
  };
}

test("handleNotify: re-sent notify is processed once", async () => {
  const s = fakeStore(order());
  const n = signedNotify({ MerchantID: KEYS.merchantId, MerchantOrderNo: "1000123TS1", Amt: 880, TradeNo: "T1", PaymentType: "CREDIT" });
  const r1 = await handleNotify(n, s.deps);
  const r2 = await handleNotify(n, s.deps);
  const r3 = await handleNotify(n, s.deps);
  assert.deepEqual([r1.outcome, r2.outcome, r3.outcome], ["paid", "duplicate", "duplicate"]);
  assert.equal(s.calls.transitions, 1);
  assert.equal(s.o.status, "processing");
  assert.equal(s.o.transaction_id, "T1");
});

test("handleNotify: concurrent duplicates race to a single transition", async () => {
  const s = fakeStore(order());
  const n = signedNotify({ MerchantID: KEYS.merchantId, MerchantOrderNo: "1000123TS1", Amt: 880, TradeNo: "T1" });
  const rs = await Promise.all([handleNotify(n, s.deps), handleNotify(n, s.deps), handleNotify(n, s.deps)]);
  assert.equal(rs.filter((r) => r.outcome === "paid").length, 1);
  assert.equal(s.calls.transitions, 1);
});

test("handleNotify: bad signature / amount mismatch never touch the order", async () => {
  const s = fakeStore(order());
  const n = signedNotify({ MerchantID: KEYS.merchantId, MerchantOrderNo: "1000123TS1", Amt: 880, TradeNo: "T1" });
  const bad = await handleNotify({ ...n, TradeSha: tradeSha(n.TradeInfo, { hashKey: "Q".repeat(32), hashIv: KEYS.hashIv }) }, s.deps);
  assert.equal(bad.http, 400);
  assert.equal(bad.outcome, "rejected:bad_sha");
  const amt = await handleNotify(signedNotify({ MerchantID: KEYS.merchantId, MerchantOrderNo: "1000123TS1", Amt: 1, TradeNo: "T1" }), s.deps);
  assert.equal(amt.http, 400);
  assert.equal(amt.outcome, "rejected:amount_mismatch");
  assert.equal(s.calls.transitions, 0);
  assert.equal(s.o.status, "pending");
});

test("handleNotify: failure sets failed once", async () => {
  const s = fakeStore(order());
  const n = signedNotify({ MerchantID: KEYS.merchantId, MerchantOrderNo: "1000123TS1", Amt: 880, TradeNo: "" }, "MPG03008");
  assert.equal((await handleNotify(n, s.deps)).outcome, "failed");
  assert.equal((await handleNotify(n, s.deps)).outcome, "duplicate");
  assert.equal(s.calls.transitions, 1);
  assert.equal(s.o.status, "failed");
});
