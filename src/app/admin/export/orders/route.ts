import { adminActor } from "@/lib/admin/auth";
import { audit } from "@/lib/cms/core";
import { listOrders } from "@/lib/cms/commerce";

export const dynamic = "force-dynamic";

const esc = (v: unknown) => {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(req: Request) {
  const actor = await adminActor();
  if (!actor) return new Response("unauthorized", { status: 401 });
  const status = new URL(req.url).searchParams.get("status") || "all";
  const rows: any[] = [];
  for (let page = 1; page < 100; page++) {
    const r = await listOrders({ status, page, per: 200 });
    rows.push(...r.rows);
    if (r.rows.length < 200) break;
  }
  const head = ["id", "number", "date_created", "status", "total", "currency", "billing_email", "name", "phone", "payment_method_title", "date_paid"];
  const lines = [head.join(",")];
  for (const o of rows)
    lines.push(
      [o.id, o.number, o.date_created, o.status, o.total, o.currency, o.billing_email, [o.billing?.last_name, o.billing?.first_name].filter(Boolean).join(""), o.billing?.phone, o.payment_method_title, o.date_paid].map(esc).join(","),
    );
  await audit(actor, "order.export", "order", status, null, { rows: rows.length });
  return new Response("﻿" + lines.join("\r\n"), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="orders-${status}.csv"`, "cache-control": "no-store" },
  });
}
