import "server-only";
import { db } from "@/lib/db";
import { CmsError, SYSTEM, audit, changed, decodeSlug, encodeWpSlug, ilikeTerm, makeSlug, must, num, type Actor } from "./core";
import { recountTerms } from "./terms";

export const POST_STATUSES = ["draft", "pending", "publish", "future", "private", "trash"] as const;
export type PostStatus = (typeof POST_STATUSES)[number];
export type PostType = "post" | "page";

export type PostRow = {
  id: number;
  post_type: string;
  slug: string;
  status: PostStatus;
  title: string;
  content: string;
  excerpt: string;
  author_id: number | null;
  featured_media_id: number | null;
  parent_id: number | null;
  menu_order: number;
  template: string;
  format: string;
  sticky: boolean;
  comment_status: string;
  ping_status: string;
  builder: string | null;
  link_path: string | null;
  date: string | null;
  modified: string | null;
  seo: Record<string, any>;
  meta: Record<string, any>;
};

export type PostInput = {
  title?: string;
  slug?: string;
  content?: string;
  excerpt?: string;
  status?: PostStatus;
  date?: string | null;
  author_id?: number | null;
  featured_media_id?: number | null;
  parent_id?: number | null;
  menu_order?: number;
  template?: string;
  comment_status?: "open" | "closed";
  sticky?: boolean;
  seo_title?: string | null;
  seo_description?: string | null;
  category_ids?: number[];
  tag_ids?: number[];
  password?: string | null;
};

const LIST_COLS = "id,post_type,slug,status,title,author_id,date,modified,link_path,parent_id,menu_order,featured_media_id";

export async function listPosts(opts: { type?: PostType; status?: string; search?: string; termId?: number; page?: number; per?: number } = {}) {
  const type = opts.type ?? "post";
  const per = Math.min(Math.max(opts.per ?? 20, 1), 200);
  const page = Math.max(opts.page ?? 1, 1);
  let q = db().from("posts").select(LIST_COLS + (opts.termId ? ",post_terms!inner(term_id)" : ""), { count: "exact" }).eq("post_type", type);
  if (opts.status && opts.status !== "all") q = q.eq("status", opts.status);
  else q = q.neq("status", "trash");
  if (opts.termId) q = q.eq("post_terms.term_id", opts.termId);
  if (opts.search) {
    const t = ilikeTerm(opts.search);
    q = q.or(`title.ilike.%${t}%,content.ilike.%${t}%`);
  }
  q = type === "page" ? q.order("link_path", { ascending: true }) : q.order("date", { ascending: false, nullsFirst: true }).order("id", { ascending: false });
  const r = await q.range((page - 1) * per, page * per - 1);
  const rows = must(r, "posts") as unknown as (PostRow & { post_terms?: unknown })[];
  return { rows: rows.map(({ post_terms: _pt, ...x }) => x), total: r.count ?? 0, page, per };
}

export async function statusCounts(type: PostType) {
  const out: Record<string, number> = {};
  await Promise.all(
    POST_STATUSES.map(async (s) => {
      const r = await db().from("posts").select("id", { count: "exact", head: true }).eq("post_type", type).eq("status", s);
      out[s] = r.count ?? 0;
    }),
  );
  return out;
}

export async function getPost(id: number) {
  const r = await db().from("posts").select("*").eq("id", id).in("post_type", ["post", "page"]).maybeSingle();
  const p = must(r, "posts") as PostRow | null;
  if (!p) return null;
  const [pt, pw] = await Promise.all([
    db().from("post_terms").select("term_id,term_order").eq("post_id", id).order("term_order"),
    db().from("post_passwords").select("password").eq("post_id", id).maybeSingle(),
  ]);
  const termIds = (must(pt, "post_terms") ?? []).map((x: any) => Number(x.term_id));
  return { ...p, term_ids: termIds, password: (pw.data as any)?.password ?? null };
}

async function pathFor(type: string, slug: string, parentId: number | null): Promise<string> {
  const leaf = decodeSlug(slug);
  if (type === "page" && parentId) {
    const r = await db().from("posts").select("link_path").eq("id", parentId).maybeSingle();
    const base = ((r.data as any)?.link_path as string | undefined) ?? "";
    return (base === "/" ? "" : base) + "/" + leaf;
  }
  return "/" + leaf;
}

/** Slug unique per (type,parent) and a link_path not used by another post/page. WordPress appends -2, -3 … */
async function uniqueSlug(type: string, slug: string, parentId: number | null, selfId: number | null): Promise<string> {
  for (let i = 1; i < 200; i++) {
    const cand = i === 1 ? slug : `${slug}-${i}`;
    let q = db().from("posts").select("id").eq("post_type", type).eq("slug", cand);
    q = parentId ? q.eq("parent_id", parentId) : q.is("parent_id", null);
    const a = must(await q.limit(2), "posts") as { id: number }[];
    const path = await pathFor(type, cand, parentId);
    const b = must(await db().from("posts").select("id").eq("link_path", path).in("post_type", ["post", "page"]).limit(2), "posts") as { id: number }[];
    if ([...a, ...b].every((x) => x.id === selfId)) return cand;
  }
  throw new CmsError("無法產生不重複的網址代稱");
}

function normDate(d: string | null | undefined): string | null | undefined {
  if (d === undefined) return undefined;
  if (d === null || d === "") return null;
  const t = Date.parse(d);
  if (!Number.isFinite(t)) throw new CmsError(`日期格式錯誤：${d}`);
  return new Date(t).toISOString();
}

async function setTerms(postId: number, categoryIds: number[] | undefined, tagIds: number[] | undefined) {
  if (categoryIds === undefined && tagIds === undefined) return [] as number[];
  const cur = must(await db().from("post_terms").select("term_id,terms!inner(taxonomy)").eq("post_id", postId), "post_terms") as any[];
  const touched = new Set<number>(cur.map((x) => Number(x.term_id)));
  const keep = cur
    .filter((x) => (categoryIds === undefined && x.terms.taxonomy === "category") || (tagIds === undefined && x.terms.taxonomy === "post_tag"))
    .map((x) => Number(x.term_id));
  const want = [...new Set([...keep, ...(categoryIds ?? []), ...(tagIds ?? [])])];
  if (want.length) {
    const ok = must(await db().from("terms").select("id,taxonomy").in("id", want), "terms") as { id: number; taxonomy: string }[];
    const bad = want.filter((id) => !ok.some((t) => t.id === id && (t.taxonomy === "category" || t.taxonomy === "post_tag")));
    if (bad.length) throw new CmsError(`分類／標籤 ID 不存在：${bad.join(", ")}`);
  }
  must(await db().from("post_terms").delete().eq("post_id", postId), "post_terms");
  if (want.length) must(await db().from("post_terms").insert(want.map((term_id, i) => ({ post_id: postId, term_id, term_order: i }))), "post_terms");
  want.forEach((id) => touched.add(id));
  return [...touched];
}

async function setPassword(postId: number, password: string | null | undefined) {
  if (password === undefined) return;
  if (!password) must(await db().from("post_passwords").delete().eq("post_id", postId), "post_passwords");
  else must(await db().from("post_passwords").upsert({ post_id: postId, password }), "post_passwords");
}

function buildRow(input: PostInput, existing: PostRow | null) {
  const row: Record<string, any> = {};
  for (const k of ["title", "content", "excerpt", "author_id", "featured_media_id", "parent_id", "menu_order", "template", "comment_status", "sticky"] as const) {
    if (input[k] !== undefined) row[k] = input[k];
  }
  if (input.status !== undefined) {
    if (!POST_STATUSES.includes(input.status)) throw new CmsError(`不支援的狀態：${input.status}`);
    row.status = input.status;
  }
  const date = normDate(input.date);
  if (date !== undefined) {
    row.date = date;
    row.date_gmt = date;
  }
  const status = row.status ?? existing?.status ?? "draft";
  const effDate = date !== undefined ? date : existing?.date ?? null;
  if (status === "future") {
    if (!effDate || Date.parse(effDate) <= Date.now()) throw new CmsError("排程發布需要一個未來的日期時間（date）");
  }
  if (status === "publish" && !effDate) {
    row.date = new Date().toISOString();
    row.date_gmt = row.date;
  }
  if (status === "publish" && effDate && Date.parse(effDate) > Date.now() + 60_000) {
    // WordPress turns "publish with a future date" into a scheduled post
    row.status = "future";
  }
  if (input.seo_title !== undefined || input.seo_description !== undefined) {
    const seo = { ...(existing?.seo ?? {}) };
    if (input.seo_title !== undefined) {
      if (input.seo_title) seo.title = input.seo_title;
      else delete seo.title;
    }
    if (input.seo_description !== undefined) {
      if (input.seo_description) seo.description = input.seo_description;
      else delete seo.description;
    }
    row.seo = seo;
  }
  const now = new Date().toISOString();
  row.modified = now;
  row.modified_gmt = now;
  return row;
}

export async function createPost(actor: Actor, type: PostType, input: PostInput) {
  if (type !== "post" && type !== "page") throw new CmsError("type 只能是 post 或 page");
  const title = (input.title ?? "").trim();
  const parentId = type === "page" ? input.parent_id ?? null : null;
  const slug = await uniqueSlug(type, input.slug ? encodeWpSlug(makeSlugKeep(input.slug)) : makeSlug(title || "untitled"), parentId, null);
  const row = buildRow({ ...input, status: input.status ?? "draft" }, null);
  row.post_type = type;
  row.slug = slug;
  row.parent_id = parentId;
  row.title = title;
  row.link_path = await pathFor(type, slug, parentId);
  if (row.author_id === undefined) row.author_id = 1;
  if (type === "page") row.comment_status = row.comment_status ?? "closed";
  const created = must(await db().from("posts").insert(row).select("*").single(), "posts") as PostRow;
  const touched = await setTerms(created.id, input.category_ids ?? (type === "post" ? [1] : undefined), input.tag_ids);
  await setPassword(created.id, input.password);
  await recountTerms(touched);
  await audit(actor, `${type}.create`, type, created.id, null, { title: created.title, status: created.status, slug: created.slug, link_path: created.link_path });
  changed();
  return getPost(created.id);
}

/** Accepts a decoded or encoded slug typed by a person; normalises spaces but keeps unicode. */
function makeSlugKeep(s: string) {
  return decodeSlug(s).trim().toLowerCase().replace(/\s+/g, "-").replace(/\//g, "-");
}

export async function updatePost(actor: Actor, id: number, input: PostInput) {
  const before = await getPost(id);
  if (!before) throw new CmsError(`找不到文章／頁面 ${id}`, 404);
  const row = buildRow(input, before);
  const parentId = input.parent_id !== undefined ? (before.post_type === "page" ? input.parent_id : null) : before.parent_id;
  if (parentId === id) throw new CmsError("上層頁面不能是自己");
  const slugIn = input.slug !== undefined && input.slug !== "" ? encodeWpSlug(makeSlugKeep(input.slug)) : undefined;
  if ((slugIn && slugIn !== before.slug) || parentId !== before.parent_id) {
    const slug = await uniqueSlug(before.post_type, slugIn ?? before.slug, parentId, id);
    row.slug = slug;
    row.parent_id = parentId;
    if (before.link_path !== "/") {
      const newPath = await pathFor(before.post_type, slug, parentId);
      if (newPath !== before.link_path && before.link_path && before.status === "publish") {
        // keep the old URL working (SEO)
        await db().from("redirects").upsert({ source_path: before.link_path, target: newPath, status_code: 301, kind: "manual" }, { onConflict: "source_path" });
      }
      row.link_path = newPath;
    }
  }
  const after = must(await db().from("posts").update(row).eq("id", id).select("*").single(), "posts") as PostRow;
  const touched = await setTerms(id, input.category_ids, input.tag_ids);
  await setPassword(id, input.password);
  if (touched.length || before.status !== after.status) await recountTerms(touched.length ? touched : before.term_ids);
  const diffKeys = Object.keys(row).filter((k) => !["modified", "modified_gmt"].includes(k));
  const pickd = (o: any) => Object.fromEntries(diffKeys.map((k) => [k, k === "content" ? `(${String(o[k] ?? "").length} chars)` : o[k]]));
  await audit(actor, `${before.post_type}.update`, before.post_type, id, pickd(before), {
    ...pickd(after),
    ...(input.category_ids || input.tag_ids ? { term_ids: [...(input.category_ids ?? []), ...(input.tag_ids ?? [])] } : {}),
  });
  changed();
  return getPost(id);
}

/** Moves to trash (WordPress default). force=true deletes permanently. */
export async function deletePost(actor: Actor, id: number, force = false) {
  const before = await getPost(id);
  if (!before) throw new CmsError(`找不到文章／頁面 ${id}`, 404);
  if (!force && before.status !== "trash") {
    await db()
      .from("posts")
      .update({ status: "trash", meta: { ...before.meta, _wp_trash_meta_status: before.status }, modified: new Date().toISOString() })
      .eq("id", id);
    await recountTerms(before.term_ids);
    await audit(actor, `${before.post_type}.trash`, before.post_type, id, { status: before.status }, { status: "trash" });
    changed();
    return { id, trashed: true };
  }
  must(await db().from("posts").delete().eq("id", id), "posts");
  await recountTerms(before.term_ids);
  await audit(actor, `${before.post_type}.delete`, before.post_type, id, { title: before.title, slug: before.slug, status: before.status, link_path: before.link_path }, null);
  changed();
  return { id, deleted: true };
}

export async function restorePost(actor: Actor, id: number) {
  const before = await getPost(id);
  if (!before || before.status !== "trash") throw new CmsError("只有回收桶內的項目可以還原");
  const prev = (before.meta?._wp_trash_meta_status as PostStatus) || "draft";
  const meta = { ...before.meta };
  delete meta._wp_trash_meta_status;
  await db().from("posts").update({ status: prev === "trash" ? "draft" : prev, meta }).eq("id", id);
  await recountTerms(before.term_ids);
  await audit(actor, `${before.post_type}.restore`, before.post_type, id, { status: "trash" }, { status: prev });
  changed();
  return getPost(id);
}

/** Publishes scheduled posts whose date has passed. Cheap; called from admin, MCP and the storefront (throttled). */
export async function publishDue(actor: Actor = SYSTEM) {
  const now = new Date().toISOString();
  const due = must(await db().from("posts").select("id,post_type").eq("status", "future").lte("date", now), "posts") as { id: number; post_type: string }[];
  if (!due.length) return [];
  must(await db().from("posts").update({ status: "publish" }).in("id", due.map((d) => d.id)).eq("status", "future"), "posts");
  const terms = must(await db().from("post_terms").select("term_id").in("post_id", due.map((d) => d.id)), "post_terms") as { term_id: number }[];
  await recountTerms(terms.map((t) => t.term_id));
  for (const d of due) await audit(actor, `${d.post_type}.publish_scheduled`, d.post_type, d.id, { status: "future" }, { status: "publish" });
  changed();
  return due.map((d) => d.id);
}

let lastDueCheck = 0;
export function publishDueThrottled() {
  if (Date.now() - lastDueCheck < 60_000) return;
  lastDueCheck = Date.now();
  void publishDue().catch((e) => console.error("[publishDue]", e?.message ?? e));
}

export function previewPathOf(p: { id: number }) {
  return `/admin-preview/${p.id}`;
}

export { num };
