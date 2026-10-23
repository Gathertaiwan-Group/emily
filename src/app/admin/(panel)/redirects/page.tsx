import { listRedirects } from "@/lib/cms/site";
import { deleteRedirect, saveRedirect } from "../../actions";
import { ConfirmButton } from "../../components/ConfirmButton";
import { Notice, Pager, SubNav, sp, type SP } from "../../components/ui";

export const metadata = { title: "轉址" };

export default async function RedirectsPage({ searchParams }: { searchParams: SP }) {
  const q = await sp(searchParams);
  const kind = q.kind || "all";
  const list = await listRedirects({ search: q.s, kind, page: Number(q.page || 1), per: 50 });
  const edit = q.edit ? list.rows.find((r) => r.id === Number(q.edit)) : null;
  return (
    <>
      <h1 className="adm-h1">轉址管理</h1>
      <p className="adm-help">舊附件頁與改過網址的內容會自動 301。新增的規則最多約 5 分鐘後在所有伺服器生效。</p>
      <Notice q={q} />
      <form action={saveRedirect} className="adm-card adm-row">
        {edit ? <input type="hidden" name="id" value={edit.id} /> : null}
        <input className="grow" name="source_path" placeholder="來源路徑，例如 /old-page" defaultValue={edit?.source_path ?? ""} required />
        <span>→</span>
        <input className="grow" name="target" placeholder="目標，例如 /new-page 或 https://…" defaultValue={edit?.target ?? ""} required />
        <select name="status_code" defaultValue={edit?.status_code ?? 301} style={{ width: "auto" }}>
          <option value={301}>301 永久</option>
          <option value={302}>302 暫時</option>
        </select>
        <button className="adm-btn primary">{edit ? "更新" : "新增轉址"}</button>
        {edit ? <a href="/admin/redirects">取消</a> : null}
      </form>
      <SubNav
        current={kind}
        items={[
          ["all", "全部"],
          ["manual", "手動"],
          ["attachment", "附件頁"],
          ["legacy", "舊網址"],
        ].map(([k, l]) => ({ key: k, label: l, href: `/admin/redirects?kind=${k}` }))}
      />
      <form className="adm-filters" action="/admin/redirects">
        <input type="hidden" name="kind" value={kind} />
        <input type="search" name="s" defaultValue={q.s ?? ""} placeholder="搜尋路徑" />
        <button className="adm-btn">搜尋</button>
      </form>
      <table className="adm-table">
        <thead>
          <tr>
            <th>來源</th>
            <th>目標</th>
            <th>代碼</th>
            <th>類型</th>
          </tr>
        </thead>
        <tbody>
          {list.rows.map((r) => (
            <tr key={r.id}>
              <td>
                {r.source_path}
                <div className="actions">
                  <a href={`/admin/redirects?edit=${r.id}&kind=${kind}${q.s ? `&s=${encodeURIComponent(q.s)}` : ""}`}>編輯</a>
                  <form action={deleteRedirect} style={{ display: "inline" }}>
                    <input type="hidden" name="id" value={r.id} />
                    <ConfirmButton message="刪除此轉址？">刪除</ConfirmButton>
                  </form>
                </div>
              </td>
              <td style={{ wordBreak: "break-all" }}>{r.target}</td>
              <td>{r.status_code}</td>
              <td>{r.kind}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pager total={list.total} page={list.page} per={list.per} base="/admin/redirects" q={q} />
    </>
  );
}
