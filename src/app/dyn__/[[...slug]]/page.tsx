import type { Metadata } from "next";
import { StorefrontPage, pathOf, storefrontMetadata, toSearch } from "@/components/StorefrontPage";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug?: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ slug }, raw] = await Promise.all([params, searchParams]);
  return storefrontMetadata(pathOf(slug), toSearch(raw));
}

export default async function Page({ params, searchParams }: Props) {
  const [{ slug }, raw] = await Promise.all([params, searchParams]);
  return <StorefrontPage path={pathOf(slug)} sp={toSearch(raw)} />;
}
