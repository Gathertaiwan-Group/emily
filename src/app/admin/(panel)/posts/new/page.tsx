import { PostEditor } from "../../../components/PostEditor";
import { Notice, sp, type SP } from "../../../components/ui";

export const metadata = { title: "新增" };

export default async function NewPost({ searchParams }: { searchParams: SP }) {
  const q = await sp(searchParams);
  const type = q.type === "page" ? "page" : "post";
  return (
    <>
      <h1 className="adm-h1">新增{type === "page" ? "頁面" : "文章"}</h1>
      <Notice q={q} />
      <PostEditor
        post={{
          post_type: type,
          title: "",
          slug: "",
          content: "",
          excerpt: "",
          status: "draft",
          date: null,
          author_id: 2,
          featured_media_id: null,
          parent_id: null,
          menu_order: 0,
          template: "",
          comment_status: type === "post" ? "open" : "closed",
          sticky: false,
          link_path: null,
          seo: {},
          term_ids: type === "post" ? [1] : [],
          password: null,
        }}
      />
    </>
  );
}
