import { urlAtLeast } from "@/lib/img";
import { Fragment } from "react";
import { getMenu, getRecentPosts, getTagCloud, siteConfig, type MenuItem } from "@/lib/data";
import { encPath, ymd, isoLocal } from "@/lib/format";
import { SLOGAN_LINES } from "@/lib/site";

export function href(url: string): string {
  if (/^(https?:|mailto:|tel:|#)/.test(url)) return url;
  return encPath(url);
}

function isCurrent(it: MenuItem, cur?: string): boolean {
  return !!cur && decodeSafe(it.url) === cur;
}
function hasCurrent(it: MenuItem, cur?: string): boolean {
  return it.children.some((c) => isCurrent(c, cur) || hasCurrent(c, cur));
}
function decodeSafe(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function MenuTree({ items, ids, cur }: { items: MenuItem[]; ids: boolean; cur?: string }) {
  return (
    <>
      {items.map((it) => {
        const cls = [
          "menu-item",
          `menu-item-type-${it.object_type === "custom" ? "custom" : it.object_type === "category" ? "taxonomy" : "post_type"}`,
          `menu-item-object-${it.object_type ?? "custom"}`,
          it.children.length ? "menu-item-has-children" : "",
          "ajax-mega-menu",
          `menu-item-${it.id}`,
          isCurrent(it, cur) ? "current-menu-item" : "",
          hasCurrent(it, cur) ? "current-menu-ancestor current-menu-parent" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <li key={it.id} id={ids ? `menu-item-${it.id}` : undefined} className={cls}>
            <a href={href(it.url)}>{it.title}</a>
            {it.children.length > 0 && (
              <ul className="sub-menu">
                <MenuTree items={it.children} ids={ids} cur={cur} />
              </ul>
            )}
          </li>
        );
      })}
    </>
  );
}

const HamburgerSvg = () => (
  <svg width={18} height={18} viewBox="0 0 512 384" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink">
    <g stroke="none" strokeWidth={1} fill="none" fillRule="evenodd">
      <g transform="translate(0.000000, 0.250080)" fill="#333333">
        <rect x={0} y={0} width={512} height={62} />
        <rect x={0} y={161} width={512} height={62} />
        <rect x={0} y={321} width={512} height={62} />
      </g>
    </g>
  </svg>
);

export function SearchForm() {
  return (
    <form role="search" method="get" className="pc-searchform" action="/" data-form="search">
      <div className="pc-searchform-inner">
        <input type="text" className="search-input" placeholder="Type and hit enter..." name="s" />
        <i className="penciicon-magnifiying-glass"></i>
        <input type="submit" className="searchsubmit" value="Search" />
      </div>
    </form>
  );
}

export async function Header({ cartCount, current }: { cartCount: number; current?: string }) {
  const menu = await getMenu("menu-beta");
  const { logo: LOGO_URL, name: SITE_NAME } = await siteConfig();
  return (
    <div className="penci-header-wrap">
      <header id="header" className="header-header-2 has-bottom-line" itemScope itemType="https://schema.org/WPHeader">
        <div className="inner-header penci-header-second">
          <div className="container">
            <div id="logo">
              <a href="/">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="penci-mainlogo pclogo-cls" src={LOGO_URL} alt={SITE_NAME} width={655} height={116} decoding="async" />
              </a>
            </div>
            <div className="header-slogan">
              <div className="header-slogan-text">
                {SLOGAN_LINES[0]}
                {"\n"}
                {SLOGAN_LINES[1]}
                <br />
              </div>
            </div>
          </div>
        </div>
        <div id="navigation-sticky-wrapper" className="sticky-wrapper">
          <nav id="navigation" className="header-layout-bottom header-2 menu-style-2" role="navigation" itemScope itemType="https://schema.org/SiteNavigationElement">
            <div className="container">
              <div className="button-menu-mobile header-2">
                <HamburgerSvg />
              </div>
              <ul id="menu-beta" className="menu">
                <MenuTree items={menu} ids cur={current} />
              </ul>
              <div id="top-search" className="penci-top-search pcheader-icon top-search-classes">
                <a className="search-click" aria-label="Search">
                  <i className="penciicon-magnifiying-glass"></i>
                </a>
                <div className="show-search">
                  <SearchForm />
                  <a className="search-click close-search" aria-label="Close search">
                    <i className="penciicon-close-button"></i>
                  </a>
                </div>
              </div>
              <div id="top-header-cart" className="top-search-classes pcheader-icon shoping-cart-icon">
                <ul>
                  <li>
                    <a className="cart-contents" href="/cart" title="View your shopping cart">
                      <i className="penciicon-shopping-cart"></i>
                      <span data-cart-count>{cartCount}</span>
                    </a>
                  </li>
                </ul>
              </div>
            </div>
          </nav>
        </div>
      </header>
    </div>
  );
}

export function SideItem({ p, imgCls = "penci-image-holder small-fix-size" }: { p: Awaited<ReturnType<typeof getRecentPosts>>[number]; imgCls?: string }) {
  const url = href(p.link_path);
  return (
    <li className="penci-feed">
      <div className="side-item">
        <div className="side-image">
          <a className={imgCls} rel="bookmark" style={p.media ? { backgroundImage: `url('${urlAtLeast(p.media, 480)}')` } : undefined} href={url} title={p.title}></a>
        </div>
        <div className="side-item-text">
          <h4 className="side-title-post">
            <a href={url} rel="bookmark" title={p.title}>
              {p.title}
            </a>
          </h4>
          <div className="grid-post-box-meta penci-side-item-meta pcsnmt-below">
            <span className="side-item-meta side-wdate">
              <time className="entry-date published" dateTime={isoLocal(p.date)}>
                {ymd(p.date)}
              </time>
            </span>
          </div>
        </div>
      </div>
    </li>
  );
}

export async function Footer() {
  const [recent, cloud, footerMenu] = await Promise.all([getRecentPosts(), getTagCloud(), getMenu("menu-footer-menu")]);
  const { logo: LOGO_URL, social: SOCIAL } = await siteConfig();
  return (
    <>
      <div className="clear-footer"></div>
      <div id="widget-area">
        <div className="container">
          <div className="footer-widget-wrapper footer-widget-style-4"></div>
          <div className="footer-widget-wrapper footer-widget-style-4">
            <aside id="penci_latest_news_widget-7" className="widget penci_latest_news_widget">
              <h4 className="widget-title penci-border-arrow">
                <span className="inner-arrow">Recent Posts</span>
              </h4>
              <ul id="penci-latestwg-2486" className="side-newsfeed penci-feed-2columns penci-2columns-feed">
                {recent.slice(0, 3).map((p) => (
                  <SideItem key={p.id} p={p} />
                ))}
              </ul>
            </aside>
          </div>
          <div className="footer-widget-wrapper footer-widget-style-4">
            <aside id="block-15" className="widget widget_block">
              <div className="wp-block-stackable-columns stk-block-columns stk-block stk-965c941" data-block-id="965c941">
                <div className="stk-row stk-inner-blocks stk-block-content stk-content-align stk-965c941-column">
                  <div className="wp-block-stackable-column stk-block-column stk-column stk-block stk-49f02f1" data-block-id="49f02f1">
                    <div className="stk-column-wrapper stk-block-column__content stk-container stk-49f02f1-container stk--no-background stk--no-padding">
                      <div className="stk-block-content stk-inner-blocks">
                        <div className="wp-block-stackable-columns aligncenter stk-block-columns stk-block stk-82cd1a8" data-block-id="82cd1a8">
                          <div className="stk-row stk-inner-blocks stk-block-content stk-content-align stk-82cd1a8-column">
                            <div className="wp-block-stackable-column stk-block-column stk-column stk-block stk-a6e341e" data-block-id="a6e341e">
                              <div className="stk-column-wrapper stk-block-column__content stk-container stk-a6e341e-container stk--no-background stk--no-padding">
                                <div className="stk-block-content stk-inner-blocks">
                                  <div className="wp-block-stackable-image stk-block-image has-text-align-center stk-block stk-4d95e77" data-block-id="4d95e77">
                                    <style>{`.stk-4d95e77 .stk-img-wrapper img{transform:scale(0.87) !important}.stk-4d95e77 .stk-img-wrapper{width:50% !important}`}</style>
                                    <figure className="stk-img-wrapper stk-image--shape-stretch">
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img loading="lazy" decoding="async" className="stk-img wp-image-2474" src={LOGO_URL} width={655} height={116} alt="" />
                                    </figure>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </aside>
          </div>
          <div className="footer-widget-wrapper footer-widget-style-4 last">
            <aside id="block-22" className="widget widget_block widget_tag_cloud">
              <p className="wp-block-tag-cloud">
                {cloud.map(({ term, size }, i) => (
                  <Fragment key={term.id}>
                    <a
                      href={href(term.link_path ?? `/tag/${term.slug}`)}
                      className={`tag-cloud-link tag-link-${term.id} tag-link-position-${i + 1}`}
                      style={{ fontSize: `${size}pt` }}
                      aria-label={`${term.name} (${term.count} 個項目)`}
                    >
                      {term.name}
                    </a>{" "}
                  </Fragment>
                ))}
              </p>
            </aside>
          </div>
        </div>
      </div>
      <footer id="footer-section" className="penci-footer-social-media footer-social-remove-circle" itemScope itemType="https://schema.org/WPFooter">
        <div className="container">
          <div className="footer-socials-section">
            <ul className="footer-socials">
              <li>
                <a href={SOCIAL.facebook} aria-label="Facebook" rel="noreferrer" target="_blank">
                  <i className="penci-faicon fa fa-facebook"></i> <span>Facebook</span>
                </a>
              </li>
              <li>
                <a href={SOCIAL.instagram} aria-label="Instagram" rel="noreferrer" target="_blank">
                  <i className="penci-faicon fa fa-instagram"></i> <span>Instagram</span>
                </a>
              </li>
              <li>
                <a href={SOCIAL.email} aria-label="Email" rel="noreferrer" target="_blank">
                  <i className="penci-faicon fa fa-envelope"></i> <span>Email</span>
                </a>
              </li>
              <li>
                <a href={SOCIAL.line} aria-label="Line" rel="noreferrer" target="_blank">
                  <i className="penci-faicon penciicon-line"></i> <span>Line</span>
                </a>
              </li>
            </ul>
          </div>
          <div className="footer-logo-copyright footer-not-logo footer-not-gotop">
            <div className="footer-menu-wrap" role="navigation" itemScope itemType="https://schema.org/SiteNavigationElement">
              <ul id="menu-footer-menu" className="footer-menu">
                <MenuTree items={footerMenu} ids />
              </ul>
            </div>
            <div id="footer-copyright">
              <p>
                @2022 - All Right Reserved. Designed and Developed by{" "}
                <a rel="nofollow" href="https://1.envato.market/YYJ4P" target="_blank">
                  Emily
                </a>
              </p>
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}

export async function OffCanvas({ current }: { current?: string }) {
  const menu = await getMenu("menu-beta-1");
  const { logo: LOGO_URL, name: SITE_NAME, social: SOCIAL } = await siteConfig();
  return (
    <>
      <div className="penci-go-to-top-floating">
        <i className="penciicon-up-chevron"></i>
      </div>
      <a id="close-sidebar-nav" className="header-2">
        <i className="penci-faicon fa fa-close"></i>
      </a>
      <nav id="sidebar-nav" className="header-2" role="navigation" itemScope itemType="https://schema.org/SiteNavigationElement">
        <div id="sidebar-nav-logo">
          <a href="/">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={LOGO_URL} width={655} height={116} alt={SITE_NAME} loading="lazy" decoding="async" />
          </a>
        </div>
        <div className="header-social sidebar-nav-social">
          <div className="inner-header-social">
            <a href={SOCIAL.facebook} aria-label="Facebook" rel="noreferrer" target="_blank">
              <i className="penci-faicon fa fa-facebook"></i>
            </a>
            <a href={SOCIAL.instagram} aria-label="Instagram" rel="noreferrer" target="_blank">
              <i className="penci-faicon fa fa-instagram"></i>
            </a>
            <a href={SOCIAL.email} aria-label="Email" rel="noreferrer" target="_blank">
              <i className="penci-faicon fa fa-envelope"></i>
            </a>
            <a href={SOCIAL.line} aria-label="Line" rel="noreferrer" target="_blank">
              <i className="penci-faicon penciicon-line"></i>
            </a>
          </div>
        </div>
        <ul id="menu-beta-1" className="menu">
          <MenuTree items={menu} ids={false} cur={current} />
        </ul>
      </nav>
      <nav id="sidebar-sidebar-cart" className="woocommerce penci-sidebar-cart side-right">
        <div className="sidebar-cart-container">
          <div className="sidecart-heading">
            <h3>Shopping Cart</h3>
            <span className="close sidebar-cart-close">
              <i className="penciicon-close-button"></i>Close
            </span>
          </div>
          <div className="sidecart-content">
            <div className="widget_shopping_cart_content" data-mini-cart>
              <p className="woocommerce-mini-cart__empty-message">購物車內沒有任何商品。</p>
            </div>
          </div>
        </div>
      </nav>
      <div className="penci-sidebar-cart-close sidebar-cart-close">Close</div>
    </>
  );
}

export function ShareLinks({ url, title, wrap = true }: { url: string; title: string; wrap?: boolean }) {
  const u = url;
  const links = (
    <div className="list-posts-share">
      <a className="post-share-item post-share-facebook" aria-label="Share on Facebook" target="_blank" rel="noreferrer" href={`https://www.facebook.com/sharer/sharer.php?u=${u}`}>
        <i className="penci-faicon fa fa-facebook"></i>
        <span className="dt-share">Facebook</span>
      </a>
      <a
        className="post-share-item post-share-twitter"
        aria-label="Share on Twitter"
        target="_blank"
        rel="noreferrer"
        href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`Check out this article: ${title} - `)}${u}`}
      >
        <i className="penci-faicon fa fa-twitter"></i>
        <span className="dt-share">Twitter</span>
      </a>
      <a
        className="post-share-item post-share-pinterest"
        aria-label="Pin to Pinterest"
        data-pin-do="none"
        rel="noreferrer"
        target="_blank"
        href={`https://www.pinterest.com/pin/create/button/?url=${encodeURIComponent(u)}&description=${encodeURIComponent(title)}`}
      >
        <i className="penci-faicon fa fa-pinterest"></i>
        <span className="dt-share">Pinterest</span>
      </a>
      <a className="post-share-item post-share-email" target="_blank" aria-label="Share via Email" rel="noreferrer" href={`mailto:?subject=${title}&BODY=${u}`}>
        <i className="penci-faicon fa fa-envelope"></i>
        <span className="dt-share">Email</span>
      </a>
    </div>
  );
  return wrap ? <div className="post-share">{links}</div> : links;
}

export function Crumbs({ items, cls = "container container-single-page penci-breadcrumb" }: { items: { label: string; url?: string }[]; cls?: string }) {
  return (
    <div className={cls}>
      <span>
        <a className="crumb" href="/">
          Home
        </a>
      </span>
      {items.map((it, i) => (
        <span key={i} style={{ display: "contents" }}>
          <i className="penci-faicon fa fa-angle-right"></i>{" "}
          <span>
            {it.url ? (
              <a className="crumb" href={href(it.url)}>
                {it.label}
              </a>
            ) : (
              it.label
            )}
          </span>
        </span>
      ))}
    </div>
  );
}
