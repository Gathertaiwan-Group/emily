import "server-only";
import { cache } from "react";
import { db } from "./db";
import { getPostByPath, getProductBySlug, getTerms, type Post, type ProductFull, type Term, type Author, getAuthors } from "./data";

export type SpecialPage = "cart" | "checkout" | "account" | "wishlist" | "compare";

export type Resolved =
  | { kind: "home"; post: Post }
  | { kind: "post"; post: Post }
  | { kind: "page"; post: Post; special?: SpecialPage; sub?: string[] }
  | { kind: "category" | "tag"; term: Term; page: number }
  | { kind: "author"; author: Author; page: number }
  | { kind: "date"; year: number; month?: number; day?: number; page: number }
  | { kind: "search"; q: string; page: number }
  | { kind: "blog"; page: number }
  | { kind: "shop"; page: number; term?: Term; post: Post | null }
  | { kind: "product"; product: ProductFull }
  | { kind: "redirect"; to: string; status: 301 | 302 }
  | { kind: "notfound" };

const SPECIAL: Record<string, SpecialPage> = {
  cart: "cart",
  "cart-2": "cart",
  checkout: "checkout",
  "checkout-2": "checkout",
  "my-account": "account",
  "my-account-2": "account",
  wishlist: "wishlist",
  compare: "compare",
};

function splitPage(segs: string[]): { segs: string[]; page: number } | null {
  const n = segs.length;
  if (n >= 2 && segs[n - 2] === "page") {
    const p = Number(segs[n - 1]);
    if (!Number.isInteger(p) || p < 1) return null;
    return { segs: segs.slice(0, -2), page: p };
  }
  return { segs, page: 1 };
}

/** Resolve a decoded path (segments) + search string to what WordPress would have served. */
export const resolveRoute = cache(async (pathname: string, search: string): Promise<Resolved> => {
  const sp = new URLSearchParams(search);
  const raw = pathname.split("/").filter(Boolean).map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });
  const sp2 = splitPage(raw);
  if (!sp2) return { kind: "notfound" };
  const { segs, page } = sp2;

  // ?s= search (WordPress handles it on any front-end URL, normally "/")
  if (sp.has("s") && (segs.length === 0)) return { kind: "search", q: sp.get("s") ?? "", page };

  if (segs.length === 0) {
    if (page > 1) return { kind: "blog", page };
    const home = await getPostByPath("/");
    return home ? { kind: "home", post: home } : { kind: "notfound" };
  }

  const [first, ...rest] = segs;

  if (first === "category" && rest.length) {
    const { all } = await getTerms();
    const slug = rest[rest.length - 1];
    const cands = all.filter((t) => t.taxonomy === "category" && (t.slug === slug || dec(t.slug) === slug));
    const want = "/" + segs.join("/");
    const exact = cands.find((t) => t.link_path === want);
    const t = exact ?? cands[0];
    if (!t) return { kind: "notfound" };
    if (!exact && t.link_path) return { kind: "redirect", to: t.link_path + (page > 1 ? `/page/${page}` : ""), status: 301 };
    return { kind: "category", term: t, page };
  }
  if ((first === "tag" || first === "product-tag" || first === "product-category") && rest.length) {
    const tax = first === "tag" ? "post_tag" : first === "product-tag" ? "product_tag" : "product_cat";
    const { all } = await getTerms();
    const slug = rest[rest.length - 1];
    const t = all.find((x) => x.taxonomy === tax && (x.slug === slug || dec(x.slug) === slug));
    if (!t) return { kind: "notfound" };
    if (tax === "post_tag") return { kind: "tag", term: t, page };
    return { kind: "shop", term: t, page, post: null };
  }
  if (first === "author" && rest.length === 1) {
    const authors = await getAuthors();
    const a = [...authors.values()].find((x) => x.slug === rest[0]);
    return a ? { kind: "author", author: a, page } : { kind: "notfound" };
  }
  if (/^\d{4}$/.test(first) && rest.length <= 2 && rest.every((r) => /^\d{1,2}$/.test(r))) {
    const [m, d] = rest.map(Number);
    if ((m && (m < 1 || m > 12)) || (d && (d < 1 || d > 31))) return { kind: "notfound" };
    return { kind: "date", year: Number(first), month: m, day: d, page };
  }
  if (first === "product" && rest.length === 1) {
    const p = await getProductBySlug(rest[0]);
    return p ? { kind: "product", product: p } : { kind: "notfound" };
  }
  if (first === "shop" && rest.length === 0) {
    const post = await getPostByPath("/shop");
    return { kind: "shop", page, post };
  }
  if (segs.length >= 1 && SPECIAL[first] && page === 1) {
    const post = await getPostByPath("/" + first);
    if (post) return { kind: "page", post, special: SPECIAL[first], sub: rest };
  }
  if (page > 1) return { kind: "notfound" };

  const path = "/" + segs.join("/");
  const post = await getPostByPath(path);
  if (post) return post.post_type === "post" ? { kind: "post", post } : { kind: "page", post };

  // Posts are also reachable by their slug alone (WordPress' redirect_guess_404_permalink).
  if (segs.length === 1) {
    const r = await db().from("posts").select("link_path").eq("status", "publish").eq("post_type", "post").eq("slug", encodeWp(segs[0])).limit(1);
    const lp = r.data?.[0]?.link_path;
    if (lp && lp !== path) return { kind: "redirect", to: lp, status: 301 };
  }
  return { kind: "notfound" };
});

function dec(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
function encodeWp(s: string) {
  return encodeURIComponent(s).replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase());
}

const BASE = "wp-theme-soledad theme-soledad woocommerce-js soledad-ver-8-1-1 pclight-mode pcmn-drdw-style-slide_down";

export function bodyClass(r: Resolved): string {
  const kit = "elementor-default elementor-kit-2072";
  switch (r.kind) {
    case "home":
      return `home wp-singular page-template-default page page-id-${r.post.id} ${BASE} ${kit} elementor-page elementor-page-${r.post.id}`;
    case "post":
      return `wp-singular post-template-default single single-post postid-${r.post.id} single-format-standard ${BASE} ${kit}`;
    case "page": {
      const p = r.post;
      const full = p.template === "page-fullwidth.php";
      const tpl = full ? "page-template page-template-page-fullwidth page-template-page-fullwidth-php" : "page-template-default";
      const wc =
        r.special === "cart" ? " woocommerce-cart woocommerce-page" : r.special === "checkout" ? " woocommerce-checkout woocommerce-page" : r.special === "account" ? " woocommerce-account woocommerce-page" : "";
      const child = p.parent_id ? ` page-child parent-pageid-${p.parent_id}` : "";
      const el = p.builder === "elementor" ? ` elementor-page elementor-page-${p.id}` : "";
      return `wp-singular ${tpl} page page-id-${p.id}${child} ${BASE.replace("woocommerce-js", "")}${wc} woocommerce-js ${kit}${el}`.replace(/\s+/g, " ");
    }
    case "category":
      return `archive category category-${r.term.slug} category-${r.term.id} ${BASE} ${kit}`;
    case "tag":
      return `archive tag tag-${r.term.slug} tag-${r.term.id} ${BASE} ${kit}`;
    case "author":
      return `archive author author-${r.author.slug} author-${r.author.id} ${BASE} ${kit}`;
    case "date":
      return `archive date ${BASE} ${kit}`;
    case "blog":
      return `blog paged ${BASE} ${kit}`;
    case "search":
      return `search search-results ${BASE} ${kit}`;
    case "shop":
      if (r.term)
        return `archive tax-${r.term.taxonomy} term-${r.term.slug} term-${r.term.id} ${BASE.replace("woocommerce-js", "woocommerce woocommerce-page woocommerce-js")} ${kit}`;
      return `archive post-type-archive post-type-archive-product ${BASE.replace("woocommerce-js", "woocommerce-shop woocommerce woocommerce-page woocommerce-js")} ${kit}`;
    case "product":
      return `wp-singular product-template-default single single-product postid-${r.product.id} ${BASE.replace("woocommerce-js", "woocommerce woocommerce-page woocommerce-js")} penci-port-product ${kit}`;
    default:
      return `error404 ${BASE} ${kit}`;
  }
}
