"use client";
import { useEffect, useState } from "react";
import { cartRequest, encPath, fetchCart, money, type Cart } from "./util";

export function EmptyCart() {
  return (
    <>
      <div className="woocommerce-content-wrapper">
        <div className="penci-empty-cart penci-empty-page penci-empty-page-text">
          <h3 className="penci-compare-empty-title">Your cart is currently empty.</h3>
          You don&apos;t have any products in the shop yet. <br /> You will find a lot of interesting products on our &quot;Shop&quot; page.
        </div>
      </div>
      <p className="return-to-shop">
        <a className="button wc-backward" href="/shop">
          回到商店
        </a>
      </p>
    </>
  );
}

export default function CartView({ initial }: { initial: Cart }) {
  const [cart, setCart] = useState<Cart>(initial);
  const [qtys, setQtys] = useState<Record<number, number>>({});
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [coupon, setCoupon] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const on = (e: Event) => setCart((e as CustomEvent<Cart>).detail);
    window.addEventListener("emily:cart", on);
    void fetchCart();
    return () => window.removeEventListener("emily:cart", on);
  }, []);

  async function run(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const r = await cartRequest(body);
      setNotice(r.error ? { text: r.error, error: true } : r.message ? { text: r.message } : null);
      setCart(r.cart);
      setQtys({});
    } finally {
      setBusy(false);
    }
  }

  async function update(e: React.FormEvent) {
    e.preventDefault();
    const changed = Object.entries(qtys).filter(([id, q]) => cart.items.find((i) => i.id === Number(id))?.quantity !== q);
    for (const [id, q] of changed) await run({ action: "set", item_id: Number(id), quantity: q });
    if (!changed.length && coupon.trim()) await applyCoupon();
    else if (changed.length) setNotice({ text: "購物車已更新。" });
  }
  async function applyCoupon() {
    await run({ action: "coupon", code: coupon.trim() });
    setCoupon("");
  }

  return (
    <div className="woocommerce">
      <div className="woocommerce-notices-wrapper">
        {notice && (
          <div className={notice.error ? "woocommerce-error" : "woocommerce-message"} role="alert">
            {notice.text}
          </div>
        )}
      </div>
      {cart.items.length === 0 ? (
        <EmptyCart />
      ) : (
        <>
          <form className="woocommerce-cart-form" action="/cart" method="post" onSubmit={update}>
            <table className="shop_table shop_table_responsive cart woocommerce-cart-form__contents" cellSpacing={0}>
              <thead>
                <tr>
                  <th className="product-remove">
                    <span className="screen-reader-text">移除項目</span>
                  </th>
                  <th className="product-thumbnail">
                    <span className="screen-reader-text">縮圖</span>
                  </th>
                  <th className="product-name">商品</th>
                  <th className="product-price">價格</th>
                  <th className="product-quantity">數量</th>
                  <th className="product-subtotal">小計</th>
                </tr>
              </thead>
              <tbody>
                {cart.items.map((it) => (
                  <tr key={it.id} className="woocommerce-cart-form__cart-item cart_item">
                    <td className="product-remove">
                      <a href="#" className="remove" aria-label={`從購物車中移除 ${it.name}`} onClick={(e) => (e.preventDefault(), run({ action: "remove", item_id: it.id }))}>
                        &times;
                      </a>
                    </td>
                    <td className="product-thumbnail">
                      <a href={encPath(it.link)}>
                        {it.image && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img width={300} height={300} src={it.image} className="attachment-woocommerce_thumbnail size-woocommerce_thumbnail" alt="" />
                        )}
                      </a>
                    </td>
                    <td className="product-name" data-title="商品">
                      <a href={encPath(it.link)}>{it.name}</a>
                      {Object.keys(it.variation).length > 0 && (
                        <dl className="variation">
                          {Object.entries(it.variation).map(([k, v]) => (
                            <span key={k}>
                              <dt>{k.replace(/^pa_/, "")}:</dt>
                              <dd>
                                <p>{v}</p>
                              </dd>
                            </span>
                          ))}
                        </dl>
                      )}
                    </td>
                    <td className="product-price" data-title="價格">
                      {it.unit_price < it.regular_unit ? (
                        <>
                          <del>{money(it.regular_unit)}</del> <ins>{money(it.unit_price)}</ins>
                        </>
                      ) : (
                        money(it.unit_price)
                      )}
                    </td>
                    <td className="product-quantity" data-title="數量">
                      {it.sold_individually ? (
                        <>1</>
                      ) : (
                        <div className="quantity">
                          <input type="button" value="-" className="minus" onClick={() => setQtys({ ...qtys, [it.id]: Math.max(0, (qtys[it.id] ?? it.quantity) - 1) })} />
                          <label className="screen-reader-text" htmlFor={`qty-${it.id}`}>
                            {it.name} 數量
                          </label>
                          <input
                            type="number"
                            id={`qty-${it.id}`}
                            className="input-text qty text"
                            step={1}
                            min={0}
                            max={it.max_qty ?? undefined}
                            value={qtys[it.id] ?? it.quantity}
                            onChange={(e) => setQtys({ ...qtys, [it.id]: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                            title="Qty"
                            size={4}
                            inputMode="numeric"
                          />
                          <input type="button" value="+" className="plus" onClick={() => setQtys({ ...qtys, [it.id]: (qtys[it.id] ?? it.quantity) + 1 })} />
                        </div>
                      )}
                    </td>
                    <td className="product-subtotal" data-title="小計">
                      {money(it.line_total)}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={6} className="actions">
                    <div className="coupon">
                      <label htmlFor="coupon_code" className="screen-reader-text">
                        優惠券：
                      </label>{" "}
                      <input type="text" name="coupon_code" className="input-text" id="coupon_code" value={coupon} onChange={(e) => setCoupon(e.target.value)} placeholder="優惠券代碼" />{" "}
                      <button type="button" className="button" name="apply_coupon" value="套用優惠券" onClick={applyCoupon} disabled={busy}>
                        套用優惠券
                      </button>
                    </div>
                    <button type="submit" className="button" name="update_cart" value="更新購物車" disabled={busy || Object.keys(qtys).length === 0}>
                      更新購物車
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </form>
          <div className="cart-collaterals">
            <div className="cart_totals">
              <h2>購物車總計</h2>
              <table cellSpacing={0} className="shop_table shop_table_responsive">
                <tbody>
                  <tr className="cart-subtotal">
                    <th>小計</th>
                    <td data-title="小計">{money(cart.subtotal)}</td>
                  </tr>
                  {cart.coupons.map((c) => (
                    <tr key={c.code} className={`cart-discount coupon-${c.code.toLowerCase()}`}>
                      <th>優惠券：{c.code}</th>
                      <td data-title={`優惠券：${c.code}`}>
                        -{money(c.amount)}{" "}
                        <a href="#" className="woocommerce-remove-coupon" onClick={(e) => (e.preventDefault(), run({ action: "remove_coupon", code: c.code }))}>
                          [移除]
                        </a>
                      </td>
                    </tr>
                  ))}
                  <tr className="order-total">
                    <th>總計</th>
                    <td data-title="總計">
                      <strong>{money(cart.total)}</strong>
                    </td>
                  </tr>
                </tbody>
              </table>
              <div className="wc-proceed-to-checkout">
                <a href="/checkout" className="checkout-button button alt wc-forward">
                  前往結帳
                </a>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function MiniCart() {
  const [cart, setCart] = useState<Cart | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      const c = (e as CustomEvent<Cart>).detail;
      setCart(c);
      document.querySelectorAll("[data-cart-count]").forEach((el) => (el.textContent = String(c.count)));
    };
    window.addEventListener("emily:cart", on);
    void fetchCart();
    return () => window.removeEventListener("emily:cart", on);
  }, []);
  if (!cart || cart.items.length === 0) return <p className="woocommerce-mini-cart__empty-message">購物車內沒有任何商品。</p>;
  return (
    <>
      <ul className="woocommerce-mini-cart cart_list product_list_widget">
        {cart.items.map((it) => (
          <li key={it.id} className="woocommerce-mini-cart-item mini_cart_item">
            <a href="#" className="remove remove_from_cart_button" aria-label={`從購物車中移除 ${it.name}`} onClick={(e) => (e.preventDefault(), cartRequest({ action: "remove", item_id: it.id }))}>
              &times;
            </a>
            <a href={encPath(it.link)}>
              {it.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img width={300} height={300} src={it.image} className="attachment-woocommerce_thumbnail size-woocommerce_thumbnail" alt="" />
              )}
              {it.name}
            </a>
            <span className="quantity">
              {it.quantity} &times; <span className="woocommerce-Price-amount amount">{money(it.unit_price)}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="woocommerce-mini-cart__total total">
        <strong>小計：</strong> <span className="woocommerce-Price-amount amount">{money(cart.subtotal)}</span>
      </p>
      <p className="woocommerce-mini-cart__buttons buttons">
        <a href="/cart" className="button wc-forward">
          查看購物車
        </a>
        <a href="/checkout" className="button checkout wc-forward">
          結帳
        </a>
      </p>
    </>
  );
}
