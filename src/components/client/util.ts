"use client";

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
  max_qty: number | null;
  sold_individually: boolean;
};
export type Cart = { items: CartLine[]; count: number; subtotal: number; discount: number; total: number; coupons: { code: string; amount: number }[]; needs_shipping: boolean };

export function money(n: number) {
  const s = Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `NT$${s}`;
}

export function encPath(path: string): string {
  if (/^(https?:|mailto:|#)/.test(path)) return path;
  return path
    .split("/")
    .map((seg) => encodeURIComponent(seg).replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase()))
    .join("/");
}

export async function cartRequest(body: Record<string, unknown>): Promise<{ ok?: boolean; error?: string; message?: string; cart: Cart }> {
  const res = await fetch("/api/cart", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, page_url: location.pathname }) });
  const data = await res.json();
  if (data?.cart) window.dispatchEvent(new CustomEvent("emily:cart", { detail: data.cart }));
  return data;
}

export async function fetchCart(): Promise<Cart> {
  const res = await fetch("/api/cart", { cache: "no-store" });
  const cart = (await res.json()) as Cart;
  window.dispatchEvent(new CustomEvent("emily:cart", { detail: cart }));
  return cart;
}

/** Record a storefront form submission (never include secrets). */
export function logForm(slug: string, data: Record<string, unknown>) {
  try {
    const body = JSON.stringify({ data, page_url: location.pathname + location.search });
    if (navigator.sendBeacon) navigator.sendBeacon(`/api/forms/${slug}`, new Blob([body], { type: "application/json" }));
    else void fetch(`/api/forms/${slug}`, { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true });
  } catch {
    /* ignore */
  }
}

function readList(key: string): number[] {
  try {
    return JSON.parse(localStorage.getItem(key) || "[]").filter((x: unknown) => Number.isInteger(x));
  } catch {
    return [];
  }
}
export const lists = {
  get: (k: "wishlist" | "compare") => readList(`emily_${k}`),
  toggle(k: "wishlist" | "compare", id: number, force?: boolean) {
    const cur = readList(`emily_${k}`);
    const has = cur.includes(id);
    const next = force === true || (!has && force !== false) ? [...new Set([...cur, id])] : cur.filter((x) => x !== id);
    try {
      localStorage.setItem(`emily_${k}`, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent("emily:lists"));
    return next.includes(id);
  },
};

export type SupabaseCfg = { url: string; anon: string };
export function sbCfg(): SupabaseCfg | null {
  const w = window as unknown as { __EMILY__?: SupabaseCfg };
  return w.__EMILY__ ?? null;
}
