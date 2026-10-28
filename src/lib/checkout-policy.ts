// Pure checkout decisions (no I/O, no imports) — unit-tested in tests/checkout-policy.test.mjs.

export type GuardVerdict = { proceed: true; degraded?: boolean } | { proceed: false; http: number; message: string };

/**
 * Maps the checkout_guard RPC result to what checkout does.
 * The guard only exists to stop stock-locking through unpaid online (藍新) orders, so when the RPC
 * itself fails we block online methods (503) but let offline methods (銀行轉帳／支票／貨到付款) through.
 */
export function guardVerdict(guard: { error: unknown; data: unknown }, online: boolean): GuardVerdict {
  if (guard.error) {
    if (online) return { proceed: false, http: 503, message: "目前無法使用線上付款，請稍後再試或改用其他付款方式。" };
    return { proceed: true, degraded: true };
  }
  if (guard.data === "ok") return { proceed: true };
  if (guard.data === "too_many_unpaid")
    return { proceed: false, http: 429, message: "您有多筆尚未完成付款的訂單。請先完成付款，或於 60 分鐘後未付款訂單自動取消後再下單。" };
  return { proceed: false, http: 429, message: "結帳次數過於頻繁，請稍候幾分鐘後再試。" };
}

export type StockRow = { manage_stock: boolean; stock_quantity: number | null; stock_status: string; backorders: string };
export type StockLine = { name: string; quantity: number; product_id: number; variation_id: number | null; product: StockRow | null; variation: StockRow | null };

/**
 * WooCommerce check_cart_item_stock at checkout, against fresh (uncached) stock rows.
 * Variation stock wins when the variation manages its own stock; otherwise the parent product's
 * (and lines sharing the parent's stock are summed).
 */
export function stockProblems(lines: StockLine[]): string[] {
  const out: string[] = [];
  const need = new Map<string, number>();
  const srcOf = (l: StockLine) => (l.variation && l.variation.manage_stock ? { key: `v:${l.variation_id}`, row: l.variation } : { key: `p:${l.product_id}`, row: l.product! });
  for (const l of lines) if (l.product) need.set(srcOf(l).key, (need.get(srcOf(l).key) ?? 0) + l.quantity);
  for (const l of lines) {
    if (!l.product) {
      out.push(`「${l.name}」已無法購買。`);
      continue;
    }
    const { key, row } = srcOf(l);
    const status = l.variation?.stock_status ?? l.product.stock_status;
    if (status === "outofstock") {
      out.push(`「${l.name}」目前缺貨，請從購物車移除後再結帳。`);
      continue;
    }
    const backorders = row.backorders || l.product.backorders;
    if (row.manage_stock && row.stock_quantity != null && backorders === "no" && (need.get(key) ?? l.quantity) > row.stock_quantity)
      out.push(`「${l.name}」庫存不足（目前僅剩 ${Math.max(0, row.stock_quantity)} 件），請調整數量後再結帳。`);
  }
  return out;
}
