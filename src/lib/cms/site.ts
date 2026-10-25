import "server-only";
import { db } from "@/lib/db";
import { CmsError, audit, changed, ilikeTerm, must, type Actor } from "./core";

/* ------------------------------------------------------------------ settings */
/** Keys the admin may edit. `is_public` rows are readable by the storefront. */
export const SETTING_KEYS: Record<string, { label: string; public: boolean }> = {
  general: { label: "一般（網站名稱、標語、logo、icon）", public: true },
  contact: { label: "聯絡資訊", public: true },
  social: { label: "社群連結", public: true },
  tracking: { label: "追蹤碼（GA4、GTM、FB Pixel、自訂程式碼）", public: true },
  reading: { label: "閱讀", public: true },
  comments: { label: "留言", public: true },
  woocommerce: { label: "商店", public: true },
  seo: { label: "SEO", public: true },
  newsletter: { label: "電子報串接（不公開）", public: false },
};

export async function getAllSettings(includePrivate = true) {
  let q = db().from("settings").select("key,value,is_public,updated_at").order("key");
  if (!includePrivate) q = q.eq("is_public", true);
  const rows = must(await q, "settings") as { key: string; value: any; is_public: boolean; updated_at: string }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value])) as Record<string, any>;
}

/** Shallow-merges `patch` into setting `key` (replace=true overwrites). null removes a field; "" keeps an explicit empty value (e.g. tracking turned off). */
export async function setSetting(actor: Actor, key: string, patch: Record<string, any>, replace = false) {
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(key)) throw new CmsError("設定鍵名格式錯誤");
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) throw new CmsError("設定值必須是物件");
  const cur = must(await db().from("settings").select("value,is_public").eq("key", key).maybeSingle(), "settings") as any;
  const next: Record<string, any> = replace ? {} : { ...(cur?.value ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete next[k];
    else next[k] = v;
  }
  const isPublic = cur ? cur.is_public : SETTING_KEYS[key]?.public ?? false;
  must(await db().from("settings").upsert({ key, value: next, is_public: isPublic }, { onConflict: "key" }), "settings");
  await audit(actor, "settings.update", "settings", key, cur?.value ?? null, next);
  changed("settings");
  changed("siteconfig");
  return next;
}

/* ------------------------------------------------------------------ menus */
export async function listMenus() {
  const menus = must(await db().from("menus").select("id,slug,name,location,source").order("id"), "menus") as any[];
  const counts = must(await db().from("menu_items").select("menu_id"), "menu_items") as { menu_id: number }[];
  return menus.map((m) => ({ ...m, items: counts.filter((c) => c.menu_id === m.id).length }));
}

export async function getMenu(id: number) {
  const m = must(await db().from("menus").select("*").eq("id", id).maybeSingle(), "menus") as any;
  if (!m) return null;
  const items = must(await db().from("menu_items").select("id,parent_id,position,title,url,target,object_type,object_id,classes").eq("menu_id", id).order("position").order("id"), "menu_items") as any[];
  // depth-first order for display
  const kids = new Map<number | null, any[]>();
  for (const i of items) {
    const p = i.parent_id && items.some((x) => x.id === i.parent_id) ? i.parent_id : null;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p)!.push(i);
  }
  const ordered: any[] = [];
  const walk = (p: number | null, d: number) => (kids.get(p) ?? []).forEach((i) => (ordered.push({ ...i, depth: d }), walk(i.id, d + 1)));
  walk(null, 0);
  return { ...m, items: ordered };
}

export type MenuItemInput = { key: string; parent_key: string | null; title: string; url: string; target?: string | null; object_type?: string | null; object_id?: number | null; classes?: string[] };

/** Replaces all items of a menu with the given flat list (order = array order; parent by key). */
export async function saveMenu(actor: Actor, id: number, patch: { name?: string; location?: string | null }, items: MenuItemInput[]) {
  const before = await getMenu(id);
  if (!before) throw new CmsError(`找不到選單 ${id}`, 404);
  for (const it of items) {
    if (!it.title?.trim()) throw new CmsError("每個選單項目都需要標題");
    if (!it.url?.trim()) throw new CmsError(`選單項目「${it.title}」缺少網址`);
    if (/^\s*javascript:/i.test(it.url)) throw new CmsError("不允許 javascript: 網址");
  }
  if (patch.name !== undefined || patch.location !== undefined) {
    const row: any = {};
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.location !== undefined) row.location = patch.location || null;
    // a theme location shows exactly one menu (WordPress nav_menu_locations semantics)
    if (row.location) must(await db().from("menus").update({ location: null }).eq("location", row.location).neq("id", id), "menus");
    must(await db().from("menus").update(row).eq("id", id), "menus");
  }
  must(await db().from("menu_items").delete().eq("menu_id", id), "menu_items");
  const idByKey = new Map<string, number>();
  const pos = new Map<string, number>();
  // parents first: process in given order; a child must come after its parent
  for (const it of items) {
    const parent = it.parent_key ? idByKey.get(it.parent_key) ?? null : null;
    const pk = String(parent);
    const p = pos.get(pk) ?? 0;
    pos.set(pk, p + 1);
    const r = must(
      await db()
        .from("menu_items")
        .insert({ menu_id: id, parent_id: parent, position: p, title: it.title.trim(), url: it.url.trim(), target: it.target || null, object_type: it.object_type ?? "custom", object_id: it.object_id ?? null, classes: it.classes ?? [] })
        .select("id")
        .single(),
      "menu_items",
    ) as { id: number };
    idByKey.set(it.key, r.id);
  }
  await audit(
    actor,
    "menu.update",
    "menu",
    id,
    { name: before.name, items: before.items.map((i: any) => ({ title: i.title, url: i.url, depth: i.depth })) },
    { name: patch.name ?? before.name, items: items.map((i) => ({ title: i.title, url: i.url, parent: i.parent_key })) },
  );
  changed("menu:");
  return getMenu(id);
}

/* ------------------------------------------------------------------ forms */
export async function listForms() {
  const forms = must(await db().from("forms").select("id,slug,title,kind,source,status,pages,fields").order("id"), "forms") as any[];
  const subs = must(await db().from("form_submissions").select("form_id,status"), "form_submissions") as { form_id: number; status: string }[];
  return forms.map((f) => ({ ...f, submissions: subs.filter((s) => s.form_id === f.id && s.status !== "trash").length, unread: subs.filter((s) => s.form_id === f.id && s.status === "new").length }));
}

export async function listSubmissions(opts: { formId?: number; status?: string; page?: number; per?: number; since?: string } = {}) {
  const per = Math.min(Math.max(opts.per ?? 50, 1), 1000);
  const page = Math.max(opts.page ?? 1, 1);
  let q = db().from("form_submissions").select("id,form_id,data,status,page_url,ip,user_agent,created_at,forms(slug,title)", { count: "exact" });
  if (opts.formId) q = q.eq("form_id", opts.formId);
  if (opts.status && opts.status !== "all") q = q.eq("status", opts.status);
  else q = q.neq("status", "trash");
  if (opts.since) q = q.gte("created_at", opts.since);
  const r = await q.order("created_at", { ascending: false }).range((page - 1) * per, page * per - 1);
  return { rows: must(r, "form_submissions") as any[], total: r.count ?? 0, page, per };
}

export async function setSubmissionStatus(actor: Actor, id: number, status: "new" | "read" | "spam" | "trash") {
  const before = must(await db().from("form_submissions").select("id,status").eq("id", id).maybeSingle(), "form_submissions") as any;
  if (!before) throw new CmsError(`找不到表單提交 ${id}`, 404);
  must(await db().from("form_submissions").update({ status }).eq("id", id), "form_submissions");
  await audit(actor, "form_submission.status", "form_submission", id, { status: before.status }, { status });
}

export function submissionsCsv(rows: any[]): string {
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r.data ?? {})))];
  const head = ["id", "form", "status", "created_at", "page_url", ...keys];
  const esc = (v: unknown) => {
    let s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // spreadsheet formula injection
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [head.join(",")];
  for (const r of rows) lines.push([r.id, r.forms?.slug ?? r.form_id, r.status, r.created_at, r.page_url, ...keys.map((k) => r.data?.[k])].map(esc).join(","));
  return "﻿" + lines.join("\r\n");
}

/* ------------------------------------------------------------------ redirects */
export async function listRedirects(opts: { search?: string; kind?: string; page?: number; per?: number } = {}) {
  const per = Math.min(Math.max(opts.per ?? 50, 1), 500);
  const page = Math.max(opts.page ?? 1, 1);
  let q = db().from("redirects").select("*", { count: "exact" });
  if (opts.kind && opts.kind !== "all") q = q.eq("kind", opts.kind);
  if (opts.search) {
    const t = ilikeTerm(opts.search);
    q = q.or(`source_path.ilike.%${t}%,target.ilike.%${t}%`);
  }
  const r = await q.order("id", { ascending: false }).range((page - 1) * per, page * per - 1);
  return { rows: must(r, "redirects") as any[], total: r.count ?? 0, page, per };
}

function normSource(p: string) {
  let s = p.trim();
  try {
    s = new URL(s).pathname;
  } catch {
    /* already a path */
  }
  try {
    s = decodeURIComponent(s);
  } catch {
    /* keep */
  }
  if (!s.startsWith("/")) s = "/" + s;
  return s.length > 1 ? s.replace(/\/+$/, "") : s;
}

export async function saveRedirect(actor: Actor, id: number | null, input: { source_path: string; target: string; status_code?: number }) {
  const source = normSource(input.source_path);
  const target = input.target.trim();
  if (source === "/" || source.startsWith("/admin") || source.startsWith("/api/")) throw new CmsError("不可轉址首頁、/admin 或 /api 路徑");
  if (!target) throw new CmsError("目標網址必填");
  if (/^\s*javascript:/i.test(target)) throw new CmsError("不允許 javascript: 網址");
  if (normSource(target) === source) throw new CmsError("來源與目標相同");
  const code = input.status_code ?? 301;
  if (![301, 302, 307, 308, 410].includes(code)) throw new CmsError("狀態碼只能是 301/302/307/308/410");
  const row = { source_path: source, target, status_code: code };
  if (id == null) {
    const r = must(await db().from("redirects").insert({ ...row, kind: "manual" }).select("*").single(), "redirects") as any;
    await audit(actor, "redirect.create", "redirect", r.id, null, row);
    return r;
  }
  const before = must(await db().from("redirects").select("*").eq("id", id).maybeSingle(), "redirects");
  if (!before) throw new CmsError(`找不到轉址 ${id}`, 404);
  const r = must(await db().from("redirects").update(row).eq("id", id).select("*").single(), "redirects");
  await audit(actor, "redirect.update", "redirect", id, before, row);
  return r;
}

export async function deleteRedirect(actor: Actor, id: number) {
  const before = must(await db().from("redirects").select("*").eq("id", id).maybeSingle(), "redirects");
  if (!before) throw new CmsError(`找不到轉址 ${id}`, 404);
  must(await db().from("redirects").delete().eq("id", id), "redirects");
  await audit(actor, "redirect.delete", "redirect", id, before, null);
  return { id, deleted: true };
}

/* ------------------------------------------------------------------ audit + dashboard */
export async function listAudit(opts: { entityType?: string; source?: string; search?: string; page?: number; per?: number } = {}) {
  const per = Math.min(Math.max(opts.per ?? 50, 1), 200);
  const page = Math.max(opts.page ?? 1, 1);
  let q = db().from("audit_log").select("id,at,actor,source,action,entity_type,entity_id,before,after,ip", { count: "exact" });
  if (opts.entityType) q = q.eq("entity_type", opts.entityType);
  if (opts.source && opts.source !== "all") q = q.eq("source", opts.source);
  if (opts.search) {
    const t = ilikeTerm(opts.search);
    q = q.or(`action.ilike.%${t}%,actor.ilike.%${t}%,entity_id.ilike.%${t}%`);
  }
  const r = await q.order("at", { ascending: false }).range((page - 1) * per, page * per - 1);
  return { rows: must(r, "audit_log") as any[], total: r.count ?? 0, page, per };
}

export async function dashboardCounts() {
  const c = async (table: string, f?: (q: any) => any) => {
    let q = db().from(table).select("*", { count: "exact", head: true });
    if (f) q = f(q);
    return (await q).count ?? 0;
  };
  const [posts, drafts, scheduled, pages, products, orders, pending, processing, customers, media, subs] = await Promise.all([
    c("posts", (q) => q.eq("post_type", "post").eq("status", "publish")),
    c("posts", (q) => q.in("post_type", ["post", "page"]).in("status", ["draft", "pending"])),
    c("posts", (q) => q.in("post_type", ["post", "page"]).eq("status", "future")),
    c("posts", (q) => q.eq("post_type", "page").eq("status", "publish")),
    c("products", (q) => q.eq("status", "publish")),
    c("orders", (q) => q.eq("type", "shop_order")),
    c("orders", (q) => q.eq("type", "shop_order").eq("status", "pending")),
    c("orders", (q) => q.eq("type", "shop_order").eq("status", "processing")),
    c("customers"),
    c("media"),
    c("form_submissions", (q) => q.eq("status", "new")),
  ]);
  return { posts, drafts, scheduled, pages, products, orders, pending_orders: pending, processing_orders: processing, customers, media, new_form_submissions: subs };
}
