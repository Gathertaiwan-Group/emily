import { db } from "@/lib/db";
import { buildMpgForm, makeMerchantOrderNo } from "@/lib/newebpay/core";
import { newebpayConfig } from "@/lib/newebpay";
import { NEWEBPAY_EXPIRE_DAYS, gateway } from "@/lib/payments";

export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(title: string, body: string, status = 200) {
  return new Response(
    `<!doctype html><html lang="zh-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title></head><body style="font-family:sans-serif;text-align:center;padding:3em 1em">${body}</body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
}

/** Auto-submitting form to 藍新 MPG for a pending order (amount = the server-computed order total). */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const id = Number(u.searchParams.get("order"));
  const key = u.searchParams.get("key") ?? "";
  const cfg = newebpayConfig();
  if (!cfg) return page("付款", "<p>線上付款目前無法使用。</p>", 503);
  if (!Number.isInteger(id) || id <= 0 || !key) return page("付款", "<p>找不到訂單。</p>", 404);
  const r = await db().from("orders").select("id,order_key,status,payment_method,total,billing_email,meta").eq("id", id).eq("type", "shop_order").maybeSingle();
  const o = r.data as any;
  if (!o || o.order_key !== key) return page("付款", "<p>找不到訂單。</p>", 404);
  const back = `/checkout/order-received/${id}?key=${encodeURIComponent(key)}`;
  const gw = gateway(o.payment_method ?? "");
  if (!gw?.online || o.status !== "pending") return Response.redirect(new URL(back, u.origin), 303);
  const amount = Math.round(Number(o.total));
  if (!(amount > 0)) return page("付款", "<p>訂單金額無效。</p>", 400);

  const items = ((await db().from("order_items").select("name,quantity").eq("order_id", id).eq("item_type", "line_item")).data ?? []) as { name: string; quantity: number }[];
  const desc = items.map((i) => `${i.name}x${i.quantity}`).join(",").replace(/[^\p{L}\p{N} x,._-]/gu, "") || `訂單 ${id}`;
  const no = makeMerchantOrderNo(id);
  // atomic append (row-locked in SQL): parallel tabs each keep their own number
  const up = await db().rpc("newebpay_register_order_no", { p_order_id: id, p_no: no, p_keep: 20 });
  if (up.error) return page("付款", "<p>暫時無法前往付款，請稍後再試。</p>", 500);
  if (up.data !== true) return Response.redirect(new URL(back, u.origin), 303); // no longer pending

  const expire = new Date(Date.now() + NEWEBPAY_EXPIRE_DAYS * 86400_000).toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" }).replace(/-/g, "");
  const origin = u.origin;
  const qs = `order=${id}&key=${encodeURIComponent(key)}`;
  const form = buildMpgForm(
    {
      merchantOrderNo: no,
      amount,
      itemDesc: desc,
      email: o.billing_email ?? "",
      notifyUrl: `${origin}/api/newebpay/notify`,
      returnUrl: `${origin}/api/newebpay/return?${qs}`,
      clientBackUrl: `${origin}${back}`,
      methods: gw.mpg ?? { CREDIT: 1 },
      expireDate: expire,
    },
    cfg,
  );
  const inputs = Object.entries(form)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(String(v))}">`)
    .join("");
  return page(
    "前往藍新金流付款",
    `<p>正在前往藍新金流付款頁面…</p><form id="mpg" method="post" action="${esc(cfg.endpoint)}">${inputs}<button type="submit">前往付款</button></form><script>document.getElementById("mpg").submit()</script>`,
  );
}
