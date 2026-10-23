import { listRules } from "@/lib/cms/commerce";
import { listTerms } from "@/lib/cms/terms";
import { db } from "@/lib/db";
import { deleteRule, saveRule } from "../../actions";
import { ConfirmButton } from "../../components/ConfirmButton";
import { Notice, dt, localInput, money, sp, type SP } from "../../components/ui";

export const metadata = { title: "數量折扣" };
const TYPE: Record<string, string> = { percent: "百分比", fixed_per_item: "每件折抵", fixed_price: "固定單價" };

export default async function DiscountsPage({ searchParams }: { searchParams: SP }) {
  const q = await sp(searchParams);
  const [rules, prods, cats] = await Promise.all([listRules(), db().from("products").select("id,name").neq("status", "trash").order("name"), listTerms("product_cat")]);
  const edit = q.edit ? rules.find((r) => r.id === Number(q.edit)) : null;
  const r = edit ?? { enabled: true, priority: 10, applies_to: "products", product_ids: [], category_ids: [], discount_type: "percent" };
  return (
    <>
      <h1 className="adm-h1">數量折扣規則</h1>
      <p className="adm-help">對應舊站的數量階梯折扣（買越多單價越低）。前台商品頁與購物車會依規則計算單價。</p>
      <Notice q={q} />
      <table className="adm-table" style={{ marginBottom: 16 }}>
        <thead>
          <tr>
            <th>名稱</th>
            <th>適用</th>
            <th>數量</th>
            <th>折扣</th>
            <th>期間</th>
            <th>狀態</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((x) => (
            <tr key={x.id}>
              <td>
                <a href={`/admin/discounts?edit=${x.id}`}>{x.name}</a>
                <div className="actions">
                  <form action={deleteRule} style={{ display: "inline" }}>
                    <input type="hidden" name="id" value={x.id} />
                    <ConfirmButton message="刪除此規則？">刪除</ConfirmButton>
                  </form>
                </div>
              </td>
              <td>{x.applies_to === "all" ? "全部商品" : x.applies_to === "products" ? `商品 ${x.product_ids.join(", ")}` : `分類 ${x.category_ids.join(", ")}`}</td>
              <td>
                {x.min_qty}
                {x.max_qty ? `–${x.max_qty}` : "+"}
              </td>
              <td>{x.discount_type === "percent" ? `${Number(x.amount)}%` : `${TYPE[x.discount_type]} ${money(x.amount)}`}</td>
              <td>
                {x.date_from ? dt(x.date_from) : "—"} ~ {x.date_to ? dt(x.date_to) : "—"}
              </td>
              <td>{x.enabled ? "啟用" : "停用"}</td>
            </tr>
          ))}
          {!rules.length ? (
            <tr>
              <td colSpan={6}>尚無規則。</td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <form action={saveRule} className="adm-card">
        <h2 className="adm-h2">{edit ? `編輯「${edit.name}」` : "新增規則"}</h2>
        {edit ? <input type="hidden" name="id" value={edit.id} /> : null}
        <div className="adm-cols">
          <div>
            <label className="adm-label">名稱</label>
            <input name="name" defaultValue={(r as any).name ?? ""} required />
          </div>
          <div>
            <label className="adm-label">適用範圍</label>
            <select name="applies_to" defaultValue={r.applies_to}>
              <option value="all">全部商品</option>
              <option value="products">指定商品</option>
              <option value="categories">指定分類</option>
            </select>
          </div>
          <div>
            <label className="adm-label">最低數量</label>
            <input type="number" min="1" name="min_qty" defaultValue={(r as any).min_qty ?? 2} required />
          </div>
          <div>
            <label className="adm-label">最高數量（選填）</label>
            <input type="number" min="1" name="max_qty" defaultValue={(r as any).max_qty ?? ""} />
          </div>
          <div>
            <label className="adm-label">折扣方式</label>
            <select name="discount_type" defaultValue={r.discount_type}>
              <option value="percent">百分比</option>
              <option value="fixed_per_item">每件折抵金額</option>
              <option value="fixed_price">固定單價</option>
            </select>
          </div>
          <div>
            <label className="adm-label">數值</label>
            <input type="number" step="0.01" min="0" name="amount" defaultValue={(r as any).amount ?? ""} required />
          </div>
          <div>
            <label className="adm-label">優先順序</label>
            <input type="number" name="priority" defaultValue={r.priority} />
          </div>
          <div>
            <label className="adm-label">開始</label>
            <input type="datetime-local" name="date_from" defaultValue={localInput((r as any).date_from)} />
          </div>
          <div>
            <label className="adm-label">結束</label>
            <input type="datetime-local" name="date_to" defaultValue={localInput((r as any).date_to)} />
          </div>
          <div>
            <label className="adm-label">指定商品</label>
            <select name="product_ids" multiple defaultValue={(r.product_ids ?? []).map(String)} style={{ minHeight: 80 }}>
              {((prods.data ?? []) as any[]).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="adm-label">指定分類</label>
            <select name="category_ids" multiple defaultValue={(r.category_ids ?? []).map(String)} style={{ minHeight: 80 }}>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <label style={{ display: "block", marginTop: 10 }}>
          <input type="checkbox" name="enabled" defaultChecked={r.enabled} />
          啟用
        </label>
        <p className="adm-row">
          <button className="adm-btn primary">{edit ? "更新規則" : "新增規則"}</button>
          {edit ? <a href="/admin/discounts">取消</a> : null}
        </p>
      </form>
    </>
  );
}
