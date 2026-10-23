import { NextResponse } from "next/server";
import { db, userFromToken } from "@/lib/db";

export const dynamic = "force-dynamic";

/** After sign-up / sign-in: make sure the auth user has a site_emily.customers row. */
export async function POST(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const user = await userFromToken(token);
  if (!user) return NextResponse.json({ error: "請先登入。" }, { status: 401 });
  const existing = await db().from("customers").select("id").eq("auth_user_id", user.id).maybeSingle();
  if (existing.data) return NextResponse.json({ ok: true, customer_id: existing.data.id });
  // claim an imported customer row with the same e-mail (from the WooCommerce import) if present
  const byEmail = user.email ? await db().from("customers").select("id,auth_user_id").ilike("email", user.email).is("auth_user_id", null).limit(1) : { data: [] as any[] };
  if (byEmail.data?.[0]) {
    await db().from("customers").update({ auth_user_id: user.id, date_last_active: new Date().toISOString() }).eq("id", byEmail.data[0].id);
    return NextResponse.json({ ok: true, customer_id: byEmail.data[0].id });
  }
  const ins = await db()
    .from("customers")
    .insert({ auth_user_id: user.id, email: user.email, username: user.email, display_name: user.email?.split("@")[0] ?? "", role: "customer", date_created: new Date().toISOString(), billing: { email: user.email } })
    .select("id")
    .single();
  if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });
  return NextResponse.json({ ok: true, customer_id: ins.data.id });
}
