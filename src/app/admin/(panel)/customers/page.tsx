import { requireAdmin } from "@/lib/admin/auth";
import { listCustomers } from "@/lib/cms/commerce";
import { Notice, Pager, dt, money, sp, type SP } from "../../components/ui";

export const metadata = { title: "顧客" };

export default async function CustomersPage({ searchParams }: { searchParams: SP }) {
  await requireAdmin();
  const q = await sp(searchParams);
  const list = await listCustomers({ search: q.s, page: Number(q.page || 1), per: 20 });
  return (
    <>
      <h1 className="adm-h1">顧客</h1>
      <Notice q={q} />
      <form className="adm-filters" action="/admin/customers">
        <input type="search" name="s" defaultValue={q.s ?? ""} placeholder="姓名或 Email" />
        <button className="adm-btn">搜尋</button>
      </form>
      {list.total === 0 && !q.s ? <div className="adm-notice warn">目前沒有顧客資料；舊站會員與顧客會在取得資料庫備份後匯入。</div> : null}
      <table className="adm-table">
        <thead>
          <tr>
            <th>姓名</th>
            <th>Email</th>
            <th className="num">訂單數</th>
            <th className="num">消費總額</th>
            <th>註冊日期</th>
            <th>最後活動</th>
          </tr>
        </thead>
        <tbody>
          {list.rows.map((c) => (
            <tr key={c.id}>
              <td>
                <a href={`/admin/customers/${c.id}`}>{c.display_name || [c.last_name, c.first_name].filter(Boolean).join("") || c.username || `#${c.id}`}</a>
              </td>
              <td>{c.email}</td>
              <td className="num">{c.order_count}</td>
              <td className="num">{money(c.total_spent)}</td>
              <td>{dt(c.date_created)}</td>
              <td>{dt(c.date_last_active)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pager total={list.total} page={list.page} per={list.per} base="/admin/customers" q={q} />
    </>
  );
}
