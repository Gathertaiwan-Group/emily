import "server-only";
import { cache } from "react";
import { db } from "./db";
import { POSTS_PER_PAGE } from "./site";

/* ------------------------------------------------------------------ types */
export type Media = {
  id: number;
  public_url: string;
  width: number | null;
  height: number | null;
  alt_text: string;
  title: string;
  mime_type: string;
  variants?: { w: number; h: number; path: string }[] | null;
};
export type Term = {
  id: number;
  taxonomy: string;
  slug: string;
  name: string;
  description: string;
  parent_id: number | null;
  count: number;
  link_path: string | null;
  seo: Record<string, any>;
};
export type Author = { id: number; slug: string; name: string; description: string; avatar_url: string | null; link_path: string | null };
export type PostLite = {
  id: number;
  post_type: string;
  title: string;
  excerpt: string;
  link_path: string;
  date: string;
  modified: string | null;
  author_id: number | null;
  featured_media_id: number | null;
  comment_status: string;
};
export type Post = PostLite & {
  slug: string;
  status: string;
  content: string;
  parent_id: number | null;
  template: string;
  builder: string | null;
  seo: Record<string, any>;
  meta: Record<string, any>;
};
export type PostCard = PostLite & { media: Media | null; categories: Term[]; tags: Term[]; author: Author | null; comments: number };

export type Product = {
  id: number;
  slug: string;
  name: string;
  type: string;
  status: string;
  featured: boolean;
  catalog_visibility: string;
  description: string;
  short_description: string;
  sku: string | null;
  regular_price: number | null;
  sale_price: number | null;
  price: number | null;
  date_on_sale_from: string | null;
  date_on_sale_to: string | null;
  manage_stock: boolean;
  stock_quantity: number | null;
  stock_status: string;
  backorders: string;
  sold_individually: boolean;
  min_purchase_qty: number;
  max_purchase_qty: number | null;
  purchasable: boolean;
  virtual: boolean;
  featured_media_id: number | null;
  gallery_media_ids: number[];
  menu_order: number;
  total_sales: number;
  average_rating: number;
  review_count: number;
  link_path: string;
  date: string;
  modified: string | null;
  seo: Record<string, any>;
  meta: Record<string, any>;
};
export type Variation = {
  id: number;
  product_id: number;
  status: string;
  sku: string | null;
  attributes: Record<string, string>;
  description: string;
  regular_price: number | null;
  sale_price: number | null;
  price: number | null;
  manage_stock: boolean | null;
  stock_quantity: number | null;
  stock_status: string | null;
  image_id: number | null;
  menu_order: number;
};
export type AttrValue = {
  attribute_id: number | null;
  name: string;
  position: number;
  visible: boolean;
  used_for_variations: boolean;
  term_ids: number[];
  options: string[];
};
export type QtyRule = {
  id: number;
  name: string;
  priority: number;
  applies_to: string;
  product_ids: number[];
  category_ids: number[];
  min_qty: number;
  max_qty: number | null;
  discount_type: "percent" | "fixed_per_item" | "fixed_price";
  amount: number;
};

/* ------------------------------------------------------------------ tiny TTL memo (per server instance) */
const store = new Map<string, { at: number; v: Promise<any> }>();
function memo<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  const now = Date.now();
  if (hit && now - hit.at < ttlMs) return hit.v as Promise<T>;
  const v = fn().catch((e) => {
    store.delete(key);
    throw e;
  });
  store.set(key, { at: now, v });
  return v;
}
const MIN = 60_000;
/** Drops this instance's memoised lookups (called after admin / MCP writes). */
export function invalidateMemo(prefix?: string) {
  if (!prefix) store.clear();
  else for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k);
}

function must<T>(r: { data: T | null; error: any }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return (r.data ?? ([] as unknown)) as T;
}

/* ------------------------------------------------------------------ terms / authors / menus / settings */
export const getTerms = () =>
  memo("terms", 5 * MIN, async () => {
    const rows: Term[] = [];
    for (let from = 0; ; from += 1000) {
      const r = await db()
        .from("terms")
        .select("id,taxonomy,slug,name,description,parent_id,count,link_path,seo")
        .order("name")
        .range(from, from + 999);
      const page = must(r, "terms") as Term[];
      rows.push(...page);
      if (page.length < 1000) break;
    }
    const byId = new Map(rows.map((t) => [t.id, t]));
    return { all: rows, byId };
  });

export async function termDescendants(id: number): Promise<number[]> {
  const { all } = await getTerms();
  const out = [id];
  for (let i = 0; i < out.length; i++) for (const t of all) if (t.parent_id === out[i]) out.push(t.id);
  return out;
}

export const getAuthors = () =>
  memo("authors", 10 * MIN, async () => {
    const rows = must(await db().from("authors").select("id,slug,name,description,avatar_url,link_path"), "authors") as Author[];
    return new Map(rows.map((a) => [a.id, a]));
  });

export type MenuItem = { id: number; parent_id: number | null; position: number; title: string; url: string; object_type: string | null; children: MenuItem[] };
/** Menu assigned to a theme location (WordPress nav_menu_locations: main-menu, footer-menu ...). */
export const getMenuByLocation = (location: string) => getMenu(location, "location");
export const getMenu = (key: string, by: "slug" | "location" = "slug") =>
  memo(`menu:${by}:${key}`, 5 * MIN, async () => {
    const rows = must(await db().from("menus").select("id").eq(by, key).order("id").limit(1), "menu") as { id: number }[];
    const m = rows[0] ?? null;
    if (!m) return [] as MenuItem[];
    const items = must(
      await db().from("menu_items").select("id,parent_id,position,title,url,object_type").eq("menu_id", m.id).order("position"),
      "menu_items",
    ) as Omit<MenuItem, "children">[];
    const nodes = new Map<number, MenuItem>(items.map((i) => [i.id, { ...i, children: [] }]));
    const roots: MenuItem[] = [];
    for (const n of nodes.values()) {
      if (n.parent_id && nodes.has(n.parent_id)) nodes.get(n.parent_id)!.children.push(n);
      else roots.push(n);
    }
    const sort = (a: MenuItem[]) => {
      a.sort((x, y) => x.position - y.position || x.id - y.id);
      a.forEach((c) => sort(c.children));
    };
    sort(roots);
    return roots;
  });

export const getSettings = () =>
  memo("settings", 10 * MIN, async () => {
    const rows = must(await db().from("settings").select("key,value").eq("is_public", true), "settings") as { key: string; value: any }[];
    return Object.fromEntries(rows.map((r) => [r.key, r.value])) as Record<string, any>;
  });

/** Site identity / tracking from site_emily.settings (editable in /admin/settings), with the migrated defaults. */
export const siteConfig = () =>
  memo("siteconfig", 5 * MIN, async () => {
    const s = await getSettings().catch(() => ({}) as Record<string, any>);
    const g = s.general ?? {};
    const t = s.tracking ?? {};
    const so = s.social ?? {};
    const D = await import("./site");
    const id = (v: unknown, re: RegExp, d: string) => (typeof v === "string" && re.test(v) ? v : v === undefined ? d : "");
    return {
      name: (g.name as string) || D.SITE_NAME,
      tagline: (g.description as string) || "",
      logo: (g.logo_url as string) || D.LOGO_URL,
      favicon: (g.site_icon_url as string) || D.FAVICON_URL,
      gtm: id(t.gtm, /^GTM-[A-Z0-9]+$/, D.GTM_ID),
      ga4: id(t.ga4, /^G-[A-Z0-9]+$/, D.GA4_ID),
      pixel: id(t.facebook_pixel, /^\d{5,20}$/, D.FB_PIXEL_ID),
      social: {
        facebook: (so.facebook as string) || D.SOCIAL.facebook,
        instagram: (so.instagram as string) || D.SOCIAL.instagram,
        email: (so.email as string) || D.SOCIAL.email,
        line: (so.line as string) || D.SOCIAL.line,
      },
      contact: (s.contact ?? {}) as Record<string, string>,
    };
  });

/* ------------------------------------------------------------------ media */
export async function mediaByIds(ids: (number | null | undefined)[]): Promise<Map<number, Media>> {
  const uniq = [...new Set(ids.filter((x): x is number => typeof x === "number"))];
  if (!uniq.length) return new Map();
  const rows = must(
    await db().from("media").select("id,public_url,width,height,alt_text,title,mime_type,variants").in("id", uniq),
    "media",
  ) as Media[];
  return new Map(rows.map((m) => [m.id, m]));
}

/* ------------------------------------------------------------------ posts */
const LITE = "id,post_type,title,excerpt,link_path,date,modified,author_id,featured_media_id,comment_status";

export async function listPostIds(opts: {
  types?: string[];
  termIds?: number[] | null;
  author?: number | null;
  search?: string | null;
  year?: number | null;
  month?: number | null;
  day?: number | null;
  limit?: number;
  offset?: number;
}): Promise<{ ids: number[]; total: number }> {
  const r = await db().rpc("list_post_ids", {
    p_types: opts.types ?? ["post"],
    p_term_ids: opts.termIds ?? null,
    p_author: opts.author ?? null,
    p_search: opts.search ?? null,
    p_year: opts.year ?? null,
    p_month: opts.month ?? null,
    p_day: opts.day ?? null,
    p_limit: opts.limit ?? POSTS_PER_PAGE,
    p_offset: opts.offset ?? 0,
  });
  const rows = must(r, "list_post_ids") as { id: number; total: number }[];
  return { ids: rows.map((x) => Number(x.id)), total: rows.length ? Number(rows[0].total) : 0 };
}

export async function cardsByIds(ids: number[]): Promise<PostCard[]> {
  if (!ids.length) return [];
  const posts = must(await db().from("posts").select(LITE).in("id", ids), "posts") as PostLite[];
  const [media, { byId }, authors, pt, cm] = await Promise.all([
    mediaByIds(posts.map((p) => p.featured_media_id)),
    getTerms(),
    getAuthors(),
    db().from("post_terms").select("post_id,term_id,term_order").in("post_id", ids),
    db().from("comments").select("post_id").eq("status", "approved").in("post_id", ids),
  ]);
  const termRows = must(pt, "post_terms") as { post_id: number; term_id: number; term_order: number }[];
  const commentRows = must(cm, "comments") as { post_id: number }[];
  const order = new Map(ids.map((id, i) => [id, i]));
  return posts
    .map((p) => {
      const terms = termRows
        .filter((r) => r.post_id === p.id)
        .sort((a, b) => a.term_order - b.term_order || a.term_id - b.term_id)
        .map((r) => byId.get(r.term_id))
        .filter((t): t is Term => !!t);
      return {
        ...p,
        media: p.featured_media_id ? media.get(p.featured_media_id) ?? null : null,
        categories: sortCats(terms.filter((t) => t.taxonomy === "category")),
        tags: terms.filter((t) => t.taxonomy === "post_tag"),
        author: p.author_id ? authors.get(p.author_id) ?? null : null,
        comments: commentRows.filter((c) => c.post_id === p.id).length,
      };
    })
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/** WordPress lists a post's categories ordered by name; Soledad keeps that order. We keep the
 *  order recorded on import (class_list order) when present. */
function sortCats(c: Term[]) {
  return c;
}

export const getRecentPosts = () =>
  memo("recent", 2 * MIN, async () => {
    const { ids } = await listPostIds({ limit: 5 });
    return cardsByIds(ids);
  });

export const getPostByPath = cache(async (path: string): Promise<Post | null> => {
  const r = await db()
    .from("posts")
    .select("*")
    .eq("link_path", path)
    .eq("status", "publish")
    .in("post_type", ["post", "page"])
    .limit(1)
    .maybeSingle();
  if (r.error) throw new Error(r.error.message);
  if (!r.data) return null;
  const pw = await db().from("post_passwords").select("post_id").eq("post_id", r.data.id).maybeSingle();
  if (pw.data) return null;
  return r.data as Post;
});

export const getPostById = cache(async (id: number): Promise<Post | null> => {
  const r = await db().from("posts").select("*").eq("id", id).eq("status", "publish").maybeSingle();
  return (r.data as Post) ?? null;
});

export async function postTerms(postId: number): Promise<Term[]> {
  const [{ byId }, r] = await Promise.all([getTerms(), db().from("post_terms").select("term_id,term_order").eq("post_id", postId)]);
  const rows = must(r, "post_terms") as { term_id: number; term_order: number }[];
  return rows
    .sort((a, b) => a.term_order - b.term_order || a.term_id - b.term_id)
    .map((x) => byId.get(x.term_id))
    .filter((t): t is Term => !!t);
}

export async function adjacentPosts(p: Post): Promise<{ prev: PostLite | null; next: PostLite | null }> {
  const [a, b] = await Promise.all([
    db().from("posts").select(LITE).eq("post_type", "post").eq("status", "publish").lt("date", p.date).order("date", { ascending: false }).limit(1),
    db().from("posts").select(LITE).eq("post_type", "post").eq("status", "publish").gt("date", p.date).order("date", { ascending: true }).limit(1),
  ]);
  return { prev: (a.data?.[0] as PostLite) ?? null, next: (b.data?.[0] as PostLite) ?? null };
}

export async function relatedPosts(p: Post, cats: Term[]): Promise<PostCard[]> {
  const ids = cats.map((c) => c.id);
  if (!ids.length) return [];
  const { ids: rel } = await listPostIds({ termIds: ids, limit: 11 });
  return cardsByIds(rel.filter((x) => x !== p.id).slice(0, 10));
}

export async function approvedComments(postId: number) {
  const r = await db()
    .from("comments")
    .select("id,parent_id,author_name,author_url,avatar_url,content,date,type")
    .eq("post_id", postId)
    .eq("status", "approved")
    .order("date");
  return (r.data ?? []) as { id: number; parent_id: number | null; author_name: string; author_url: string; avatar_url: string | null; content: string; date: string; type: string }[];
}

/** Footer tag cloud. The old site's tag-cloud block showed 45 tags picked at random (ties at the
 *  count cut-off are returned in arbitrary order by MySQL), sorted by name, sized 8–22pt by count.
 *  (Verified against 3 saved old pages: ~half of the 45 shown tags have count 1, matching a random pick.) */
export const getTagCloud = () =>
  memo("tagcloud", 10 * MIN, async () => {
    const { all } = await getTerms();
    const pool = all.filter((t) => t.taxonomy === "post_tag" && t.count > 0);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const key = (s: string) => s.toLowerCase();
    const tags = pool.slice(0, 45).sort((a, b) => (key(a.name) < key(b.name) ? -1 : key(a.name) > key(b.name) ? 1 : 0));
    const counts = tags.map((t) => t.count);
    const min = Math.min(...counts);
    const spread = Math.max(...counts) - min || 1;
    const step = (22 - 8) / spread;
    return tags.map((t) => ({ term: t, size: +(8 + (t.count - min) * step).toFixed(3) }));
  });

/** Category tree for the sidebar "Categories" widget (non-empty categories with counts). */
export const getCategoryTree = () =>
  memo("cattree", 10 * MIN, async () => {
    const [{ all }, padded] = await Promise.all([getTerms(), db().rpc("category_padded_counts")]);
    const pc = new Map(((padded.data ?? []) as { term_id: number; padded: number }[]).map((r) => [Number(r.term_id), Number(r.padded)]));
    const order = (await db().from("terms").select("id,menu_order").eq("taxonomy", "category")).data ?? [];
    const mo = new Map(order.map((r: any) => [r.id, r.menu_order]));
    const cats = all
      .filter((t) => t.taxonomy === "category" && (pc.get(t.id) ?? t.count) > 0)
      .map((t) => ({ ...t, count: pc.get(t.id) ?? t.count }));
    type Node = { term: Term; children: Node[] };
    const nodes = new Map<number, Node>(cats.map((c) => [c.id, { term: c, children: [] }]));
    const roots: Node[] = [];
    for (const n of nodes.values()) {
      const p = n.term.parent_id ? nodes.get(n.term.parent_id) : null;
      if (p) p.children.push(n);
      else roots.push(n);
    }
    const sort = (a: Node[]) => {
      a.sort((x, y) => (mo.get(x.term.id) ?? 999) - (mo.get(y.term.id) ?? 999) || x.term.name.localeCompare(y.term.name, "zh-Hant"));
      a.forEach((n) => sort(n.children));
    };
    sort(roots);
    return roots;
  });

/* ------------------------------------------------------------------ products */
export const getAllProducts = () =>
  memo("products", 1 * MIN, async () => {
    const rows = must(await db().from("products").select("*").eq("status", "publish").order("menu_order").order("name"), "products") as Product[];
    const ids = rows.map((p) => p.id);
    const [pt, media, { byId }] = await Promise.all([
      ids.length ? db().from("product_terms").select("product_id,term_id").in("product_id", ids) : Promise.resolve({ data: [], error: null }),
      mediaByIds(rows.flatMap((p) => [p.featured_media_id, ...(p.gallery_media_ids ?? [])])),
      getTerms(),
    ]);
    const termRows = must(pt as any, "product_terms") as { product_id: number; term_id: number }[];
    return rows.map((p) => {
      const terms = termRows.filter((r) => r.product_id === p.id).map((r) => byId.get(r.term_id)).filter((t): t is Term => !!t);
      return {
        ...p,
        regular_price: p.regular_price == null ? null : Number(p.regular_price),
        sale_price: p.sale_price == null ? null : Number(p.sale_price),
        price: p.price == null ? null : Number(p.price),
        cats: terms.filter((t) => t.taxonomy === "product_cat"),
        tags: terms.filter((t) => t.taxonomy === "product_tag"),
        image: p.featured_media_id ? media.get(p.featured_media_id) ?? null : null,
        gallery: (p.gallery_media_ids ?? []).map((id) => media.get(id)).filter((m): m is Media => !!m),
      };
    });
  });
export type ProductFull = Awaited<ReturnType<typeof getAllProducts>>[number];

export async function getProductBySlug(slug: string): Promise<ProductFull | null> {
  const all = await getAllProducts();
  return all.find((p) => p.slug === slug || decodeURIComponentSafe(p.slug) === slug) ?? null;
}
export async function getProductById(id: number): Promise<ProductFull | null> {
  const all = await getAllProducts();
  return all.find((p) => p.id === id) ?? null;
}
function decodeURIComponentSafe(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export async function productVariations(productId: number) {
  const [v, a] = await Promise.all([
    db().from("product_variations").select("*").eq("product_id", productId).eq("status", "publish").order("menu_order"),
    db().from("product_attribute_values").select("attribute_id,name,position,visible,used_for_variations,term_ids,options").eq("product_id", productId).order("position"),
  ]);
  return { variations: (v.data ?? []) as Variation[], attributes: (a.data ?? []) as AttrValue[] };
}

export const getQtyRules = () =>
  memo("qtyrules", 1 * MIN, async () => {
    const r = await db().from("quantity_discount_rules").select("*").eq("enabled", true).order("priority").order("min_qty");
    const now = Date.now();
    return ((r.data ?? []) as any[])
      .filter((x) => (!x.date_from || Date.parse(x.date_from) <= now) && (!x.date_to || Date.parse(x.date_to) > now))
      .map((x) => ({ ...x, amount: Number(x.amount) })) as QtyRule[];
  });

export function rulesForProduct(rules: QtyRule[], p: { id: number; cats: Term[] }) {
  const catIds = new Set(p.cats.map((c) => c.id));
  return rules.filter(
    (r) =>
      r.applies_to === "all" ||
      (r.applies_to === "products" && r.product_ids.includes(p.id)) ||
      (r.applies_to === "categories" && r.category_ids.some((c) => catIds.has(c))),
  );
}

/** Unit price after quantity discount (best matching tier). */
export function unitPriceForQty(base: number, qty: number, rules: QtyRule[]): number {
  let best = base;
  for (const r of rules) {
    if (qty < r.min_qty || (r.max_qty != null && qty > r.max_qty)) continue;
    let v = base;
    if (r.discount_type === "percent") v = base * (1 - r.amount / 100);
    else if (r.discount_type === "fixed_per_item") v = base - r.amount;
    else v = r.amount;
    best = Math.min(best, Math.max(0, v));
  }
  return Math.round(best * 100) / 100;
}

export function isOnSale(p: { sale_price: number | null; regular_price: number | null; date_on_sale_from?: string | null; date_on_sale_to?: string | null }) {
  if (p.sale_price == null || p.regular_price == null || p.sale_price >= p.regular_price) return false;
  const now = Date.now();
  if (p.date_on_sale_from && Date.parse(p.date_on_sale_from) > now) return false;
  if (p.date_on_sale_to && Date.parse(p.date_on_sale_to) < now) return false;
  return true;
}
export function activePrice(p: { price: number | null; sale_price: number | null; regular_price: number | null; date_on_sale_from?: string | null; date_on_sale_to?: string | null }) {
  if (isOnSale(p)) return Number(p.sale_price);
  return Number(p.regular_price ?? p.price ?? 0);
}

/** Attribute selectors for a variable product: [{ key: "pa_colors", label, options: [{value, label}] }]. */
export async function variationForm(productId: number) {
  const { variations, attributes } = await productVariations(productId);
  const attrIds = attributes.map((a) => a.attribute_id).filter((x): x is number => !!x);
  const defs = attrIds.length ? (((await db().from("product_attributes").select("id,name,slug").in("id", attrIds)).data ?? []) as { id: number; name: string; slug: string }[]) : [];
  const { byId } = await getTerms();
  const fields = attributes
    .filter((a) => a.used_for_variations)
    .map((a) => {
      const def = a.attribute_id ? defs.find((d) => d.id === a.attribute_id) : undefined;
      if (def) {
        return {
          key: `pa_${def.slug}`,
          label: def.name,
          options: a.term_ids.map((id) => byId.get(id)).filter((t): t is Term => !!t).map((t) => ({ value: t.slug, label: t.name })),
        };
      }
      return { key: a.name.toLowerCase().replace(/\s+/g, "-"), label: a.name, options: a.options.map((o) => ({ value: o, label: o })) };
    });
  return {
    fields,
    variations: variations.map((v) => ({
      id: v.id,
      attributes: v.attributes,
      price: v.price == null ? null : Number(v.price),
      regular_price: v.regular_price == null ? null : Number(v.regular_price),
      sale_price: v.sale_price == null ? null : Number(v.sale_price),
      stock_status: v.stock_status ?? "instock",
      sku: v.sku,
      image_id: v.image_id,
    })),
  };
}
