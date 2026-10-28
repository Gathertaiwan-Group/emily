import { requireAdmin } from "@/lib/admin/auth";
import { notFound } from "next/navigation";
import { ORDER_STATUSES, getOrder } from "@/lib/cms/commerce";
import { addOrderNote, saveOrderAddresses, setOrderStatus } from "../../../actions";
import { Notice, dt, money, sp, type SP } from "../../../components/ui";

export const metadata = { title: "訂單明細" };
const F: [string, string][] = [
  ["last_name", "姓"],
  ["first_name", "名"],
  ["company", "公司"],
  ["country", "國家"],
  ["postcode", "郵遞區號"],
  ["state", "縣市"],
  ["city", "鄉鎮市區"],
  ["address_1", "地址"],
  ["address_2", "地址 2"],
  ["phone", "電話"],
  ["email", "Email"],
];

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  await requireAdmin();
  const { id } = await params;
  const q = await sp(searchParams);
  const o = await getOrder(Number(id));
  if (!o) notFound();
  const lines = o.items.filter((i: any) => i.item_type === "line_item");
  const others = o.items.filter((i: any) => i.item_type !== "line_item");
  return (
    <>
      <h1 className="adm-h1">
        訂單 #{o.number ?? o.id}
        <a className="adm-btn" href="/admin/orders">
          返回列表
        </a>
      </h1>
      <Notice q={q} />
      <div className="adm-grid">
        <div>
          <div className="adm-card">
            <dl className="adm-kv">
              <dt>建立時間</dt>
              <dd>{dt(o.date_created)}</dd>
              <dt>付款方式</dt>
              <dd>{o.payment_method_title || o.payment_method || "—"}</dd>
              <dt>付款時間</dt>
              <dd>{dt(o.date_paid)}</dd>
              <dt>交易編號</dt>
              <dd>{o.transaction_id || "—"}</dd>
              <dt>顧客</dt>
              <dd>{o.customer_id ? <a href={`/admin/customers/${o.customer_id}`}>#{o.customer_id}</a> : "訪客"}</dd>
              <dt>建立來源</dt>
              <dd>{o.created_via || "—"}</dd>
            </dl>
          </div>
          {(o.meta?.newebpay || o.meta?.newebpay_MerchantOrderNo || o.payments.length > 0) && (
            <div className="adm-card">
              <h2 className="adm-h2">藍新金流交易資訊</h2>
              <dl className="adm-kv">
                <dt>商店訂單編號</dt>
                <dd>{o.meta?.newebpay?.MerchantOrderNo ?? o.meta?.newebpay_MerchantOrderNo ?? "—"}</dd>
                {o.meta?.newebpay &&
                  (
                    [
                      ["TradeNo", "藍新交易序號"],
                      ["PaymentType", "支付方式"],
                      ["Amt", "金額"],
                      ["PayTime", "付款時間"],
                      ["RespondCode", "回應碼"],
                      ["Auth", "授權碼"],
                      ["AuthBank", "收單銀行"],
                      ["Card6No", "卡號前六碼"],
                      ["Card4No", "卡號末四碼"],
                      ["Inst", "分期期數"],
                    ] as const
                  )
                    .filter(([k]) => o.meta.newebpay[k])
                    .map(([k, l]) => (
                      <div key={k} style={{ display: "contents" }}>
                        <dt>{l}</dt>
                        <dd>{String(o.meta.newebpay[k])}</dd>
                      </div>
                    ))}
              </dl>
              {o.payments.length > 0 && (
                <table className="adm-table">
                  <thead>
                    <tr>
                      <th>收到時間</th>
                      <th>狀態</th>
                      <th>處理結果</th>
                      <th className="num">金額</th>
                      <th>訊息</th>
                    </tr>
                  </thead>
                  <tbody>
                    {o.payments.map((p: any, i: number) => (
                      <tr key={i}>
                        <td>{dt(p.received_at)}</td>
                        <td>{p.status ?? "—"}</td>
                        <td>{p.outcome}</td>
                        <td className="num">{p.amount == null ? "—" : money(p.amount)}</td>
                        <td>{p.info?.Message ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
          <div className="adm-card">
            <h2 className="adm-h2">品項</h2>
            <table className="adm-table">
              <thead>
                <tr>
                  <th>商品</th>
                  <th className="num">單價</th>
                  <th className="num">數量</th>
                  <th className="num">小計</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((i: any) => (
                  <tr key={i.id}>
                    <td>
                      {i.product_id ? <a href={`/admin/products/${i.product_id}`}>{i.name}</a> : i.name}
                      {i.sku ? <div className="actions">SKU: {i.sku}</div> : null}
                      {i.meta && Object.keys(i.meta).length ? <div className="actions">{Object.entries(i.meta).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join("；")}</div> : null}
                    </td>
                    <td className="num">{money(i.unit_price ?? (i.quantity ? Number(i.subtotal) / i.quantity : null))}</td>
                    <td className="num">× {i.quantity}</td>
                    <td className="num">{money(i.total)}</td>
                  </tr>
                ))}
                {others.map((i: any) => (
                  <tr key={i.id}>
                    <td colSpan={3}>
                      {i.item_type === "shipping" ? "運送：" : i.item_type === "coupon" ? "優惠券：" : i.item_type === "fee" ? "費用：" : "稅："}
                      {i.name}
                    </td>
                    <td className="num">{money(i.item_type === "coupon" ? -Number(i.total || 0) : i.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} className="num">
                    小計
                  </td>
                  <td className="num">{money(o.subtotal)}</td>
                </tr>
                {Number(o.discount_total) ? (
                  <tr>
                    <td colSpan={3} className="num">
                      折扣
                    </td>
                    <td className="num">-{money(o.discount_total)}</td>
                  </tr>
                ) : null}
                <tr>
                  <td colSpan={3} className="num">
                    運費
                  </td>
                  <td className="num">{money(o.shipping_total)}</td>
                </tr>
                <tr>
                  <td colSpan={3} className="num">
                    <b>訂單總計</b>
                  </td>
                  <td className="num">
                    <b>{money(o.total)}</b>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <form action={saveOrderAddresses} className="adm-card">
            <input type="hidden" name="id" value={o.id} />
            <h2 className="adm-h2">帳單與運送資料</h2>
            <div className="adm-cols">
              {(["billing", "shipping"] as const).map((g) => (
                <div key={g}>
                  <h3 style={{ fontSize: 14 }}>{g === "billing" ? "帳單地址" : "運送地址"}</h3>
                  {F.filter(([k]) => g === "billing" || (k !== "email" && k !== "phone") || k === "phone").map(([k, l]) => (
                    <div key={k}>
                      <label className="adm-label">{l}</label>
                      <input name={`${g}_${k}`} defaultValue={o[g]?.[k] ?? ""} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <label className="adm-label">顧客備註</label>
            <textarea name="customer_note" defaultValue={o.customer_note ?? ""} rows={2} />
            <p>
              <button className="adm-btn primary">儲存資料</button>
            </p>
          </form>
        </div>
        <div>
          <form action={setOrderStatus} className="adm-card">
            <input type="hidden" name="id" value={o.id} />
            <h2 className="adm-h2">訂單狀態</h2>
            <select name="status" defaultValue={o.status}>
              {Object.entries(ORDER_STATUSES).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
            <label className="adm-label">附註（選填）</label>
            <input name="note" />
            <p className="adm-help">藍新金流訂單由付款通知自動更新；銀行轉帳／支票／貨到付款確認收款後請手動變更狀態。</p>
            <p>
              <button className="adm-btn primary">更新狀態</button>
            </p>
          </form>
          <div className="adm-card">
            <h2 className="adm-h2">訂單備註</h2>
            <form action={addOrderNote}>
              <input type="hidden" name="id" value={o.id} />
              <textarea name="content" rows={3} required />
              <label style={{ display: "block", margin: "4px 0" }}>
                <input type="checkbox" name="is_customer_note" />
                給顧客的備註
              </label>
              <button className="adm-btn small">新增備註</button>
            </form>
            {o.notes.map((n: any) => (
              <div key={n.id} style={{ background: n.is_customer_note ? "#a7cedc33" : "#f6f7f7", padding: 8, margin: "8px 0", fontSize: 13 }}>
                <div style={{ whiteSpace: "pre-wrap" }}>{n.content}</div>
                <div className="adm-help">
                  {dt(n.date)} · {n.added_by || "系統"}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
