import "../globals.css";
import { headers } from "next/headers";
import SiteDocument from "@/components/SiteDocument";

/** Admin-only preview renders inside the storefront document (uncached). */
export const dynamic = "force-dynamic";

export default async function PreviewRootLayout({ children }: { children: React.ReactNode }) {
  const h = await headers();
  return <SiteDocument path={h.get("x-pathname") ?? "/admin-preview"}>{children}</SiteDocument>;
}
