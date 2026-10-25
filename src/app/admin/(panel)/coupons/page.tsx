import { requireAdmin } from "@/lib/admin/auth";
import { listCoupons } from "@/lib/cms/commerce";
import { Notice, dt, money, sp, type SP } from "../../components/ui";

export const metadata = { title: "優惠券" };
const TYPE: Record<string, string> = { percent: "百分比折扣", fixed_cart: "購物車固定折扣", fixed_product: "商品固定折扣" };

export default async function CouponsPage({ searchParams }: { searchParams: SP }) {
  await requireAdmin();
  const q = await sp(searchParams);
  const rows = await listCoupons();
  return (
    <>
      <h1 className="adm-h1">
        優惠券
        <a className="adm-btn" href="/admin/coupons/new">
          新增優惠券
        </a>
      </h1>
      <Notice q={q} />
      {!rows.length ? <div className="adm-notice warn">目前沒有優惠券；舊站優惠券會在取得資料庫備份後匯入，也可以在這裡新增。</div> : null}
      <table className="adm-table">
        <thead>
          <tr>
            <th>代碼</th>
            <th>折扣類型</th>
            <th className="num">金額</th>
            <th>描述</th>
            <th>使用／上限</th>
            <th>到期日</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td>
                <a href={`/admin/coupons/${c.id}`}>
                  <b>{c.code}</b>
                </a>
                {c.status !== "publish" ? <span className="adm-badge draft">{c.status}</span> : null}
              </td>
              <td>{TYPE[c.discount_type] ?? c.discount_type}</td>
              <td className="num">{c.discount_type === "percent" ? `${Number(c.amount)}%` : money(c.amount)}</td>
              <td>{c.description}</td>
              <td>
                {c.usage_count} / {c.usage_limit ?? "∞"}
              </td>
              <td>{dt(c.date_expires)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
