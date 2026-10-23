import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { currentAdmin } from "@/lib/admin/auth";
import { db } from "@/lib/db";
import type { Post } from "@/lib/data";
import { PageView, SinglePost } from "@/components/Single";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "預覽", robots: { index: false, follow: false } };

/** Admin-only preview of any post / page (drafts, scheduled, private) rendered with the storefront templates. */
export default async function Preview({ params }: { params: Promise<{ id: string }> }) {
  if (!(await currentAdmin())) redirect("/admin/login");
  const { id } = await params;
  const r = await db().from("posts").select("*").eq("id", Number(id)).in("post_type", ["post", "page"]).maybeSingle();
  const post = r.data as Post | null;
  if (!post) notFound();
  const bar: React.CSSProperties = { position: "sticky", top: 0, zIndex: 99999, background: "#1d2327", color: "#fff", padding: "8px 16px", font: "14px/1.4 sans-serif", display: "flex", gap: 16 };
  return (
    <>
      <div style={bar}>
        <span>
          預覽：{post.title || "（無標題）"}（狀態：{post.status}）
        </span>
        <a href={`/admin/posts/${post.id}`} style={{ color: "#72aee6" }}>
          ← 回到編輯
        </a>
      </div>
      {post.post_type === "post" ? <SinglePost post={post} /> : <PageView post={post} />}
    </>
  );
}
