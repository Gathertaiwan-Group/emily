import { listAudit } from "@/lib/cms/site";
import { Notice, Pager, SubNav, dt, sp, type SP } from "../../components/ui";

export const metadata = { title: "稽核紀錄" };

export default async function AuditPage({ searchParams }: { searchParams: SP }) {
  const q = await sp(searchParams);
  const source = q.source || "all";
  const list = await listAudit({ source, search: q.s, entityType: q.type || undefined, page: Number(q.page || 1), per: 50 });
  return (
    <>
      <h1 className="adm-h1">稽核紀錄</h1>
      <Notice q={q} />
      <SubNav
        current={source}
        items={[
          ["all", "全部"],
          ["admin", "後台"],
          ["mcp", "MCP"],
          ["system", "系統"],
        ].map(([k, l]) => ({ key: k, label: l, href: `/admin/audit?source=${k}` }))}
      />
      <form className="adm-filters" action="/admin/audit">
        <input type="hidden" name="source" value={source} />
        <input type="search" name="s" defaultValue={q.s ?? ""} placeholder="動作、操作者或 ID" />
        <button className="adm-btn">搜尋</button>
      </form>
      <table className="adm-table">
        <thead>
          <tr>
            <th>時間</th>
            <th>操作者</th>
            <th>動作</th>
            <th>對象</th>
            <th>變更前</th>
            <th>變更後</th>
          </tr>
        </thead>
        <tbody>
          {list.rows.map((r) => (
            <tr key={r.id}>
              <td style={{ whiteSpace: "nowrap" }}>{dt(r.at)}</td>
              <td>
                {r.actor}
                <div className="actions">
                  {r.source}
                  {r.ip ? ` · ${r.ip}` : ""}
                </div>
              </td>
              <td>{r.action}</td>
              <td>
                {r.entity_type} #{r.entity_id}
              </td>
              <td style={{ maxWidth: 280 }}>{r.before ? <pre className="adm-json">{JSON.stringify(r.before, null, 1)}</pre> : "—"}</td>
              <td style={{ maxWidth: 280 }}>{r.after ? <pre className="adm-json">{JSON.stringify(r.after, null, 1)}</pre> : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pager total={list.total} page={list.page} per={list.per} base="/admin/audit" q={q} />
    </>
  );
}
