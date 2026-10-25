import "server-only";
import { bodyClass, resolveRoute } from "@/lib/route";
import { env } from "@/lib/env";
import { siteConfig } from "@/lib/data";
import { publishDueThrottled } from "@/lib/cms/posts";
import { Footer, Header, OffCanvas } from "./Shell";
import SiteScripts from "./client/SiteScripts";
import { MiniCart } from "./client/CartView";
import { MiniCartMount } from "./client/MiniCartMount";

const CSS = [
  "/wp/wp-includes/css/dist/block-library/style.min.css",
  "/wp/wp-content/plugins/stackable-ultimate-gutenberg-blocks/dist/frontend_blocks.css",
  "/wp/wp-content/plugins/woocommerce/assets/client/blocks/wc-blocks.css",
  "/wp/wp-content/plugins/woocommerce/assets/css/brands.css",
  "https://fonts.googleapis.com/css?family=Roboto+Slab%3A300%2C300italic%2C400%2C400italic%2C500%2C500italic%2C700%2C700italic%2C800%2C800italic%7COpen+Sans%3A300%2C300italic%2C400%2C400italic%2C500%2C500italic%2C700%2C700italic%2C800%2C800italic%7CPeddana%3A300%2C300italic%2C400%2C400italic%2C500%2C500italic%2C600%2C600italic%2C700%2C700italic%2C800%2C800italic%26subset%3Dlatin%2Ccyrillic%2Ccyrillic-ext%2Cgreek%2Cgreek-ext%2Clatin-ext&display=swap",
  "/wp/wp-content/themes/soledad/main.css",
  "/wp/wp-content/themes/soledad/css/font-awesome.4.7.0.swap.min.css",
  "/wp/wp-content/themes/soledad/css/penci-icon.css",
  "/wp/wp-content/themes/soledad/style.css",
  "/wp/wp-content/themes/soledad/css/social-counter.css",
  "/wp/wp-content/plugins/elementor/assets/lib/eicons/css/elementor-icons.min.css",
  "/wp/wp-content/plugins/elementor/assets/css/frontend-lite.min.css",
  "/wp/elementor/css/post-2072.css",
  "/wp/elementor/css/global.css",
];
const CSS_AFTER = [
  "/wp/wp-content/themes/soledad/inc/woocommerce/css/build/woocommerce.css",
  "/wp/wp-content/themes/soledad/inc/woocommerce/css/build/woocommerce-layout.css",
  "/wp/wp-content/themes/soledad/inc/woocommerce/css/penci-woocomerce.css",
  "/wp/wp-content/plugins/mailin/css/mailin-front.css",
  "https://fonts.googleapis.com/css?family=Roboto%3A100%2C100italic%2C200%2C200italic%2C300%2C300italic%2C400%2C400italic%2C500%2C500italic%2C600%2C600italic%2C700%2C700italic%2C800%2C800italic%2C900%2C900italic%7CRoboto+Slab%3A100%2C100italic%2C200%2C200italic%2C300%2C300italic%2C400%2C400italic%2C500%2C500italic%2C600%2C600italic%2C700%2C700italic%2C800%2C800italic%2C900%2C900italic%7CAlex+Brush%3A100%2C100italic%2C200%2C200italic%2C300%2C300italic%2C400%2C400italic%2C500%2C500italic%2C600%2C600italic%2C700%2C700italic%2C800%2C800italic%2C900%2C900italic&display=auto",
  "/wp/wp-content/plugins/elementor/assets/lib/font-awesome/css/fontawesome.min.css",
  "/wp/wp-content/plugins/elementor/assets/lib/font-awesome/css/solid.min.css",
  "/wp/wp-content/plugins/stackable-ultimate-gutenberg-blocks/dist/frontend_blocks_responsive.css",
  "/wp/wp-content/plugins/elementor/assets/lib/animations/animations.min.css",
  "/wp/wp-content/plugins/gutenslider/build/gutenslider-init.css",
  "/wp/wp-content/plugins/woocommerce/assets/css/photoswipe/photoswipe.min.css",
  "/wp/wp-content/plugins/woocommerce/assets/css/photoswipe/default-skin/default-skin.min.css",
  "/wp/inline/common.css",
  "/wp/inline/penci-custom.css",
];
const ELEMENTOR_PAGES = new Set([6624, 2074, 8827, 11, 13, 2075]);

const gtmJs = (GTM_ID: string) => `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTM_ID}');`;
const pixelJs = (FB_PIXEL_ID: string) => `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${FB_PIXEL_ID}');fbq('track','PageView');`;

function decodeURIComponentSafe(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * The storefront document (<html>/<body> + theme CSS, header, footer). Rendered by the cached (ISR)
 * root layout app/[[...slug]] and by the uncached app/dyn__ tree (query strings, cart, checkout, account).
 * The cart count starts at 0 in cached HTML; MiniCart fetches /api/cart and fills it in.
 */
export default async function SiteDocument({ path, search = "", count = 0, children }: { path: string; search?: string; count?: number; children: React.ReactNode }) {
  publishDueThrottled();
  const sc = await siteConfig();
  const r = await resolveRoute(path, search);
  const pageId = r.kind === "home" || r.kind === "page" ? r.post.id : null;
  const cfg = JSON.stringify({ url: env.supabaseUrl(), anon: env.anonKey() }).replace(/</g, "\\u003c");
  return (
    <html lang="zh-TW">
      <head>
        <link rel="profile" href="http://gmpg.org/xfn/11" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {sc.gtm ? <script dangerouslySetInnerHTML={{ __html: gtmJs(sc.gtm) }} /> : null}
        {CSS.map((href) => (
          <link key={href} rel="stylesheet" href={href} media="all" />
        ))}
        {pageId && ELEMENTOR_PAGES.has(pageId) && <link rel="stylesheet" href={`/wp/elementor/css/post-${pageId}.css`} media="all" />}
        {CSS_AFTER.map((href) => (
          <link key={href} rel="stylesheet" href={href} media="all" />
        ))}
        <link rel="stylesheet" href="/wp/wp-content/plugins/woocommerce/assets/css/woocommerce-smallscreen.css" media="only screen and (max-width: 768px)" />
        {/* Without JS the Elementor entrance-animation reveal never runs: keep those widgets visible. */}
        <noscript>
          <style>{`.elementor-invisible{visibility:visible!important}`}</style>
        </noscript>
        <script dangerouslySetInnerHTML={{ __html: `window.__EMILY__=${cfg};` }} />
        {sc.pixel ? <script dangerouslySetInnerHTML={{ __html: pixelJs(sc.pixel) }} /> : null}
      </head>
      <body className={bodyClass(r)}>
        {sc.gtm ? (
        <noscript>
          <iframe src={`https://www.googletagmanager.com/ns.html?id=${sc.gtm}`} height="0" width="0" style={{ display: "none", visibility: "hidden" }} />
        </noscript>
        ) : null}
        <div className="wrapper-boxed header-style-header-2 header-search-style-default">
          <Header cartCount={count} current={decodeURIComponentSafe(path)} />
          {children}
          <Footer />
        </div>
        <OffCanvas current={decodeURIComponentSafe(path)} />
        <MiniCartMount>
          <MiniCart />
        </MiniCartMount>
        <SiteScripts />
        {sc.pixel ? (
          <noscript>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img height="1" width="1" style={{ display: "none" }} src={`https://www.facebook.com/tr?id=${sc.pixel}&ev=PageView&noscript=1`} alt="" />
          </noscript>
        ) : null}
      </body>
    </html>
  );
}
