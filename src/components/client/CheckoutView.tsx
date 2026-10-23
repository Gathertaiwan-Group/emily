"use client";
import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { encPath, fetchCart, money, sbCfg, type Cart } from "./util";

const PAYMENTS = [
  { id: "bacs", title: "銀行轉帳", desc: "直接匯款至我們的銀行帳戶。請在付款備註中填入你的訂單編號，訂單款項到帳後才會出貨。" },
  { id: "cheque", title: "支票付款", desc: "請將支票寄送至商店地址。" },
  { id: "cod", title: "貨到付款", desc: "貨到時以現金付款。" },
  { id: "ry_newebpay_credit", title: "藍新金流 信用卡", desc: "使用藍新金流信用卡付款。" },
];

type F = { name: string; label: string; required?: boolean; type?: string; cls: string; autoComplete?: string; placeholder?: string };
const FIELDS: F[] = [
  { name: "billing_last_name", label: "姓氏", required: true, cls: "form-row-first", autoComplete: "family-name" },
  { name: "billing_first_name", label: "名字", required: true, cls: "form-row-last", autoComplete: "given-name" },
  { name: "billing_company", label: "公司名稱", cls: "form-row-wide", autoComplete: "organization" },
  { name: "billing_country", label: "國家/地區", required: true, cls: "form-row-wide address-field update_totals_on_change", type: "country" },
  { name: "billing_postcode", label: "郵遞區號", cls: "form-row-wide address-field", autoComplete: "postal-code" },
  { name: "billing_state", label: "縣/市", cls: "form-row-wide address-field", autoComplete: "address-level1" },
  { name: "billing_city", label: "鄉鎮市", required: true, cls: "form-row-wide address-field", autoComplete: "address-level2" },
  { name: "billing_address_1", label: "街道地址", required: true, cls: "form-row-wide address-field", autoComplete: "address-line1", placeholder: "門牌號碼與街道名稱" },
  { name: "billing_address_2", label: "公寓、套房、單位等", cls: "form-row-wide address-field", autoComplete: "address-line2", placeholder: "公寓、套房、單位等 (選填)" },
  { name: "billing_phone", label: "電話", required: true, cls: "form-row-wide", type: "tel", autoComplete: "tel" },
  { name: "billing_email", label: "電子郵件地址", required: true, cls: "form-row-wide", type: "email", autoComplete: "email" },
];

export default function CheckoutView({ initial }: { initial: Cart }) {
  const [cart, setCart] = useState<Cart>(initial);
  const [pm, setPm] = useState("bacs");
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState("");

  useEffect(() => {
    const on = (e: Event) => setCart((e as CustomEvent<Cart>).detail);
    window.addEventListener("emily:cart", on);
    void fetchCart();
    const cfg = sbCfg();
    if (cfg) {
      const sb = createClient(cfg.url, cfg.anon, { auth: { persistSession: true, storageKey: "emily-auth" } });
      sb.auth.getSession().then(({ data }) => {
        setToken(data.session?.access_token ?? null);
        if (data.session?.user.email) setEmail(data.session.user.email);
      });
    }
    return () => window.removeEventListener("emily:cart", on);
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body: Record<string, unknown> = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));
    body.access_token = token;
    setBusy(true);
    setErrors([]);
    try {
      const res = await fetch("/api/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json();
      if (!res.ok) {
        setErrors(j.errors ?? [j.error ?? "下單失敗"]);
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        window.dispatchEvent(new CustomEvent("emily:cart", { detail: { items: [], count: 0, subtotal: 0, discount: 0, total: 0, coupons: [], needs_shipping: false } }));
        location.href = encPath(j.redirect.split("?")[0]) + "?" + j.redirect.split("?")[1];
      }
    } catch {
      setErrors(["網路錯誤，請稍後再試。"]);
    } finally {
      setBusy(false);
    }
  }

  if (!cart.items.length) {
    return (
      <div className="woocommerce">
        <div className="woocommerce-notices-wrapper"></div>
        <div className="woocommerce-info">結帳前購物車是空的。</div>
        <p className="return-to-shop">
          <a className="button wc-backward" href="/shop">
            回到商店
          </a>
        </p>
      </div>
    );
  }

  return (
    <div className="woocommerce">
      <div className="woocommerce-notices-wrapper">
        {errors.length > 0 && (
          <ul className="woocommerce-error" role="alert">
            {errors.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="woocommerce-form-coupon-toggle">
        <div className="woocommerce-info">
          有優惠券嗎？ <a href="/cart" className="showcoupon">請在購物車頁面輸入你的優惠代碼</a>
        </div>
      </div>
      <form name="checkout" method="post" className="checkout woocommerce-checkout" action="/checkout" encType="multipart/form-data" onSubmit={submit} data-form="checkout">
        <div className="col2-set" id="customer_details">
          <div className="col-1">
            <div className="woocommerce-billing-fields">
              <h3>帳單詳細資料</h3>
              <div className="woocommerce-billing-fields__field-wrapper">
                {FIELDS.map((f) => (
                  <p key={f.name} className={`form-row ${f.cls}${f.required ? " validate-required" : ""}`} id={`${f.name}_field`}>
                    <label htmlFor={f.name} className={f.name === "billing_address_2" ? "screen-reader-text" : undefined}>
                      {f.label}&nbsp;{f.required ? <abbr className="required" title="必填">*</abbr> : <span className="optional">(選填)</span>}
                    </label>
                    <span className="woocommerce-input-wrapper">
                      {f.type === "country" ? (
                        <select name={f.name} id={f.name} className="country_to_state country_select" autoComplete="country" defaultValue="TW">
                          <option value="TW">台灣</option>
                          <option value="HK">香港</option>
                          <option value="MO">澳門</option>
                          <option value="CN">中國</option>
                          <option value="JP">日本</option>
                          <option value="US">美國</option>
                        </select>
                      ) : (
                        <input
                          type={f.type ?? "text"}
                          className="input-text"
                          name={f.name}
                          id={f.name}
                          placeholder={f.placeholder ?? ""}
                          autoComplete={f.autoComplete}
                          required={f.required}
                          defaultValue={f.name === "billing_email" ? email : undefined}
                          key={f.name === "billing_email" ? email : f.name}
                        />
                      )}
                    </span>
                  </p>
                ))}
              </div>
            </div>
          </div>
          <div className="col-2">
            <div className="woocommerce-additional-fields">
              <h3>額外資訊</h3>
              <div className="woocommerce-additional-fields__field-wrapper">
                <p className="form-row notes" id="order_comments_field">
                  <label htmlFor="order_comments">
                    訂單備註&nbsp;<span className="optional">(選填)</span>
                  </label>
                  <span className="woocommerce-input-wrapper">
                    <textarea name="order_comments" className="input-text" id="order_comments" placeholder="關於你的訂單的備註，例如：配送的特殊備註。" rows={2} cols={5}></textarea>
                  </span>
                </p>
              </div>
            </div>
          </div>
        </div>
        <h3 id="order_review_heading">您的訂單</h3>
        <div id="order_review" className="woocommerce-checkout-review-order">
          <table className="shop_table woocommerce-checkout-review-order-table">
            <thead>
              <tr>
                <th className="product-name">商品</th>
                <th className="product-total">小計</th>
              </tr>
            </thead>
            <tbody>
              {cart.items.map((it) => (
                <tr key={it.id} className="cart_item">
                  <td className="product-name">
                    {it.name}&nbsp;<strong className="product-quantity">&times;&nbsp;{it.quantity}</strong>
                  </td>
                  <td className="product-total">{money(it.line_total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="cart-subtotal">
                <th>小計</th>
                <td>{money(cart.subtotal)}</td>
              </tr>
              {cart.coupons.map((c) => (
                <tr key={c.code} className="cart-discount">
                  <th>優惠券：{c.code}</th>
                  <td>-{money(c.amount)}</td>
                </tr>
              ))}
              <tr className="order-total">
                <th>總計</th>
                <td>
                  <strong>{money(cart.total)}</strong>
                </td>
              </tr>
            </tfoot>
          </table>
          <div id="payment" className="woocommerce-checkout-payment">
            <ul className="wc_payment_methods payment_methods methods">
              {PAYMENTS.map((p) => (
                <li key={p.id} className={`wc_payment_method payment_method_${p.id}`}>
                  <input id={`payment_method_${p.id}`} type="radio" className="input-radio" name="payment_method" value={p.id} checked={pm === p.id} onChange={() => setPm(p.id)} />
                  <label htmlFor={`payment_method_${p.id}`}>{p.title}</label>
                  {pm === p.id && (
                    <div className={`payment_box payment_method_${p.id}`}>
                      <p>{p.desc}</p>
                      <p>
                        <small>（本站目前未串接線上金流：送出後會建立「待付款」訂單，我們將另行與您聯繫付款事宜。）</small>
                      </p>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <div className="form-row place-order">
              <div className="woocommerce-terms-and-conditions-wrapper">
                <div className="woocommerce-privacy-policy-text">
                  <p>
                    你的個人資料將用於處理此訂單、支援你在此網站中的使用體驗，以及用於
                    <a href="/%e9%9a%b1%e7%a7%81%e6%94%bf%e7%ad%96" className="woocommerce-privacy-policy-link" target="_blank">
                      隱私權政策
                    </a>
                    中說明的其他用途。
                  </p>
                </div>
              </div>
              <button type="submit" className={`button alt${busy ? " loading" : ""}`} name="woocommerce_checkout_place_order" id="place_order" value="下單購買" disabled={busy}>
                下單購買
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
