import { urlAtLeast } from "@/lib/img";
import { listProducts } from "@/lib/cms/products";
import { db } from "@/lib/db";
import { deleteProductForever, restoreProduct, trashProduct } from "../../actions";
import { ConfirmButton } from "../../components/ConfirmButton";
import { Badge, Notice, Pager, POST_STATUS_LABEL, SubNav, money, sp, type SP } from "../../components/ui";

export const metadata = { title: "商品" };
const STOCK: Record<string, string> = { instock: "有庫存", outofstock: "缺貨", onbackorder: "可預購" };

export default async function ProductsPage({ searchParams }: { searchParams: SP }) {
  const q = await sp(searchParams);
  const status = q.status || "all";
  const list = await listProducts({ status, search: q.s, termId: q.term ? Number(q.term) : undefined, page: Number(q.page || 1), per: 20 });
  const mids = list.rows.map((p) => p.featured_media_id).filter(Boolean);
  const media = mids.length ? (((await db().from("media").select("id,public_url,width,height,variants").in("id", mids)).data ?? []) as any[]) : [];
  const img = new Map(media.map((m) => [m.id, urlAtLeast(m, 480)]));
  return (
    <>
      <h1 className="adm-h1">
        商品
        <a className="adm-btn" href="/admin/products/new">
          新增商品
        </a>
      </h1>
      <Notice q={q} />
      <SubNav
        current={status}
        items={["all", "publish", "draft", "pending", "private", "trash"].map((k) => ({ key: k, label: POST_STATUS_LABEL[k], href: `/admin/products?status=${k}` }))}
      />
      <form className="adm-filters" action="/admin/products">
        <input type="hidden" name="status" value={status} />
        <input type="search" name="s" defaultValue={q.s ?? ""} placeholder="搜尋商品名稱或貨號" />
        <button className="adm-btn">搜尋</button>
      </form>
      <table className="adm-table">
        <thead>
          <tr>
            <th style={{ width: 60 }} />
            <th>名稱</th>
            <th>貨號</th>
            <th>庫存</th>
            <th className="num">價格</th>
            <th>狀態</th>
          </tr>
        </thead>
        <tbody>
          {list.rows.map((p) => (
            <tr key={p.id}>
              <td>
                {img.get(p.featured_media_id) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="adm-thumb" src={img.get(p.featured_media_id)} alt="" />
                ) : (
                  <span className="adm-thumb" />
                )}
              </td>
              <td>
                <a href={`/admin/products/${p.id}`}>
                  <b>{p.name}</b>
                </a>
                <div className="actions">
                  ID: {p.id} · {p.type}{" "}
                  {p.status !== "trash" ? (
                    <>
                      <a href={`/admin/products/${p.id}`}>編輯</a>
                      {p.status === "publish" ? (
                        <a href={p.link_path} target="_blank" rel="noreferrer">
                          檢視
                        </a>
                      ) : null}
                      <form action={trashProduct} style={{ display: "inline" }}>
                        <input type="hidden" name="id" value={p.id} />
                        <button className="adm-link-danger">移到回收桶</button>
                      </form>
                    </>
                  ) : (
                    <>
                      <form action={restoreProduct} style={{ display: "inline" }}>
                        <input type="hidden" name="id" value={p.id} />
                        <button className="adm-link-danger" style={{ color: "var(--adm-accent)" }}>
                          還原
                        </button>
                      </form>
                      <form action={deleteProductForever} style={{ display: "inline" }}>
                        <input type="hidden" name="id" value={p.id} />
                        <ConfirmButton message="永久刪除商品？">永久刪除</ConfirmButton>
                      </form>
                    </>
                  )}
                </div>
              </td>
              <td>{p.sku || "—"}</td>
              <td>
                <Badge s={p.stock_status} label={STOCK[p.stock_status] ?? p.stock_status} />
                {p.manage_stock ? ` (${p.stock_quantity ?? 0})` : ""}
              </td>
              <td className="num">
                {p.sale_price != null ? (
                  <>
                    <del>{money(p.regular_price)}</del> {money(p.sale_price)}
                  </>
                ) : (
                  money(p.price ?? p.regular_price)
                )}
              </td>
              <td>
                <Badge s={p.status} label={POST_STATUS_LABEL[p.status]} />
              </td>
            </tr>
          ))}
          {!list.rows.length ? (
            <tr>
              <td colSpan={6}>找不到商品。</td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <Pager total={list.total} page={list.page} per={list.per} base="/admin/products" q={q} />
    </>
  );
}
