import "server-only";
import { db } from "@/lib/db";
import { CmsError, all, audit, changed, decodeSlug, encodeWpSlug, makeSlug, must, type Actor } from "./core";

export const TAXONOMIES: Record<string, { label: string; hierarchical: boolean; base: string | null; object: "post" | "product" }> = {
  category: { label: "文章分類", hierarchical: true, base: "/category", object: "post" },
  post_tag: { label: "文章標籤", hierarchical: false, base: "/tag", object: "post" },
  product_cat: { label: "商品分類", hierarchical: true, base: "/product-category", object: "product" },
  product_tag: { label: "商品標籤", hierarchical: false, base: "/product-tag", object: "product" },
  pa_colors: { label: "商品屬性：colors", hierarchical: false, base: null, object: "product" },
  pa_brands: { label: "商品屬性：brands", hierarchical: false, base: null, object: "product" },
};

export type TermRow = {
  id: number;
  taxonomy: string;
  slug: string;
  name: string;
  description: string;
  parent_id: number | null;
  menu_order: number;
  count: number;
  link_path: string | null;
  seo: Record<string, any>;
};

function checkTax(taxonomy: string) {
  if (!TAXONOMIES[taxonomy] && !/^pa_[a-z0-9_-]+$/.test(taxonomy)) throw new CmsError(`不支援的分類法：${taxonomy}`);
}

export async function listTerms(taxonomy?: string, search?: string): Promise<TermRow[]> {
  const rows = await all<TermRow>((f, t) => {
    let q = db().from("terms").select("id,taxonomy,slug,name,description,parent_id,menu_order,count,link_path,seo");
    if (taxonomy) q = q.eq("taxonomy", taxonomy);
    return q.order("taxonomy").order("menu_order").order("name").range(f, t);
  }, "terms");
  if (!search) return rows;
  const s = search.toLowerCase();
  return rows.filter((r) => r.name.toLowerCase().includes(s) || decodeSlug(r.slug).toLowerCase().includes(s));
}

/** Depth-first order with depth, like wp-admin's indented category list. */
export function treeOrder(rows: TermRow[]): (TermRow & { depth: number })[] {
  const kids = new Map<number | null, TermRow[]>();
  const ids = new Set(rows.map((r) => r.id));
  for (const r of rows) {
    const p = r.parent_id && ids.has(r.parent_id) ? r.parent_id : null;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p)!.push(r);
  }
  const out: (TermRow & { depth: number })[] = [];
  const walk = (p: number | null, d: number) => {
    for (const r of kids.get(p) ?? []) {
      out.push({ ...r, depth: d });
      if (d < 20) walk(r.id, d + 1);
    }
  };
  walk(null, 0);
  return out;
}

async function linkPathFor(taxonomy: string, slug: string, parentId: number | null): Promise<string | null> {
  const base = TAXONOMIES[taxonomy]?.base ?? null;
  if (!base) return null;
  const segs = [decodeSlug(slug)];
  let p = taxonomy === "category" ? parentId : null; // WC product_cat permalinks are flat on this site
  for (let i = 0; p && i < 20; i++) {
    const r = (await db().from("terms").select("slug,parent_id").eq("id", p).maybeSingle()).data as any;
    if (!r) break;
    segs.unshift(decodeSlug(r.slug));
    p = r.parent_id;
  }
  return `${base}/${segs.join("/")}`;
}

async function uniqueTermSlug(taxonomy: string, slug: string, selfId: number | null) {
  for (let i = 1; i < 200; i++) {
    const cand = i === 1 ? slug : `${slug}-${i}`;
    const r = must(await db().from("terms").select("id").eq("taxonomy", taxonomy).eq("slug", cand).limit(1), "terms") as { id: number }[];
    if (!r.length || r[0].id === selfId) return cand;
  }
  throw new CmsError("無法產生不重複的代稱");
}

export type TermInput = { name?: string; slug?: string; description?: string; parent_id?: number | null; menu_order?: number; seo_title?: string | null; seo_description?: string | null };

export async function createTerm(actor: Actor, taxonomy: string, input: TermInput) {
  checkTax(taxonomy);
  const name = (input.name ?? "").trim();
  if (!name) throw new CmsError("名稱必填");
  const slug = await uniqueTermSlug(taxonomy, input.slug ? encodeWpSlug(input.slug.trim().toLowerCase().replace(/\s+/g, "-")) : makeSlug(name), null);
  const parent = TAXONOMIES[taxonomy]?.hierarchical ? input.parent_id ?? null : null;
  const row = {
    taxonomy,
    name,
    slug,
    description: input.description ?? "",
    parent_id: parent,
    menu_order: input.menu_order ?? 0,
    link_path: await linkPathFor(taxonomy, slug, parent),
    seo: { ...(input.seo_title ? { title: input.seo_title } : {}), ...(input.seo_description ? { description: input.seo_description } : {}) },
  };
  const t = must(await db().from("terms").insert(row).select("*").single(), "terms") as TermRow;
  await audit(actor, "term.create", taxonomy, t.id, null, row);
  changed("terms");
  return t;
}

export async function updateTerm(actor: Actor, id: number, input: TermInput) {
  const before = must(await db().from("terms").select("*").eq("id", id).maybeSingle(), "terms") as TermRow | null;
  if (!before) throw new CmsError(`找不到分類 ${id}`, 404);
  const row: Record<string, any> = {};
  if (input.name !== undefined) row.name = input.name.trim();
  if (input.description !== undefined) row.description = input.description;
  if (input.menu_order !== undefined) row.menu_order = input.menu_order;
  if (input.parent_id !== undefined && TAXONOMIES[before.taxonomy]?.hierarchical) {
    if (input.parent_id === id) throw new CmsError("上層分類不能是自己");
    row.parent_id = input.parent_id;
  }
  if (input.slug) row.slug = await uniqueTermSlug(before.taxonomy, encodeWpSlug(input.slug.trim().toLowerCase().replace(/\s+/g, "-")), id);
  if (input.seo_title !== undefined || input.seo_description !== undefined) {
    const seo = { ...(before.seo ?? {}) };
    if (input.seo_title !== undefined) input.seo_title ? (seo.title = input.seo_title) : delete seo.title;
    if (input.seo_description !== undefined) input.seo_description ? (seo.description = input.seo_description) : delete seo.description;
    row.seo = seo;
  }
  if (row.slug !== undefined || row.parent_id !== undefined) {
    const lp = await linkPathFor(before.taxonomy, row.slug ?? before.slug, row.parent_id !== undefined ? row.parent_id : before.parent_id);
    if (lp !== before.link_path) {
      row.link_path = lp;
      if (before.link_path && lp) await db().from("redirects").upsert({ source_path: before.link_path, target: lp, status_code: 301, kind: "manual" }, { onConflict: "source_path" });
    }
  }
  const after = must(await db().from("terms").update(row).eq("id", id).select("*").single(), "terms") as TermRow;
  if (row.link_path !== undefined && before.taxonomy === "category") await relinkChildren(id);
  await audit(actor, "term.update", before.taxonomy, id, Object.fromEntries(Object.keys(row).map((k) => [k, (before as any)[k]])), row);
  changed("terms");
  return after;
}

async function relinkChildren(parentId: number) {
  const kids = must(await db().from("terms").select("id,taxonomy,slug,parent_id").eq("parent_id", parentId), "terms") as TermRow[];
  for (const k of kids) {
    const lp = await linkPathFor(k.taxonomy, k.slug, k.parent_id);
    await db().from("terms").update({ link_path: lp }).eq("id", k.id);
    await relinkChildren(k.id);
  }
}

export async function deleteTerm(actor: Actor, id: number) {
  const before = must(await db().from("terms").select("*").eq("id", id).maybeSingle(), "terms") as TermRow | null;
  if (!before) throw new CmsError(`找不到分類 ${id}`, 404);
  if (before.taxonomy === "category" && id === 1) throw new CmsError("預設分類不能刪除");
  // children move up one level (WordPress behaviour)
  await db().from("terms").update({ parent_id: before.parent_id }).eq("parent_id", id);
  must(await db().from("terms").delete().eq("id", id), "terms");
  await audit(actor, "term.delete", before.taxonomy, id, before, null);
  changed("terms");
  return { id, deleted: true };
}

/** Recomputes terms.count = number of published objects carrying the term. */
export async function recountTerms(ids: number[]) {
  const uniq = [...new Set(ids.filter((x) => Number.isFinite(x)))];
  if (!uniq.length) return;
  const rows = must(await db().from("terms").select("id,taxonomy").in("id", uniq), "terms") as { id: number; taxonomy: string }[];
  for (const t of rows) {
    const isProduct = t.taxonomy.startsWith("product_") || t.taxonomy.startsWith("pa_");
    const r = isProduct
      ? await db().from("product_terms").select("product_id,products!inner(status)", { count: "exact", head: true }).eq("term_id", t.id).eq("products.status", "publish")
      : await db().from("post_terms").select("post_id,posts!inner(status)", { count: "exact", head: true }).eq("term_id", t.id).eq("posts.status", "publish");
    if (!r.error) await db().from("terms").update({ count: r.count ?? 0 }).eq("id", t.id);
  }
  changed("terms");
}
