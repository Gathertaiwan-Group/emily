import "../globals.css";
import SiteDocument from "@/components/SiteDocument";
import { pathOf, type RouteProps } from "@/components/StorefrontPage";

/** Cached storefront (ISR). Requests with a query string, cart/checkout/account are rewritten to app/dyn__ by the proxy. */
export const revalidate = 300;

export default async function CachedRootLayout({ children, params }: RouteProps & { children: React.ReactNode }) {
  const { slug } = await params;
  return <SiteDocument path={pathOf(slug)}>{children}</SiteDocument>;
}
