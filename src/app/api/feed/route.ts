import { cardsByIds, getPostById, listPostIds } from "@/lib/data";
import { transformContent } from "@/lib/content";
import { encPath } from "@/lib/format";
import { SITE_NAME, SITE_URL } from "@/lib/site";

export const dynamic = "force-dynamic";
const cdata = (s: string) => `<![CDATA[${s.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;

/** RSS 2.0 feed of the 10 latest posts (WordPress /feed). */
export async function GET() {
  const { ids } = await listPostIds({ limit: 10 });
  const cards = await cardsByIds(ids);
  const items = await Promise.all(
    cards.map(async (c) => {
      const full = await getPostById(c.id);
      const link = SITE_URL + encPath(c.link_path);
      return `\t<item>
\t\t<title>${cdata(c.title)}</title>
\t\t<link>${link}</link>
\t\t<dc:creator>${cdata(c.author?.name ?? "")}</dc:creator>
\t\t<pubDate>${new Date(c.date).toUTCString().replace("GMT", "+0000")}</pubDate>
${c.categories.map((t) => `\t\t<category>${cdata(t.name)}</category>`).join("\n")}
\t\t<guid isPermaLink="false">${SITE_URL}/?p=${c.id}</guid>
\t\t<description>${cdata(c.excerpt.replace(/<[^>]+>/g, "").trim())}</description>
\t\t<content:encoded>${cdata(transformContent(full?.content ?? ""))}</content:encoded>
\t</item>`;
    }),
  );
  const body = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"
\txmlns:content="http://purl.org/rss/1.0/modules/content/"
\txmlns:wfw="http://wellformedweb.org/CommentAPI/"
\txmlns:dc="http://purl.org/dc/elements/1.1/"
\txmlns:atom="http://www.w3.org/2005/Atom"
\txmlns:sy="http://purl.org/rss/1.0/modules/syndication/"
\txmlns:slash="http://purl.org/rss/1.0/modules/slash/"
>
<channel>
\t<title>${SITE_NAME}</title>
\t<atom:link href="${SITE_URL}/feed" rel="self" type="application/rss+xml" />
\t<link>${SITE_URL}</link>
\t<description></description>
\t<lastBuildDate>${new Date(cards[0]?.modified ?? Date.now()).toUTCString().replace("GMT", "+0000")}</lastBuildDate>
\t<language>zh-TW</language>
\t<sy:updatePeriod>hourly</sy:updatePeriod>
\t<sy:updateFrequency>1</sy:updateFrequency>
${items.join("\n")}
</channel>
</rss>`;
  return new Response(body, { headers: { "content-type": "application/rss+xml; charset=UTF-8" } });
}
