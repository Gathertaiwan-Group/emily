import { dashboardCounts, listAudit } from "@/lib/cms/site";
import { listPosts } from "@/lib/cms/posts";
import { dt } from "../components/ui";

export const metadata = { title: "控制台" };

export default async function Dashboard() {
  const [c, recent, drafts] = await Promise.all([dashboardCounts(), listAudit({ per: 10 }), listPosts({ type: "post", status: "draft", per: 5 })]);
  const stats: [string, number, string][] = [
    ["已發布文章", c.posts, "/admin/posts"],
    ["草稿／待審", c.drafts, "/admin/posts?status=draft"],
    ["已排程", c.scheduled, "/admin/posts?status=future"],
    ["頁面", c.pages, "/admin/posts?type=page"],
    ["上架商品", c.products, "/admin/products"],
    ["訂單", c.orders, "/admin/orders"],
    ["待付款訂單", c.pending_orders, "/admin/orders?status=pending"],
    ["處理中訂單", c.processing_orders, "/admin/orders?status=processing"],
    ["顧客", c.customers, "/admin/customers"],
    ["媒體", c.media, "/admin/media"],
    ["未讀表單提交", c.new_form_submissions, "/admin/forms"],
  ];
  return (
    <>
      <h1 className="adm-h1">控制台</h1>
      <div className="adm-stats">
        {stats.map(([l, n, h]) => (
          <a key={l} href={h}>
            <b>{n}</b>
            {l}
          </a>
        ))}
      </div>
      <div className="adm-grid">
        <div className="adm-card">
          <h2 className="adm-h2">最近活動</h2>
          <table className="adm-table">
            <tbody>
              {recent.rows.map((r) => (
                <tr key={r.id}>
                  <td>{dt(r.at)}</td>
                  <td>{r.actor}</td>
                  <td>{r.action}</td>
                  <td>
                    {r.entity_type} #{r.entity_id}
                  </td>
                </tr>
              ))}
              {!recent.rows.length ? (
                <tr>
                  <td>尚無紀錄</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="adm-card">
          <h2 className="adm-h2">草稿</h2>
          {drafts.rows.map((p) => (
            <p key={p.id} style={{ margin: "4px 0" }}>
              <a href={`/admin/posts/${p.id}`}>{p.title || "（無標題）"}</a>
            </p>
          ))}
          {!drafts.rows.length ? <p className="adm-help">沒有草稿</p> : null}
          <p>
            <a className="adm-btn primary" href="/admin/posts/new">
              撰寫新文章
            </a>
          </p>
        </div>
      </div>
    </>
  );
}
