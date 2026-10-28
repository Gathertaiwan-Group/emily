import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { clearCart, viewCart } from "@/lib/cart";
import { db, userFromToken } from "@/lib/db";
import { HOLD_STOCK_MINUTES, ONLINE_METHODS, availableGateways } from "@/lib/payments";
import { cancelUnpaidOrders, clientIp, newebpayEnabled } from "@/lib/newebpay";
import { guardVerdict, stockProblems, type StockRow } from "@/lib/checkout-policy";

export const dynamic = "force-dynamic";

const STATUS_ZH: Record<string, string> = { pending: "待付款", "on-hold": "保留", processing: "處理中" };
const REQUIRED = ["billing_last_name", "billing_first_name", "billing_country", "billing_address_1", "billing_city", "billing_phone", "billing_email"];
const FIELDS = [
  "billing_last_name",
  "billing_first_name",
  "billing_company",
  "billing_country",
  "billing_postcode",
  "billing_state",
  "billing_city",
  "billing_address_1",
  "billing_address_2",
  "billing_phone",
  "billing_email",
];

/**
 * Creates a WooCommerce-style order from the current cart. Amounts come from the server-side cart
 * (never from the request). Offline methods follow WooCommerce: 銀行轉帳/支票 -> 保留 (on-hold),
 * 貨到付款 -> 處理中, stock reduced; 藍新 -> 待付款 and the browser is sent to /api/newebpay/pay.
 */
export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const f: Record<string, string> = {};
  for (const k of FIELDS) f[k] = String(body?.[k] ?? "").trim().slice(0, 200);
  const errors: string[] = [];
  const labels: Record<string, string> = {
    billing_last_name: "姓氏",
    billing_first_name: "名字",
    billing_country: "國家/地區",
    billing_address_1: "街道地址",
    billing_city: "鄉鎮市",
    billing_phone: "電話",
    billing_email: "電子郵件地址",
  };
  for (const k of REQUIRED) if (!f[k]) errors.push(`帳單 ${labels[k]} 是必填欄位。`);
  if (f.billing_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.billing_email)) errors.push("帳單 電子郵件地址 格式無效。");
  if (f.billing_phone && !/^[0-9+\-()\s#]{6,20}$/.test(f.billing_phone)) errors.push("帳單 電話 不是有效的電話號碼。");
  const pm = String(body?.payment_method ?? "");
  const gw = availableGateways(newebpayEnabled()).find((g) => g.id === pm);
  if (!gw) errors.push("請選擇付款方式。");
  if (!body?.terms_ok && body?.terms_required) errors.push("請詳閱並同意網站條款。");
  // release expired unpaid 藍新 holds first, so the stock check below sees their stock again
  await cancelUnpaidOrders();
  const cart = await viewCart();
  if (!cart.items.length) errors.push("購物車是空的，無法結帳。");
  if (errors.length || !gw) return NextResponse.json({ error: errors.join("\n"), errors }, { status: 422 });

  // stock check against fresh rows (product list is memoised for 1 min)
  const pids = [...new Set(cart.items.map((i) => i.product_id))];
  const vids = [...new Set(cart.items.map((i) => i.variation_id).filter((v): v is number => !!v))];
  const cols = "id,manage_stock,stock_quantity,stock_status,backorders";
  const [ps, vs] = await Promise.all([
    db().from("products").select(cols).in("id", pids).eq("status", "publish"),
    vids.length ? db().from("product_variations").select(cols).in("id", vids).eq("status", "publish") : Promise.resolve({ data: [], error: null }),
  ]);
  if (ps.error || vs.error) return NextResponse.json({ error: "目前無法確認庫存，請稍後再試。" }, { status: 503 });
  const pRow = new Map(((ps.data ?? []) as (StockRow & { id: number })[]).map((r) => [r.id, r]));
  const vRow = new Map(((vs.data ?? []) as (StockRow & { id: number })[]).map((r) => [r.id, r]));
  const stockErrors = stockProblems(
    cart.items.map((i) => ({ name: i.name, quantity: i.quantity, product_id: i.product_id, variation_id: i.variation_id, product: pRow.get(i.product_id) ?? null, variation: i.variation_id ? vRow.get(i.variation_id) ?? null : null })),
  );
  if (stockErrors.length) return NextResponse.json({ error: stockErrors.join("\n"), errors: stockErrors }, { status: 409 });

  // Anti stock-locking: checkouts reduce stock immediately, so cap checkout rate per IP / e-mail and the
  // number of unpaid 藍新 orders one visitor can hold (counted in the DB, serialised per IP / e-mail).
  // If the guard itself fails, only online methods are refused; offline methods still go through.
  const ip = clientIp(req);
  const guard = await db().rpc("checkout_guard", { p_ip: ip, p_email: f.billing_email, p_online: gw.online, p_methods: ONLINE_METHODS, p_hold_minutes: HOLD_STOCK_MINUTES });
  if (guard.error) console.error("[checkout] guard failed", guard.error.message, gw.online ? "-> online method refused" : "-> offline method allowed");
  const verdict = guardVerdict(guard, gw.online);
  if (!verdict.proceed) return NextResponse.json({ error: verdict.message, errors: [verdict.message] }, { status: verdict.http });

  // optional signed-in customer
  const user = await userFromToken(typeof body?.access_token === "string" ? body.access_token : null);
  let customerId: number | null = null;
  if (user) {
    const c = await db().from("customers").select("id").eq("auth_user_id", user.id).maybeSingle();
    customerId = c.data?.id ?? null;
  }

  const billing = {
    first_name: f.billing_first_name,
    last_name: f.billing_last_name,
    company: f.billing_company,
    address_1: f.billing_address_1,
    address_2: f.billing_address_2,
    city: f.billing_city,
    state: f.billing_state,
    postcode: f.billing_postcode,
    country: f.billing_country || "TW",
    email: f.billing_email,
    phone: f.billing_phone,
  };
  const orderKey = "wc_order_" + randomBytes(9).toString("base64url");
  const ins = await db()
    .from("orders")
    .insert({
      order_key: orderKey,
      status: gw.initialStatus,
      currency: "TWD",
      customer_id: customerId,
      billing_email: billing.email,
      billing,
      shipping: body?.ship_to_different ? body.shipping ?? {} : {},
      payment_method: pm,
      payment_method_title: gw.title,
      customer_note: String(body?.order_comments ?? "").slice(0, 2000) || null,
      subtotal: cart.subtotal,
      discount_total: cart.discount,
      total: cart.total,
      customer_ip: ip && /^[0-9a-f.:]+$/i.test(ip) ? ip : null,
      customer_user_agent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
      created_via: "checkout",
      meta: { storefront: "nextjs", coupons: cart.coupons, payment_gateway_connected: gw.online },
    })
    .select("id,order_key")
    .single();
  if (ins.error) return NextResponse.json({ error: "建立訂單失敗：" + ins.error.message }, { status: 500 });
  const orderId = ins.data.id as number;
  await db().from("orders").update({ number: String(orderId) }).eq("id", orderId);
  const lines: Record<string, unknown>[] = cart.items.map((i) => ({
    order_id: orderId,
    item_type: "line_item",
    name: i.name,
    product_id: i.product_id,
    variation_id: i.variation_id,
    sku: i.sku,
    quantity: i.quantity,
    unit_price: i.unit_price,
    subtotal: Math.round(i.regular_unit * i.quantity * 100) / 100,
    total: i.line_total,
    meta: i.variation,
  }));
  for (const c of cart.coupons) lines.push({ order_id: orderId, item_type: "coupon", name: c.code, product_id: null as any, variation_id: null, sku: null, quantity: 1, unit_price: null as any, subtotal: 0, total: -c.amount, meta: { code: c.code, discount: c.amount } });
  const li = await db().from("order_items").insert(lines);
  if (li.error) return NextResponse.json({ error: "建立訂單項目失敗：" + li.error.message }, { status: 500 });
  // WooCommerce stock side effects (idempotent in SQL): RY 藍新 gateways reduce at checkout; core
  // gateways via the on-hold/processing status hooks.
  const fx = gw.reduceStockAtCheckout
    ? await db().rpc("order_reduce_stock", { p_order_id: orderId })
    : await db().rpc("order_status_effects", { p_order_id: orderId, p_status: gw.initialStatus });
  if (fx.error) console.error("[checkout] stock effects failed", fx.error.message);
  const note =
    gw.initialStatus === "pending"
      ? `訂單已建立，付款方式「${gw.title}」，等待藍新金流付款通知。`
      : `${gw.checkoutNote ?? ""} 訂單狀態已從 待付款 變更為 ${STATUS_ZH[gw.initialStatus]}。`.trim();
  await db().from("order_notes").insert({ order_id: orderId, content: note, added_by: "system" });
  await db()
    .from("audit_log")
    .insert({ actor: "storefront", source: "storefront", action: "order.create", entity_type: "order", entity_id: String(orderId), after: { status: gw.initialStatus, payment_method: pm, total: cart.total }, ip: ip && /^[0-9a-f.:]+$/i.test(ip) ? ip : null });
  const form = await db().from("forms").select("id").eq("slug", "checkout").maybeSingle();
  if (form.data)
    await db().from("form_submissions").insert({
      form_id: form.data.id,
      data: { order_id: orderId, ...f, payment_method: pm, order_comments: String(body?.order_comments ?? "").slice(0, 2000) },
      page_url: "/checkout",
      ip: ip && /^[0-9a-f.:]+$/i.test(ip) ? ip : null,
      user_agent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
    });
  await clearCart();
  const redirect = gw.online ? `/api/newebpay/pay?order=${orderId}&key=${orderKey}` : `/checkout/order-received/${orderId}?key=${orderKey}`;
  return NextResponse.json({ ok: true, order_id: orderId, order_key: orderKey, redirect });
}
