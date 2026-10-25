import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { clearCart, viewCart } from "@/lib/cart";
import { db, userFromToken } from "@/lib/db";

export const dynamic = "force-dynamic";

const PAYMENT_TITLES: Record<string, string> = {
  bacs: "銀行轉帳",
  cheque: "支票付款",
  cod: "貨到付款",
  // ry_newebpay_credit (藍新金流 信用卡) is not accepted until a real gateway is integrated.
};
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

/** Creates a WooCommerce-style "pending payment" order from the current cart. No payment gateway is called. */
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
  if (!PAYMENT_TITLES[pm]) errors.push("請選擇付款方式。");
  if (!body?.terms_ok && body?.terms_required) errors.push("請詳閱並同意網站條款。");
  const cart = await viewCart();
  if (!cart.items.length) errors.push("購物車是空的，無法結帳。");
  if (errors.length) return NextResponse.json({ error: errors.join("\n"), errors }, { status: 422 });

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
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
  const orderKey = "wc_order_" + randomBytes(9).toString("base64url");
  const ins = await db()
    .from("orders")
    .insert({
      order_key: orderKey,
      status: "pending",
      currency: "TWD",
      customer_id: customerId,
      billing_email: billing.email,
      billing,
      shipping: body?.ship_to_different ? body.shipping ?? {} : {},
      payment_method: pm,
      payment_method_title: PAYMENT_TITLES[pm],
      customer_note: String(body?.order_comments ?? "").slice(0, 2000) || null,
      subtotal: cart.subtotal,
      discount_total: cart.discount,
      total: cart.total,
      customer_ip: ip && /^[0-9a-f.:]+$/i.test(ip) ? ip : null,
      customer_user_agent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
      created_via: "checkout",
      meta: { storefront: "nextjs", coupons: cart.coupons, payment_gateway_connected: false },
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
  await db().from("order_notes").insert({ order_id: orderId, content: `訂單狀態：待付款。付款方式「${PAYMENT_TITLES[pm]}」尚未串接金流，請人工確認款項。`, added_by: "system" });
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
  return NextResponse.json({ ok: true, order_id: orderId, order_key: orderKey, redirect: `/checkout/order-received/${orderId}?key=${orderKey}` });
}
