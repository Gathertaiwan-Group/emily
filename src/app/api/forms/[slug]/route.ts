import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const SECRET_KEYS = /pass(word)?|pwd|token|secret|card|cvc|cvv/i;

/** Stores a storefront form submission in site_emily.form_submissions (and, for the comment form,
 *  a held comment in site_emily.comments). Secrets such as passwords are never stored. */
export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > 64_000) return NextResponse.json({ error: "內容過大" }, { status: 413 });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const form = await db().from("forms").select("id,slug,kind,fields,status").eq("slug", slug).maybeSingle();
  if (!form.data || form.data.status !== "publish") return NextResponse.json({ error: "Unknown form" }, { status: 404 });
  const raw = body?.data && typeof body.data === "object" ? body.data : {};
  const data: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (Object.keys(data).length >= 40) break;
    const key = String(k).slice(0, 64);
    if (SECRET_KEYS.test(key)) continue;
    data[key] = String(v ?? "").slice(0, 5000);
  }
  if (body?.website_hp) return NextResponse.json({ ok: true }); // honeypot
  const ipRaw = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const ip = ipRaw && /^[0-9a-f.:]+$/i.test(ipRaw) ? ipRaw : null;
  const ua = req.headers.get("user-agent")?.slice(0, 300) ?? null;
  const pageUrl = String(body?.page_url ?? "").slice(0, 500) || null;

  if (form.data.kind === "comment") {
    const postId = Number(data.comment_post_ID);
    const errs: string[] = [];
    if (!data.comment?.trim()) errs.push("請輸入留言內容。");
    if (!data.author?.trim()) errs.push("請輸入名稱。");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email ?? "")) errs.push("請輸入有效的電子郵件地址。");
    const post = await db().from("posts").select("id,comment_status,status").eq("id", postId).maybeSingle();
    if (!post.data || post.data.status !== "publish" || post.data.comment_status !== "open") errs.push("此文章已關閉留言。");
    if (errs.length) return NextResponse.json({ error: errs.join("\n") }, { status: 422 });
    const avatar = `https://secure.gravatar.com/avatar/${createHash("sha256").update(data.email.trim().toLowerCase()).digest("hex")}?s=96&d=mm&r=g`;
    const c = await db()
      .from("comments")
      .insert({
        post_id: postId,
        object_type: "post",
        parent_id: Number(data.comment_parent) || null,
        author_name: data.author.trim().slice(0, 245),
        author_url: (data.url ?? "").trim().slice(0, 200),
        avatar_url: avatar,
        content: data.comment.trim().replace(/[<>]/g, (m) => (m === "<" ? "&lt;" : "&gt;")).replace(/\n/g, "<br />"),
        status: "hold",
        type: "comment",
        date: new Date().toISOString(),
        date_gmt: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (c.error) return NextResponse.json({ error: c.error.message }, { status: 500 });
    await db().from("comment_private").insert({ comment_id: c.data.id, author_email: data.email.trim(), author_ip: ip, user_agent: ua });
    data.comment_id = String(c.data.id);
  }

  const ins = await db().from("form_submissions").insert({ form_id: form.data.id, data, page_url: pageUrl, ip, user_agent: ua }).select("id").single();
  if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });
  const message = form.data.kind === "comment" ? "您的留言正在等待審核。" : "已送出。";
  return NextResponse.json({ ok: true, id: ins.data.id, message });
}
