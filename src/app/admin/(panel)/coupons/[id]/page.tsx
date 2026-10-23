import { notFound } from "next/navigation";
import { getCoupon } from "@/lib/cms/commerce";
import { listTerms } from "@/lib/cms/terms";
import { db } from "@/lib/db";
import { deleteCoupon, saveCoupon } from "../../../actions";
import { ConfirmButton } from "../../../components/ConfirmButton";
import { Notice, localInput, sp, type SP } from "../../../components/ui";

export const metadata = { title: "優惠券" };

export default async function CouponPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const q = await sp(searchParams);
  const isNew = id === "new";
  const c = isNew ? { discount_type: "fixed_cart", amount: 0, status: "publish", product_ids: [], excluded_product_ids: [], product_category_ids: [], excluded_product_category_ids: [], email_restrictions: [] } : await getCoupon(Number(id));
  if (!c) notFound();
  const [prods, cats] = await Promise.all([db().from("products").select("id,name").neq("status", "trash").order("name"), listTerms("product_cat")]);
  const P = (prods.data ?? []) as { id: number; name: string }[];
  const Multi = ({ name, opts, sel }: { name: string; opts: { id: number; name: string }[]; sel: number[] }) => (
    <select name={name} multiple defaultValue={(sel ?? []).map(String)} style={{ minHeight: 90 }}>
      {opts.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
  return (
    <>
      <h1 className="adm-h1">
        {isNew ? "新增優惠券" : `編輯優惠券 ${c.code}`}
        <a className="adm-btn" href="/admin/coupons">
          返回列表
        </a>
      </h1>
      <Notice q={q} />
      <form action={saveCoupon} className="adm-card">
        {!isNew ? <input type="hidden" name="id" value={c.id} /> : null}
        <div className="adm-cols">
          <div>
            <label className="adm-label">優惠碼</label>
            <input name="code" defaultValue={c.code ?? ""} required />
          </div>
          <div>
            <label className="adm-label">折扣類型</label>
            <select name="discount_type" defaultValue={c.discount_type}>
              <option value="percent">百分比折扣</option>
              <option value="fixed_cart">購物車固定折扣</option>
              <option value="fixed_product">商品固定折扣</option>
            </select>
          </div>
          <div>
            <label className="adm-label">折扣金額／百分比</label>
            <input type="number" step="0.01" min="0" name="amount" defaultValue={c.amount ?? 0} />
          </div>
          <div>
            <label className="adm-label">到期日（台北時間）</label>
            <input type="datetime-local" name="date_expires" defaultValue={localInput(c.date_expires)} />
          </div>
          <div>
            <label className="adm-label">狀態</label>
            <select name="status" defaultValue={c.status}>
              <option value="publish">啟用</option>
              <option value="draft">停用（草稿）</option>
            </select>
          </div>
        </div>
        <label className="adm-label">描述</label>
        <textarea name="description" defaultValue={c.description ?? ""} rows={2} />
        <h2 className="adm-h2" style={{ marginTop: 14 }}>
          使用限制
        </h2>
        <div className="adm-cols">
          <div>
            <label className="adm-label">最低消費</label>
            <input type="number" step="0.01" name="minimum_amount" defaultValue={c.minimum_amount ?? ""} />
          </div>
          <div>
            <label className="adm-label">最高消費</label>
            <input type="number" step="0.01" name="maximum_amount" defaultValue={c.maximum_amount ?? ""} />
          </div>
          <div>
            <label className="adm-label">總使用次數上限</label>
            <input type="number" name="usage_limit" defaultValue={c.usage_limit ?? ""} />
          </div>
          <div>
            <label className="adm-label">每位使用者上限</label>
            <input type="number" name="usage_limit_per_user" defaultValue={c.usage_limit_per_user ?? ""} />
          </div>
          <div>
            <label className="adm-label">限用商品件數</label>
            <input type="number" name="limit_usage_to_x_items" defaultValue={c.limit_usage_to_x_items ?? ""} />
          </div>
        </div>
        <div className="adm-row" style={{ marginTop: 10, gap: 16 }}>
          <label>
            <input type="checkbox" name="individual_use" defaultChecked={!!c.individual_use} />
            不可與其他優惠券合併
          </label>
          <label>
            <input type="checkbox" name="exclude_sale_items" defaultChecked={!!c.exclude_sale_items} />
            排除特價商品
          </label>
          <label>
            <input type="checkbox" name="free_shipping" defaultChecked={!!c.free_shipping} />
            免運費
          </label>
        </div>
        <div className="adm-cols" style={{ marginTop: 10 }}>
          <div>
            <label className="adm-label">適用商品</label>
            {Multi({ name: "product_ids", opts: P, sel: c.product_ids })}
          </div>
          <div>
            <label className="adm-label">排除商品</label>
            {Multi({ name: "excluded_product_ids", opts: P, sel: c.excluded_product_ids })}
          </div>
          <div>
            <label className="adm-label">適用商品分類</label>
            {Multi({ name: "product_category_ids", opts: cats, sel: c.product_category_ids })}
          </div>
          <div>
            <label className="adm-label">排除商品分類</label>
            {Multi({ name: "excluded_product_category_ids", opts: cats, sel: c.excluded_product_category_ids })}
          </div>
        </div>
        <label className="adm-label">限定 Email（以逗號分隔）</label>
        <input name="email_restrictions" defaultValue={(c.email_restrictions ?? []).join(", ")} />
        <p className="adm-row" style={{ marginTop: 14 }}>
          <button className="adm-btn primary">{isNew ? "建立優惠券" : "更新"}</button>
          {!isNew ? (
            <ConfirmButton message="刪除此優惠券？" formAction={deleteCoupon}>
              刪除
            </ConfirmButton>
          ) : null}
          {!isNew ? <span className="adm-help">已使用 {c.usage_count} 次</span> : null}
        </p>
      </form>
    </>
  );
}
