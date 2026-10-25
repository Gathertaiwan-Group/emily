import type { Metadata } from "next";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { resolveRoute, type Resolved } from "@/lib/route";
import { buildMetadata, extraOgProps, jsonLd } from "@/lib/seo";
import { cardsByIds, getAllProducts, getAuthors, listPostIds, termDescendants, type PostCard } from "@/lib/data";
import { viewCart } from "@/lib/cart";
import { db } from "@/lib/db";
import { POSTS_PER_PAGE } from "@/lib/site";
import { money, priceHtml } from "@/lib/format";
import { ArchiveLayout } from "@/components/Blog";
import { Crumbs } from "@/components/Shell";
import { PageView, SinglePost } from "@/components/Single";
import { ProductSingle, ShopArchive } from "@/components/Shop";
import CartView from "@/components/client/CartView";
import CheckoutView from "@/components/client/CheckoutView";
import AccountView from "@/components/client/AccountView";
import { CompareView, WishlistView } from "@/components/client/ListsView";

export type RouteProps = { params: Promise<{ slug?: string[] }> };

export function pathOf(slug: string[] = []): string {
  return "/" + slug.map((s) => encodeURIComponent(safeDecode(s))).join("/");
}
function safeDecode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
export function toSearch(raw: Record<string, string | string[] | undefined>): URLSearchParams {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) if (v != null) sp.set(k, Array.isArray(v) ? v[0] : v);
  return sp;
}

export async function storefrontMetadata(path: string, sp: URLSearchParams): Promise<Metadata> {
  const search = sp.toString() ? `?${sp}` : "";
  const r = await resolveRoute(path, search);
  if (r.kind === "redirect") return {};
  return buildMetadata(r);
}

async function searchProducts(q: string): Promise<PostCard[]> {
  if (!q) return [];
  const [all, authors] = await Promise.all([getAllProducts(), getAuthors()]);
  const needle = q.toLowerCase();
  return all
    .filter((p) => p.catalog_visibility === "visible" || p.catalog_visibility === "search")
    .filter((p) => [p.name, p.description, p.short_description].some((s) => s.toLowerCase().includes(needle)))
    .map((p) => ({
      id: p.id,
      post_type: "product",
      title: p.name,
      excerpt: "",
      link_path: p.link_path,
      date: p.date,
      modified: p.modified,
      author_id: 1,
      featured_media_id: p.featured_media_id,
      comment_status: "closed",
      media: p.image,
      categories: [],
      tags: [],
      author: authors.get(1) ?? null,
      comments: 0,
    }));
}

async function OrderReceived({ id, orderKey }: { id: number; orderKey: string }) {
  const o = await db().from("orders").select("id,number,status,date_created,total,subtotal,discount_total,payment_method_title,billing,order_key,customer_note").eq("id", id).maybeSingle();
  if (!o.data || !orderKey || o.data.order_key !== orderKey) notFound();
  const items = (await db().from("order_items").select("name,quantity,total,item_type").eq("order_id", id)).data ?? [];
  const d = o.data as any;
  return (
    <div className="woocommerce">
      <div className="woocommerce-order">
        <p className="woocommerce-notice woocommerce-notice--success woocommerce-thankyou-order-received">謝謝你，我們已經收到你的訂單。</p>
        <ul className="woocommerce-order-overview woocommerce-thankyou-order-details order_details">
          <li className="woocommerce-order-overview__order order">
            訂單編號： <strong>{d.number ?? d.id}</strong>
          </li>
          <li className="woocommerce-order-overview__date date">
            日期： <strong>{new Date(d.date_created).toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" })}</strong>
          </li>
          <li className="woocommerce-order-overview__email email">
            電子郵件： <strong>{d.billing?.email}</strong>
          </li>
          <li className="woocommerce-order-overview__total total">
            總計： <strong dangerouslySetInnerHTML={{ __html: priceHtml(d.total) }} />
          </li>
          <li className="woocommerce-order-overview__payment-method method">
            付款方式： <strong>{d.payment_method_title}</strong>
          </li>
        </ul>
        <p className="penci-notice">訂單狀態：待付款。本站尚未串接線上金流，我們會另行與你聯繫付款方式。</p>
        <section className="woocommerce-order-details">
          <h2 className="woocommerce-order-details__title">訂單詳細資料</h2>
          <table className="woocommerce-table woocommerce-table--order-details shop_table order_details">
            <thead>
              <tr>
                <th className="woocommerce-table__product-name product-name">商品</th>
                <th className="woocommerce-table__product-table product-total">總計</th>
              </tr>
            </thead>
            <tbody>
              {items
                .filter((i: any) => i.item_type === "line_item")
                .map((i: any, n: number) => (
                  <tr key={n} className="woocommerce-table__line-item order_item">
                    <td className="woocommerce-table__product-name product-name">
                      {i.name} <strong className="product-quantity">&times;&nbsp;{i.quantity}</strong>
                    </td>
                    <td className="woocommerce-table__product-total product-total">{money(i.total)}</td>
                  </tr>
                ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">小計：</th>
                <td>{money(d.subtotal)}</td>
              </tr>
              {Number(d.discount_total) > 0 && (
                <tr>
                  <th scope="row">折扣：</th>
                  <td>-{money(d.discount_total)}</td>
                </tr>
              )}
              <tr>
                <th scope="row">付款方式：</th>
                <td>{d.payment_method_title}</td>
              </tr>
              <tr>
                <th scope="row">總計：</th>
                <td>{money(d.total)}</td>
              </tr>
            </tfoot>
          </table>
        </section>
      </div>
    </div>
  );
}

/**
 * Renders what WordPress served for `path` (+ query). Used by the cached route app/[[...slug]]
 * (no query string) and the uncached app/dyn__ route (query strings, cart, checkout, account).
 */
export async function StorefrontPage({ path, sp }: { path: string; sp: URLSearchParams }) {
  const search = sp.toString() ? `?${sp}` : "";
  const r = await resolveRoute(path, search);
  if (r.kind === "notfound") notFound();
  if (r.kind === "redirect") (r.status === 301 ? permanentRedirect : redirect)(r.to.split("/").map((s) => encodeURIComponent(safeDecode(s))).join("/"));
  const [ld, og] = await Promise.all([jsonLd(r), extraOgProps(r)]);
  const LD = (
    <>
      {og.map(([k, v], i) => (
        <meta key={`${k}-${i}`} property={k} content={v} />
      ))}
      <script type="application/ld+json" className="rank-math-schema" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld[0]).replace(/</g, "\\u003c") }} />
    </>
  );

  switch (r.kind) {
    case "home":
      return (
        <>
          <PageView post={r.post} home />
          {LD}
        </>
      );
    case "post":
      return (
        <>
          <SinglePost post={r.post} />
          {LD}
        </>
      );
    case "page": {
      const sub = r.sub ?? [];
      if (r.special === "cart") {
        if (sub.length) notFound();
        const cart = await viewCart();
        return (
          <>
            <PageView post={r.post}>
              <CartView initial={cart} />
            </PageView>
            {LD}
          </>
        );
      }
      if (r.special === "checkout") {
        if (sub[0] === "order-received" && sub[1]) {
          return (
            <PageView post={{ ...r.post, title: "已收到訂單" }}>
              <OrderReceived id={Number(sub[1])} orderKey={sp.get("key") ?? ""} />
            </PageView>
          );
        }
        if (sub.length) notFound();
        const cart = await viewCart();
        if (!cart.items.length && r.post.slug === "checkout") redirect("/cart");
        return (
          <>
            <PageView post={r.post}>{cart.items.length ? <CheckoutView initial={cart} /> : <div className="woocommerce"></div>}</PageView>
            {LD}
          </>
        );
      }
      if (r.special === "account") {
        const allowed = ["", "orders", "edit-account", "lost-password", "view-order", "customer-logout"];
        if (!allowed.includes(sub[0] ?? "")) notFound();
        const title = sub[0] === "lost-password" ? "忘記密碼" : sub[0] === "orders" ? "訂單" : r.post.title;
        return (
          <>
            <PageView post={{ ...r.post, title }}>
              <AccountView base={r.post.link_path} sub={sub} />
            </PageView>
            {LD}
          </>
        );
      }
      if (r.special === "wishlist" || r.special === "compare") {
        if (sub.length) notFound();
        return (
          <>
            <PageView post={r.post}>{r.special === "wishlist" ? <WishlistView /> : <CompareView />}</PageView>
            {LD}
          </>
        );
      }
      return (
        <>
          <PageView post={r.post} />
          {LD}
        </>
      );
    }
    case "category":
    case "tag": {
      const ids = r.kind === "category" ? await termDescendants(r.term.id) : [r.term.id];
      const { ids: page, total } = await listPostIds({ termIds: ids, limit: POSTS_PER_PAGE, offset: (r.page - 1) * POSTS_PER_PAGE });
      const pages = Math.ceil(total / POSTS_PER_PAGE);
      if (r.page > 1 && r.page > pages) notFound();
      const items = await cardsByIds(page);
      const { getTerms } = await import("@/lib/data");
      const { byId } = await getTerms();
      const chain = [];
      for (let t = byId.get(r.term.parent_id ?? -1); t; t = byId.get(t.parent_id ?? -1)) chain.unshift({ label: t.name, url: t.link_path ?? "" });
      return (
        <>
          <ArchiveLayout
            crumbs={<Crumbs cls="container penci-breadcrumb" items={[...chain, { label: r.term.name }]} />}
            titleLabel={r.kind === "category" ? "Category:" : "Tag:"}
            title={r.term.name}
            items={items}
            page={r.page}
            totalPages={pages}
            base={r.term.link_path ?? "/"}
          />
          {LD}
        </>
      );
    }
    case "author":
    case "date":
    case "blog": {
      const opts =
        r.kind === "author" ? { author: r.author.id } : r.kind === "date" ? { year: r.year, month: r.month ?? null, day: r.day ?? null } : {};
      const { ids: page, total } = await listPostIds({ ...opts, limit: POSTS_PER_PAGE, offset: (r.page - 1) * POSTS_PER_PAGE });
      const pages = Math.ceil(total / POSTS_PER_PAGE);
      if ((r.page > 1 && r.page > pages) || (r.kind === "date" && total === 0)) notFound();
      const items = await cardsByIds(page);
      const label =
        r.kind === "author" ? r.author.name : r.kind === "date" ? (r.day ? `${r.year}年${r.month}月${r.day}日` : r.month ? `${r.year}年${r.month}月` : `${r.year}`) : "Blog";
      const base = r.kind === "author" ? r.author.link_path ?? "/" : r.kind === "date" ? `/${r.year}${r.month ? `/${String(r.month).padStart(2, "0")}` : ""}${r.day ? `/${String(r.day).padStart(2, "0")}` : ""}` : "/";
      const authorBox =
        r.kind === "author" ? (
          <div className="post-author abio-style-1 bioimg-round">
            <div className="author-img">
              {r.author.avatar_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img alt="" src={r.author.avatar_url.replace("s=96", "s=100")} className="avatar avatar-100 photo" height={100} width={100} decoding="async" />
              )}
            </div>
            <div className="author-content">
              <h5>
                <a href={r.author.link_path ?? "#"} title={`Author ${r.author.name}`} rel="author">
                  {r.author.name}
                </a>
              </h5>
              <p>{r.author.description}</p>
              <div className="bio-social"></div>
            </div>
          </div>
        ) : undefined;
      return (
        <>
          <ArchiveLayout
            crumbs={<Crumbs cls="container penci-breadcrumb" items={[{ label: r.kind === "author" ? "Author" : label }]} />}
            intro={authorBox}
            h1Class={r.kind === "author" ? "page-title" : undefined}
            titleLabel={r.kind === "author" ? "Author " : r.kind === "date" ? (r.day ? "Daily Archives:" : r.month ? "Monthly Archives:" : "Yearly Archives:") : ""}
            title={label}
            items={items}
            page={r.page}
            totalPages={pages}
            base={base}
          />
          {LD}
        </>
      );
    }
    case "search": {
      const per = POSTS_PER_PAGE;
      const products = r.page === 1 ? await searchProducts(r.q) : [];
      const { ids, total } = r.q ? await listPostIds({ types: ["post", "page"], search: r.q, limit: per, offset: (r.page - 1) * per }) : { ids: [], total: 0 };
      const items = [...products, ...(await cardsByIds(ids))];
      return (
        <>
          <ArchiveLayout
            crumbs={<Crumbs cls="container penci-breadcrumb" items={[{ label: "Search" }]} />}
            titleLabel="Search results for"
            title={`"${r.q}"`}
            items={items}
            page={r.page}
            totalPages={Math.ceil(total / per)}
            base="/"
            query={`?s=${encodeURIComponent(r.q)}`}
          />
          {LD}
        </>
      );
    }
    case "shop":
      return (
        <>
          <ShopArchive term={r.term} page={r.page} search={sp} title={r.term?.name ?? "SHOP"} />
          {LD}
        </>
      );
    case "product":
      return (
        <>
          <ProductSingle p={r.product} />
          {LD}
        </>
      );
  }
}
