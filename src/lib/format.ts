import { CURRENCY_SYMBOL, TZ } from "./site";

/** WordPress date format used by the theme: Y-m-d in site timezone. */
export function ymd(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}`;
}

/** ISO 8601 with +08:00 offset, like WordPress' datetime attribute. */
export function isoLocal(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() + 8 * 3600 * 1000);
  return d.toISOString().replace(/\.\d{3}Z$/, "+08:00");
}

export function money(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  const s = Number.isInteger(v) ? v.toLocaleString("en-US") : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${CURRENCY_SYMBOL}${s}`;
}

export function priceHtml(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  const s = Number.isInteger(v) ? v.toLocaleString("en-US") : v.toFixed(2);
  return `<span class="woocommerce-Price-amount amount"><bdi><span class="woocommerce-Price-currencySymbol">${CURRENCY_SYMBOL}</span>${s}</bdi></span>`;
}

export function esc(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function stripTags(html: string | null | undefined): string {
  return String(html ?? "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&hellip;/g, "…")
    .replace(/&#8211;/g, "–")
    .replace(/&#8230;/g, "…")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Soledad trims titles in related/feeds: N chars then "...". */
export function trimChars(s: string, n: number): string {
  const arr = Array.from(s);
  return arr.length > n ? arr.slice(0, n).join("") + "..." : s;
}

/** Percent-encode a decoded path the way WordPress prints permalinks (lowercase hex). */
export function encPath(path: string): string {
  return path
    .split("/")
    .map((seg) => encodeURIComponent(seg).replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase()))
    .join("/");
}

export function decPath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}
