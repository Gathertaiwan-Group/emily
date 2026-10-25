import "server-only";
import { createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";
import { db } from "./db";
import { urlAtLeast } from "./img";
import { activePrice, getAllProducts, getQtyRules, mediaByIds, rulesForProduct, unitPriceForQty, type ProductFull, type Variation } from "./data";

export const CART_COOKIE = "emily_cart";

export type CartLine = {
  id: number;
  product_id: number;
  variation_id: number | null;
  name: string;
  link: string;
  image: string | null;
  quantity: number;
  regular_unit: number;
  unit_price: number;
  line_total: number;
  variation: Record<string, string>;
  sku: string | null;
  max_qty: number | null;
  sold_individually: boolean;
};
export type CartView = {
  items: CartLine[];
  count: number;
  subtotal: number;
  discount: number;
  total: number;
  coupons: { code: string; amount: number }[];
  needs_shipping: boolean;
};

const hash = (t: string) => createHash("sha256").update(t).digest("hex");

export async function readCartToken(): Promise<string | null> {
  const c = await cookies();
  return c.get(CART_COOKIE)?.value ?? null;
}

async function findCart(token: string | null) {
  if (!token) return null;
  const r = await db().from("carts").select("id,coupon_codes,customer_id,expires_at").eq("token_hash", hash(token)).maybeSingle();
  if (!r.data) return null;
  if (Date.parse(r.data.expires_at) < Date.now()) return null;
  return r.data as { id: string; coupon_codes: string[]; customer_id: number | null };
}

/** Returns the cart for the current cookie, creating one (and the cookie) when `create` is set. */
export async function getOrCreateCart(create: boolean) {
  const c = await cookies();
  let token = c.get(CART_COOKIE)?.value ?? null;
  let cart = await findCart(token);
  if (!cart && create) {
    token = randomBytes(24).toString("base64url");
    const r = await db().from("carts").insert({ token_hash: hash(token) }).select("id,coupon_codes,customer_id").single();
    if (r.error) throw new Error(r.error.message);
    cart = r.data as any;
    c.set(CART_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 });
  }
  return cart;
}

export async function variationById(id: number): Promise<Variation | null> {
  const r = await db().from("product_variations").select("*").eq("id", id).eq("status", "publish").maybeSingle();
  return (r.data as Variation) ?? null;
}

function stockOk(p: ProductFull, v: Variation | null, qty: number): string | null {
  const status = (v?.stock_status ?? p.stock_status) as string;
  if (status === "outofstock") return "此商品目前缺貨。";
  const manage = v?.manage_stock ?? p.manage_stock;
  const stockQty = v?.stock_quantity ?? p.stock_quantity;
  if (manage && stockQty != null && p.backorders === "no" && qty > stockQty) return `庫存不足，目前僅剩 ${stockQty} 件。`;
  if (p.max_purchase_qty && qty > p.max_purchase_qty) return `此商品每筆訂單最多購買 ${p.max_purchase_qty} 件。`;
  return null;
}

export async function addToCart(productId: number, qty: number, variationId: number | null, variation: Record<string, string>) {
  const products = await getAllProducts();
  const p = products.find((x) => x.id === productId);
  if (!p || !p.purchasable) return { error: "找不到此商品或此商品無法購買。" };
  if (p.type === "variable" && !variationId) return { error: "請選擇商品選項。" };
  const v = variationId ? await variationById(variationId) : null;
  if (variationId && (!v || v.product_id !== p.id)) return { error: "商品選項無效。" };
  if (!Number.isInteger(qty) || qty < 1) return { error: "數量無效。" };
  const cart = await getOrCreateCart(true);
  if (!cart) return { error: "無法建立購物車。" };
  const existing = await db().from("cart_items").select("id,quantity").eq("cart_id", cart.id).eq("product_id", productId).filter("variation_id", variationId ? "eq" : "is", variationId ?? null).maybeSingle();
  let newQty = (existing.data?.quantity ?? 0) + qty;
  if (p.sold_individually) {
    if (existing.data) return { error: `無法再新增「${p.name}」，此商品每筆訂單限購一件。` };
    newQty = 1;
  }
  const err = stockOk(p, v, newQty);
  if (err) return { error: err };
  if (existing.data) await db().from("cart_items").update({ quantity: newQty }).eq("id", existing.data.id);
  else await db().from("cart_items").insert({ cart_id: cart.id, product_id: productId, variation_id: variationId, quantity: newQty, variation });
  await db().from("carts").update({ updated_at: new Date().toISOString() }).eq("id", cart.id);
  return { ok: true, message: `「${p.name}」已新增至你的購物車` };
}

export async function setQty(itemId: number, qty: number) {
  const cart = await getOrCreateCart(false);
  if (!cart) return { error: "購物車是空的。" };
  if (qty <= 0) {
    await db().from("cart_items").delete().eq("id", itemId).eq("cart_id", cart.id);
    return { ok: true };
  }
  const it = await db().from("cart_items").select("product_id,variation_id").eq("id", itemId).eq("cart_id", cart.id).maybeSingle();
  if (!it.data) return { error: "找不到購物車項目。" };
  const p = (await getAllProducts()).find((x) => x.id === it.data!.product_id);
  if (!p) return { error: "商品已不存在。" };
  const v = it.data.variation_id ? await variationById(it.data.variation_id) : null;
  const err = stockOk(p, v, p.sold_individually ? 1 : qty);
  if (err) return { error: err };
  await db().from("cart_items").update({ quantity: p.sold_individually ? 1 : qty }).eq("id", itemId).eq("cart_id", cart.id);
  return { ok: true };
}

export async function setCoupons(codes: string[]) {
  const cart = await getOrCreateCart(true);
  if (!cart) return;
  await db().from("carts").update({ coupon_codes: codes }).eq("id", cart.id);
}

type Coupon = {
  id: number;
  code: string;
  status: string;
  discount_type: "percent" | "fixed_cart" | "fixed_product";
  amount: number;
  date_expires: string | null;
  usage_count: number;
  usage_limit: number | null;
  minimum_amount: number | null;
  maximum_amount: number | null;
  product_ids: number[];
  excluded_product_ids: number[];
  exclude_sale_items: boolean;
  individual_use: boolean;
};

export async function findCoupon(code: string): Promise<Coupon | null> {
  const r = await db().from("coupons").select("*").ilike("code", code.replace(/[%_\\]/g, (m) => "\\" + m)).eq("status", "publish").maybeSingle();
  return (r.data as Coupon) ?? null;
}

export function couponError(c: Coupon | null, subtotal: number): string | null {
  if (!c) return "優惠券不存在。";
  if (c.date_expires && Date.parse(c.date_expires) < Date.now()) return "此優惠券已過期。";
  if (c.usage_limit != null && c.usage_count >= c.usage_limit) return "此優惠券已達使用上限。";
  if (c.minimum_amount != null && subtotal < Number(c.minimum_amount)) return `此優惠券最低消費金額為 NT$${Number(c.minimum_amount)}。`;
  if (c.maximum_amount != null && Number(c.maximum_amount) > 0 && subtotal > Number(c.maximum_amount)) return `此優惠券最高消費金額為 NT$${Number(c.maximum_amount)}。`;
  return null;
}

/** Computes the cart with server-side prices (quantity discounts + coupons). */
export async function viewCart(): Promise<CartView> {
  const empty: CartView = { items: [], count: 0, subtotal: 0, discount: 0, total: 0, coupons: [], needs_shipping: false };
  const cart = await findCart(await readCartToken());
  if (!cart) return empty;
  const rows = (await db().from("cart_items").select("id,product_id,variation_id,quantity,variation").eq("cart_id", cart.id).order("added_at")).data ?? [];
  if (!rows.length) return { ...empty, coupons: [] };
  const [products, rules] = await Promise.all([getAllProducts(), getQtyRules()]);
  const varIds = rows.map((r: any) => r.variation_id).filter(Boolean);
  const vars = varIds.length ? (((await db().from("product_variations").select("*").in("id", varIds)).data ?? []) as Variation[]) : [];
  const varImgs = await mediaByIds(vars.map((v) => v.image_id));
  const items: CartLine[] = [];
  let needsShipping = false;
  for (const r of rows as any[]) {
    const p = products.find((x) => x.id === r.product_id);
    if (!p) continue;
    const v = r.variation_id ? vars.find((x) => x.id === r.variation_id) ?? null : null;
    const base = v ? activePrice({ price: v.price, sale_price: v.sale_price == null ? null : Number(v.sale_price), regular_price: v.regular_price == null ? null : Number(v.regular_price) }) : activePrice(p);
    const regular = Number(v?.regular_price ?? p.regular_price ?? base);
    const unit = unitPriceForQty(base, r.quantity, rulesForProduct(rules, p));
    if (!p.virtual) needsShipping = true;
    items.push({
      id: r.id,
      product_id: p.id,
      variation_id: r.variation_id,
      name: p.name,
      link: p.link_path,
      image: thumb(v?.image_id ? varImgs.get(v.image_id) : null) ?? thumb(p.image) ?? null,
      quantity: r.quantity,
      regular_unit: regular,
      unit_price: unit,
      line_total: Math.round(unit * r.quantity * 100) / 100,
      variation: r.variation ?? {},
      sku: v?.sku ?? p.sku,
      max_qty: p.sold_individually ? 1 : p.max_purchase_qty,
      sold_individually: p.sold_individually,
    });
  }
  const subtotal = Math.round(items.reduce((s, i) => s + i.line_total, 0) * 100) / 100;
  const coupons: { code: string; amount: number }[] = [];
  let discount = 0;
  for (const code of cart.coupon_codes ?? []) {
    const c = await findCoupon(code);
    if (couponError(c, subtotal)) continue;
    let amt = 0;
    const eligible = items.filter(
      (i) => (!c!.product_ids?.length || c!.product_ids.includes(i.product_id)) && !(c!.excluded_product_ids ?? []).includes(i.product_id) && !(c!.exclude_sale_items && i.unit_price < i.regular_unit),
    );
    const base = eligible.reduce((s, i) => s + i.line_total, 0);
    if (c!.discount_type === "percent") amt = (base * Number(c!.amount)) / 100;
    else if (c!.discount_type === "fixed_cart") amt = Math.min(Number(c!.amount), base);
    else amt = eligible.reduce((s, i) => s + Math.min(Number(c!.amount), i.unit_price) * i.quantity, 0);
    amt = Math.min(Math.round(amt * 100) / 100, subtotal - discount);
    discount += amt;
    coupons.push({ code: c!.code, amount: amt });
  }
  return {
    items,
    count: items.reduce((s, i) => s + i.quantity, 0),
    subtotal,
    discount,
    total: Math.max(0, Math.round((subtotal - discount) * 100) / 100),
    coupons,
    needs_shipping: needsShipping,
  };
}

export async function clearCart() {
  const cart = await findCart(await readCartToken());
  if (!cart) return;
  await db().from("cart_items").delete().eq("cart_id", cart.id);
  await db().from("carts").update({ coupon_codes: [] }).eq("id", cart.id);
}

export async function cartCount(): Promise<number> {
  const cart = await findCart(await readCartToken());
  if (!cart) return 0;
  const r = await db().from("cart_items").select("quantity").eq("cart_id", cart.id);
  return (r.data ?? []).reduce((s: number, x: any) => s + x.quantity, 0);
}

/** Cart thumbnails render at ≤300px: use the 480 variant instead of the full-size file. */
function thumb(m: { public_url: string; width: number | null; height: number | null; variants?: { w: number; h: number; path: string }[] | null } | null | undefined) {
  return m ? urlAtLeast(m, 480) : null;
}
