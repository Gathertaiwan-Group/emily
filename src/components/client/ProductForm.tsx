"use client";
import { useMemo, useState } from "react";
import { cartRequest, money } from "./util";

type VF = {
  fields: { key: string; label: string; options: { value: string; label: string }[] }[];
  variations: { id: number; attributes: Record<string, string>; price: number | null; regular_price: number | null; sale_price: number | null; stock_status: string; sku: string | null }[];
} | null;

export default function ProductForm({
  product,
  variationForm,
  compact = false,
  onAdded,
}: {
  product: { id: number; name: string; link: string; type: string; soldIndividually: boolean; maxQty: number | null };
  variationForm: VF;
  compact?: boolean;
  onAdded?: () => void;
}) {
  const [qty, setQty] = useState(1);
  const [sel, setSel] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const variation = useMemo(() => {
    if (!variationForm) return null;
    if (variationForm.fields.some((f) => !sel[f.key])) return null;
    return (
      variationForm.variations.find((v) =>
        variationForm.fields.every((f) => {
          const want = v.attributes[f.key] ?? v.attributes[`attribute_${f.key}`] ?? "";
          return want === "" || want === sel[f.key];
        }),
      ) ?? null
    );
  }, [variationForm, sel]);
  const max = product.soldIndividually ? 1 : product.maxQty ?? undefined;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (variationForm && !variation) {
      setMsg({ text: "請選擇商品選項後再加入購物車。", error: true });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await cartRequest({ action: "add", product_id: product.id, quantity: qty, variation_id: variation?.id ?? null, variation: variation ? sel : {} });
      if (r.error) setMsg({ text: r.error, error: true });
      else {
        setMsg({ text: r.message ?? "已加入購物車" });
        onAdded?.();
        document.body.classList.add("open-sidecart");
      }
    } catch {
      setMsg({ text: "網路錯誤，請稍後再試。", error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={`cart${variationForm ? " variations_form" : ""}`} action={product.link} method="post" encType="multipart/form-data" onSubmit={add} data-form="add-to-cart">
      {variationForm && (
        <table className="variations" cellSpacing={0} role="presentation">
          <tbody>
            {variationForm.fields.map((f) => (
              <tr key={f.key}>
                <th className="label">
                  <label htmlFor={`${f.key}-${product.id}`}>{f.label}</label>
                </th>
                <td className="value">
                  <select id={`${f.key}-${product.id}`} name={`attribute_${f.key}`} value={sel[f.key] ?? ""} onChange={(e) => setSel({ ...sel, [f.key]: e.target.value })}>
                    <option value="">選擇一個選項</option>
                    {f.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {f === variationForm.fields[variationForm.fields.length - 1] && Object.keys(sel).length > 0 && (
                    <a className="reset_variations" href="#" onClick={(e) => (e.preventDefault(), setSel({}))}>
                      清除
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {variation && (
        <div className="woocommerce-variation single_variation">
          <div className="woocommerce-variation-price">
            <span className="price">
              {variation.sale_price != null && variation.regular_price != null && variation.sale_price < variation.regular_price ? (
                <>
                  <del>{money(variation.regular_price)}</del> <ins>{money(variation.sale_price)}</ins>
                </>
              ) : (
                money(Number(variation.price ?? variation.regular_price ?? 0))
              )}
            </span>
          </div>
          <div className="woocommerce-variation-availability">
            <p className={`stock ${variation.stock_status === "outofstock" ? "out-of-stock" : "in-stock"}`}>{variation.stock_status === "outofstock" ? "缺貨" : variation.stock_status === "onbackorder" ? "可預購" : "有庫存"}</p>
          </div>
        </div>
      )}
      {!product.soldIndividually && (
        <div className="quantity">
          <input type="button" value="-" className="minus" onClick={() => setQty(Math.max(1, qty - 1))} />
          <label className="screen-reader-text" htmlFor={`quantity_${product.id}${compact ? "_qv" : ""}`}>
            {product.name} 數量
          </label>
          <input
            type="number"
            id={`quantity_${product.id}${compact ? "_qv" : ""}`}
            className="input-text qty text"
            step={1}
            min={1}
            max={max}
            name="quantity"
            value={qty}
            title="Qty"
            size={4}
            inputMode="numeric"
            onChange={(e) => setQty(Math.max(1, Math.min(max ?? 9999, Math.floor(Number(e.target.value) || 1))))}
          />
          <input type="button" value="+" className="plus" onClick={() => setQty(Math.min(max ?? 9999, qty + 1))} />
        </div>
      )}
      <button type="submit" name="add-to-cart" value={product.id} className={`single_add_to_cart_button button alt${busy ? " loading" : ""}`} disabled={busy || (variation?.stock_status === "outofstock")}>
        加入購物車
      </button>
      {msg && (
        <p className={`penci-notice${msg.error ? " error" : ""}`} role="status" style={{ marginTop: 15, width: "100%" }}>
          {msg.text}
          {!msg.error && (
            <>
              {" "}
              <a href="/cart" className="button wc-forward" style={{ marginLeft: 8 }}>
                查看購物車
              </a>
            </>
          )}
        </p>
      )}
    </form>
  );
}
