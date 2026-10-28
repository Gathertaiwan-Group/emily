// Run: npm test  (node --test; Node ≥22.18 strips TypeScript types natively)
// Keys below are made-up test values, not real 藍新 credentials.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCipheriv } from "node:crypto";
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

// 藍新 MPG technical document example (HashKey / HashIV / TradeInfo / TradeSha), same vector kcasa uses.
const OFFICIAL = { merchantId: "3430112", hashKey: "12345678901234567890123456789012", hashIv: "1234567890123456" };
const OFFICIAL_PLAIN = "MerchantID=3430112&RespondType=JSON&TimeStamp=1485232229&Version=1.4&MerchantOrderNo=S_1485232229&Amt=40&ItemDesc=UnitTest";
const OFFICIAL_CT =
  "ff91c8aa01379e4de621a44e5f11f72e4d25bdb1a18242db6cef9ef07d80b0165e476fd1d9acaa53170272c82d122961e1a0700a7427cfa1cf90db7f6d6593bbc93102a4d4b9b66d9974c13c31a7ab4bba1d4e0790f0cbbbd7ad64c6d3c8012a601ceaa808bff70f94a8efa5a4f984b9d41304ffd879612177c622f75f4214fa";
const OFFICIAL_SHA = "EA0A6CC37F40C1EA5692E7CBB8AE097653DF3E91365E6A9CD7E91312413C7BB8";

/** Independent reference encryptor: raw AES-256-CBC over bytes padded exactly as given (no auto padding). */
function rawEncrypt(bytes, keys = KEYS) {
  const c = createCipheriv("aes-256-cbc", Buffer.from(keys.hashKey), Buffer.from(keys.hashIv));
  c.setAutoPadding(false);
  return Buffer.concat([c.update(bytes), c.final()]).toString("hex");
}
/** 藍新 PHP addpadding(): PKCS7 to a 32-byte block. */
const pad32 = (b) => {
  const p = 32 - (b.length % 32);
  return Buffer.concat([b, Buffer.alloc(p, p)]);
};
const pad16 = (b) => {
  const p = 16 - (b.length % 16);
  return Buffer.concat([b, Buffer.alloc(p, p)]);
};

test("official 藍新 vector: encrypt / decrypt / TradeSha", () => {
  assert.equal(encryptTradeInfo(OFFICIAL_PLAIN, OFFICIAL), OFFICIAL_CT);
  assert.equal(decryptTradeInfo(OFFICIAL_CT, OFFICIAL), OFFICIAL_PLAIN);
  assert.equal(tradeSha(OFFICIAL_CT, OFFICIAL), OFFICIAL_SHA);
  assert.equal(verifyTradeSha(OFFICIAL_CT, OFFICIAL_SHA, OFFICIAL), true);
});

test("32-byte block padding: plaintext length 0..64 round-trips and matches PHP addpadding", () => {
  for (let n = 0; n <= 64; n++) {
    const plain = "abcdefghijklmnopqrstuvwxyz0123456789".repeat(2).slice(0, n);
    const hex = encryptTradeInfo(plain, KEYS);
    assert.equal(hex, rawEncrypt(pad32(Buffer.from(plain))), `encrypt len ${n}`);
    assert.equal(hex.length % 64, 0, `32-byte blocks len ${n}`);
    assert.equal(decryptTradeInfo(hex, KEYS), plain, `round-trip len ${n}`);
  }
});

test("decrypt accepts every PKCS7 pad length 1..32 (incl. 17..32) and legacy 16-byte padding", () => {
  const seen = new Set();
  for (let n = 0; n <= 64; n++) {
    const plain = Buffer.from("x".repeat(n));
    seen.add(32 - (n % 32));
    assert.equal(decryptTradeInfo(rawEncrypt(pad32(plain)), KEYS), plain.toString(), `pad32 len ${n}`);
    assert.equal(decryptTradeInfo(rawEncrypt(pad16(plain)), KEYS), plain.toString(), `pad16 len ${n}`);
  }
  assert.equal(seen.size, 32);
  // UTF-8 (multi-byte) JSON notify body, as 藍新 sends it
  const json = JSON.stringify({ Status: "SUCCESS", Message: "授權成功", Result: { MerchantOrderNo: "1TS1", Amt: 880 } });
  assert.equal(decryptTradeInfo(rawEncrypt(pad32(Buffer.from(json))), KEYS), json);
});

test("decrypt rejects invalid padding (pad 0, pad > 32, inconsistent pad bytes)", () => {
  const body = Buffer.from("A".repeat(40));
  const bad = (padBytes) => rawEncrypt(Buffer.concat([body, padBytes]));
  assert.throws(() => decryptTradeInfo(bad(Buffer.from([...Array(23).fill(1), 0])), KEYS), /bad padding/);
  assert.throws(() => decryptTradeInfo(rawEncrypt(Buffer.alloc(64, 33)), KEYS), /bad padding/);
  const p24 = Buffer.alloc(24, 24);
  p24[0] = 23; // first pad byte wrong
  assert.throws(() => decryptTradeInfo(bad(p24), KEYS), /bad padding/);
  const p20 = Buffer.alloc(24, 20); // last byte says 20, but bytes 20..24 back are 20 too -> valid only if exactly 20 checked
  assert.equal(decryptTradeInfo(bad(p20), KEYS), "A".repeat(40) + "\x14".repeat(4));
});

test("parseNotify accepts signed notifies whose padding is 17..32 bytes", () => {
  let accepted = 0;
  for (let extra = 0; extra < 32; extra++) {
    const json = JSON.stringify({ Status: "SUCCESS", Message: "ok", Result: { MerchantID: KEYS.merchantId, MerchantOrderNo: "1TS1", Amt: 880, Pad: "p".repeat(extra) } });
    const TradeInfo = rawEncrypt(pad32(Buffer.from(json)));
    const p = parseNotify({ MerchantID: KEYS.merchantId, TradeInfo, TradeSha: tradeSha(TradeInfo, KEYS) }, KEYS);
    assert.equal(p.ok, true, `extra ${extra}`);
    if (p.ok) accepted++;
  }
  assert.equal(accepted, 32);
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
