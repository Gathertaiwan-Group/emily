import "server-only";
import { db } from "@/lib/db";
import { CmsError, audit, changed, decodeSlug, encodeWpSlug, ilikeTerm, makeSlug, must, type Actor } from "./core";
import { recountTerms } from "./terms";

export const PRODUCT_STATUSES = ["publish", "draft", "pending", "private", "trash"] as const;
export const STOCK_STATUSES = ["instock", "outofstock", "onbackorder"] as const;

export type ProductInput = {
  name?: string;
  slug?: string;
  type?: "simple" | "variable" | "grouped" | "external";
  status?: (typeof PRODUCT_STATUSES)[number];
  featured?: boolean;
  catalog_visibility?: "visible" | "catalog" | "search" | "hidden";
  description?: string;
  short_description?: string;
  sku?: string | null;
  regular_price?: number | null;
  sale_price?: number | null;
  date_on_sale_from?: string | null;
  date_on_sale_to?: string | null;
  manage_stock?: boolean;
  stock_quantity?: number | null;
  stock_status?: (typeof STOCK_STATUSES)[number];
  backorders?: "no" | "notify" | "yes";
  low_stock_amount?: number | null;
  sold_individually?: boolean;
  min_purchase_qty?: number;
  max_purchase_qty?: number | null;
  virtual?: boolean;
  downloadable?: boolean;
  weight?: number | null;
  length?: number | null;
  width?: number | null;
  height?: number | null;
  external_url?: string | null;
  button_text?: string | null;
  featured_media_id?: number | null;
  gallery_media_ids?: number[];
  upsell_ids?: number[];
  cross_sell_ids?: number[];
  menu_order?: number;
  reviews_allowed?: boolean;
  tax_status?: string;
  category_ids?: number[];
  tag_ids?: number[];
  seo_title?: string | null;
  seo_description?: string | null;
};

const SIMPLE_KEYS = [
  "name", "type", "status", "featured", "catalog_visibility", "description", "short_description", "sku", "regular_price", "sale_price",
  "manage_stock", "stock_quantity", "stock_status", "backorders", "low_stock_amount", "sold_individually", "min_purchase_qty", "max_purchase_qty",
  "virtual", "downloadable", "weight", "length", "width", "height", "external_url", "button_text", "featured_media_id", "gallery_media_ids",
  "upsell_ids", "cross_sell_ids", "menu_order", "reviews_allowed", "tax_status",
] as const;

function iso(d: string | null | undefined) {
  if (d === undefined) return undefined;
  if (!d) return null;
  const t = Date.parse(d);
  if (!Number.isFinite(t)) throw new CmsError(`日期格式錯誤：${d}`);
  return new Date(t).toISOString();
}

/** WooCommerce's active price: sale price while the sale window is open, otherwise the regular price. */
export function activePrice(p: { regular_price: any; sale_price: any; date_on_sale_from?: string | null; date_on_sale_to?: string | null }) {
  const reg = p.regular_price == null || p.regular_price === "" ? null : Number(p.regular_price);
  const sale = p.sale_price == null || p.sale_price === "" ? null : Number(p.sale_price);
  const now = Date.now();
  const open = (!p.date_on_sale_from || Date.parse(p.date_on_sale_from) <= now) && (!p.date_on_sale_to || Date.parse(p.date_on_sale_to) > now);
  return sale != null && open ? sale : reg;
}

function stockStatusFor(r: { manage_stock: boolean; stock_quantity: number | null; backorders: string; stock_status: string }) {
  if (!r.manage_stock) return r.stock_status;
  if ((r.stock_quantity ?? 0) > 0) return "instock";
  return r.backorders === "no" ? "outofstock" : "onbackorder";
}

export async function listProducts(opts: { status?: string; search?: string; termId?: number; page?: number; per?: number } = {}) {
  const per = Math.min(Math.max(opts.per ?? 20, 1), 200);
  const page = Math.max(opts.page ?? 1, 1);
  let q = db()
    .from("products")
    .select(
      "id,slug,name,type,status,sku,regular_price,sale_price,price,manage_stock,stock_quantity,stock_status,featured,featured_media_id,link_path,date,modified" +
        (opts.termId ? ",product_terms!inner(term_id)" : ""),
      { count: "exact" },
    );
  if (opts.status && opts.status !== "all") q = q.eq("status", opts.status);
  else q = q.neq("status", "trash");
  if (opts.termId) q = q.eq("product_terms.term_id", opts.termId);
  if (opts.search) {
    const t = ilikeTerm(opts.search);
    q = q.or(`name.ilike.%${t}%,sku.ilike.%${t}%`);
  }
  const r = await q.order("menu_order").order("name").range((page - 1) * per, page * per - 1);
  const rows = (must(r, "products") as any[]).map(({ product_terms: _x, ...p }) => p);
  return { rows, total: r.count ?? 0, page, per };
}

export async function getProduct(id: number) {
  const p = must(await db().from("products").select("*").eq("id", id).maybeSingle(), "products") as any;
  if (!p) return null;
  const [pt, vars, attrs] = await Promise.all([
    db().from("product_terms").select("term_id").eq("product_id", id),
    db().from("product_variations").select("*").eq("product_id", id).order("menu_order").order("id"),
    db().from("product_attribute_values").select("*").eq("product_id", id).order("position"),
  ]);
  return {
    ...p,
    term_ids: (must(pt, "product_terms") as any[]).map((x) => Number(x.term_id)),
    variations: must(vars, "product_variations") as any[],
    attributes: must(attrs, "product_attribute_values") as any[],
  };
}

async function uniqueProductSlug(slug: string, selfId: number | null) {
  for (let i = 1; i < 200; i++) {
    const cand = i === 1 ? slug : `${slug}-${i}`;
    const r = must(await db().from("products").select("id").eq("slug", cand).limit(1), "products") as { id: number }[];
    if (!r.length || r[0].id === selfId) return cand;
  }
  throw new CmsError("無法產生不重複的商品代稱");
}

async function setProductTerms(id: number, categoryIds?: number[], tagIds?: number[]) {
  if (categoryIds === undefined && tagIds === undefined) return [] as number[];
  const cur = must(await db().from("product_terms").select("term_id,terms!inner(taxonomy)").eq("product_id", id), "product_terms") as any[];
  const touched = new Set<number>(cur.map((x) => Number(x.term_id)));
  const keep = cur
    .filter((x) => !(categoryIds !== undefined && x.terms.taxonomy === "product_cat") && !(tagIds !== undefined && x.terms.taxonomy === "product_tag"))
    .map((x) => Number(x.term_id));
  const want = [...new Set([...keep, ...(categoryIds ?? []), ...(tagIds ?? [])])];
  if (want.length) {
    const ok = must(await db().from("terms").select("id").in("id", want), "terms") as { id: number }[];
    const bad = want.filter((w) => !ok.some((o) => o.id === w));
    if (bad.length) throw new CmsError(`分類／標籤 ID 不存在：${bad.join(", ")}`);
  }
  must(await db().from("product_terms").delete().eq("product_id", id), "product_terms");
  if (want.length) must(await db().from("product_terms").insert(want.map((term_id) => ({ product_id: id, term_id }))), "product_terms");
  want.forEach((w) => touched.add(w));
  return [...touched];
}

function rowFrom(input: ProductInput, before: any | null) {
  const row: Record<string, any> = {};
  for (const k of SIMPLE_KEYS) if (input[k] !== undefined) row[k] = input[k];
  if (row.status && !PRODUCT_STATUSES.includes(row.status)) throw new CmsError(`不支援的狀態：${row.status}`);
  if (row.stock_status && !STOCK_STATUSES.includes(row.stock_status)) throw new CmsError(`不支援的庫存狀態：${row.stock_status}`);
  for (const k of ["regular_price", "sale_price"] as const) if (row[k] != null && (!(Number(row[k]) >= 0) || !Number.isFinite(Number(row[k])))) throw new CmsError(`${k} 必須是 ≥ 0 的數字`);
  const from = iso(input.date_on_sale_from);
  const to = iso(input.date_on_sale_to);
  if (from !== undefined) row.date_on_sale_from = from;
  if (to !== undefined) row.date_on_sale_to = to;
  const merged = { ...(before ?? {}), ...row };
  if (merged.sale_price != null && merged.regular_price != null && Number(merged.sale_price) >= Number(merged.regular_price)) throw new CmsError("特價必須低於原價");
  row.price = merged.type === "variable" ? before?.price ?? null : activePrice(merged);
  row.stock_status = stockStatusFor({ manage_stock: !!merged.manage_stock, stock_quantity: merged.stock_quantity ?? null, backorders: merged.backorders ?? "no", stock_status: merged.stock_status ?? "instock" });
  if (input.seo_title !== undefined || input.seo_description !== undefined) {
    const seo = { ...(before?.seo ?? {}) };
    if (input.seo_title !== undefined) input.seo_title ? (seo.title = input.seo_title) : delete seo.title;
    if (input.seo_description !== undefined) input.seo_description ? (seo.description = input.seo_description) : delete seo.description;
    row.seo = seo;
  }
  row.modified = new Date().toISOString();
  return row;
}

export async function createProduct(actor: Actor, input: ProductInput) {
  const name = (input.name ?? "").trim();
  if (!name) throw new CmsError("商品名稱必填");
  const slug = await uniqueProductSlug(input.slug ? encodeWpSlug(input.slug.trim().toLowerCase().replace(/\s+/g, "-")) : makeSlug(name), null);
  const row = rowFrom({ status: "draft", type: "simple", ...input, name }, null);
  row.slug = slug;
  row.link_path = `/product/${decodeSlug(slug)}`;
  row.date = new Date().toISOString();
  row.date_gmt = row.date;
  const p = must(await db().from("products").insert(row).select("id,name,status,slug,price").single(), "products") as any;
  const touched = await setProductTerms(p.id, input.category_ids ?? [15], input.tag_ids);
  await recountTerms(touched);
  await audit(actor, "product.create", "product", p.id, null, row);
  changed("products");
  return getProduct(p.id);
}

export async function updateProduct(actor: Actor, id: number, input: ProductInput, action = "product.update") {
  const before = await getProduct(id);
  if (!before) throw new CmsError(`找不到商品 ${id}`, 404);
  const row = rowFrom(input, before);
  if (input.slug && encodeWpSlug(input.slug) !== before.slug) {
    row.slug = await uniqueProductSlug(encodeWpSlug(input.slug.trim().toLowerCase().replace(/\s+/g, "-")), id);
    row.link_path = `/product/${decodeSlug(row.slug)}`;
    if (before.status === "publish" && before.link_path) {
      await db().from("redirects").upsert({ source_path: before.link_path, target: row.link_path, status_code: 301, kind: "manual" }, { onConflict: "source_path" });
    }
  }
  must(await db().from("products").update(row).eq("id", id), "products");
  const touched = await setProductTerms(id, input.category_ids, input.tag_ids);
  if (touched.length || (row.status && row.status !== before.status)) await recountTerms(touched.length ? touched : before.term_ids);
  const keys = Object.keys(row).filter((k) => k !== "modified");
  const view = (o: any) => Object.fromEntries(keys.map((k) => [k, k === "description" ? `(${String(o[k] ?? "").length} chars)` : o[k]]));
  await audit(actor, action, "product", id, view(before), { ...view({ ...before, ...row }), ...(input.category_ids || input.tag_ids ? { term_ids: [...(input.category_ids ?? []), ...(input.tag_ids ?? [])] } : {}) });
  changed("products");
  return getProduct(id);
}

export async function setPrice(actor: Actor, id: number, p: { regular_price?: number | null; sale_price?: number | null; date_on_sale_from?: string | null; date_on_sale_to?: string | null; variation_id?: number }) {
  if (p.variation_id) return updateVariation(actor, p.variation_id, p, "variation.price", id);
  return updateProduct(actor, id, p, "product.price");
}

export async function setStock(actor: Actor, id: number, s: { manage_stock?: boolean; stock_quantity?: number | null; adjust_by?: number; stock_status?: (typeof STOCK_STATUSES)[number]; variation_id?: number }) {
  const target = s.variation_id
    ? (must(await db().from("product_variations").select("stock_quantity,manage_stock").eq("id", s.variation_id).eq("product_id", id).maybeSingle(), "product_variations") as any)
    : (must(await db().from("products").select("stock_quantity,manage_stock").eq("id", id).maybeSingle(), "products") as any);
  if (!target) throw new CmsError("找不到商品或變體", 404);
  const input: any = {};
  if (s.manage_stock !== undefined) input.manage_stock = s.manage_stock;
  if (s.stock_status !== undefined) input.stock_status = s.stock_status;
  if (s.stock_quantity !== undefined) input.stock_quantity = s.stock_quantity;
  if (s.adjust_by) input.stock_quantity = (target.stock_quantity ?? 0) + s.adjust_by;
  if (input.stock_quantity !== undefined && input.manage_stock === undefined) input.manage_stock = true;
  if (s.variation_id) return updateVariation(actor, s.variation_id, input, "variation.stock", id);
  return updateProduct(actor, id, input, "product.stock");
}

export async function deleteProduct(actor: Actor, id: number, force = false) {
  const before = await getProduct(id);
  if (!before) throw new CmsError(`找不到商品 ${id}`, 404);
  if (!force && before.status !== "trash") {
    await db().from("products").update({ status: "trash", meta: { ...before.meta, _wp_trash_meta_status: before.status } }).eq("id", id);
    await recountTerms(before.term_ids);
    await audit(actor, "product.trash", "product", id, { status: before.status }, { status: "trash" });
    changed("products");
    return { id, trashed: true };
  }
  must(await db().from("products").delete().eq("id", id), "products");
  await recountTerms(before.term_ids);
  await audit(actor, "product.delete", "product", id, { name: before.name, slug: before.slug, status: before.status }, null);
  changed("products");
  return { id, deleted: true };
}

/* ------------------------------------------------------------- variations */
export type VariationInput = {
  attributes?: Record<string, string>;
  status?: "publish" | "private";
  sku?: string | null;
  description?: string;
  regular_price?: number | null;
  sale_price?: number | null;
  date_on_sale_from?: string | null;
  date_on_sale_to?: string | null;
  manage_stock?: boolean;
  stock_quantity?: number | null;
  stock_status?: (typeof STOCK_STATUSES)[number];
  backorders?: "no" | "notify" | "yes";
  weight?: number | null;
  image_id?: number | null;
  menu_order?: number;
};

const VAR_KEYS = ["attributes", "status", "sku", "description", "regular_price", "sale_price", "manage_stock", "stock_quantity", "stock_status", "backorders", "weight", "image_id", "menu_order"] as const;

async function syncVariablePrice(productId: number) {
  const vs = must(await db().from("product_variations").select("price,stock_status").eq("product_id", productId).eq("status", "publish"), "product_variations") as any[];
  const prices = vs.map((v) => (v.price == null ? null : Number(v.price))).filter((x): x is number => x != null);
  const anyIn = vs.some((v) => v.stock_status !== "outofstock");
  await db()
    .from("products")
    .update({ price: prices.length ? Math.min(...prices) : null, stock_status: vs.length ? (anyIn ? "instock" : "outofstock") : "instock" })
    .eq("id", productId)
    .eq("type", "variable");
}

function varRow(input: VariationInput, before: any | null) {
  const row: Record<string, any> = {};
  for (const k of VAR_KEYS) if (input[k] !== undefined) row[k] = input[k];
  const f = iso(input.date_on_sale_from);
  const t = iso(input.date_on_sale_to);
  if (f !== undefined) row.date_on_sale_from = f;
  if (t !== undefined) row.date_on_sale_to = t;
  const m = { ...(before ?? {}), ...row };
  if (m.sale_price != null && m.regular_price != null && Number(m.sale_price) >= Number(m.regular_price)) throw new CmsError("特價必須低於原價");
  row.price = activePrice(m);
  row.stock_status = stockStatusFor({ manage_stock: !!m.manage_stock, stock_quantity: m.stock_quantity ?? null, backorders: m.backorders ?? "no", stock_status: m.stock_status ?? "instock" });
  return row;
}

export async function createVariation(actor: Actor, productId: number, input: VariationInput) {
  const p = must(await db().from("products").select("id,type").eq("id", productId).maybeSingle(), "products") as any;
  if (!p) throw new CmsError(`找不到商品 ${productId}`, 404);
  if (p.type !== "variable") throw new CmsError("只有「可變商品」可以新增變體");
  const row = varRow({ status: "publish", attributes: {}, ...input }, null);
  row.product_id = productId;
  const v = must(await db().from("product_variations").insert(row).select("*").single(), "product_variations") as any;
  await syncVariablePrice(productId);
  await audit(actor, "variation.create", "product_variation", v.id, null, { product_id: productId, ...row });
  changed("products");
  return v;
}

export async function updateVariation(actor: Actor, variationId: number, input: VariationInput, action = "variation.update", productId?: number) {
  let q = db().from("product_variations").select("*").eq("id", variationId);
  if (productId) q = q.eq("product_id", productId);
  const before = must(await q.maybeSingle(), "product_variations") as any;
  if (!before) throw new CmsError(`找不到變體 ${variationId}`, 404);
  const row = varRow(input, before);
  row.updated_at = new Date().toISOString();
  const after = must(await db().from("product_variations").update(row).eq("id", variationId).select("*").single(), "product_variations") as any;
  await syncVariablePrice(before.product_id);
  const keys = Object.keys(row).filter((k) => k !== "updated_at");
  await audit(actor, action, "product_variation", variationId, Object.fromEntries(keys.map((k) => [k, before[k]])), Object.fromEntries(keys.map((k) => [k, after[k]])));
  changed("products");
  return after;
}

export async function deleteVariation(actor: Actor, variationId: number) {
  const before = must(await db().from("product_variations").select("*").eq("id", variationId).maybeSingle(), "product_variations") as any;
  if (!before) throw new CmsError(`找不到變體 ${variationId}`, 404);
  must(await db().from("product_variations").delete().eq("id", variationId), "product_variations");
  await syncVariablePrice(before.product_id);
  await audit(actor, "variation.delete", "product_variation", variationId, before, null);
  changed("products");
  return { id: variationId, deleted: true };
}

/** Replaces a product's attribute set (WooCommerce "屬性" tab). */
export async function setAttributes(
  actor: Actor,
  productId: number,
  attrs: { attribute_id?: number | null; name: string; options?: string[]; term_ids?: number[]; visible?: boolean; used_for_variations?: boolean }[],
) {
  const before = must(await db().from("product_attribute_values").select("*").eq("product_id", productId), "product_attribute_values");
  must(await db().from("product_attribute_values").delete().eq("product_id", productId), "product_attribute_values");
  if (attrs.length)
    must(
      await db()
        .from("product_attribute_values")
        .insert(
          attrs.map((a, i) => ({
            product_id: productId,
            attribute_id: a.attribute_id ?? null,
            name: a.name,
            position: i,
            visible: a.visible ?? true,
            used_for_variations: a.used_for_variations ?? false,
            term_ids: a.term_ids ?? [],
            options: a.options ?? [],
          })),
        ),
      "product_attribute_values",
    );
  await audit(actor, "product.attributes", "product", productId, before, attrs);
  changed("products");
}

export async function listAttributes() {
  return must(await db().from("product_attributes").select("*").order("name"), "product_attributes") as { id: number; name: string; slug: string; taxonomy: string }[];
}
