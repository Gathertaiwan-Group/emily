import "server-only";
import type { Metadata } from "next";
import { getAuthors, mediaByIds, postTerms } from "./data";
import { encPath, isoLocal, stripTags } from "./format";
import type { Resolved } from "./route";
import { FAVICON_URL, FB_DOMAIN_VERIFICATION, LOGO_URL, SITE_NAME, SITE_URL } from "./site";

const abs = (p: string) => (/^https?:/.test(p) ? p : SITE_URL + (p === "/" ? "/" : encPath(p)));
const INDEX = "index, follow, max-snippet:-1, max-video-preview:-1, max-image-preview:large";

type Seo = { title: string; description?: string; robots: string; canonical?: string; ogType: string; ogImage?: { url: string; w?: number | null; h?: number | null; alt?: string }; extra?: Record<string, string | string[]> };

export async function seoFor(r: Resolved): Promise<Seo> {
  switch (r.kind) {
    case "home":
    case "post":
    case "page": {
      const p = r.post;
      const s = p.seo ?? {};
      let ogImage: Seo["ogImage"];
      if (p.featured_media_id) {
        const m = (await mediaByIds([p.featured_media_id])).get(p.featured_media_id);
        if (m) ogImage = { url: m.public_url, w: m.width, h: m.height, alt: p.title };
      } else if (s.og_image) ogImage = { url: s.og_image, alt: p.title };
      const extra: Record<string, string | string[]> = {};
      if (r.kind === "post") {
        const terms = await postTerms(p.id);
        const tags = terms.filter((t) => t.taxonomy === "post_tag").map((t) => t.name);
        const cat = terms.find((t) => t.taxonomy === "category");
        if (tags.length) extra["article:tag"] = tags;
        if (cat) extra["article:section"] = cat.name;
        extra["article:published_time"] = isoLocal(p.date);
        if (p.modified) extra["article:modified_time"] = isoLocal(p.modified);
      }
      if (p.modified) extra["og:updated_time"] = isoLocal(p.modified);
      return {
        title: s.title || `${p.title} - ${SITE_NAME}`,
        description: s.description || (r.kind === "post" ? stripTags(p.excerpt).slice(0, 160) : undefined),
        robots: s.robots || INDEX,
        canonical: String(s.robots ?? "").includes("noindex") ? undefined : s.canonical || p.link_path,
        ogType: s.og_type || "article",
        ogImage,
        extra,
      };
    }
    case "category":
    case "tag": {
      const s = r.term.seo ?? {};
      return {
        title: (s.title || `${r.term.name} - ${SITE_NAME}`).replace(/ - The three of us$/, r.page > 1 ? ` - Page ${r.page} - ${SITE_NAME}` : ` - ${SITE_NAME}`),
        description: s.description || stripTags(r.term.description) || undefined,
        robots: s.robots || (r.kind === "tag" ? "follow, noindex" : INDEX),
        canonical: String(s.robots ?? "").includes("noindex") ? undefined : (r.term.link_path ?? "") + (r.page > 1 ? `/page/${r.page}` : ""),
        ogType: "article",
      };
    }
    case "author":
      return { title: `${r.author.name} - ${SITE_NAME}`, robots: "follow, noindex", ogType: "profile" };
    case "date": {
      const label = r.day ? `${r.year}年${r.month}月${r.day}日` : r.month ? `${r.year}年${r.month}月` : `${r.year}`;
      return { title: `${label} - ${SITE_NAME}`, robots: "follow, noindex", ogType: "article" };
    }
    case "blog":
      return { title: `${SITE_NAME} - Page ${r.page}`, robots: "follow, noindex", ogType: "website" };
    case "search":
      return { title: `${r.q} - ${SITE_NAME}`, robots: "follow, noindex", ogType: "article" };
    case "shop": {
      if (r.term) {
        const s = r.term.seo ?? {};
        return { title: s.title || `${r.term.name} - ${SITE_NAME}`, robots: s.robots || INDEX, canonical: s.canonical || r.term.link_path || undefined, ogType: "article", description: s.description };
      }
      const s = r.post?.seo ?? {};
      return { title: s.title || `SHOP - ${SITE_NAME}`, description: s.description, robots: s.robots || INDEX, canonical: "/shop", ogType: "article" };
    }
    case "product": {
      const p = r.product;
      const s = p.seo ?? {};
      return {
        title: s.title || `${p.name} - ${SITE_NAME}`,
        description: s.description || stripTags(p.short_description) || stripTags(p.description).slice(0, 160) || undefined,
        robots: s.robots || INDEX,
        canonical: s.canonical || p.link_path,
        ogType: "product",
        ogImage: p.image ? { url: p.image.public_url, w: p.image.width, h: p.image.height, alt: p.name } : undefined,
        extra: {
          "product:price:amount": String(p.price ?? ""),
          "product:price:currency": "TWD",
          ...(p.stock_status === "instock" ? { "product:availability": "instock" } : {}),
        },
      };
    }
    default:
      return { title: `Page Not Found - ${SITE_NAME}`, robots: "follow, noindex", ogType: "article" };
  }
}

export async function buildMetadata(r: Resolved): Promise<Metadata> {
  const s = await seoFor(r);
  const other: Record<string, string | string[]> = { "facebook-domain-verification": FB_DOMAIN_VERIFICATION };
  const ex = s.extra ?? {};
  const canonical = s.canonical ? abs(s.canonical) : undefined;
  return {
    title: { absolute: s.title },
    description: s.description,
    robots: s.robots,
    alternates: {
      canonical,
      types: { "application/rss+xml": [{ url: `${SITE_URL}/feed`, title: `${SITE_NAME} RSS Feed` }] },
    },
    icons: { icon: [{ url: FAVICON_URL, sizes: "32x32" }, { url: FAVICON_URL, sizes: "192x192" }], apple: FAVICON_URL, shortcut: FAVICON_URL },
    openGraph: {
      locale: "zh_TW",
      ...(s.ogType === "product" ? {} : { type: s.ogType as any }),
      ...(s.ogType === "article" && ex["article:published_time"]
        ? {
            publishedTime: ex["article:published_time"] as string,
            modifiedTime: ex["article:modified_time"] as string | undefined,
            section: ex["article:section"] as string | undefined,
            tags: ex["article:tag"] as string[] | undefined,
          }
        : {}),
      title: s.title,
      description: s.description,
      url: canonical,
      siteName: SITE_NAME,
      images: s.ogImage ? [{ url: s.ogImage.url, width: s.ogImage.w ?? undefined, height: s.ogImage.h ?? undefined, alt: s.ogImage.alt }] : undefined,
    },
    twitter: { card: "summary_large_image", title: s.title, description: s.description, images: s.ogImage ? [s.ogImage.url] : undefined },
    other,
  };
}

/** Open Graph properties the Metadata API cannot express (og:type=product, product:*, og:updated_time).
 *  Rendered as <meta property> tags, which React hoists into <head>. */
export async function extraOgProps(r: Resolved): Promise<[string, string][]> {
  const s = await seoFor(r);
  const out: [string, string][] = [];
  if (s.ogType === "product") out.push(["og:type", "product"]);
  for (const [k, v] of Object.entries(s.extra ?? {})) {
    if (k.startsWith("article:")) continue;
    for (const x of Array.isArray(v) ? v : [v]) if (x) out.push([k, x]);
  }
  return out;
}

/** Rank Math style JSON-LD graph. */
export async function jsonLd(r: Resolved): Promise<object[]> {
  const s = await seoFor(r);
  const org = { "@type": "Organization", "@id": `${SITE_URL}/#organization`, name: SITE_NAME, url: SITE_URL, logo: { "@type": "ImageObject", url: LOGO_URL } };
  const site = { "@type": "WebSite", "@id": `${SITE_URL}/#website`, url: SITE_URL, name: SITE_NAME, publisher: { "@id": `${SITE_URL}/#organization` }, inLanguage: "zh-TW" };
  const url = s.canonical ? abs(s.canonical) : undefined;
  const graph: any[] = [org, site];
  const crumbs = (items: { name: string; url: string }[]) => ({
    "@type": "BreadcrumbList",
    "@id": `${url ?? SITE_URL}#breadcrumb`,
    itemListElement: [{ name: "Home", url: SITE_URL }, ...items].map((x, i) => ({ "@type": "ListItem", position: i + 1, item: { "@id": x.url, name: x.name } })),
  });
  if (r.kind === "post" || r.kind === "page" || r.kind === "home") {
    const p = r.post;
    const authors = await getAuthors();
    const a = p.author_id ? authors.get(p.author_id) : undefined;
    const page: any = { "@type": "WebPage", "@id": `${url ?? SITE_URL}#webpage`, url, name: s.title, datePublished: isoLocal(p.date), dateModified: isoLocal(p.modified), isPartOf: { "@id": `${SITE_URL}/#website` }, inLanguage: "zh-TW" };
    if (s.ogImage) {
      graph.push({ "@type": "ImageObject", "@id": s.ogImage.url, url: s.ogImage.url, width: s.ogImage.w, height: s.ogImage.h, inLanguage: "zh-TW" });
      page.primaryImageOfPage = { "@id": s.ogImage.url };
    }
    graph.push(page);
    if (a) graph.push({ "@type": "Person", "@id": abs(a.link_path ?? "/"), name: a.name, url: abs(a.link_path ?? "/"), image: { "@type": "ImageObject", url: a.avatar_url, caption: a.name }, worksFor: { "@id": `${SITE_URL}/#organization` } });
    if (r.kind === "post") {
      const terms = await postTerms(p.id);
      const cats = terms.filter((t) => t.taxonomy === "category");
      graph.push({
        "@type": "BlogPosting",
        headline: s.title,
        datePublished: isoLocal(p.date),
        dateModified: isoLocal(p.modified),
        articleSection: cats.map((c) => c.name).join(", "),
        author: a ? { "@id": abs(a.link_path ?? "/"), name: a.name } : undefined,
        publisher: { "@id": `${SITE_URL}/#organization` },
        description: s.description,
        name: s.title,
        "@id": `${url}#richSnippet`,
        isPartOf: { "@id": `${url}#webpage` },
        image: s.ogImage ? { "@id": s.ogImage.url } : undefined,
        inLanguage: "zh-TW",
        mainEntityOfPage: { "@id": `${url}#webpage` },
      });
      if (cats[0]) graph.push(crumbs([{ name: cats[0].name, url: abs(cats[0].link_path ?? "/") }, { name: p.title, url: url ?? SITE_URL }]));
    }
  } else if (r.kind === "product") {
    const p = r.product;
    graph.push({
      "@type": "Product",
      name: p.name,
      url,
      description: stripTags(p.short_description || p.description).slice(0, 300),
      sku: p.sku || undefined,
      image: p.image ? [p.image.public_url] : undefined,
      category: p.cats[0]?.name,
      offers: {
        "@type": "Offer",
        price: String(p.price ?? ""),
        priceCurrency: "TWD",
        availability: p.stock_status === "instock" ? "http://schema.org/InStock" : p.stock_status === "onbackorder" ? "http://schema.org/BackOrder" : "http://schema.org/OutOfStock",
        url,
        seller: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
      },
    });
    graph.push(crumbs([...(p.cats[0] ? [{ name: p.cats[0].name, url: abs(p.cats[0].link_path ?? "/") }] : []), { name: p.name, url: url ?? SITE_URL }]));
  } else if (r.kind === "category" || r.kind === "tag" || r.kind === "shop") {
    graph.push({ "@type": "CollectionPage", "@id": `${url ?? SITE_URL}#webpage`, url, name: s.title, isPartOf: { "@id": `${SITE_URL}/#website` }, inLanguage: "zh-TW" });
    if (r.kind === "shop") graph.push(crumbs([{ name: r.term?.name ?? "SHOP", url: url ?? SITE_URL }]));
  } else if (r.kind === "author") {
    graph.push({ "@type": "ProfilePage", "@id": `${abs(r.author.link_path ?? "/")}#webpage`, name: s.title, isPartOf: { "@id": `${SITE_URL}/#website` }, inLanguage: "zh-TW" });
    graph.push({ "@type": "Person", "@id": abs(r.author.link_path ?? "/"), name: r.author.name, url: abs(r.author.link_path ?? "/"), image: { "@type": "ImageObject", url: r.author.avatar_url } });
  } else if (r.kind === "search") {
    graph.push({ "@type": "SearchResultsPage", "@id": `${SITE_URL}/?s=${encodeURIComponent(r.q)}#webpage`, name: s.title, isPartOf: { "@id": `${SITE_URL}/#website` }, inLanguage: "zh-TW" });
  } else {
    graph.push({ "@type": "WebPage", "@id": `${SITE_URL}#webpage`, name: s.title, isPartOf: { "@id": `${SITE_URL}/#website` }, inLanguage: "zh-TW" });
  }
  return [{ "@context": "https://schema.org", "@graph": graph }];
}
