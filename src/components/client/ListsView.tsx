"use client";
import { useEffect, useState } from "react";
import { cartRequest, encPath, lists, money } from "./util";

type P = {
  id: number;
  name: string;
  link: string;
  type: string;
  price: number | null;
  regular_price: number | null;
  sale_price: number | null;
  on_sale: boolean;
  stock_status: string;
  sku: string | null;
  short_description: string;
  image: { url: string } | null;
  cats: { name: string; link: string | null }[];
};

function useProducts(kind: "wishlist" | "compare") {
  const [items, setItems] = useState<P[] | null>(null);
  useEffect(() => {
    const load = () => {
      const ids = lists.get(kind);
      if (!ids.length) return setItems([]);
      fetch(`/api/products?ids=${ids.join(",")}`)
        .then((r) => r.json())
        .then(setItems)
        .catch(() => setItems([]));
    };
    load();
    window.addEventListener("emily:lists", load);
    return () => window.removeEventListener("emily:lists", load);
  }, [kind]);
  return items;
}

const Price = ({ p }: { p: P }) =>
  p.on_sale ? (
    <>
      <del>{money(Number(p.regular_price))}</del> <ins>{money(Number(p.sale_price))}</ins>
    </>
  ) : (
    <>{money(Number(p.price ?? p.regular_price ?? 0))}</>
  );

async function addSimple(p: P) {
  if (p.type !== "simple") return (location.href = encPath(p.link));
  const r = await cartRequest({ action: "add", product_id: p.id, quantity: 1 });
  if (r.error) alert(r.error);
  else document.body.classList.add("open-sidecart");
}

export function WishlistView() {
  const items = useProducts("wishlist");
  if (!items || items.length === 0)
    return (
      <div className="woocommerce">
        <div className="penci-wishlist-products-empty-text">
          <h3 className="penci-wishlist-empty-title">Wishlist is empty.</h3>
          You don&apos;t have any products in the wishlist yet. <br /> You will find a lot of interesting products on our &quot;Shop&quot; page.
        </div>
        <p className="return-to-shop">
          <a className="button" href="/shop">
            Return to shop
          </a>
        </p>
      </div>
    );
  return (
    <div className="woocommerce">
      <table className="shop_table shop_table_responsive penci-wishlist-table">
        <thead>
          <tr>
            <th className="product-remove"></th>
            <th className="product-thumbnail"></th>
            <th className="product-name">商品</th>
            <th className="product-price">價格</th>
            <th className="product-stock-status">庫存狀態</th>
            <th className="product-add-to-cart"></th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr key={p.id}>
              <td className="product-remove">
                <a href="#" className="remove" onClick={(e) => (e.preventDefault(), lists.toggle("wishlist", p.id, false))} aria-label="移除">
                  &times;
                </a>
              </td>
              <td className="product-thumbnail">
                {p.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.image.url} width={80} height={80} alt="" />
                )}
              </td>
              <td className="product-name">
                <a href={encPath(p.link)}>{p.name}</a>
              </td>
              <td className="product-price">
                <Price p={p} />
              </td>
              <td className="product-stock-status">{p.stock_status === "outofstock" ? "缺貨" : "有庫存"}</td>
              <td className="product-add-to-cart">
                <a href="#" className="button" onClick={(e) => (e.preventDefault(), addSimple(p))}>
                  {p.type === "simple" ? "加入購物車" : "選擇選項"}
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CompareView() {
  const items = useProducts("compare");
  if (!items || items.length === 0)
    return (
      <div className="penci-products-compare-table woocommerce">
        <div className="penci-empty-compare penci-empty-page penci-empty-page-text">
          <h3 className="penci-compare-empty-title">Compare list is empty.</h3>
          <p>
            No products added in the compare list. You must add some products to compare them.
            <br /> You will find a lot of interesting products on our &quot;Shop&quot; page.
          </p>
        </div>
        <p className="return-to-shop">
          <a className="button" href="/shop">
            Return to shop
          </a>
        </p>
      </div>
    );
  return (
    <div className="penci-products-compare-table woocommerce">
      <table className="shop_table penci-compare-table">
        <tbody>
          <tr>
            <th></th>
            {items.map((p) => (
              <td key={p.id}>
                <a href="#" className="penci-remove-compare" onClick={(e) => (e.preventDefault(), lists.toggle("compare", p.id, false))}>
                  移除
                </a>
                <br />
                {p.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.image.url} width={160} height={160} alt="" />
                )}
                <h4>
                  <a href={encPath(p.link)}>{p.name}</a>
                </h4>
              </td>
            ))}
          </tr>
          <tr>
            <th>價格</th>
            {items.map((p) => (
              <td key={p.id}>
                <Price p={p} />
              </td>
            ))}
          </tr>
          <tr>
            <th>描述</th>
            {items.map((p) => (
              <td key={p.id} dangerouslySetInnerHTML={{ __html: p.short_description }} />
            ))}
          </tr>
          <tr>
            <th>庫存</th>
            {items.map((p) => (
              <td key={p.id}>{p.stock_status === "outofstock" ? "缺貨" : "有庫存"}</td>
            ))}
          </tr>
          <tr>
            <th>貨號</th>
            {items.map((p) => (
              <td key={p.id}>{p.sku ?? "-"}</td>
            ))}
          </tr>
          <tr>
            <th></th>
            {items.map((p) => (
              <td key={p.id}>
                <a href="#" className="button" onClick={(e) => (e.preventDefault(), addSimple(p))}>
                  {p.type === "simple" ? "加入購物車" : "選擇選項"}
                </a>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
