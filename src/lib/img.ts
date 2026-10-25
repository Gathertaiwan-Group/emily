// Responsive image helpers (shared by server and client components).
// Variants live at site-emily/v/<w>/<storage_path> (widths 480/960/1440, never upscaled) and are
// listed per media row in media.variants.
import { STORAGE_BASE } from "./site";

export type Variant = { w: number; h: number; path: string };
export type ImgSource = {
  public_url: string;
  width: number | null;
  height: number | null;
  variants?: Variant[] | null;
};

const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");
export const variantUrl = (v: Variant) => `${STORAGE_BASE}/${enc(v.path)}`;

function sorted(m: ImgSource): Variant[] {
  return [...(m.variants ?? [])].filter((v) => v && v.w && v.path).sort((a, b) => a.w - b.w);
}

/** "url 480w, url 960w, …, original Ww" or undefined when there are no variants. */
export function srcSetOf(m: ImgSource): string | undefined {
  const vs = sorted(m);
  if (!vs.length) return undefined;
  const parts = vs.map((v) => `${variantUrl(v)} ${v.w}w`);
  if (m.width && m.width > vs[vs.length - 1].w) parts.push(`${m.public_url} ${m.width}w`);
  return parts.join(", ");
}

/** Smallest stored file at least `min` px wide (falls back to the original). */
export function urlAtLeast(m: ImgSource, min: number): string {
  const v = sorted(m).find((x) => x.w >= min);
  return v ? variantUrl(v) : m.public_url;
}

/** Props for an <img>: src, srcSet, sizes, width/height, lazy + async decoding (unless `priority`). */
export function imgProps(m: ImgSource, opts: { sizes: string; width?: number; height?: number; priority?: boolean; fallbackMin?: number }) {
  const srcSet = srcSetOf(m);
  const w = opts.width ?? m.width ?? undefined;
  const h = opts.height ?? (w && m.width && m.height ? Math.round((w * m.height) / m.width) : m.height ?? undefined);
  return {
    src: opts.fallbackMin ? urlAtLeast(m, opts.fallbackMin) : m.public_url,
    srcSet,
    sizes: srcSet ? opts.sizes : undefined,
    width: w,
    height: h,
    loading: opts.priority ? ("eager" as const) : ("lazy" as const),
    decoding: "async" as const,
    fetchPriority: opts.priority ? ("high" as const) : undefined,
  };
}
