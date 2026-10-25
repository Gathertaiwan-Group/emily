import type { Metadata } from "next";
import { StorefrontPage, pathOf, storefrontMetadata, type RouteProps } from "@/components/StorefrontPage";

// ISR: pages are rendered on first visit, served from the cache and refreshed at most every 300 s
// (CMS / MCP writes call revalidatePath). No query string reaches this route (see src/proxy.ts).
export const revalidate = 300;
export const dynamicParams = true;
export function generateStaticParams() {
  return [];
}

const NO_QUERY = new URLSearchParams();

export async function generateMetadata({ params }: RouteProps): Promise<Metadata> {
  const { slug } = await params;
  return storefrontMetadata(pathOf(slug), NO_QUERY);
}

export default async function Page({ params }: RouteProps) {
  const { slug } = await params;
  return <StorefrontPage path={pathOf(slug)} sp={NO_QUERY} />;
}
