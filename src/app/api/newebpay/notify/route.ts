import { handleNotify } from "@/lib/newebpay/core";
import { db } from "@/lib/db";
import { clientIp, newebpayConfig, newebpayConfigIssue, notifyDeps } from "@/lib/newebpay";

export const dynamic = "force-dynamic";

/**
 * 藍新 NotifyURL (server-to-server). The only place an online payment changes an order:
 * TradeSha verified, TradeInfo AES-decrypted, MerchantID / MerchantOrderNo / Amt checked against
 * the order, then an atomic compare-and-set transition (idempotent on re-sends).
 */
export async function POST(req: Request) {
  const cfg = newebpayConfig();
  if (!cfg) {
    const issue = newebpayConfigIssue();
    if (issue) {
      // production deployment with NEWEBPAY_ENV=test: never mark anything paid; leave a trace for the admin
      const ip = clientIp(req);
      await db().from("payment_events").insert({ gateway: "newebpay", kind: "notify", outcome: `rejected:${issue}`, info: {}, ip });
      await db().from("audit_log").insert({ actor: "newebpay", source: "system", action: "payment.notify_rejected", entity_type: "order", entity_id: null, after: { outcome: `rejected:${issue}` }, ip });
    }
    return new Response("newebpay disabled", { status: 503 });
  }
  let body: Record<string, string>;
  try {
    const fd = await req.formData();
    body = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));
  } catch {
    return new Response("bad request", { status: 400 });
  }
  try {
    const r = await handleNotify(body, notifyDeps(cfg, clientIp(req)));
    return new Response(r.http === 200 ? "1|OK" : `0|${r.outcome}`, { status: r.http, headers: { "content-type": "text/plain; charset=utf-8" } });
  } catch (e) {
    console.error("[newebpay] notify failed", e instanceof Error ? e.message : e);
    return new Response("0|error", { status: 500 });
  }
}
