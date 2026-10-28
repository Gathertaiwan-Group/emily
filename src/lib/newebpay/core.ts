// 藍新金流 NewebPay MPG — pure helpers (no I/O, no env access). Unit-tested in tests/newebpay.test.mjs.
// Keep this file free of relative imports so it can run directly under `node --test`.
import { createCipheriv, createDecipheriv, createHash, timingSafeEqual } from "node:crypto";

export type NewebpayKeys = { merchantId: string; hashKey: string; hashIv: string };

export const MPG_VERSION = "2.0";
export const MPG_ENDPOINT = {
  test: "https://ccore.newebpay.com/MPG/mpg_gateway",
  production: "https://core.newebpay.com/MPG/mpg_gateway",
} as const;

/** PKCS7 block size used by 藍新's official PHP sample (addpadding pads to 32 bytes, so pad is 1..32). */
export const PAD_BLOCK = 32;

/** AES-256-CBC, PKCS7 padded to 32-byte blocks like 藍新's addpadding(), hex output (TradeInfo). */
export function encryptTradeInfo(plain: string, keys: Pick<NewebpayKeys, "hashKey" | "hashIv">): string {
  const buf = Buffer.from(plain, "utf8");
  const pad = PAD_BLOCK - (buf.length % PAD_BLOCK);
  const c = createCipheriv("aes-256-cbc", Buffer.from(keys.hashKey, "utf8"), Buffer.from(keys.hashIv, "utf8"));
  c.setAutoPadding(false);
  return Buffer.concat([c.update(Buffer.concat([buf, Buffer.alloc(pad, pad)])), c.final()]).toString("hex");
}

/**
 * Reverses encryptTradeInfo. Accepts PKCS7 padding of 1..32 bytes (藍新 pads to 32-byte blocks; a
 * 16-byte-block sender is a subset) and verifies every pad byte. Throws on malformed input or bad
 * padding. Tolerates trailing NULs in the plaintext.
 */
export function decryptTradeInfo(hex: string, keys: Pick<NewebpayKeys, "hashKey" | "hashIv">): string {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 32 !== 0) throw new Error("TradeInfo is not hex AES blocks");
  const d = createDecipheriv("aes-256-cbc", Buffer.from(keys.hashKey, "utf8"), Buffer.from(keys.hashIv, "utf8"));
  d.setAutoPadding(false);
  const buf = Buffer.concat([d.update(Buffer.from(hex, "hex")), d.final()]);
  const pad = buf[buf.length - 1];
  if (pad < 1 || pad > PAD_BLOCK || pad > buf.length) throw new Error("bad padding");
  for (let i = buf.length - pad; i < buf.length; i++) if (buf[i] !== pad) throw new Error("bad padding");
  return buf.subarray(0, buf.length - pad).toString("utf8").replace(/\0+$/, "");
}

/** TradeSha = SHA256("HashKey=...&{TradeInfo}&HashIV=...") uppercased. */
export function tradeSha(tradeInfo: string, keys: Pick<NewebpayKeys, "hashKey" | "hashIv">): string {
  return createHash("sha256").update(`HashKey=${keys.hashKey}&${tradeInfo}&HashIV=${keys.hashIv}`).digest("hex").toUpperCase();
}

export function verifyTradeSha(tradeInfo: string, sha: string, keys: Pick<NewebpayKeys, "hashKey" | "hashIv">): boolean {
  const want = Buffer.from(tradeSha(tradeInfo, keys), "utf8");
  const got = Buffer.from(String(sha ?? "").toUpperCase(), "utf8");
  return want.length === got.length && timingSafeEqual(want, got);
}

/** PHP http_build_query-compatible encoding (spaces as '+'). */
export function buildQuery(params: Record<string, string | number>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v)).replace(/%20/g, "+")}`)
    .join("&");
}

export type MpgOrder = {
  merchantOrderNo: string;
  amount: number;
  itemDesc: string;
  email: string;
  notifyUrl: string;
  returnUrl: string;
  clientBackUrl: string;
  methods: Record<string, 1>; // e.g. { CREDIT: 1, LINEPAY: 1 }
  expireDate?: string; // Ymd
  timestamp?: number;
};

/** Builds the auto-submitted MPG form fields. */
export function buildMpgForm(o: MpgOrder, keys: NewebpayKeys) {
  const params: Record<string, string | number> = {
    MerchantID: keys.merchantId,
    RespondType: "JSON",
    TimeStamp: o.timestamp ?? Math.floor(Date.now() / 1000),
    Version: MPG_VERSION,
    LangType: "zh-tw",
    MerchantOrderNo: o.merchantOrderNo,
    Amt: o.amount,
    ItemDesc: o.itemDesc.slice(0, 50),
    Email: o.email,
    EmailModify: 0,
    LoginType: 0,
    NotifyURL: o.notifyUrl,
    ReturnURL: o.returnUrl,
    ClientBackURL: o.clientBackUrl,
    ...(o.expireDate ? { ExpireDate: o.expireDate } : {}),
    ...o.methods,
  };
  const TradeInfo = encryptTradeInfo(buildQuery(params), keys);
  return { MerchantID: keys.merchantId, TradeInfo, TradeSha: tradeSha(TradeInfo, keys), Version: MPG_VERSION };
}

/** Our MerchantOrderNo: `<orderId>TS<digits>` (old-site format, ≤30 chars, [A-Za-z0-9_]). */
export function makeMerchantOrderNo(orderId: number, now = Date.now()): string {
  return `${orderId}TS${String(now).slice(-10)}${Math.floor(Math.random() * 1e3).toString().padStart(3, "0")}`.slice(0, 30);
}
export function orderIdFromMerchantOrderNo(no: string): number | null {
  const m = /^(\d+)TS\d+$/.exec(String(no ?? ""));
  return m ? Number(m[1]) : null;
}

export type NotifyResult = {
  Status: string;
  Message: string;
  Result: Record<string, any>;
};

export type ParsedNotify =
  | { ok: true; data: NotifyResult }
  | { ok: false; reason: "missing_fields" | "bad_sha" | "bad_merchant" | "decrypt_failed" | "bad_json" };

/** Verifies TradeSha, decrypts TradeInfo and checks MerchantID. Does NOT touch any order. */
export function parseNotify(body: Record<string, string | undefined>, keys: NewebpayKeys): ParsedNotify {
  const tradeInfo = body.TradeInfo ?? "";
  const sha = body.TradeSha ?? "";
  if (!tradeInfo || !sha) return { ok: false, reason: "missing_fields" };
  if (!verifyTradeSha(tradeInfo, sha, keys)) return { ok: false, reason: "bad_sha" };
  if (body.MerchantID && body.MerchantID !== keys.merchantId) return { ok: false, reason: "bad_merchant" };
  let plain: string;
  try {
    plain = decryptTradeInfo(tradeInfo, keys);
  } catch {
    return { ok: false, reason: "decrypt_failed" };
  }
  let data: any;
  try {
    data = JSON.parse(plain);
  } catch {
    // RespondType=String fallback: query string
    const q = new URLSearchParams(plain);
    if (!q.get("Status")) return { ok: false, reason: "bad_json" };
    const result: Record<string, string> = {};
    for (const [k, v] of q) if (k !== "Status" && k !== "Message") result[k] = v;
    data = { Status: q.get("Status"), Message: q.get("Message") ?? "", Result: result };
  }
  if (!data || typeof data !== "object" || typeof data.Status !== "string") return { ok: false, reason: "bad_json" };
  const result = typeof data.Result === "string" ? JSON.parse(data.Result || "{}") : data.Result ?? {};
  if (result.MerchantID && String(result.MerchantID) !== keys.merchantId) return { ok: false, reason: "bad_merchant" };
  return { ok: true, data: { Status: data.Status, Message: String(data.Message ?? ""), Result: result } };
}

/* ------------------------------------------------------------------ transition decision */
export const NEWEBPAY_METHODS = ["newebpay", "ry_newebpay_credit"] as const;

export type OrderState = {
  id: number;
  status: string;
  payment_method: string | null;
  total: number | string;
  transaction_id: string | null;
  meta: Record<string, any> | null;
};

export type Decision =
  | { kind: "reject"; reason: "order_not_found" | "wrong_gateway" | "order_no_mismatch" | "amount_mismatch" }
  | { kind: "duplicate" }
  | { kind: "ignore"; reason: string }
  | { kind: "paid"; from: string; tradeNo: string }
  | { kind: "failed"; from: string; message: string };

const STATUS_ZH: Record<string, string> = { pending: "待付款", processing: "處理中", "on-hold": "保留", completed: "已完成", cancelled: "已取消", refunded: "已退款", failed: "失敗" };

const PAYABLE_FROM = new Set(["pending", "on-hold", "failed", "cancelled"]); // woocommerce_valid_order_statuses_for_payment_complete
const PAID = new Set(["processing", "completed", "refunded"]);

/**
 * Pure decision for a verified notify. Idempotent by construction: once an order is paid, any repeat
 * (same or different notify) yields 'duplicate'; a repeated failure on an already-failed order too.
 */
export function decideNotify(order: OrderState | null, n: NotifyResult): Decision {
  if (!order) return { kind: "reject", reason: "order_not_found" };
  if (!order.payment_method || !(NEWEBPAY_METHODS as readonly string[]).includes(order.payment_method)) return { kind: "reject", reason: "wrong_gateway" };
  const r = n.Result ?? {};
  const merchantOrderNo = String(r.MerchantOrderNo ?? "");
  const known = [order.meta?.newebpay_MerchantOrderNo, ...(Array.isArray(order.meta?.newebpay_order_nos) ? order.meta!.newebpay_order_nos : [])].map((x) => String(x ?? ""));
  if (!merchantOrderNo || !known.includes(merchantOrderNo)) return { kind: "reject", reason: "order_no_mismatch" };
  const amt = Number(r.Amt);
  if (!Number.isFinite(amt) || Math.round(Number(order.total)) !== amt) return { kind: "reject", reason: "amount_mismatch" };
  const tradeNo = String(r.TradeNo ?? "");
  if (n.Status === "SUCCESS") {
    if (PAID.has(order.status)) return { kind: "duplicate" };
    if (!PAYABLE_FROM.has(order.status)) return { kind: "ignore", reason: `status ${order.status}` };
    return { kind: "paid", from: order.status, tradeNo };
  }
  if (order.status === "failed") return { kind: "duplicate" };
  if (order.status !== "pending") return { kind: "ignore", reason: `failure notify for ${order.status} order` };
  return { kind: "failed", from: order.status, message: `${n.Status} ${n.Message}`.trim() };
}

/** Fields of Result we keep on the order (never a full card number — NewebPay only sends first6/last4). */
export function paymentInfo(r: Record<string, any>) {
  const keep = ["TradeNo", "MerchantOrderNo", "PaymentType", "Amt", "PayTime", "RespondCode", "Auth", "AuthBank", "Card6No", "Card4No", "Inst", "InstFirst", "InstEach", "ECI", "PaymentMethod", "EscrowBank", "IP"];
  const out: Record<string, string> = {};
  for (const k of keep) if (r[k] != null && r[k] !== "") out[k] = String(r[k]);
  return out;
}

export type NotifyDeps = {
  keys: NewebpayKeys;
  loadOrder: (id: number) => Promise<OrderState | null>;
  transition: (orderId: number, from: string, to: string, tradeNo: string, meta: Record<string, any>, note: string) => Promise<string>;
  logEvent: (e: { order_id: number | null; merchant_order_no: string | null; trade_no: string | null; status: string | null; amount: number | null; outcome: string; info: Record<string, any> }) => Promise<void>;
};

export type NotifyOutcome = { http: number; outcome: string; orderId: number | null };

/** Full NotifyURL processing with injected I/O. */
export async function handleNotify(body: Record<string, string | undefined>, deps: NotifyDeps): Promise<NotifyOutcome> {
  const parsed = parseNotify(body, deps.keys);
  if (!parsed.ok) {
    await deps.logEvent({ order_id: null, merchant_order_no: null, trade_no: null, status: body.Status ?? null, amount: null, outcome: `rejected:${parsed.reason}`, info: {} });
    return { http: 400, outcome: `rejected:${parsed.reason}`, orderId: null };
  }
  const n = parsed.data;
  const info = paymentInfo(n.Result);
  const orderNo = String(n.Result.MerchantOrderNo ?? "");
  const orderId = orderIdFromMerchantOrderNo(orderNo);
  const base = { order_id: orderId, merchant_order_no: orderNo || null, trade_no: info.TradeNo ?? null, status: n.Status, amount: Number.isFinite(Number(n.Result.Amt)) ? Number(n.Result.Amt) : null, info: { ...info, Message: n.Message } };
  for (let attempt = 0; attempt < 3; attempt++) {
    const order = orderId ? await deps.loadOrder(orderId) : null;
    const d = decideNotify(order, n);
    if (d.kind === "reject") {
      await deps.logEvent({ ...base, outcome: `rejected:${d.reason}` });
      return { http: 400, outcome: `rejected:${d.reason}`, orderId };
    }
    if (d.kind === "duplicate" || d.kind === "ignore") {
      await deps.logEvent({ ...base, outcome: d.kind });
      return { http: 200, outcome: d.kind, orderId };
    }
    const meta = { newebpay: info, newebpay_payment_type: info.PaymentType ?? "" };
    const note =
      d.kind === "paid"
        ? `藍新金流付款完成（${info.PaymentType ?? ""}）。交易序號：${d.tradeNo}，金額：${info.Amt}。訂單狀態已從 ${STATUS_ZH[d.from] ?? d.from} 變更為 處理中。`
        : `藍新金流付款失敗：${d.message}。訂單狀態已從 待付款 變更為 失敗。`;
    const r = await deps.transition(order!.id, d.from, d.kind === "paid" ? "processing" : "failed", d.kind === "paid" ? d.tradeNo : "", meta, note);
    if (r === "ok") {
      await deps.logEvent({ ...base, outcome: d.kind });
      return { http: 200, outcome: d.kind, orderId };
    }
    if (r !== "conflict") {
      await deps.logEvent({ ...base, outcome: `error:${r}` });
      return { http: 500, outcome: `error:${r}`, orderId };
    }
    // conflict: someone else changed the order between read and write — re-read and decide again
  }
  await deps.logEvent({ ...base, outcome: "error:conflict" });
  return { http: 503, outcome: "error:conflict", orderId };
}
