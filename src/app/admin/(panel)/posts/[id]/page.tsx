import { notFound } from "next/navigation";
import { getPost } from "@/lib/cms/posts";
import { PostEditor } from "../../../components/PostEditor";
import { Notice, sp, type SP } from "../../../components/ui";

export const metadata = { title: "編輯" };

export default async function EditPost({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const q = await sp(searchParams);
  const p = await getPost(Number(id));
  if (!p) notFound();
  return (
    <>
      <h1 className="adm-h1">
        編輯{p.post_type === "page" ? "頁面" : "文章"}
        <a className="adm-btn" href={`/admin/posts/new?type=${p.post_type}`}>
          新增
        </a>
      </h1>
      <Notice q={q} />
      <PostEditor post={p as any} />
    </>
  );
}
