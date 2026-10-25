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

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", ndash: "–", mdash: "—",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»", middot: "·", bull: "•",
  copy: "©", reg: "®", trade: "™", times: "×", deg: "°", yen: "¥", euro: "€",
};

/** Decode HTML character references in ONE pass (WordPress stores wptexturize output such as
 *  &#038; / &#8217;), so text can be escaped exactly once on output. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (m, ref: string) => {
    if (ref[0] === "#") {
      const n = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : m;
    }
    return NAMED[ref.toLowerCase()] ?? m;
  });
}

/** Plain text from stored HTML: tags removed, character references decoded (escape on output). */
export function stripTags(html: string | null | undefined): string {
  const text = String(html ?? "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(text)
    .replace(/[\s\u00a0]+/g, " ")
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
