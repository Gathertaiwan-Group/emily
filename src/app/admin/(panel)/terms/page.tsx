import { requireAdmin } from "@/lib/admin/auth";
import { TAXONOMIES, listTerms, treeOrder } from "@/lib/cms/terms";
import { decodeSlug } from "@/lib/cms/core";
import { deleteTerm, saveTerm } from "../../actions";
import { ConfirmButton } from "../../components/ConfirmButton";
import { Notice, SubNav, sp, type SP } from "../../components/ui";

export const metadata = { title: "分類" };

export default async function TermsPage({ searchParams }: { searchParams: SP }) {
  await requireAdmin();
  const q = await sp(searchParams);
  const taxonomy = q.taxonomy && (TAXONOMIES[q.taxonomy] || /^pa_[a-z0-9_-]+$/.test(q.taxonomy)) ? q.taxonomy : "category";
  const meta = TAXONOMIES[taxonomy] ?? { label: taxonomy, hierarchical: false, base: null, object: "product" };
  const rows = await listTerms(taxonomy, q.s);
  const ordered = meta.hierarchical && !q.s ? treeOrder(rows) : rows.map((r) => ({ ...r, depth: 0 }));
  const edit = q.edit ? rows.find((r) => r.id === Number(q.edit)) : undefined;
  const isAttr = taxonomy.startsWith("pa_");
  return (
    <>
      <h1 className="adm-h1">{meta.label}</h1>
      <Notice q={q} />
      {isAttr ? (
        <SubNav
          current={taxonomy}
          items={Object.entries(TAXONOMIES)
            .filter(([k]) => k.startsWith("pa_"))
            .map(([k, v]) => ({ key: k, label: v.label, href: `/admin/terms?taxonomy=${k}` }))}
        />
      ) : null}
      <div className="adm-grid" style={{ gridTemplateColumns: "320px minmax(0,1fr)" }}>
        <div className="adm-card">
          <h2 className="adm-h2">{edit ? `編輯「${edit.name}」` : `新增${meta.label}`}</h2>
          <form action={saveTerm}>
            <input type="hidden" name="taxonomy" value={taxonomy} />
            {edit ? <input type="hidden" name="id" value={edit.id} /> : null}
            <label className="adm-label">名稱</label>
            <input name="name" required defaultValue={edit?.name ?? ""} />
            <label className="adm-label">代稱</label>
            <input name="slug" defaultValue={edit ? decodeSlug(edit.slug) : ""} />
            <p className="adm-help">網址用的名稱；變更後舊網址會自動 301 轉到新網址。</p>
            {meta.hierarchical ? (
              <>
                <label className="adm-label">上層分類</label>
                <select name="parent_id" defaultValue={edit?.parent_id ?? ""}>
                  <option value="">無</option>
                  {treeOrder(rows)
                    .filter((r) => r.id !== edit?.id)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {"　".repeat(r.depth)}
                        {r.name}
                      </option>
                    ))}
                </select>
              </>
            ) : null}
            <label className="adm-label">描述</label>
            <textarea name="description" defaultValue={edit?.description ?? ""} rows={4} />
            {meta.base ? (
              <>
                <label className="adm-label">SEO 標題</label>
                <input name="seo_title" defaultValue={edit?.seo?.title ?? ""} />
                <label className="adm-label">Meta 描述</label>
                <textarea name="seo_description" defaultValue={edit?.seo?.description ?? ""} rows={2} />
              </>
            ) : null}
            <p className="adm-row" style={{ marginTop: 12 }}>
              <button className="adm-btn primary">{edit ? "更新" : "新增"}</button>
              {edit ? <a href={`/admin/terms?taxonomy=${taxonomy}`}>取消</a> : null}
            </p>
          </form>
        </div>
        <div>
          <form className="adm-filters" action="/admin/terms">
            <input type="hidden" name="taxonomy" value={taxonomy} />
            <input type="search" name="s" defaultValue={q.s ?? ""} placeholder="搜尋" />
            <button className="adm-btn">搜尋</button>
          </form>
          <table className="adm-table">
            <thead>
              <tr>
                <th>名稱</th>
                <th>代稱</th>
                <th className="num">數量</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((t) => (
                <tr key={t.id}>
                  <td style={{ paddingLeft: 10 + t.depth * 18 }}>
                    <a href={`/admin/terms?taxonomy=${taxonomy}&edit=${t.id}`}>
                      <b>
                        {t.depth ? "— ".repeat(t.depth) : ""}
                        {t.name}
                      </b>
                    </a>
                    <div className="actions">
                      <a href={`/admin/terms?taxonomy=${taxonomy}&edit=${t.id}`}>編輯</a>
                      {t.link_path ? (
                        <a href={t.link_path} target="_blank" rel="noreferrer">
                          檢視
                        </a>
                      ) : null}
                      <form action={deleteTerm} style={{ display: "inline" }}>
                        <input type="hidden" name="id" value={t.id} />
                        <input type="hidden" name="taxonomy" value={taxonomy} />
                        <ConfirmButton message={`確定刪除「${t.name}」？`}>刪除</ConfirmButton>
                      </form>
                    </div>
                  </td>
                  <td>{decodeSlug(t.slug)}</td>
                  <td className="num">
                    {meta.object === "post" ? <a href={`/admin/posts?cat=${t.id}`}>{t.count}</a> : <a href={`/admin/products?term=${t.id}`}>{t.count}</a>}
                  </td>
                </tr>
              ))}
              {!ordered.length ? (
                <tr>
                  <td colSpan={3}>沒有項目。</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
