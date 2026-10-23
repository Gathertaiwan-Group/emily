import { getAllProducts, getQtyRules, getTerms, isOnSale, rulesForProduct, variationForm, type ProductFull, type Term } from "@/lib/data";
import { transformContent } from "@/lib/content";
import { priceHtml } from "@/lib/format";
import { PRODUCTS_PER_PAGE_DEFAULT, SITE_URL } from "@/lib/site";
import { FollowUs, Sidebar } from "./Blog";
import { href, ShareLinks } from "./Shell";
import ProductForm from "./client/ProductForm";
import ShopToolbar from "./client/ShopToolbar";

export function PriceHtml({ p }: { p: ProductFull }) {
  if (p.price == null && p.regular_price == null) return null;
  const html = isOnSale(p)
    ? `<del aria-hidden="true">${priceHtml(p.regular_price)}</del> <span class="screen-reader-text">原始價格為：${p.regular_price}。</span><ins aria-hidden="true">${priceHtml(p.sale_price)}</ins><span class="screen-reader-text">目前價格為：${p.sale_price}。</span>`
    : priceHtml(p.price ?? p.regular_price);
  return <span dangerouslySetInnerHTML={{ __html: html }} style={{ display: "contents" }} />;
}

function stockClass(p: ProductFull) {
  return p.stock_status === "instock" ? "instock" : p.stock_status === "onbackorder" ? "onbackorder" : "outofstock";
}

function productClasses(p: ProductFull, extra = "") {
  return [
    "product",
    "type-product",
    `post-${p.id}`,
    "status-publish",
    stockClass(p),
    ...p.cats.map((c) => `product_cat-${c.slug}`),
    ...p.tags.map((c) => `product_tag-${c.slug}`),
    p.image ? "has-post-thumbnail" : "",
    isOnSale(p) ? "sale" : "",
    p.virtual ? "virtual" : "",
    p.purchasable ? "purchasable" : "",
    `product-type-${p.type}`,
    extra,
  ]
    .filter(Boolean)
    .join(" ");
}

export function ProductLoopItem({ p, first }: { p: ProductFull; first?: boolean }) {
  const url = href(p.link_path);
  const img = p.image;
  const hover = p.gallery[0] ?? img;
  return (
    <li className={productClasses(p, `${first ? "first " : ""}penci-share-style-1 penci-share-icon-style-circle no-product-gallery`)}>
      <div className="penci-soledad-product style-6">
        <div className="penci-product-loop-inner-content">
          <div className="penci-product-loop-top">
            <div className="penci-product-loop-image">
              {isOnSale(p) && <span className="onsale">特價!</span>}
              <a className="penci-main-loop-image" href={url}>
                {img && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img width={300} height={300} src={img.public_url} className="attachment-woocommerce_thumbnail size-woocommerce_thumbnail" alt={p.name} decoding="async" loading="lazy" />
                )}
              </a>
              <div className="quick-shop-wrapper">
                <div className="quick-shop-close">
                  <a href="#" rel="nofollow noopener"></a>
                </div>
                <div className="quick-shop-form" data-pid={p.id}></div>
              </div>
              <div className="penci-image-loader"></div>
              {hover && (
                <div className="hover-img">
                  <a href={url}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img width={300} height={300} src={hover.public_url} className="attachment-woocommerce_thumbnail size-woocommerce_thumbnail" alt="" decoding="async" loading="lazy" />
                  </a>
                </div>
              )}
            </div>
            <div className="penci-product-loop-buttons">
              <div className="penci-product-loop-button">
                {p.type === "simple" && p.purchasable && p.stock_status !== "outofstock" ? (
                  <a
                    href={`?add-to-cart=${p.id}`}
                    data-quantity="1"
                    className="button product_type_simple add_to_cart_button ajax_add_to_cart"
                    data-product_id={p.id}
                    data-product_sku={p.sku ?? ""}
                    aria-label={`加入購物車：「${p.name}」`}
                    rel="nofollow"
                    role="button"
                  >
                    加入購物車
                  </a>
                ) : (
                  <a href={url} className={`button product_type_${p.type}`} aria-label={`閱讀更多關於「${p.name}」`} rel="nofollow">
                    {p.type === "variable" ? "選擇選項" : "閱讀更多"}
                  </a>
                )}
                <a title="Quick view" href="#" data-pid={p.id} className="penci-quickview-button button">
                  Quick View
                </a>
                <a title="Add to Wishlist" href={`?add-to-wishlist=${p.id}`} data-pid={p.id} className="penci-addtowishlist button ">
                  Add to Wishlist
                </a>
                <a data-method="add" href={`?add-to-compare=${p.id}`} className="button compare penci-compare" data-pid={p.id}>
                  Add to Compare
                </a>
              </div>
            </div>
          </div>
          <div className="penci-product-loop-title">
            <h3 className="woocommerce-loop-product__title penci-loop-title">
              <a href={url}>{p.name}</a>
            </h3>
            <div className="penci-product-cats">
              {p.cats.map((c) => (
                <a key={c.id} href={href(c.link_path ?? "")} rel="tag">
                  {c.name}
                </a>
              ))}
            </div>
            <span className="price">
              <PriceHtml p={p} />
            </span>
          </div>
        </div>
      </div>
    </li>
  );
}

function PriceFilter({ id, min, max, cur, action, h = "h4" }: { id: string; min: number; max: number; cur: { min?: string; max?: string }; action: string; h?: "h3" | "h4" }) {
  const H = h;
  return (
    <aside id={id} className="widget woocommerce widget_price_filter">
      <H className="widget-title penci-border-arrow">
        <span className="inner-arrow">Filter by price</span>
      </H>
      <form method="get" action={action} data-form="product-price-filter">
        <div className="price_slider_wrapper">
          <div className="price_slider_amount" data-step="10">
            <label className="screen-reader-text" htmlFor={`${id}-min`}>
              最低價格
            </label>
            <input type="text" id={`${id}-min`} name="min_price" defaultValue={cur.min ?? String(min)} data-min={min} placeholder="最低價格" />
            <label className="screen-reader-text" htmlFor={`${id}-max`}>
              最高價格
            </label>
            <input type="text" id={`${id}-max`} name="max_price" defaultValue={cur.max ?? String(max)} data-max={max} placeholder="最高價格" />
            <button type="submit" className="button">
              篩選
            </button>
            <div className="clear"></div>
          </div>
        </div>
      </form>
    </aside>
  );
}

export async function ShopArchive({ term, page, search, title }: { term?: Term; page: number; search: URLSearchParams; title: string }) {
  const [all, { all: terms }] = await Promise.all([getAllProducts(), getTerms()]);
  const visible = all.filter((p) => p.catalog_visibility === "visible" || p.catalog_visibility === "catalog");
  let list = visible;
  if (term) list = list.filter((p) => (term.taxonomy === "product_cat" ? p.cats : p.tags).some((c) => c.id === term.id || c.parent_id === term.id));
  const prices = visible.map((p) => Number(p.price ?? 0));
  const pmin = prices.length ? Math.floor(Math.min(...prices) / 10) * 10 : 0;
  const pmax = prices.length ? Math.ceil(Math.max(...prices) / 10) * 10 : 0;
  const minP = search.get("min_price");
  const maxP = search.get("max_price");
  if (minP) list = list.filter((p) => Number(p.price ?? 0) >= Number(minP));
  if (maxP) list = list.filter((p) => Number(p.price ?? 0) <= Number(maxP));
  const orderby = search.get("orderby") ?? "menu_order";
  const sorted = [...list];
  if (orderby === "price") sorted.sort((a, b) => Number(a.price) - Number(b.price));
  else if (orderby === "price-desc") sorted.sort((a, b) => Number(b.price) - Number(a.price));
  else if (orderby === "date") sorted.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  else if (orderby === "popularity") sorted.sort((a, b) => b.total_sales - a.total_sales);
  else if (orderby === "rating") sorted.sort((a, b) => b.average_rating - a.average_rating);
  else sorted.sort((a, b) => a.menu_order - b.menu_order || a.name.localeCompare(b.name));
  const perPage = [12, 24, 36].includes(Number(search.get("per_page"))) ? Number(search.get("per_page")) : PRODUCTS_PER_PAGE_DEFAULT;
  const perRow = [2, 3, 4].includes(Number(search.get("per_row"))) ? Number(search.get("per_row")) : 4;
  const view = search.get("shop_view") === "list" ? "list" : "grid";
  const totalPages = Math.max(1, Math.ceil(sorted.length / perPage));
  const items = sorted.slice((page - 1) * perPage, page * perPage);
  const productCats = terms.filter((t) => t.taxonomy === "product_cat").sort((a, b) => a.id - b.id);
  const base = term?.link_path ?? "/shop";
  const qs = (patch: Record<string, string | null>) => {
    const sp = new URLSearchParams(search);
    for (const [k, v] of Object.entries(patch)) {
      if (v == null) sp.delete(k);
      else sp.set(k, v);
    }
    const s = sp.toString();
    return s ? `?${s}` : "";
  };
  const pageUrl = (n: number) => `${href(base)}${n > 1 ? `/page/${n}` : ""}${qs({})}`;
  const active: { label: string; url: string }[] = [];
  if (minP) active.push({ label: `最低 ${minP}`, url: href(base) + qs({ min_price: null }) });
  if (maxP) active.push({ label: `最高 ${maxP}`, url: href(base) + qs({ max_price: null }) });

  return (
    <div className="pagination container penci-woo-page-container right-sidebar">
      <div id="main">
        <div className="theiaStickySidebar">
          <header className="woocommerce-products-header">
            <div id="penci-top-product-filter" className="penci-top-product-filter">
              <PriceFilter id="woocommerce_price_filter-5" min={pmin} max={pmax} cur={{ min: minP ?? undefined, max: maxP ?? undefined }} action={href(base)} />
              <aside id="woocommerce_product_categories-3" className="widget woocommerce widget_product_categories">
                <h4 className="widget-title penci-border-arrow">
                  <span className="inner-arrow">Categories</span>
                </h4>
                <ul className="product-categories">
                  {productCats.map((c) => (
                    <li key={c.id} className={`cat-item cat-item-${c.id}${term?.id === c.id ? " current-cat" : ""}`}>
                      <a href={href(c.link_path ?? "")}>{c.name}</a> <span className="count">({visible.filter((p) => p.cats.some((x) => x.id === c.id)).length})</span>
                    </li>
                  ))}
                </ul>
              </aside>
            </div>
            <div className="page-description">
              {term?.description ? <div dangerouslySetInnerHTML={{ __html: transformContent(term.description) }} /> : <p></p>}
            </div>
            <div className="penci-woo-before-main-content">
              <div className="penci-woo-before-main-inner-content content-left">
                <div className="container penci-breadcrumb penci-woo-breadcrumb top">
                  <span>
                    <a href="/">Home</a>
                  </span>
                  <i className="penci-faicon fa fa-angle-right"></i>
                  <span>{term ? (term.taxonomy === "product_tag" ? `商品標籤為 “${title}”` : title) : "SHOP"}</span>
                </div>
              </div>
              <div className="penci-woo-before-main-inner-content content-right">
                <div className="penci-wofilter-inner">
                  <div className="penci-products-per-page">
                    <span className="per-page-title">Show </span>
                    {[12, 24, 36].map((n) => (
                      <a key={n} rel="nofollow noopener" href={`${href(base)}${qs({ per_page: String(n) })}`} className={`per-page-variation${n === perPage ? " current-variation" : ""}`}>
                        <span>{n}</span>
                      </a>
                    ))}
                  </div>
                  <div className="penci-products-shop-view products-view-grid_list">
                    <a rel="nofollow noopener" href={`${href(base)}${qs({ shop_view: "list", per_row: null })}`} className={`shop-view per-row-list${view === "list" ? " current-variation" : ""}`} aria-label="List view">
                      <svg className="icon">
                        <use xlinkHref="#list" />
                      </svg>
                    </a>
                    {[2, 3, 4].map((n) => (
                      <a
                        key={n}
                        title={`Show ${n} columns`}
                        rel="nofollow noopener"
                        href={`${href(base)}${qs({ shop_view: "grid", per_row: String(n) })}`}
                        className={`shop-view${view === "grid" && perRow === n ? " current-variation" : ""} per-row-${n}`}
                      >
                        <svg className="icon">
                          <use xlinkHref={`#columns-${n}`} />
                        </svg>
                      </a>
                    ))}
                    <ShopIcons />
                  </div>
                  <div className="penci-product-top-filter-button">
                    <a className="penci-filter-button" title="Sidebar Filter" href="#penci-top-product-filter">
                      <i>
                        <svg enableBackground="new 0 0 512 512" height={20} viewBox="0 0 512 512" width={20} xmlns="http://www.w3.org/2000/svg">
                          <g>
                            <path d="m90.5 0h-30v362h-30v90h30v60h30v-60h30v-90h-30zm0 422h-30v-30h30z" />
                            <path d="m481.5 362h-30v-362h-30v362h-30v90h30v60h30v-60h30zm-30 60h-30v-30h30z" />
                            <path d="m331.5 0h-30v222h-30v90h30v200h30v-200h30v-90h-30zm0 282h-30v-30h30z" />
                            <path d="m210.5 0h-30v53.652h-30v90h30v368.348h30v-368.348h30v-90h-30zm0 113.652h-30v-30h30z" />
                          </g>
                        </svg>
                      </i>
                      <span>Sidebar Filter</span>
                    </a>
                  </div>
                </div>
                {items.length > 0 && <ShopToolbar orderby={orderby} />}
              </div>
            </div>
          </header>
          <div className="woocommerce-notices-wrapper"></div>
          <div className="penci-active-filters">
            {active.length > 0 && (
              <ul className="penci-active-filter-list">
                {active.map((a) => (
                  <li key={a.label}>
                    <a href={a.url}>{a.label} ×</a>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {items.length === 0 ? (
            <div className="woocommerce-no-products-found">
              <div className="woocommerce-info">找不到符合你選擇的商品。</div>
            </div>
          ) : (
            <ul
              data-columns={perRow}
              className={`penci-quickshop-support product-style-6 icon-style-round icon-position-center-bottom icon-animation-zoom icon-align-horizontal products mobile-columns-2 ${view === "list" ? "penci-products-list-view columns-1" : `columns-${perRow}`}`}
            >
              {items.map((p, i) => (
                <ProductLoopItem key={p.id} p={p} first={i % perRow === 0} />
              ))}
            </ul>
          )}
          {totalPages > 1 && (
            <nav className="woocommerce-pagination">
              <ul className="page-numbers">
                {page > 1 && (
                  <li>
                    <a className="prev page-numbers" href={pageUrl(page - 1)}>
                      ←
                    </a>
                  </li>
                )}
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                  <li key={n}>{n === page ? <span aria-current="page" className="page-numbers current">{n}</span> : <a className="page-numbers" href={pageUrl(n)}>{n}</a>}</li>
                ))}
                {page < totalPages && (
                  <li>
                    <a className="next page-numbers" href={pageUrl(page + 1)}>
                      →
                    </a>
                  </li>
                )}
              </ul>
            </nav>
          )}
        </div>
      </div>
      <nav id="sidebar-product-filter" className="woocommerce penci-sidebar-filter side-right">
        <div className="sidebar-filter-container">
          <div className="sidefilter-heading">
            <h3>Product Filter</h3>
            <span className="close sidebar-filter-close-button">
              <i className="penciicon-close-button"></i>Close
            </span>
          </div>
          <div className="sidebar-filter-content penci-sidebar-content style-4 pcalign-center pciconp-right pcicon-right">
            <FollowUs id="penci_social_widget-6" cls="pc_aligncenter show-text penci-social-colored" fs={12} />
            <PriceFilter id="woocommerce_price_filter-6" min={pmin} max={pmax} cur={{ min: minP ?? undefined, max: maxP ?? undefined }} action={href(base)} h="h3" />
            <aside id="woocommerce_products-9" className="widget woocommerce widget_products">
              <h3 className="widget-title penci-border-arrow">
                <span className="inner-arrow">Recent Products</span>
              </h3>
              <ul className="product_list_widget">
                {[...visible]
                  .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
                  .slice(0, 5)
                  .map((p) => (
                    <li key={p.id}>
                      <a href={href(p.link_path)}>
                        {p.image && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img width={300} height={300} src={p.image.public_url} className="attachment-woocommerce_thumbnail size-woocommerce_thumbnail" alt={p.name} loading="lazy" />
                        )}{" "}
                        <span className="product-title">{p.name}</span>
                      </a>
                      <PriceHtml p={p} />
                    </li>
                  ))}
              </ul>
            </aside>
          </div>
        </div>
      </nav>
      <div className="sidebar-filter-close"></div>
    </div>
  );
}

function ShopIcons() {
  return (
    <div hidden>
      <svg xmlns="http://www.w3.org/2000/svg" style={{ display: "none" }}>
        <symbol id="columns-2" viewBox="0 0 444 444">
          <path d="m7 0h181c3.867188 0 7 3.132812 7 7v181c0 3.867188-3.132812 7-7 7h-181c-3.867188 0-7-3.132812-7-7v-181c0-3.867188 3.132812-7 7-7zm0 0" />
          <path d="m256 0h181c3.867188 0 7 3.132812 7 7v181c0 3.867188-3.132812 7-7 7h-181c-3.867188 0-7-3.132812-7-7v-181c0-3.867188 3.132812-7 7-7zm0 0" />
          <path d="m7 249h181c3.867188 0 7 3.132812 7 7v181c0 3.867188-3.132812 7-7 7h-181c-3.867188 0-7-3.132812-7-7v-181c0-3.867188 3.132812-7 7-7zm0 0" />
          <path d="m256 249h181c3.867188 0 7 3.132812 7 7v181c0 3.867188-3.132812 7-7 7h-181c-3.867188 0-7-3.132812-7-7v-181c0-3.867188 3.132812-7 7-7zm0 0" />
        </symbol>
        <symbol id="columns-3" viewBox="0 0 512 512">
          {[0, 180.67, 361.33].flatMap((x) => [0, 180.66, 361.33].map((y) => <rect key={`${x}-${y}`} x={x} y={y} width={150.67} height={150.67} />))}
        </symbol>
        <symbol id="columns-4" viewBox="0 0 397.061 397.061">
          {[5.224, 104.49, 208.98, 313.469].flatMap((x) => [0, 104.49, 208.98, 313.469].map((y) => <rect key={`${x}-${y}`} x={x} y={y} width={83.592} height={83.592} />))}
        </symbol>
        <symbol id="list" viewBox="0 0 512 512">
          {[42.667, 213.333, 384].map((y) => (
            <g key={y}>
              <rect x={128} y={y} width={384} height={21.333} rx={10} />
              <rect x={128} y={y + 64} width={234.667} height={21.333} rx={10} />
              <circle cx={42.667} cy={y + 42.667} r={42.667} />
            </g>
          ))}
        </symbol>
      </svg>
    </div>
  );
}

export async function ProductSingle({ p }: { p: ProductFull }) {
  const [all, rules] = await Promise.all([getAllProducts(), getQtyRules()]);
  const others = all.filter((x) => x.id !== p.id && x.catalog_visibility !== "hidden");
  const idx = all.findIndex((x) => x.id === p.id);
  const prev = all.slice(0, idx).reverse().find((x) => x.catalog_visibility !== "hidden") ?? others[0];
  const myRules = rulesForProduct(rules, p);
  const vf = p.type === "variable" ? await variationForm(p.id) : null;
  const images = [p.image, ...p.gallery].filter((m): m is NonNullable<typeof m> => !!m);
  const abs = SITE_URL + href(p.link_path);
  const cat = p.cats[0];
  const stockText =
    p.stock_status === "outofstock" ? "缺貨" : p.stock_status === "onbackorder" ? "可預購" : p.manage_stock && p.stock_quantity != null ? `庫存 ${p.stock_quantity} 件` : null;
  const related = others.filter((x) => x.catalog_visibility === "visible" && x.cats.some((c) => p.cats.some((d) => d.id === c.id))).slice(0, 4);
  return (
    <div className="sidebar-placement-bottom pagination no-container penci-woo-page-container penci_sidebar right-sidebar">
      <div id="main">
        <div className="theiaStickySidebar">
          <div className="container">
            <div className="woocommerce-notices-wrapper"></div>
            <div className="container penci-breadcrumb penci-woo-breadcrumb top">
              <span>
                <a href="/">Home</a>
              </span>
              <i className="penci-faicon fa fa-angle-right"></i>
              {cat && (
                <>
                  <span>
                    <a href={href(cat.link_path ?? "")}>{cat.name}</a>
                  </span>
                  <i className="penci-faicon fa fa-angle-right"></i>
                </>
              )}
              <span>{p.name}</span>
            </div>
          </div>
          <div
            id={`product-${p.id}`}
            className={`container-wrap sidebar-bottom ${productClasses(p, "first")} top-related-posts-show penci-sidebar-enable no-background penci-product-img-standard penci-product-thumbnail-bottom penci-summary-align-standard ${images.length > 1 ? "" : "no-thumbnail "}penci-share-style-1 penci-share-icon-style-circle ${p.gallery.length ? "" : "no-product-gallery"}`}
          >
            <div className="penci-single-product-top-container">
              <div className="container">
                <div className="penci-top-relate-post">
                  <ul>
                    {prev && (
                      <li className="top-ralate-item left">
                        <a href={href(prev.link_path)} aria-label={prev.name}>
                          <span className="item-icon">
                            <i className="penciicon-left-chevron"></i>
                          </span>
                        </a>
                        <div className="inner-content">
                          <div className="top-ralate-item__image">
                            <a href={href(prev.link_path)}>
                              {prev.image && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={prev.image.public_url} width={100} height={100} alt="" loading="lazy" />
                              )}
                            </a>
                          </div>
                          <div className="top-ralate-item__summary">
                            <h4>
                              <a href={href(prev.link_path)}>{prev.name}</a>
                            </h4>
                            <span className="price">
                              <a href={href(prev.link_path)}>
                                <PriceHtml p={prev} />
                              </a>
                            </span>
                          </div>
                        </div>
                      </li>
                    )}
                    <li className="item-shop-link">
                      <a className="icon-link" href="/shop" aria-label="Back to shop">
                        <svg height="14px" viewBox="-19 -19 600 600" width="14px" xmlns="http://www.w3.org/2000/svg">
                          <path d="m251.25 12.5c0-6.90625-5.59375-12.5-12.5-12.5h-226.25c-6.90625 0-12.5 5.59375-12.5 12.5v226.25c0 6.90625 5.59375 12.5 12.5 12.5h226.25c6.90625 0 12.5-5.59375 12.5-12.5zm-25 213.75h-201.25v-201.25h201.25zm0 0" />
                          <path d="m562.5 12.5c0-6.90625-5.59375-12.5-12.5-12.5h-226.25c-6.90625 0-12.5 5.59375-12.5 12.5v226.25c0 6.90625 5.59375 12.5 12.5 12.5h226.25c6.90625 0 12.5-5.59375 12.5-12.5zm-25 213.75h-201.25v-201.25h201.25zm0 0" />
                          <path d="m251.25 323.75c0-6.90625-5.59375-12.5-12.5-12.5h-226.25c-6.90625 0-12.5 5.59375-12.5 12.5v226.25c0 6.90625 5.59375 12.5 12.5 12.5h226.25c6.90625 0 12.5-5.59375 12.5-12.5zm-25 212.5h-201.25v-200h201.25zm0 0" />
                          <path d="m562.5 323.75c0-6.90625-5.59375-12.5-12.5-12.5h-226.25c-6.90625 0-12.5 5.59375-12.5 12.5v226.25c0 6.90625 5.59375 12.5 12.5 12.5h226.25c6.90625 0 12.5-5.59375 12.5-12.5zm-25 212.5h-201.25v-200h201.25zm0 0" />
                        </svg>
                      </a>
                    </li>
                  </ul>
                </div>
                <div className={`woocommerce-product-gallery ${images.length ? "woocommerce-product-gallery--with-images" : "woocommerce-product-gallery--without-images"} woocommerce-product-gallery--columns-4 images thumbnail-left penci-sticky-sidebar normal-screen`} data-columns="4" data-pswp-gallery>
                  <div className="theiaStickySidebar">
                    {images.length > 0 && (
                      <a href="#" className="woocommerce-product-gallery__trigger" data-pswp-open="0" aria-label="檢視全螢幕圖片庫">
                        <span aria-hidden="true">🔍</span>
                      </a>
                    )}
                    {images.length === 0 && (
                      <figure data-slide_item="0" data-attr_id="" className="splide__slide splide__slide- woocommerce-product-gallery__wrapper">
                        <div className="woocommerce-product-gallery__image--placeholder">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src="/wp/wp-content/plugins/woocommerce/assets/images/placeholder.png" alt="等待中的產品圖片" className="wp-post-image" width={600} height={600} />
                        </div>
                      </figure>
                    )}
                    {images.map((m, i) => (
                      <figure key={m.id} data-slide_item={i} data-attr_id={m.id} className={`splide__slide splide__slide-${m.id} woocommerce-product-gallery__wrapper`} style={i > 0 ? { marginTop: 10 } : undefined}>
                        <div data-thumb={m.public_url} data-thumb-alt={m.alt_text} className="woocommerce-product-gallery__image">
                          <a href={m.public_url} data-pswp-item data-pswp-width={m.width ?? 1200} data-pswp-height={m.height ?? 1200}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img width={600} height={m.width && m.height ? Math.round((600 * m.height) / m.width) : 600} src={m.public_url} className={i === 0 ? "wp-post-image" : ""} alt={m.alt_text} title={m.title} decoding="async" fetchPriority={i === 0 ? "high" : undefined} />
                          </a>
                        </div>
                      </figure>
                    ))}
                  </div>
                </div>
                <div className="penci-product-summary summary entry-summary penci-main-sticky-sidebar">
                  <div className="theiaStickySidebar">
                    <h1 className="product_title entry-title">{p.name}</h1>
                    <p className="price" data-price-box>
                      <PriceHtml p={p} />
                    </p>
                    {p.short_description && <div className="woocommerce-product-details__short-description" dangerouslySetInnerHTML={{ __html: transformContent(p.short_description) }} />}
                    {stockText && <p className={`stock ${p.stock_status === "instock" ? "in-stock" : p.stock_status === "onbackorder" ? "available-on-backorder" : "out-of-stock"}`}>{stockText}</p>}
                    {myRules.length > 0 && (
                      <div className="penci-qty-discount">
                        <table className="qd-table">
                          <thead>
                            <tr>
                              <th>數量</th>
                              <th>優惠</th>
                              <th>單價</th>
                            </tr>
                          </thead>
                          <tbody>
                            {myRules.map((r) => {
                              const base = Number(p.price ?? 0);
                              const unit = r.discount_type === "percent" ? base * (1 - r.amount / 100) : r.discount_type === "fixed_per_item" ? base - r.amount : r.amount;
                              return (
                                <tr key={r.id}>
                                  <td>
                                    {r.min_qty}
                                    {r.max_qty ? ` – ${r.max_qty}` : "+"} 件
                                  </td>
                                  <td>{r.discount_type === "percent" ? `${r.amount}% off` : r.discount_type === "fixed_per_item" ? `每件折 NT$${r.amount}` : `單價 NT$${r.amount}`}</td>
                                  <td dangerouslySetInnerHTML={{ __html: priceHtml(Math.max(0, Math.round(unit * 100) / 100)) }} />
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {p.purchasable && p.stock_status !== "outofstock" ? (
                      <ProductForm
                        product={{ id: p.id, name: p.name, link: p.link_path, type: p.type, soldIndividually: p.sold_individually, maxQty: p.max_purchase_qty ?? (p.manage_stock && p.backorders === "no" ? p.stock_quantity : null) }}
                        variationForm={vf}
                      />
                    ) : (
                      <p className="stock out-of-stock">缺貨</p>
                    )}
                    <div className="penci-extra-buttons">
                      <a title="Add to Wishlist" href={`?add-to-wishlist=${p.id}`} data-pid={p.id} className="penci-addtowishlist button ">
                        Add to Wishlist
                      </a>
                      <a data-method="add" href={`?add-to-compare=${p.id}`} className="button compare penci-compare" data-pid={p.id}>
                        Add to Compare
                      </a>
                    </div>
                    <div className="product_meta">
                      {p.sku && (
                        <span className="sku_wrapper">
                          <span className="product_meta_title">貨號:</span> <span className="sku">{p.sku}</span>
                        </span>
                      )}
                      {p.cats.length > 0 && (
                        <span className="posted_in">
                          <span className="product_meta_title">分類:</span>{" "}
                          {p.cats.map((c, i) => (
                            <span key={c.id}>
                              {i > 0 && ", "}
                              <a href={href(c.link_path ?? "")} rel="tag">
                                {c.name}
                              </a>
                            </span>
                          ))}
                        </span>
                      )}
                      {p.tags.length > 0 && (
                        <span className="tagged_as">
                          <span className="product_meta_title">標籤:</span>{" "}
                          {p.tags.map((c, i) => (
                            <span key={c.id}>
                              {i > 0 && ", "}
                              <a href={href(c.link_path ?? "")} rel="tag">
                                {c.name}
                              </a>
                            </span>
                          ))}
                        </span>
                      )}
                    </div>
                    <div className="single-product-share">
                      <span className="share-title">Share: </span>
                      <ShareLinks url={abs} title={p.name} wrap={false} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="penci-single-product-bottom-container">
              <div className="container penci-content-sticky-sidebar">
                <div className="bottom-content">
                  <div className="theiaStickySidebar">
                    {p.description.trim() && (
                    <div className="woocommerce-tabs wc-tabs-wrapper">
                      <ul className="tabs wc-tabs" role="tablist">
                        <li className="description_tab active" id="tab-title-description" role="tab" aria-controls="tab-description">
                          <a href="#tab-description">描述</a>
                        </li>
                      </ul>
                      <div
                        className="woocommerce-Tabs-panel woocommerce-Tabs-panel--description panel woocommerce-single-tab-content post-entry entry-content wc-tab"
                        id="tab-description"
                        role="tabpanel"
                        aria-labelledby="tab-title-description"
                        dangerouslySetInnerHTML={{ __html: transformContent(p.description) }}
                      />
                    </div>
                    )}
                    {related.length > 0 && (
                      <section className="related products normal">
                        <h2>Related products</h2>
                        <ul data-columns="3" className="penci-quickshop-support product-style-6 icon-style-round icon-position-center-bottom icon-animation-zoom icon-align-horizontal products mobile-columns-2 columns-3">
                          {related.map((r, i) => (
                            <ProductLoopItem key={r.id} p={r} first={i === 0} />
                          ))}
                        </ul>
                      </section>
                    )}
                  </div>
                </div>
                <Sidebar />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
