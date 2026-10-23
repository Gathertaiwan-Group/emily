import { notFound } from "next/navigation";
import { getProduct } from "@/lib/cms/products";
import { ProductEditor } from "../../../components/ProductEditor";
import { Notice, sp, type SP } from "../../../components/ui";

export const metadata = { title: "編輯商品" };

export default async function EditProduct({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const q = await sp(searchParams);
  const p = await getProduct(Number(id));
  if (!p) notFound();
  return (
    <>
      <h1 className="adm-h1">
        編輯商品
        <a className="adm-btn" href="/admin/products/new">
          新增商品
        </a>
      </h1>
      <Notice q={q} />
      <ProductEditor p={p} />
    </>
  );
}
