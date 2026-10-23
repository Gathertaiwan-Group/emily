import { NextResponse } from "next/server";
import { db, userFromToken } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Orders of the signed-in customer (Authorization: Bearer <supabase access token>). */
export async function GET(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const user = await userFromToken(token);
  if (!user) return NextResponse.json({ error: "請先登入。" }, { status: 401 });
  const cust = await db().from("customers").select("id,email,first_name,last_name,display_name,billing,shipping").eq("auth_user_id", user.id).maybeSingle();
  const ids = cust.data ? [cust.data.id] : [];
  let q = db().from("orders").select("id,number,status,date_created,total,currency,payment_method_title,order_key").eq("type", "shop_order").order("date_created", { ascending: false }).limit(100);
  const em = String(user.email ?? "__none__").replace(/["\\]/g, "");
  q = ids.length ? q.or(`customer_id.eq.${ids[0]},billing_email.eq."${em}"`) : q.eq("billing_email", em);
  const orders = await q;
  const withItems = await Promise.all(
    (orders.data ?? []).map(async (o: any) => {
      const it = await db().from("order_items").select("name,quantity,total").eq("order_id", o.id).eq("item_type", "line_item");
      return { ...o, items: it.data ?? [] };
    }),
  );
  return NextResponse.json({ customer: cust.data ?? null, email: user.email, orders: withItems }, { headers: { "cache-control": "no-store" } });
}
