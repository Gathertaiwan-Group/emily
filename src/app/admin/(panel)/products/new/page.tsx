import { requireAdmin } from "@/lib/admin/auth";
import { ProductEditor } from "../../../components/ProductEditor";
import { Notice, sp, type SP } from "../../../components/ui";

export const metadata = { title: "新增商品" };

export default async function NewProduct({ searchParams }: { searchParams: SP }) {
  await requireAdmin();
  const q = await sp(searchParams);
  return (
    <>
      <h1 className="adm-h1">新增商品</h1>
      <Notice q={q} />
      <ProductEditor p={{ name: "", slug: "", status: "draft", type: "simple", term_ids: [15], gallery_media_ids: [], attributes: [], variations: [], catalog_visibility: "visible", reviews_allowed: true }} />
    </>
  );
}
