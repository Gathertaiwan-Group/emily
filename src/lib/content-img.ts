import "server-only";
import { db } from "./db";
import { STORAGE_BASE } from "./site";
import { srcSetOf, urlAtLeast, type ImgSource } from "./img";

/**
 * Rewrites images inside stored WordPress HTML to the responsive WebP variants:
 *  - <img src="…/site-emily/uploads/…"> gets srcset/sizes (+ width/height when missing);
 *  - every <img> gets loading="lazy" and decoding="async" unless it already says otherwise;
 *  - inline `background-image: url(…)` (Soledad / Elementor image holders) points at a 480/960
 *    variant via image-set() instead of the 2000px original.
 */
const BASE_RE = STORAGE_BASE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const URL_RE = new RegExp(`${BASE_RE}/(uploads/[^"'\\s)&?#<>]+)`, "g");

function dec(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
const attr = (tag: string, name: string) => new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag);
const getAttr = (tag: string, name: string) => {
  const m = attr(tag, name);
  return m ? (m[1] ?? m[2] ?? "") : null;
};
const dropAttr = (tag: string, name: string) => tag.replace(new RegExp(`\\s${name}\\s*=\\s*(?:"[^"]*"|'[^']*')`, "gi"), "");
const addAttr = (tag: string, s: string) => tag.replace(/\s*\/?>$/, (end) => ` ${s}${end.includes("/") ? " />" : ">"}`);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

async function lookup(paths: string[]): Promise<Map<string, ImgSource>> {
  const out = new Map<string, ImgSource>();
  const uniq = [...new Set(paths)];
  for (let i = 0; i < uniq.length; i += 150) {
    const r = await db().from("media").select("storage_path,public_url,width,height,variants").in("storage_path", uniq.slice(i, i + 150));
    for (const m of (r.data ?? []) as (ImgSource & { storage_path: string })[]) if (!out.has(m.storage_path)) out.set(m.storage_path, m);
  }
  return out;
}

export async function responsiveContent(html: string): Promise<string> {
  if (!html) return html;
  const paths = [...html.matchAll(URL_RE)].map((m) => dec(m[1]));
  const media = paths.length ? await lookup(paths).catch(() => new Map<string, ImgSource>()) : new Map<string, ImgSource>();
  const find = (url: string): ImgSource | undefined => {
    const m = new RegExp(`^${BASE_RE}/(uploads/[^"'\\s)&?#<>]+)`).exec(url);
    return m ? media.get(dec(m[1])) : undefined;
  };

  // <img>
  let s = html.replace(/<img\b[^>]*>/gi, (tag: string, offset: number, whole: string) => {
    let t = tag;
    const src = getAttr(t, "src") ?? "";
    const m = find(src);
    const set = m ? srcSetOf(m) : undefined;
    if (m && set) {
      const w = Number(getAttr(t, "width")) || null;
      const oldSizes = getAttr(t, "sizes");
      t = dropAttr(dropAttr(t, "srcset"), "sizes");
      let sizes = oldSizes && !/^\s*$/.test(oldSizes) ? oldSizes : w ? `(max-width: ${w}px) 100vw, ${w}px` : "(max-width: 960px) 100vw, 960px"; // content column is ≤ ~780px wide
      // Gutenslider background images (object-fit layers sized by the slide): "sizes=auto" there feeds the
      // image's own width back into the layout and blows the page up to the max height -> use the explicit list.
      if (/eedee-background-div/.test(whole.slice(Math.max(0, offset - 200), offset))) sizes = sizes.replace(/^\s*auto\s*,\s*/i, "");
      t = addAttr(t, `srcset="${esc(set)}" sizes="${esc(sizes)}"`);
      if (!getAttr(t, "width") && !getAttr(t, "height") && m.width && m.height) t = addAttr(t, `width="${m.width}" height="${m.height}"`);
    }
    if (!getAttr(t, "loading") && !/fetchpriority\s*=\s*["']high/i.test(t)) t = addAttr(t, `loading="lazy"`);
    if (!getAttr(t, "decoding")) t = addAttr(t, `decoding="async"`);
    return t;
  });

  // inline background images
  s = s.replace(/<[a-z][a-z0-9]*\b[^>]*background(?:-image)?\s*:[^>]*>/gi, (tag) => {
    const small = /\bsmall-fix-size\b/.test(getAttr(tag, "class") ?? "");
    const dq = !/\sstyle\s*=\s*'/i.test(tag); // double-quoted style attribute: single quotes are safe inside
    return tag.replace(/(background-image|background)(\s*:\s*)url\(\s*(&#0?39;|&quot;|&#x27;|'|")?([^)'"&]+?)\3?\s*\)/gi, (whole, prop, colon, _q, url) => {
      const m = find(url);
      if (!m || !m.variants?.length) return whole;
      const lo = urlAtLeast(m, 480);
      const hi = small ? lo : urlAtLeast(m, 960);
      if (prop.toLowerCase() !== "background-image" || !dq || lo === hi) return `${prop}${colon}url(${dq ? `'${hi}'` : hi})`;
      // plain url() first for browsers without image-set(), then 1x/2x candidates
      return `${prop}${colon}url('${lo}');background-image:image-set(url('${lo}') 1x, url('${hi}') 2x)`;
    });
  });
  return s;
}

/** Static Soledad post blocks saved inside page HTML (e.g. the Elementor home page) carry the
 *  category links in whatever order MySQL returned when the page was scraped; re-sort each
 *  <span class="cat"> the way get_the_category() orders them (term_order, then term_id). */
async function sortCatSpans(html: string): Promise<string> {
  if (!html.includes("penci-cat-name")) return html;
  const { getTerms, sortCats } = await import("./data");
  const { byId } = await getTerms();
  return html.replace(/(<span class="cat(?: [^"]*)?">)((?:\s*<a\b[^>]*\bpenci-cat-(\d+)\b[^>]*>[\s\S]*?<\/a>)+)(\s*<\/span>)/g, (m, open, links: string, _id, close) => {
    const parts = Array.from(links.matchAll(/\s*<a\b[^>]*\bpenci-cat-(\d+)\b[^>]*>[\s\S]*?<\/a>/g)).map((x) => ({ id: Number(x[1]), html: x[0] }));
    const terms = parts.map((x) => byId.get(x.id));
    if (terms.some((t) => !t)) return m;
    const order = sortCats(terms as NonNullable<(typeof terms)[number]>[]).map((t) => t.id);
    return open + order.map((id) => parts.find((x) => x.id === id)!.html).join("") + close;
  });
}

/** transformContent + responsive images (server components). */
export async function renderContent(html: string | null | undefined): Promise<string> {
  const { transformContent } = await import("./content");
  return responsiveContent(await sortCatSpans(transformContent(html)));
}
