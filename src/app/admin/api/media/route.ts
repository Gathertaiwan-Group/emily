import { NextResponse } from "next/server";
import { adminActor } from "@/lib/admin/auth";
import { CmsError } from "@/lib/cms/core";
import { listMedia, uploadMedia } from "@/lib/cms/media";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Media library JSON for the admin picker. */
export async function GET(req: Request) {
  if (!(await adminActor())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const u = new URL(req.url);
  const r = await listMedia({ search: u.searchParams.get("q") || undefined, type: u.searchParams.get("type") || "image", page: Number(u.searchParams.get("page") || 1), per: 40 });
  return NextResponse.json(r);
}

/** Multipart upload (field "file", optional "title" / "alt"). Images are converted to WebP server side. */
export async function POST(req: Request) {
  const actor = await adminActor();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(req.url).host) return NextResponse.json({ error: "bad origin" }, { status: 403 });
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (!(f instanceof File)) throw new CmsError("沒有收到檔案");
    const m = await uploadMedia(actor, { name: f.name, type: f.type, data: Buffer.from(await f.arrayBuffer()) }, { title: String(form.get("title") || "") || undefined, alt_text: String(form.get("alt") || "") || undefined });
    return NextResponse.json(m);
  } catch (e) {
    const msg = e instanceof CmsError ? e.message : `上傳失敗：${(e as Error).message}`;
    return NextResponse.json({ error: msg }, { status: e instanceof CmsError ? e.status : 500 });
  }
}
