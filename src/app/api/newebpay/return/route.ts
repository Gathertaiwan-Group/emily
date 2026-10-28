export const dynamic = "force-dynamic";

/**
 * 藍新 ReturnURL: the customer's browser comes back here (POST) after paying. Display only —
 * it never changes an order (NotifyURL does). Sends the customer to the order-received page,
 * which shows the order's current status.
 */
function back(req: Request) {
  const u = new URL(req.url);
  const id = Number(u.searchParams.get("order"));
  const key = u.searchParams.get("key") ?? "";
  const to = Number.isInteger(id) && id > 0 && /^wc_order_[A-Za-z0-9_-]+$/.test(key) ? `/checkout/order-received/${id}?key=${encodeURIComponent(key)}` : "/checkout";
  return new Response(null, { status: 303, headers: { location: new URL(to, u.origin).toString(), "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  return back(req);
}
export async function GET(req: Request) {
  return back(req);
}
