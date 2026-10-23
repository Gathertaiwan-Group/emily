import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { db } from "@/lib/db";
import { STORAGE_BASE } from "@/lib/site";
import { CmsError, audit, ilikeTerm, must, type Actor } from "./core";

export const BUCKET = "site-emily";
export const MAX_UPLOAD = 20 * 1024 * 1024;

export type MediaRow = {
  id: number;
  title: string;
  caption: string;
  description: string;
  alt_text: string;
  mime_type: string;
  media_type: string;
  width: number | null;
  height: number | null;
  filesize: number | null;
  storage_path: string;
  public_url: string;
  old_file: string;
  date: string | null;
  parent_post_id: number | null;
};

export async function listMedia(opts: { search?: string; type?: string; page?: number; per?: number } = {}) {
  const per = Math.min(Math.max(opts.per ?? 40, 1), 200);
  const page = Math.max(opts.page ?? 1, 1);
  let q = db().from("media").select("id,title,caption,description,alt_text,mime_type,media_type,width,height,filesize,storage_path,public_url,old_file,date,parent_post_id", { count: "exact" });
  if (opts.type && opts.type !== "all") q = q.eq("media_type", opts.type);
  if (opts.search) {
    const t = ilikeTerm(opts.search);
    q = q.or(`title.ilike.%${t}%,old_file.ilike.%${t}%,alt_text.ilike.%${t}%`);
  }
  const r = await q.order("date", { ascending: false, nullsFirst: false }).order("id", { ascending: false }).range((page - 1) * per, page * per - 1);
  return { rows: must(r, "media") as MediaRow[], total: r.count ?? 0, page, per };
}

export async function getMedia(id: number) {
  return must(await db().from("media").select("*").eq("id", id).maybeSingle(), "media") as (MediaRow & Record<string, any>) | null;
}

function kindOf(mime: string): "image" | "video" | "audio" | "file" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "file";
}

const ALLOWED = /^(image\/(jpeg|png|webp|gif|avif|heic|heif|tiff|bmp)|video\/(mp4|webm|quicktime)|audio\/(mpeg|mp4|ogg|wav)|application\/pdf)$/;

function safeBase(name: string) {
  const base = name.replace(/\.[^.]+$/, "").normalize("NFKC");
  const s = base
    .replace(/[\s_]+/g, "-")
    .replace(/[^\p{L}\p{N}.-]+/gu, "")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  return s || "file";
}

/**
 * Uploads a file to bucket site-emily under uploads/YYYY/MM/. Raster images are converted to WebP
 * (longest edge ≤ 2000, quality 80); GIF / video / audio / PDF are stored as-is. Byte-identical
 * re-uploads reuse the stored file instead of storing a duplicate.
 */
export async function uploadMedia(actor: Actor, file: { name: string; type: string; data: Buffer }, meta: { title?: string; alt_text?: string; caption?: string; parent_post_id?: number | null } = {}) {
  const mime = (file.type || "").toLowerCase();
  if (!ALLOWED.test(mime)) throw new CmsError(`不支援的檔案類型：${mime || "未知"}（可上傳圖片、影片、音訊、PDF）`);
  if (file.data.length > MAX_UPLOAD) throw new CmsError(`檔案過大（上限 ${MAX_UPLOAD / 1024 / 1024} MB）`);
  const sha1 = createHash("sha1").update(file.data).digest("hex");
  const now = new Date();
  const ym = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const ext0 = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] ?? mime.split("/")[1] ?? "bin").toLowerCase();
  const base = safeBase(file.name);
  const title = meta.title ?? file.name.replace(/\.[^.]+$/, "");

  let out = file.data;
  let outMime = mime;
  let outExt = ext0;
  let width: number | null = null;
  let height: number | null = null;
  let converted = false;
  if (mime.startsWith("image/") && mime !== "image/gif") {
    const img = sharp(file.data, { failOn: "error" }).rotate();
    const buf = await img.resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
    out = buf.data;
    outMime = "image/webp";
    outExt = "webp";
    width = buf.info.width;
    height = buf.info.height;
    converted = true;
  } else if (mime === "image/gif") {
    const m = await sharp(file.data).metadata().catch(() => null);
    width = m?.width ?? null;
    height = m?.pageHeight ?? m?.height ?? null;
  }

  // identical source already stored → reuse its file
  const dup = must(await db().from("media").select("storage_path,public_url,mime_type,width,height,filesize").eq("sha1", sha1).limit(1), "media") as any[];
  let storagePath: string;
  let publicUrl: string;
  if (dup[0]) {
    storagePath = dup[0].storage_path;
    publicUrl = dup[0].public_url;
    outMime = dup[0].mime_type;
    width = dup[0].width;
    height = dup[0].height;
  } else {
    storagePath = "";
    for (let i = 0; i < 100; i++) {
      const cand = `uploads/${ym}/${base}${i ? `-${i}` : ""}.${outExt}`;
      const taken = must(await db().from("media").select("id").eq("storage_path", cand).limit(1), "media") as any[];
      if (taken.length) continue;
      const up = await db().storage.from(BUCKET).upload(cand, out, { contentType: outMime, upsert: false, cacheControl: "31536000" });
      if (up.error) {
        if (/exists|duplicate/i.test(up.error.message)) continue;
        throw new CmsError(`上傳失敗：${up.error.message}`, 500);
      }
      storagePath = cand;
      break;
    }
    if (!storagePath) throw new CmsError("無法產生不重複的檔名", 500);
    publicUrl = `${STORAGE_BASE}/${storagePath.split("/").map(encodeURIComponent).join("/")}`;
  }

  const row = {
    title,
    alt_text: meta.alt_text ?? "",
    caption: meta.caption ?? "",
    mime_type: outMime,
    original_mime_type: mime,
    media_type: kindOf(outMime),
    width,
    height,
    filesize: dup[0]?.filesize ?? out.length,
    original_filesize: file.data.length,
    parent_post_id: meta.parent_post_id ?? null,
    status: "inherit",
    date: now.toISOString(),
    modified: now.toISOString(),
    old_file: `${ym}/${base}.${ext0}`,
    old_url: publicUrl,
    storage_path: storagePath,
    public_url: publicUrl,
    sha1,
    converted,
    metadata_source: "upload",
  };
  const m = must(await db().from("media").insert(row).select("*").single(), "media") as MediaRow;
  await audit(actor, "media.upload", "media", m.id, null, { title, storage_path: storagePath, mime_type: outMime, bytes: row.filesize, reused_file: !!dup[0] });
  return m;
}

function blockedHost(u: URL) {
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    h === "localhost" ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h === "::1" ||
    /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(h) ||
    /^f[cd][0-9a-f]{2}:/.test(h) ||
    h.startsWith("fe80:")
  );
}

/** Downloads a public http(s) URL (MCP media upload). Private / local hosts are refused. */
export async function fetchRemote(url: string): Promise<{ name: string; type: string; data: Buffer }> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new CmsError("網址格式錯誤");
  }
  if (!/^https?:$/.test(u.protocol) || blockedHost(u)) throw new CmsError("只接受公開的 http(s) 網址");
  const res = await fetch(u, { redirect: "follow", headers: { "User-Agent": "GatherMigrator/1.0" }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new CmsError(`下載失敗：HTTP ${res.status}`);
  if (blockedHost(new URL(res.url))) throw new CmsError("只接受公開的 http(s) 網址");
  const len = Number(res.headers.get("content-length") || 0);
  if (len > MAX_UPLOAD) throw new CmsError("檔案過大");
  const data = Buffer.from(await res.arrayBuffer());
  const name = decodeURIComponent(u.pathname.split("/").pop() || "file");
  return { name, type: (res.headers.get("content-type") || "").split(";")[0].trim(), data };
}

export async function updateMedia(actor: Actor, id: number, patch: { title?: string; alt_text?: string; caption?: string; description?: string }) {
  const before = await getMedia(id);
  if (!before) throw new CmsError(`找不到媒體 ${id}`, 404);
  const row: Record<string, any> = {};
  for (const k of ["title", "alt_text", "caption", "description"] as const) if (patch[k] !== undefined) row[k] = patch[k];
  row.modified = new Date().toISOString();
  const after = must(await db().from("media").update(row).eq("id", id).select("*").single(), "media");
  const keys = Object.keys(row).filter((k) => k !== "modified");
  await audit(actor, "media.update", "media", id, Object.fromEntries(keys.map((k) => [k, (before as any)[k]])), Object.fromEntries(keys.map((k) => [k, row[k]])));
  return after;
}

/** Deletes the media row; the stored file is removed only when no other row still uses it. */
export async function deleteMedia(actor: Actor, id: number) {
  const before = await getMedia(id);
  if (!before) throw new CmsError(`找不到媒體 ${id}`, 404);
  must(await db().from("media").delete().eq("id", id), "media");
  const others = must(await db().from("media").select("id").eq("storage_path", before.storage_path).limit(1), "media") as any[];
  let removed = false;
  if (!others.length) {
    const r = await db().storage.from(BUCKET).remove([before.storage_path]);
    removed = !r.error;
  }
  await audit(actor, "media.delete", "media", id, { title: before.title, storage_path: before.storage_path, public_url: before.public_url }, { file_removed: removed });
  return { id, deleted: true, file_removed: removed };
}
