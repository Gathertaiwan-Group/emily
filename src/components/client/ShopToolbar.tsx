"use client";
import { logForm } from "./util";

export default function ShopToolbar({ orderby }: { orderby: string }) {
  return (
    <form
      className="woocommerce-ordering"
      method="get"
      data-form="ordering"
      onChange={(e) => {
        const f = e.currentTarget;
        logForm("ordering", { orderby: (f.elements.namedItem("orderby") as HTMLSelectElement).value });
        const sp = new URLSearchParams(location.search);
        sp.set("orderby", (f.elements.namedItem("orderby") as HTMLSelectElement).value);
        sp.delete("paged");
        location.href = location.pathname.replace(/\/page\/\d+$/, "") + "?" + sp.toString();
      }}
    >
      <select name="orderby" className="orderby" aria-label="商店訂單" defaultValue={orderby}>
        <option value="menu_order">預設排序</option>
        <option value="popularity">依熱銷度</option>
        <option value="date">依最新項目排序</option>
        <option value="price">依價格排序:低至高</option>
        <option value="price-desc">依價格排序:高至低</option>
      </select>
      <input type="hidden" name="paged" value="1" />
    </form>
  );
}
