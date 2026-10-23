import { notFound } from "next/navigation";
import { getMenu } from "@/lib/cms/site";
import { db } from "@/lib/db";
import { MenuEditor } from "../../../components/MenuEditor";
import { Notice, sp, type SP } from "../../../components/ui";

export const metadata = { title: "編輯選單" };

export default async function MenuPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const q = await sp(searchParams);
  const m = await getMenu(Number(id));
  if (!m) notFound();
  const [pages, cats] = await Promise.all([
    db().from("posts").select("id,title,link_path").eq("post_type", "page").eq("status", "publish").order("link_path"),
    db().from("terms").select("id,name,link_path,taxonomy").in("taxonomy", ["category", "product_cat"]).not("link_path", "is", null).order("name"),
  ]);
  const sources = [
    ...((pages.data ?? []) as any[]).map((p) => ({ label: `頁面：${p.title}`, url: p.link_path, object_type: "page", object_id: p.id })),
    ...((cats.data ?? []) as any[]).map((c) => ({ label: `${c.taxonomy === "category" ? "分類" : "商品分類"}：${c.name}`, url: c.link_path, object_type: c.taxonomy, object_id: c.id })),
  ];
  return (
    <>
      <h1 className="adm-h1">
        編輯選單：{m.name}
        <a className="adm-btn" href="/admin/menus">
          返回
        </a>
      </h1>
      <Notice q={q} />
      <MenuEditor
        menu={{ id: m.id, name: m.name, location: m.location }}
        initial={m.items.map((i: any) => ({ key: String(i.id), depth: i.depth, title: i.title, url: i.url, target: i.target, object_type: i.object_type, object_id: i.object_id, classes: i.classes ?? [] }))}
        sources={sources}
      />
    </>
  );
}
