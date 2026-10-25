import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Request pre-processing that reproduces WordPress URL behaviour:
 *  - "/path/" -> 301 "/path" (WordPress permalinks had no trailing slash)
 *  - old attachment pages (site_emily.redirects) -> 301 to the file
 *  - /wp-content/uploads/... (incl. size variants) -> 301 to the migrated file
 *  - Rank Math sitemaps and the RSS feed are served by route handlers
 * It also forwards the request path to the root layout (body class / per-page CSS).
 */

type RedirectMap = Map<string, { target: string; status: number }>;
let redirects: { at: number; map: RedirectMap } | null = null;
let loading: Promise<RedirectMap> | null = null;

function rest(path: string) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Accept-Profile": "site_emily" },
    cache: "no-store",
  });
}

async function loadRedirects(): Promise<RedirectMap> {
  if (redirects && Date.now() - redirects.at < 5 * 60_000) return redirects.map;
  if (loading) return loading;
  loading = (async () => {
    const map: RedirectMap = new Map();
    for (let from = 0; from < 50_000; from += 1000) {
      const r = rest(`redirects?select=source_path,target,status_code&order=id&offset=${from}&limit=1000`);
      if (!r) break;
      const res = await r;
      if (!res.ok) break;
      const rows = (await res.json()) as { source_path: string; target: string; status_code: number }[];
      for (const x of rows) map.set(x.source_path.replace(/\/$/, "").toLowerCase(), { target: x.target, status: x.status_code });
      if (rows.length < 1000) break;
    }
    redirects = { at: Date.now(), map };
    loading = null;
    return map;
  })().catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}

async function uploadTarget(oldPath: string): Promise<string | null> {
  const r = rest(`media_url_map?select=new_url&old_path=eq.${encodeURIComponent(oldPath)}&limit=1`);
  if (!r) return null;
  const res = await r;
  if (!res.ok) return null;
  const rows = (await res.json()) as { new_url: string }[];
  if (rows[0]) return rows[0].new_url;
  // "-scaled" / "-WxH" variants that were never recorded: try the original name
  const base = oldPath.replace(/-(?:scaled|\d+x\d+)(\.[a-z0-9]+)$/i, "$1");
  if (base !== oldPath) return uploadTarget(base);
  return null;
}

function decode(p: string) {
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
}

/** Keeps the /admin Supabase session fresh (refresh-token rotation must happen where cookies can be written). */
async function adminSession(req: NextRequest, path: string) {
  const supaUrl = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  const fwd = () => {
    const h = new Headers(req.headers);
    h.set("x-pathname", path);
    h.set("x-search", req.nextUrl.search);
    return h;
  };
  let res = NextResponse.next({ request: { headers: fwd() } });
  if (!supaUrl || !anon || !req.cookies.getAll().some((c) => c.name.startsWith("emily-admin-auth"))) return res;
  const opts = { path: "/", sameSite: "lax" as const, httpOnly: true, secure: process.env.NODE_ENV === "production" };
  const sb = createServerClient(supaUrl, anon, {
    cookieOptions: { name: "emily-admin-auth", ...opts },
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) req.cookies.set(name, value);
        res = NextResponse.next({ request: { headers: fwd() } });
        for (const { name, value, options } of list) res.cookies.set(name, value, { ...options, ...opts });
      },
    },
  });
  await sb.auth.getUser().catch(() => null);
  res.headers.set("x-robots-tag", "noindex, nofollow");
  res.headers.set("cache-control", "private, no-store");
  return res;
}

export async function proxy(req: NextRequest) {
  const url = req.nextUrl;
  const path = url.pathname;

  if (path === "/admin" || path.startsWith("/admin/") || path.startsWith("/admin-preview/")) {
    if (path.length > 1 && path.endsWith("/")) {
      const to = new URL(req.url);
      to.pathname = path.replace(/\/+$/, "");
      return NextResponse.redirect(to.toString(), 308);
    }
    return adminSession(req, path);
  }

  if (path.startsWith("/_next") || path.startsWith("/api/") || path.startsWith("/wp/")) return NextResponse.next();
  // internal route for uncached rendering; only reachable through the rewrite below
  if (path === "/dyn__" || path.startsWith("/dyn__/")) return new NextResponse("Not found", { status: 404 });

  // trailing slash -> 301 (keep query)
  if (path.length > 1 && path.endsWith("/")) {
    const to = new URL(req.url);
    to.pathname = path.replace(/\/+$/, "");
    return NextResponse.redirect(to.toString(), 301);
  }

  // Rank Math "date archives disabled": /YYYY, /YYYY/MM, /YYYY/MM/DD (+ /page/N) -> 301 home, like the old site
  if (/^\/\d{4}(?:\/\d{1,2}(?:\/\d{1,2})?)?(?:\/page\/\d+)?$/.test(path)) {
    return NextResponse.redirect(new URL("/", req.url).toString(), 301);
  }

  // Rank Math sitemaps + RSS feed
  if (path === "/sitemap_index.xml" || path === "/sitemap.xml" || path === "/wp-sitemap.xml") {
    return NextResponse.rewrite(new URL("/api/sitemap/index", req.url));
  }
  const sm = /^\/(post|page|product|category)-sitemap(\d*)\.xml$/.exec(path);
  if (sm) return NextResponse.rewrite(new URL(`/api/sitemap/${sm[1]}-${sm[2]}`, req.url));
  if (path === "/feed" || path === "/feed/rss2" || path === "/feed/atom" || path === "/comments/feed") {
    return NextResponse.rewrite(new URL("/api/feed", req.url));
  }

  // old uploads
  if (path.startsWith("/wp-content/uploads/")) {
    const target = await uploadTarget(decode(path.slice("/wp-content/uploads/".length)));
    if (target) return NextResponse.redirect(target, 301);
    return new NextResponse("Not found", { status: 404 });
  }

  // attachment pages and other stored redirects
  try {
    const map = await loadRedirects();
    const hit = map.get(decode(path).toLowerCase());
    if (hit) {
      const to = /^https?:\/\//.test(hit.target) ? hit.target : new URL(hit.target, req.url).toString();
      return NextResponse.redirect(to, hit.status === 302 ? 302 : 301);
    }
  } catch {
    /* redirects are best-effort; fall through to the page */
  }

  const headers = new Headers(req.headers);
  headers.set("x-pathname", path);
  headers.set("x-search", url.search);
  // Cached (ISR) storefront unless the response depends on the query string or on the visitor's cart.
  if (needsDynamic(path, url.searchParams)) {
    const to = new URL(req.url);
    to.pathname = "/dyn__" + (path === "/" ? "" : path);
    return NextResponse.rewrite(to, { request: { headers } });
  }
  return NextResponse.next({ request: { headers } });
}

// Query parameters that never change the page (ad / analytics click ids): ignored when choosing cached vs dynamic.
const TRACKING = /^(utm_[a-z_]+|fbclid|gclid|gbraid|wbraid|msclkid|yclid|mc_cid|mc_eid|_ga|_gl|igshid|ref|srsltid)$/i;
const DYNAMIC_FIRST = new Set(["cart", "cart-2", "checkout", "checkout-2", "my-account", "my-account-2"]);

function needsDynamic(path: string, sp: URLSearchParams): boolean {
  const first = decode(path.split("/")[1] ?? "").toLowerCase();
  if (DYNAMIC_FIRST.has(first)) return true;
  for (const k of sp.keys()) if (!TRACKING.test(k)) return true;
  return false;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
