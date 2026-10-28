import { requireAdmin } from "@/lib/admin/auth";
import { ORDER_STATUSES, listOrders, orderStatusCounts } from "@/lib/cms/commerce";
import { cancelUnpaidOrders } from "@/lib/newebpay";
import { Badge, Notice, Pager, SubNav, dt, money, sp, type SP } from "../../components/ui";

export const metadata = { title: "訂單" };

export default async function OrdersPage({ searchParams }: { searchParams: SP }) {
  await requireAdmin();
  const q = await sp(searchParams);
  await cancelUnpaidOrders(); // WooCommerce hold-stock: unpaid 藍新 orders > 60 min -> 已取消
  const status = q.status || "all";
  const [list, counts] = await Promise.all([listOrders({ status, search: q.s, page: Number(q.page || 1), per: 20 }), orderStatusCounts()]);
  const all = Object.values(counts).reduce((a, b) => a + b, 0);
  return (
    <>
      <h1 className="adm-h1">
        訂單
        <a className="adm-btn" href={`/admin/export/orders?status=${status}`}>
          匯出 CSV
        </a>
      </h1>
      <Notice q={q} />
      <SubNav
        current={status}
        items={[
          { key: "all", label: `全部 (${all})`, href: "/admin/orders" },
          ...Object.entries(ORDER_STATUSES)
            .filter(([k]) => counts[k])
            .map(([k, l]) => ({ key: k, label: `${l} (${counts[k]})`, href: `/admin/orders?status=${k}` })),
        ]}
      />
      <form className="adm-filters" action="/admin/orders">
        <input type="hidden" name="status" value={status} />
        <input type="search" name="s" defaultValue={q.s ?? ""} placeholder="訂單編號或 Email" />
        <button className="adm-btn">搜尋訂單</button>
      </form>
      {all === 0 ? <div className="adm-notice warn">目前沒有訂單。舊站的歷史訂單、顧客與優惠券會在取得資料庫備份後匯入；新站結帳產生的訂單（待付款）會出現在這裡。</div> : null}
      <table className="adm-table">
        <thead>
          <tr>
            <th>訂單</th>
            <th>日期</th>
            <th>狀態</th>
            <th>付款方式</th>
            <th className="num">總計</th>
          </tr>
        </thead>
        <tbody>
          {list.rows.map((o) => (
            <tr key={o.id}>
              <td>
                <a href={`/admin/orders/${o.id}`}>
                  <b>
                    #{o.number ?? o.id} {[o.billing?.last_name, o.billing?.first_name].filter(Boolean).join("")}
                  </b>
                </a>
                <div className="actions">{o.billing_email}</div>
              </td>
              <td>{dt(o.date_created)}</td>
              <td>
                <Badge s={o.status} label={ORDER_STATUSES[o.status] ?? o.status} />
              </td>
              <td>{o.payment_method_title || "—"}</td>
              <td className="num">{money(o.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pager total={list.total} page={list.page} per={list.per} base="/admin/orders" q={q} />
    </>
  );
}
