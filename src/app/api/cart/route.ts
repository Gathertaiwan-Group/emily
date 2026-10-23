import { NextResponse } from "next/server";
import { addToCart, couponError, findCoupon, setCoupons, setQty, viewCart } from "@/lib/cart";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await viewCart(), { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const action = String(body?.action ?? "");
  let res: { ok?: boolean; error?: string; message?: string } = {};
  if (action === "add") {
    const pid = Number(body.product_id);
    const qty = Math.floor(Number(body.quantity ?? 1));
    const vid = body.variation_id ? Number(body.variation_id) : null;
    const variation = body.variation && typeof body.variation === "object" ? Object.fromEntries(Object.entries(body.variation).map(([k, v]) => [String(k).slice(0, 64), String(v).slice(0, 128)])) : {};
    res = await addToCart(pid, qty, vid, variation as Record<string, string>);
    if (res.ok) {
      // record the add-to-cart form submission (no personal data)
      const f = await db().from("forms").select("id").eq("slug", "add-to-cart").maybeSingle();
      if (f.data) await db().from("form_submissions").insert({ form_id: f.data.id, data: { product_id: pid, quantity: qty, variation_id: vid, variation }, page_url: String(body.page_url ?? "").slice(0, 500) || null, user_agent: req.headers.get("user-agent")?.slice(0, 300) ?? null });
    }
  } else if (action === "set") {
    res = await setQty(Number(body.item_id), Math.floor(Number(body.quantity)));
  } else if (action === "remove") {
    res = await setQty(Number(body.item_id), 0);
  } else if (action === "coupon") {
    const code = String(body.code ?? "").trim().slice(0, 64);
    const cart = await viewCart();
    if (!code) res = { error: "請輸入優惠券代碼。" };
    else {
      const c = await findCoupon(code);
      const err = couponError(c, cart.subtotal);
      if (err) res = { error: err };
      else if (cart.coupons.some((x) => x.code.toLowerCase() === code.toLowerCase())) res = { error: "已套用此優惠券。" };
      else {
        await setCoupons([...cart.coupons.map((x) => x.code), c!.code]);
        res = { ok: true, message: "已成功套用優惠券。" };
      }
    }
  } else if (action === "remove_coupon") {
    const cart = await viewCart();
    await setCoupons(cart.coupons.map((x) => x.code).filter((x) => x.toLowerCase() !== String(body.code ?? "").toLowerCase()));
    res = { ok: true, message: "已移除優惠券。" };
  } else {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
  const cart = await viewCart();
  return NextResponse.json({ ...res, cart }, { status: res.error ? 422 : 200, headers: { "cache-control": "no-store" } });
}
