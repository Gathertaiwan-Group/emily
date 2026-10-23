"use server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { adminActor } from "@/lib/admin/auth";
import { CmsError, type Actor } from "@/lib/cms/core";
import * as posts from "@/lib/cms/posts";
import * as terms from "@/lib/cms/terms";
import * as products from "@/lib/cms/products";
import * as commerce from "@/lib/cms/commerce";
import * as media from "@/lib/cms/media";
import * as site from "@/lib/cms/site";

/* ------------------------------------------------------------------ form helpers */
const s = (f: FormData, k: string) => (f.has(k) ? String(f.get(k) ?? "") : undefined);
const sTrim = (f: FormData, k: string) => s(f, k)?.trim();
const n = (f: FormData, k: string): number | null | undefined => {
  if (!f.has(k)) return undefined;
  const v = String(f.get(k) ?? "").trim();
  if (v === "") return null;
  const x = Number(v);
  if (!Number.isFinite(x)) throw new CmsError(`欄位 ${k} 必須是數字`);
  return x;
};
const int = (f: FormData, k: string) => {
  const v = n(f, k);
  return v == null ? v : Math.trunc(v);
};
const b = (f: FormData, k: string) => f.get(k) === "on" || f.get(k) === "1" || f.get(k) === "true";
const ids = (f: FormData, k: string): number[] =>
  f
    .getAll(k)
    .flatMap((v) => String(v).split(","))
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isInteger(x) && x > 0);
const idOrNull = (f: FormData, k: string) => (f.has(k) ? ids(f, k)[0] ?? null : undefined);
/** <input type=datetime-local> values are Asia/Taipei wall time. */
const taipei = (v: string | undefined) => (v === undefined ? undefined : v.trim() ? `${v.trim().length === 16 ? v.trim() + ":00" : v.trim()}+08:00` : null);

function back(path: string, q: Record<string, string | number | undefined>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "") u.set(k, String(v));
  const sep = path.includes("?") ? "&" : "?";
  return u.toString() ? `${path}${sep}${u}` : path;
}

/** Runs a write as the signed-in admin; redirects with ?msg= on success or ?err= on failure. */
async function run(errPath: string, fn: (a: Actor) => Promise<string | { to: string; msg?: string }>): Promise<never> {
  const actor = await adminActor();
  if (!actor) redirect("/admin/login");
  let to: string;
  try {
    const r = await fn(actor);
    to = typeof r === "string" ? back(r, { msg: "已儲存。" }) : back(r.to, { msg: r.msg ?? "已儲存。" });
  } catch (e) {
    const msg = e instanceof CmsError ? e.message : `發生錯誤：${(e as Error)?.message ?? e}`;
    if (!(e instanceof CmsError)) console.error("[admin]", e);
    to = back(errPath, { err: msg });
  }
  redirect(to);
}

async function tagIdsFromNames(actor: Actor, taxonomy: "post_tag" | "product_tag", raw: string | undefined): Promise<number[] | undefined> {
  if (raw === undefined) return undefined;
  const names = [...new Set(raw.split(/[,，、]/).map((x) => x.trim()).filter(Boolean))];
  const out: number[] = [];
  for (const name of names) {
    const ex = (await db().from("terms").select("id").eq("taxonomy", taxonomy).eq("name", name).limit(1)).data?.[0] as { id: number } | undefined;
    out.push(ex ? ex.id : (await terms.createTerm(actor, taxonomy, { name })).id);
  }
  return out;
}

/* ------------------------------------------------------------------ posts / pages */
export async function savePost(f: FormData) {
  const id = int(f, "id") ?? null;
  const type = (s(f, "type") === "page" ? "page" : "post") as posts.PostType;
  const intent = s(f, "intent") ?? "save";
  const errPath = id ? `/admin/posts/${id}` : `/admin/posts/new?type=${type}`;
  await run(errPath, async (actor) => {
    const vis = s(f, "visibility");
    let status: posts.PostStatus | undefined =
      intent === "publish" ? (vis === "private" ? "private" : "publish") : intent === "draft" || intent === "preview" ? "draft" : intent === "pending" ? "pending" : (s(f, "status") as posts.PostStatus | undefined);
    if (intent === "save" && (status === "publish" || status === "private")) status = vis === "private" ? "private" : "publish";
    const input: posts.PostInput = {
      title: s(f, "title"),
      slug: sTrim(f, "slug") || undefined,
      content: s(f, "content"),
      excerpt: s(f, "excerpt"),
      status,
      date: taipei(s(f, "date")),
      author_id: int(f, "author_id"),
      featured_media_id: idOrNull(f, "featured_media_id"),
      menu_order: int(f, "menu_order") ?? undefined,
      comment_status: f.has("comment_status_present") ? (b(f, "comment_status") ? "open" : "closed") : undefined,
      sticky: f.has("sticky_present") ? b(f, "sticky") : undefined,
      seo_title: s(f, "seo_title"),
      seo_description: s(f, "seo_description"),
      password: f.has("password") ? (s(f, "visibility") === "password" ? sTrim(f, "password") || null : null) : undefined,
    };
    if (type === "page") {
      input.parent_id = idOrNull(f, "parent_id");
      input.template = s(f, "template");
    } else {
      input.category_ids = f.has("cats_present") ? ids(f, "category_ids") : undefined;
      input.tag_ids = await tagIdsFromNames(actor, "post_tag", s(f, "tags"));
    }
    // published post edited with "update": keep its current status unless a status was chosen
    const p = id ? await posts.updatePost(actor, id, input) : await posts.createPost(actor, type, input);
    if (!p) throw new CmsError("儲存失敗");
    if (intent === "preview") return { to: `/admin-preview/${p.id}`, msg: "草稿已儲存" };
    const msg = p.status === "future" ? "已排程發布。" : p.status === "publish" ? "已發布。" : "草稿已儲存。";
    return { to: `/admin/posts/${p.id}`, msg };
  });
}

export async function trashPost(f: FormData) {
  const id = int(f, "id")!;
  const type = s(f, "type") || "post";
  await run(`/admin/posts?type=${type}`, async (a) => (await posts.deletePost(a, id, false), { to: `/admin/posts?type=${type}`, msg: "已移到回收桶。" }));
}
export async function restorePost(f: FormData) {
  const id = int(f, "id")!;
  const type = s(f, "type") || "post";
  await run(`/admin/posts?type=${type}&status=trash`, async (a) => (await posts.restorePost(a, id), { to: `/admin/posts?type=${type}&status=trash`, msg: "已還原。" }));
}
export async function deletePostForever(f: FormData) {
  const id = int(f, "id")!;
  const type = s(f, "type") || "post";
  await run(`/admin/posts?type=${type}&status=trash`, async (a) => (await posts.deletePost(a, id, true), { to: `/admin/posts?type=${type}&status=trash`, msg: "已永久刪除。" }));
}

/* ------------------------------------------------------------------ terms */
export async function saveTerm(f: FormData) {
  const id = int(f, "id") ?? null;
  const taxonomy = s(f, "taxonomy") || "category";
  const path = `/admin/terms?taxonomy=${taxonomy}`;
  await run(id ? `${path}&edit=${id}` : path, async (a) => {
    const input = { name: s(f, "name"), slug: sTrim(f, "slug") || undefined, description: s(f, "description"), parent_id: idOrNull(f, "parent_id"), seo_title: s(f, "seo_title"), seo_description: s(f, "seo_description") };
    if (id) await terms.updateTerm(a, id, input);
    else await terms.createTerm(a, taxonomy, input);
    return { to: path, msg: id ? "已更新。" : "已新增。" };
  });
}
export async function deleteTerm(f: FormData) {
  const id = int(f, "id")!;
  const path = `/admin/terms?taxonomy=${s(f, "taxonomy") || "category"}`;
  await run(path, async (a) => (await terms.deleteTerm(a, id), { to: path, msg: "已刪除。" }));
}

/* ------------------------------------------------------------------ products */
export async function saveProduct(f: FormData) {
  const id = int(f, "id") ?? null;
  const intent = s(f, "intent") ?? "save";
  await run(id ? `/admin/products/${id}` : "/admin/products/new", async (a) => {
    const input: products.ProductInput = {
      name: s(f, "name"),
      slug: sTrim(f, "slug") || undefined,
      type: s(f, "type") as products.ProductInput["type"],
      status: intent === "publish" ? "publish" : intent === "draft" ? "draft" : (s(f, "status") as products.ProductInput["status"]),
      description: s(f, "description"),
      short_description: s(f, "short_description"),
      sku: f.has("sku") ? sTrim(f, "sku") || null : undefined,
      regular_price: n(f, "regular_price"),
      sale_price: n(f, "sale_price"),
      date_on_sale_from: taipei(s(f, "date_on_sale_from")),
      date_on_sale_to: taipei(s(f, "date_on_sale_to")),
      manage_stock: f.has("stock_present") ? b(f, "manage_stock") : undefined,
      stock_quantity: int(f, "stock_quantity"),
      stock_status: (s(f, "stock_status") || undefined) as products.ProductInput["stock_status"],
      backorders: (s(f, "backorders") || undefined) as products.ProductInput["backorders"],
      low_stock_amount: int(f, "low_stock_amount"),
      sold_individually: f.has("flags_present") ? b(f, "sold_individually") : undefined,
      featured: f.has("flags_present") ? b(f, "featured") : undefined,
      virtual: f.has("flags_present") ? b(f, "virtual") : undefined,
      downloadable: f.has("flags_present") ? b(f, "downloadable") : undefined,
      reviews_allowed: f.has("flags_present") ? b(f, "reviews_allowed") : undefined,
      catalog_visibility: (s(f, "catalog_visibility") || undefined) as products.ProductInput["catalog_visibility"],
      weight: n(f, "weight"),
      length: n(f, "length"),
      width: n(f, "width"),
      height: n(f, "height"),
      external_url: f.has("external_url") ? sTrim(f, "external_url") || null : undefined,
      button_text: f.has("button_text") ? sTrim(f, "button_text") || null : undefined,
      min_purchase_qty: int(f, "min_purchase_qty") ?? undefined,
      max_purchase_qty: int(f, "max_purchase_qty"),
      menu_order: int(f, "menu_order") ?? undefined,
      featured_media_id: idOrNull(f, "featured_media_id"),
      gallery_media_ids: f.has("gallery_media_ids") ? ids(f, "gallery_media_ids") : undefined,
      category_ids: f.has("cats_present") ? ids(f, "category_ids") : undefined,
      tag_ids: await tagIdsFromNames(a, "product_tag", s(f, "tags")),
      seo_title: s(f, "seo_title"),
      seo_description: s(f, "seo_description"),
    };
    const p = id ? await products.updateProduct(a, id, input) : await products.createProduct(a, input);
    if (!p) throw new CmsError("儲存失敗");
    return { to: `/admin/products/${p.id}`, msg: p.status === "publish" ? "商品已發布／更新。" : "商品已儲存。" };
  });
}
export async function trashProduct(f: FormData) {
  const id = int(f, "id")!;
  await run("/admin/products", async (a) => (await products.deleteProduct(a, id, false), { to: "/admin/products", msg: "已移到回收桶。" }));
}
export async function deleteProductForever(f: FormData) {
  const id = int(f, "id")!;
  await run("/admin/products?status=trash", async (a) => (await products.deleteProduct(a, id, true), { to: "/admin/products?status=trash", msg: "已永久刪除。" }));
}
export async function restoreProduct(f: FormData) {
  const id = int(f, "id")!;
  await run("/admin/products?status=trash", async (a) => {
    const p = await products.getProduct(id);
    await products.updateProduct(a, id, { status: (p?.meta?._wp_trash_meta_status as any) || "draft" }, "product.restore");
    return { to: "/admin/products?status=trash", msg: "已還原。" };
  });
}

export async function saveVariation(f: FormData) {
  const productId = int(f, "product_id")!;
  const vid = int(f, "variation_id") ?? null;
  const path = `/admin/products/${productId}#variations`;
  await run(path, async (a) => {
    const attributes: Record<string, string> = {};
    for (const [k, v] of f.entries()) if (k.startsWith("attr:")) attributes[k.slice(5)] = String(v);
    const input: products.VariationInput = {
      attributes,
      sku: sTrim(f, "sku") || null,
      regular_price: n(f, "regular_price"),
      sale_price: n(f, "sale_price"),
      manage_stock: b(f, "manage_stock"),
      stock_quantity: int(f, "stock_quantity"),
      stock_status: (s(f, "stock_status") || "instock") as products.VariationInput["stock_status"],
      status: b(f, "enabled") || !vid ? "publish" : "private",
      image_id: idOrNull(f, "image_id"),
      description: s(f, "description"),
    };
    if (vid) await products.updateVariation(a, vid, input, "variation.update", productId);
    else await products.createVariation(a, productId, input);
    return { to: path, msg: "變體已儲存。" };
  });
}
export async function deleteVariation(f: FormData) {
  const productId = int(f, "product_id")!;
  const vid = int(f, "variation_id")!;
  await run(`/admin/products/${productId}`, async (a) => (await products.deleteVariation(a, vid), { to: `/admin/products/${productId}#variations`, msg: "變體已刪除。" }));
}
export async function saveAttributes(f: FormData) {
  const productId = int(f, "product_id")!;
  await run(`/admin/products/${productId}`, async (a) => {
    const global = await products.listAttributes();
    const out: Parameters<typeof products.setAttributes>[2] = [];
    for (const g of global) {
      const termIds = ids(f, `attr_terms:${g.id}`);
      if (!termIds.length) continue;
      out.push({ attribute_id: g.id, name: g.taxonomy, term_ids: termIds, visible: b(f, `attr_visible:${g.id}`), used_for_variations: b(f, `attr_var:${g.id}`) });
    }
    const cname = sTrim(f, "custom_name");
    const copts = (s(f, "custom_options") ?? "").split("|").map((x) => x.trim()).filter(Boolean);
    if (cname && copts.length) out.push({ attribute_id: null, name: cname, options: copts, visible: b(f, "custom_visible"), used_for_variations: b(f, "custom_var") });
    for (const [k] of f.entries()) {
      const m = /^keep_custom:(\d+)$/.exec(k);
      if (!m) continue;
      const i = m[1];
      const name = sTrim(f, `kc_name:${i}`);
      const opts = (s(f, `kc_options:${i}`) ?? "").split("|").map((x) => x.trim()).filter(Boolean);
      if (name && opts.length) out.push({ attribute_id: null, name, options: opts, visible: b(f, `kc_visible:${i}`), used_for_variations: b(f, `kc_var:${i}`) });
    }
    await products.setAttributes(a, productId, out);
    return { to: `/admin/products/${productId}#attributes`, msg: "屬性已儲存。" };
  });
}

/* ------------------------------------------------------------------ orders / customers */
export async function setOrderStatus(f: FormData) {
  const id = int(f, "id")!;
  await run(`/admin/orders/${id}`, async (a) => (await commerce.updateOrderStatus(a, id, s(f, "status") || "pending", sTrim(f, "note") || undefined), { to: `/admin/orders/${id}`, msg: "訂單狀態已更新。" }));
}
export async function addOrderNote(f: FormData) {
  const id = int(f, "id")!;
  await run(`/admin/orders/${id}`, async (a) => (await commerce.addOrderNote(a, id, s(f, "content") ?? "", b(f, "is_customer_note")), { to: `/admin/orders/${id}`, msg: "已新增備註。" }));
}
const ADDR = ["first_name", "last_name", "company", "address_1", "address_2", "city", "state", "postcode", "country", "email", "phone"];
export async function saveOrderAddresses(f: FormData) {
  const id = int(f, "id")!;
  await run(`/admin/orders/${id}`, async (a) => {
    const billing: Record<string, string> = {};
    const shipping: Record<string, string> = {};
    for (const k of ADDR) {
      if (f.has(`billing_${k}`)) billing[k] = String(f.get(`billing_${k}`) ?? "");
      if (f.has(`shipping_${k}`)) shipping[k] = String(f.get(`shipping_${k}`) ?? "");
    }
    await commerce.updateOrderAddresses(a, id, { billing, shipping, customer_note: s(f, "customer_note") });
    return { to: `/admin/orders/${id}`, msg: "訂單資料已更新。" };
  });
}
export async function saveCustomer(f: FormData) {
  const id = int(f, "id")!;
  await run(`/admin/customers/${id}`, async (a) => {
    const billing: Record<string, string> = {};
    const shipping: Record<string, string> = {};
    for (const k of ADDR) {
      if (f.has(`billing_${k}`)) billing[k] = String(f.get(`billing_${k}`) ?? "");
      if (f.has(`shipping_${k}`)) shipping[k] = String(f.get(`shipping_${k}`) ?? "");
    }
    await commerce.updateCustomer(a, id, { first_name: s(f, "first_name"), last_name: s(f, "last_name"), display_name: s(f, "display_name"), email: sTrim(f, "email"), billing, shipping });
    return `/admin/customers/${id}`;
  });
}

/* ------------------------------------------------------------------ coupons / rules */
export async function saveCoupon(f: FormData) {
  const id = int(f, "id") ?? null;
  await run(id ? `/admin/coupons/${id}` : "/admin/coupons/new", async (a) => {
    const c = await commerce.saveCoupon(a, id, {
      code: sTrim(f, "code"),
      description: s(f, "description"),
      status: (s(f, "status") || "publish") as any,
      discount_type: s(f, "discount_type") as any,
      amount: n(f, "amount") ?? 0,
      date_expires: taipei(s(f, "date_expires")),
      usage_limit: int(f, "usage_limit"),
      usage_limit_per_user: int(f, "usage_limit_per_user"),
      limit_usage_to_x_items: int(f, "limit_usage_to_x_items"),
      individual_use: b(f, "individual_use"),
      free_shipping: b(f, "free_shipping"),
      exclude_sale_items: b(f, "exclude_sale_items"),
      minimum_amount: n(f, "minimum_amount"),
      maximum_amount: n(f, "maximum_amount"),
      product_ids: ids(f, "product_ids"),
      excluded_product_ids: ids(f, "excluded_product_ids"),
      product_category_ids: ids(f, "product_category_ids"),
      excluded_product_category_ids: ids(f, "excluded_product_category_ids"),
      email_restrictions: (s(f, "email_restrictions") ?? "").split(/[,\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean),
    });
    return `/admin/coupons/${(c as any).id}`;
  });
}
export async function deleteCoupon(f: FormData) {
  const id = int(f, "id")!;
  await run(`/admin/coupons/${id}`, async (a) => (await commerce.deleteCoupon(a, id), { to: "/admin/coupons", msg: "已刪除。" }));
}
export async function saveRule(f: FormData) {
  const id = int(f, "id") ?? null;
  await run(id ? `/admin/discounts?edit=${id}` : "/admin/discounts", async (a) => {
    await commerce.saveRule(a, id, {
      name: sTrim(f, "name"),
      enabled: b(f, "enabled"),
      priority: int(f, "priority") ?? 10,
      applies_to: (s(f, "applies_to") || "products") as any,
      product_ids: ids(f, "product_ids"),
      category_ids: ids(f, "category_ids"),
      min_qty: int(f, "min_qty") ?? undefined,
      max_qty: int(f, "max_qty"),
      discount_type: s(f, "discount_type") as any,
      amount: n(f, "amount") ?? undefined,
      date_from: taipei(s(f, "date_from")),
      date_to: taipei(s(f, "date_to")),
    });
    return "/admin/discounts";
  });
}
export async function deleteRule(f: FormData) {
  const id = int(f, "id")!;
  await run("/admin/discounts", async (a) => (await commerce.deleteRule(a, id), { to: "/admin/discounts", msg: "已刪除。" }));
}

/* ------------------------------------------------------------------ media */
export async function saveMediaMeta(f: FormData) {
  const id = int(f, "id")!;
  await run(`/admin/media/${id}`, async (a) => (await media.updateMedia(a, id, { title: s(f, "title"), alt_text: s(f, "alt_text"), caption: s(f, "caption"), description: s(f, "description") }), `/admin/media/${id}`));
}
export async function deleteMediaItem(f: FormData) {
  const id = int(f, "id")!;
  await run(`/admin/media/${id}`, async (a) => (await media.deleteMedia(a, id), { to: "/admin/media", msg: "已永久刪除媒體。" }));
}

/* ------------------------------------------------------------------ menus */
export async function saveMenu(f: FormData) {
  const id = int(f, "id")!;
  await run(`/admin/menus/${id}`, async (a) => {
    let items: site.MenuItemInput[];
    try {
      items = JSON.parse(String(f.get("items") || "[]"));
    } catch {
      throw new CmsError("選單資料格式錯誤");
    }
    await site.saveMenu(a, id, { name: s(f, "name"), location: s(f, "location") }, items);
    return `/admin/menus/${id}`;
  });
}

/* ------------------------------------------------------------------ forms */
export async function setSubmissionStatus(f: FormData) {
  const id = int(f, "id")!;
  const ret = s(f, "return") || "/admin/forms";
  const safeRet = ret.startsWith("/admin/") ? ret : "/admin/forms";
  await run(safeRet, async (a) => (await site.setSubmissionStatus(a, id, (s(f, "status") || "read") as any), { to: safeRet, msg: "已更新。" }));
}

/* ------------------------------------------------------------------ settings */
const SETTING_FIELDS: Record<string, { k: string; kind?: "url" | "int" | "bool" }[]> = {
  general: [{ k: "name" }, { k: "description" }, { k: "logo_url", kind: "url" }, { k: "site_icon_url", kind: "url" }, { k: "timezone" }],
  contact: [{ k: "email" }, { k: "phone" }, { k: "address" }, { k: "line" }, { k: "business_hours" }],
  social: [{ k: "facebook", kind: "url" }, { k: "instagram", kind: "url" }, { k: "email" }, { k: "line", kind: "url" }, { k: "youtube", kind: "url" }],
  tracking: [{ k: "gtm" }, { k: "ga4" }, { k: "facebook_pixel" }, { k: "facebook_domain_verification" }],
  reading: [{ k: "posts_per_page", kind: "int" }],
  comments: [{ k: "moderation", kind: "bool" }, { k: "require_name_email", kind: "bool" }, { k: "default_comment_status" }],
};
export async function saveSettings(f: FormData) {
  const key = s(f, "key") || "general";
  await run(`/admin/settings?tab=${key}`, async (a) => {
    const spec = SETTING_FIELDS[key];
    if (!spec) throw new CmsError("不支援的設定群組");
    const patch: Record<string, any> = {};
    for (const { k, kind } of spec) {
      if (kind === "bool") {
        patch[k] = b(f, k);
        continue;
      }
      if (!f.has(k)) continue;
      const v = String(f.get(k) ?? "").trim();
      if (kind === "int") patch[k] = v ? Math.max(1, Math.trunc(Number(v)) || 10) : null;
      else if (kind === "url" && v && !/^(https?:\/\/|\/|mailto:|#)/i.test(v)) throw new CmsError(`${k} 必須是 http(s) 網址或站內路徑`);
      else patch[k] = v;
    }
    if (key === "tracking") {
      if (patch.gtm && !/^GTM-[A-Z0-9]+$/.test(patch.gtm)) throw new CmsError("GTM 編號格式應為 GTM-XXXXXXX");
      if (patch.ga4 && !/^G-[A-Z0-9]+$/.test(patch.ga4)) throw new CmsError("GA4 評估 ID 格式應為 G-XXXXXXX");
      if (patch.facebook_pixel && !/^\d{5,20}$/.test(patch.facebook_pixel)) throw new CmsError("Facebook Pixel ID 應為數字");
    }
    await site.setSetting(a, key, patch);
    return `/admin/settings?tab=${key}`;
  });
}

/* ------------------------------------------------------------------ redirects */
export async function saveRedirect(f: FormData) {
  const id = int(f, "id") ?? null;
  await run("/admin/redirects", async (a) => (await site.saveRedirect(a, id, { source_path: s(f, "source_path") ?? "", target: s(f, "target") ?? "", status_code: int(f, "status_code") ?? 301 }), "/admin/redirects"));
}
export async function deleteRedirect(f: FormData) {
  const id = int(f, "id")!;
  await run("/admin/redirects", async (a) => (await site.deleteRedirect(a, id), { to: "/admin/redirects", msg: "已刪除。" }));
}
