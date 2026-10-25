import "../../globals.css";
import { headers } from "next/headers";
import SiteDocument from "@/components/SiteDocument";
import { cartCount } from "@/lib/cart";

/** Uncached storefront for requests the proxy rewrites here: query strings (search, filters, order keys), cart, checkout, account. */
export const dynamic = "force-dynamic";

export default async function DynamicRootLayout({ children }: { children: React.ReactNode }) {
  const h = await headers();
  const path = h.get("x-pathname") ?? "/";
  const search = h.get("x-search") ?? "";
  const count = await cartCount().catch(() => 0);
  return (
    <SiteDocument path={path} search={search} count={count}>
      {children}
    </SiteDocument>
  );
}
