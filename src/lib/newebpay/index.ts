import "server-only";
import { db } from "@/lib/db";
import { HOLD_STOCK_MINUTES, ONLINE_METHODS } from "@/lib/payments";
import { resolveNewebpayConfig, type NewebpayConfig, type NewebpayConfigIssue, type NewebpayKeys, type NotifyDeps, type OrderState } from "./core";

let warned = false;

/**
 * Keys come only from env. Missing/partial keys => 藍新 is disabled (checkout hides it).
 * On a Vercel production deployment NEWEBPAY_ENV=test is refused (see resolveNewebpayConfig).
 */
export function newebpayConfig(): NewebpayConfig | null {
  const { config, issue } = resolveNewebpayConfig(process.env);
  if (issue && !warned) {
    warned = true; // once per server instance
    console.error(`[newebpay] DISABLED: ${issue} — NEWEBPAY_ENV=test is not allowed when VERCEL_ENV=production; set test keys in the Preview environment only.`);
  }
  return config;
}

/** Non-null when 藍新 keys are present but refused (admin panel warning). */
export function newebpayConfigIssue(): NewebpayConfigIssue | null {
  return resolveNewebpayConfig(process.env).issue;
}

export function newebpayEnabled(): boolean {
  return newebpayConfig() !== null;
}

export async function loadOrderState(id: number): Promise<OrderState | null> {
  const r = await db().from("orders").select("id,status,payment_method,total,transaction_id,meta").eq("id", id).eq("type", "shop_order").maybeSingle();
  if (r.error) throw new Error(r.error.message);
  return (r.data as OrderState) ?? null;
}

export function notifyDeps(keys: NewebpayKeys, ip: string | null): NotifyDeps {
  return {
    keys,
    loadOrder: loadOrderState,
    transition: async (orderId, from, to, tradeNo, meta, note) => {
      const r = await db().rpc("payment_transition", { p_order_id: orderId, p_from: from, p_to: to, p_trade_no: tradeNo, p_meta: meta, p_note: note, p_actor: "newebpay" });
      if (r.error) throw new Error(r.error.message);
      return String(r.data);
    },
    logEvent: async (e) => {
      const { error } = await db().from("payment_events").insert({ gateway: "newebpay", kind: "notify", ...e, ip });
      if (error) console.error("[newebpay] payment_events insert failed", error.message);
      if (e.outcome.startsWith("rejected") || e.outcome.startsWith("error")) {
        await db().from("audit_log").insert({ actor: "newebpay", source: "system", action: "payment.notify_rejected", entity_type: "order", entity_id: e.order_id == null ? null : String(e.order_id), after: { outcome: e.outcome, merchant_order_no: e.merchant_order_no, amount: e.amount }, ip });
      }
    },
  };
}

/** WooCommerce hold-stock: cancel unpaid 藍新 orders older than the hold time (lazy, called on checkout/admin/notify). */
export async function cancelUnpaidOrders(): Promise<number> {
  const r = await db().rpc("cancel_unpaid_orders", { p_minutes: HOLD_STOCK_MINUTES, p_methods: ONLINE_METHODS });
  if (r.error) {
    console.error("[payments] cancel_unpaid_orders failed", r.error.message);
    return 0;
  }
  return Number(r.data) || 0;
}

export function clientIp(req: Request): string | null {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  return ip && /^[0-9a-f.:]+$/i.test(ip) ? ip : null;
}
