#!/usr/bin/env node
// Import public WordPress/WooCommerce content from the export into site_emily (via PostgREST, service role).
// Rewrites every old-site URL in content: uploads -> Supabase Storage URLs, internal links -> relative paths.
// Usage: EXPORT_DIR=... WORK_DIR=... node scripts/migrate/import.mjs
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment (never written anywhere).
import fs from 'node:fs';
import path from 'node:path';
import { makeGroupKey } from './media-keys.mjs';

const EXPORT = process.env.EXPORT_DIR;
const WORK = process.env.WORK_DIR;
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: KEY } = process.env;
if (!EXPORT || !WORK || !SUPABASE_URL || !KEY) throw new Error('missing env');
const SCHEMA = 'site_emily';
const rd = (p) => JSON.parse(fs.readFileSync(path.join(EXPORT, p), 'utf8'));
const dec = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

// ------------------------------------------------------------------ REST helpers
async function rest(method, table, body, query = '', prefer = 'return=minimal') {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    method,
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', 'Content-Profile': SCHEMA, 'Accept-Profile': SCHEMA, Prefer: prefer },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${table}${query}: ${r.status} ${t.slice(0, 500)}`);
  return t ? JSON.parse(t) : null;
}
async function upsert(table, rows, onConflict = 'id') {
  for (let i = 0; i < rows.length; i += 200) {
    await rest('POST', table, rows.slice(i, i + 200), `?on_conflict=${onConflict}`, 'resolution=merge-duplicates,return=minimal');
  }
  console.log(`${table}: ${rows.length}`);
}

// ------------------------------------------------------------------ entity decoding (titles -> plain text)
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', middot: '·', bull: '•', times: '×', copy: '©', reg: '®', trade: '™' };
const decodeEntities = (s) => (s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return NAMED[e.toLowerCase()] ?? m;
});
const stripTags = (s) => decodeEntities((s || '').replace(/<[^>]+>/g, '')).trim();

// ------------------------------------------------------------------ media lookup
const plan = JSON.parse(fs.readFileSync(path.join(WORK, 'media_plan.json'), 'utf8'));
const library = rd('rest/media.json');
const libById = new Map(library.map((m) => [m.id, m]));
const groupKey = makeGroupKey(library);
const planByKey = new Map(plan.map((p) => [p.key, p]));
const unresolved = new Map();
function mediaUrlFor(relRaw) {
  const rel = dec(relRaw.split(/[?#]/)[0]);
  const p = planByKey.get(groupKey(rel).key);
  if (!p) { unresolved.set(rel, (unresolved.get(rel) || 0) + 1); return null; }
  return p.public_url;
}

// ------------------------------------------------------------------ URL rewriting
const OLD_HOST = String.raw`(?:https?:)?//(?:www\.)?(?:loveccdd\.com|l5910\.zeabur\.app)`;
const RE_FB = /https?:\/\/l\.facebook\.com\/l\.php\?u=([^&"'\s<>]+)(?:(?:&amp;|&)[^"'\s<>]*)?/gi;
const RE_UPLOAD = new RegExp(`(?:${OLD_HOST}|(?<=["'(\\s=,]))/wp-content/uploads/([^"'\\s<>)]+)`, 'gi');
const RE_LINK = new RegExp(`${OLD_HOST}(/[^"'\\s<>]*)?`, 'gi');
function rewrite(html) {
  if (!html) return html ?? '';
  let out = html.replace(RE_FB, (m, u) => {
    const target = dec(u);
    if (!/^https?:\/\/(?:www\.)?(?:loveccdd\.com|l5910\.zeabur\.app)\b/i.test(target)) return m;
    return target.replace(/([?&])fbclid=[^&#]*&?/, '$1').replace(/[?&]$/, '');
  });
  out = out.replace(RE_UPLOAD, (m, rel) => mediaUrlFor(rel.replace(/&amp;/g, '&')) ?? m);
  out = out.replace(RE_LINK, (m, p) => {
    if (!p) return '/';
    return p.replace(/^\/{2,}/, '/');
  });
  // responsive variant lists now point at one WebP file: drop srcset/sizes that reference it
  out = out.replace(/\s(?:data-)?srcset="[^"]*\/storage\/v1\/object\/public\/[^"]*"/g, '').replace(/\s(?:data-)?sizes="[^"]*"(?=[^<>]*\/storage\/v1\/object\/public\/)/g, '');
  return out;
}
const toPath = (url) => {
  if (!url) return null;
  const u = new URL(url, 'https://loveccdd.com');
  const host = u.hostname.replace(/^www\./, '');
  if (host !== 'loveccdd.com' && host !== 'l5910.zeabur.app') return url;
  return dec(u.pathname).replace(/\/+$/, '') || '/';
};

// ------------------------------------------------------------------ SEO from HTML snapshots
const htmlIndex = rd('html/index.json');
const htmlByPath = new Map();
for (const h of htmlIndex) if (h.status === 200 && h.file) htmlByPath.set(toPath(h.final_url || h.url), h.file);
const attr = (html, re) => { const m = re.exec(html); return m ? decodeEntities(m[1]).trim() : undefined; };
function seoFor(linkPath) {
  const f = htmlByPath.get(linkPath);
  if (!f) return {};
  const fp = path.join(EXPORT, 'html', f);
  if (!fs.existsSync(fp)) return {};
  const html = fs.readFileSync(fp, 'utf8');
  const head = html.slice(0, html.search(/<\/head>/i) + 1 || 200000);
  const seo = {
    title: attr(head, /<title[^>]*>([^<]*)<\/title>/i),
    description: attr(head, /<meta\s+name="description"\s+content="([^"]*)"/i),
    robots: attr(head, /<meta\s+name="robots"\s+content="([^"]*)"/i),
    canonical: attr(head, /<link\s+rel="canonical"\s+href="([^"]*)"/i),
    og_title: attr(head, /<meta\s+property="og:title"\s+content="([^"]*)"/i),
    og_description: attr(head, /<meta\s+property="og:description"\s+content="([^"]*)"/i),
    og_image: attr(head, /<meta\s+property="og:image"\s+content="([^"]*)"/i),
    og_type: attr(head, /<meta\s+property="og:type"\s+content="([^"]*)"/i),
  };
  if (seo.canonical) seo.canonical = toPath(seo.canonical);
  for (const k of ['description', 'og_description', 'og_image', 'title', 'og_title']) if (seo[k]) seo[k] = rewrite(seo[k]);
  for (const k of Object.keys(seo)) if (seo[k] === undefined || seo[k] === '') delete seo[k];
  return seo;
}

const tz = (local) => (local ? `${local}+08:00` : null);
const gmt = (g) => (g ? `${g}Z` : null);

// ================================================================== media rows
const mediaRows = [];
const mapRows = new Map();
const wpIdToMedia = new Map();
for (const p of plan) {
  const st = p.stored;
  if (!st) throw new Error(`media not uploaded: ${p.storage_path}`);
  const ids = p.wp_ids.length ? p.wp_ids : [null];
  let firstId = null;
  for (const wpId of ids) {
    const m = wpId ? libById.get(wpId) : null;
    const baseName = path.posix.basename(p.key).replace(/\.[^.]+$/, '');
    const row = {
      wp_id: wpId, slug: m?.slug ?? null,
      title: m ? decodeEntities(m.title?.rendered) : baseName,
      caption: m ? rewrite(m.caption?.rendered || '') : '',
      description: m ? rewrite(m.description?.rendered || '') : '',
      alt_text: m?.alt_text || '',
      mime_type: st.mime, original_mime_type: m?.mime_type ?? null,
      media_type: st.mime.startsWith('image/') ? 'image' : st.mime.startsWith('video/') ? 'video' : st.mime.startsWith('audio/') ? 'audio' : 'file',
      width: st.width ?? m?.media_details?.width ?? null, height: st.height ?? m?.media_details?.height ?? null,
      filesize: st.size, original_filesize: p.original_bytes,
      parent_post_id: m?.post ?? null, author_id: m?.author ?? null, status: 'inherit',
      date: m ? tz(m.date) : null, modified: m ? tz(m.modified) : null,
      old_file: p.key, old_url: m?.source_url ?? `https://loveccdd.com/wp-content/uploads/${p.key}`,
      storage_path: p.storage_path, public_url: p.public_url,
      link_path: m ? toPath(m.link) : null, sha1: p.sha1, converted: !!st.converted,
      metadata_source: m ? 'rest' : 'html_scan',
      sizes: m?.media_details?.sizes ?? null,
      meta: { source_file: p.source, source_how: p.source_how, ...(p.duplicate_of ? { duplicate_of: p.duplicate_of } : {}), ...(m?.media_details?.image_meta ? { image_meta: m.media_details.image_meta } : {}) },
    };
    if (wpId) row.id = wpId;
    mediaRows.push(row);
  }
}
// rows without wp_id need identity ids: insert them and read back
const withId = mediaRows.filter((r) => r.id);
const noId = mediaRows.filter((r) => !r.id);
await upsert('media', withId);
const existingNoId = await rest('GET', 'media', undefined, '?select=id,old_file&wp_id=is.null');
const noIdByFile = new Map(existingNoId.map((r) => [r.old_file, r.id]));
const toInsert = noId.filter((r) => !noIdByFile.has(r.old_file));
if (toInsert.length) {
  const ins = await rest('POST', 'media', toInsert, '', 'return=representation');
  for (const r of ins) noIdByFile.set(r.old_file, r.id);
}
for (const r of noId) { r.id = noIdByFile.get(r.old_file); await rest('PATCH', 'media', { ...r, id: undefined }, `?id=eq.${r.id}`); }
console.log(`media: ${mediaRows.length} (${noId.length} without wp id)`);
for (const r of mediaRows) if (r.wp_id) wpIdToMedia.set(r.wp_id, r.id);
const mediaIdByKey = new Map();
for (const r of mediaRows) if (!mediaIdByKey.has(r.old_file)) mediaIdByKey.set(r.old_file, r.id);

for (const p of plan) {
  const mid = mediaIdByKey.get(p.key);
  const add = (rel, kind) => { if (!mapRows.has(rel)) mapRows.set(rel, { old_path: rel, media_id: mid, kind, new_url: p.public_url }); };
  add(p.key, p.duplicate_of ? 'duplicate' : 'original');
  for (const rel of p.old_paths) add(rel, groupKey(rel).kind);
  for (const id of p.lib_ids) {
    const m = libById.get(id);
    const dir = path.posix.dirname(p.key);
    const src = /\/wp-content\/uploads\/(.+)$/.exec(m.source_url)?.[1];
    if (src) add(dec(src), groupKey(dec(src)).kind);
    for (const s of Object.values(m.media_details?.sizes || {})) if (s.file) add(path.posix.join(dir, s.file), 'variant');
  }
}
await upsert('media_url_map', [...mapRows.values()], 'old_path');

// ================================================================== authors
const users = rd('rest/users.json');
await upsert('authors', users.map((u) => ({
  id: u.id, slug: u.slug, name: u.name, description: u.description || '', url: toPath(u.url) === '/' ? '/' : (u.url || ''),
  avatar_url: u.avatar_urls?.['96'] ?? null, link_path: toPath(u.link),
})));

// ================================================================== terms
const termSources = [
  ['rest/tax_categories.json', 'category'], ['rest/tax_tags.json', 'post_tag'], ['rest/tax_product_cat.json', 'product_cat'],
  ['rest/tax_product_tag.json', 'product_tag'], ['rest/tax_product_brand.json', 'product_brand'],
];
const terms = [];
for (const [f, tax] of termSources) for (const t of rd(f)) terms.push({
  id: t.id, taxonomy: tax, slug: t.slug, name: decodeEntities(t.name), description: rewrite(t.description || ''),
  parent_id: t.parent || null, count: t.count || 0, link_path: toPath(t.link), seo: seoFor(toPath(t.link)), meta: Array.isArray(t.meta) ? {} : (t.meta || {}),
});
const attrs = rd('rest/store_attributes.json');
const attrTerms = rd('rest/store_attribute_terms.json');
for (const a of attrs) for (const t of attrTerms[String(a.id)] || []) terms.push({
  id: t.id, taxonomy: a.taxonomy, slug: t.slug, name: decodeEntities(t.name), description: t.description || '',
  parent_id: t.parent || null, count: t.count || 0, link_path: null, seo: {}, meta: {},
});
// parents first
const termIds = new Set();
const ordered = [];
let pending = terms;
while (pending.length) {
  const next = [];
  for (const t of pending) (!t.parent_id || termIds.has(t.parent_id) ? (ordered.push(t), termIds.add(t.id)) : next.push(t));
  if (next.length === pending.length) throw new Error('term parent cycle/missing');
  pending = next;
}
await upsert('terms', ordered);
await upsert('product_attributes', attrs.map((a) => ({ id: a.id, name: a.name, slug: a.taxonomy.replace(/^pa_/, ''), type: a.type, order_by: a.order, has_archives: a.has_archives })));

// ================================================================== posts / pages / wp_navigation
const posts = rd('rest/posts.json');
const pages = rd('rest/pages.json');
const navs = rd('rest/navigation.json');
const postRows = [];
const featured = (id) => (id ? wpIdToMedia.get(id) ?? null : null);
for (const p of [...pages.sort((a, b) => (a.parent ? 1 : 0) - (b.parent ? 1 : 0)), ...posts, ...navs]) {
  const lp = toPath(p.link);
  const content = p.content?.rendered || '';
  postRows.push({
    id: p.id, post_type: p.type, slug: p.slug, status: p.status, title: decodeEntities(p.title?.rendered),
    content: rewrite(content), excerpt: rewrite(p.excerpt?.rendered || ''),
    author_id: p.author || null, featured_media_id: featured(p.featured_media), parent_id: p.parent || null,
    menu_order: p.menu_order || 0, template: p.template || '', format: p.format || 'standard', sticky: !!p.sticky,
    comment_status: p.comment_status || 'closed', ping_status: p.ping_status || 'closed',
    builder: /elementor/.test(content) ? 'elementor' : null, link_path: lp,
    date: tz(p.date), date_gmt: gmt(p.date_gmt), modified: tz(p.modified), modified_gmt: gmt(p.modified_gmt),
    seo: seoFor(lp),
    meta: { class_list: Object.values(p.class_list || {}), ...(p.meta && !Array.isArray(p.meta) ? p.meta : {}), guid: p.guid?.rendered, ...(p.featured_media && !featured(p.featured_media) ? { featured_media_wp: p.featured_media } : {}) },
  });
}
await upsert('posts', postRows);
const postTerms = [];
for (const p of posts) {
  (p.categories || []).forEach((t, i) => postTerms.push({ post_id: p.id, term_id: t, term_order: i }));
  (p.tags || []).forEach((t, i) => postTerms.push({ post_id: p.id, term_id: t, term_order: i }));
}
await upsert('post_terms', postTerms, 'post_id,term_id');

// ================================================================== comments
const comments = rd('rest/comments.json');
await upsert('comments', comments.map((c) => ({
  id: c.id, post_id: c.post, object_type: 'post', parent_id: c.parent || null, author_user_id: c.author || null,
  author_name: c.author_name || '', author_url: c.author_url || '', avatar_url: c.author_avatar_urls?.['96'] ?? null,
  content: rewrite(c.content?.rendered || ''), status: c.status === 'approved' ? 'approved' : 'hold', type: c.type || 'comment',
  date: tz(c.date), date_gmt: gmt(c.date_gmt),
})));

// ================================================================== products
const wpProducts = rd('rest/product.json');
const storeProducts = new Map(rd('rest/store_products.json').map((s) => [s.id, s]));
const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
const productRows = [];
const productTerms = [];
for (const p of wpProducts) {
  const s = storeProducts.get(p.id) || {};
  const cls = Object.values(p.class_list || {});
  const pr = s.prices || {};
  const minor = pr.currency_minor_unit ?? 0;
  const money = (v) => (v === undefined || v === null || v === '' ? null : Number(v) / 10 ** minor);
  const lp = toPath(p.link);
  const imgs = (s.images || []).map((i) => wpIdToMedia.get(i.id)).filter(Boolean);
  productRows.push({
    id: p.id, slug: p.slug, name: decodeEntities(p.title?.rendered), type: s.type || 'simple', status: p.status,
    featured: cls.includes('featured'), description: rewrite(s.description ?? p.content?.rendered ?? ''),
    short_description: rewrite(s.short_description ?? p.excerpt?.rendered ?? ''), sku: s.sku || null,
    currency: pr.currency_code || 'TWD',
    regular_price: money(pr.regular_price), sale_price: s.on_sale ? money(pr.sale_price) : null, price: money(pr.price),
    tax_status: cls.includes('taxable') ? 'taxable' : 'none',
    stock_status: s.is_on_backorder ? 'onbackorder' : s.is_in_stock === false ? 'outofstock' : 'instock',
    manage_stock: s.low_stock_remaining != null, stock_quantity: s.low_stock_remaining ?? null,
    sold_individually: !!s.sold_individually,
    min_purchase_qty: s.add_to_cart?.minimum ?? 1, max_purchase_qty: s.add_to_cart?.maximum && s.add_to_cart.maximum < 9999 ? s.add_to_cart.maximum : null,
    purchasable: s.is_purchasable ?? true, virtual: cls.includes('virtual'), downloadable: cls.includes('downloadable'),
    featured_media_id: featured(p.featured_media) ?? imgs[0] ?? null, gallery_media_ids: imgs.slice(1),
    average_rating: Number(s.average_rating || 0), review_count: s.review_count || 0,
    link_path: lp, date: tz(p.date), date_gmt: gmt(p.date_gmt), modified: tz(p.modified), seo: seoFor(lp),
    meta: { class_list: cls, guid: p.guid?.rendered, price_html: s.price_html, add_to_cart: s.add_to_cart, ...(p.meta && !Array.isArray(p.meta) ? p.meta : {}) },
  });
  for (const t of [...(p.product_cat || []), ...(p.product_tag || []), ...(p.product_brand || [])]) productTerms.push({ product_id: p.id, term_id: t });
  for (const v of s.variations || []) console.warn('variation present but no source for details', v);
}
await upsert('products', productRows);
await upsert('product_terms', productTerms, 'product_id,term_id');

// ================================================================== menus
const menusHtml = rd('rest/menus_from_html.json');
const features = rd('features.json');
await rest('DELETE', 'menus', undefined, '?id=gte.0');
const pathIndex = new Map();
for (const r of postRows) if (r.link_path) pathIndex.set(r.link_path, { object_type: r.post_type, object_id: r.id });
for (const t of ordered) if (t.link_path) pathIndex.set(t.link_path, { object_type: t.taxonomy, object_id: t.id });
for (const r of productRows) pathIndex.set(r.link_path, { object_type: 'product', object_id: r.id });
let menuItemCount = 0;
const LOC_NAMES = { 'menu-beta': '主選單', 'menu-footer-menu': '頁尾選單', 'menu-beta-1': '主選單（行動版）' };
for (const [loc, items] of Object.entries(menusHtml)) {
  const [menu] = await rest('POST', 'menus', { slug: loc, name: LOC_NAMES[loc] || loc, location: loc, source: 'html' }, '', 'return=representation');
  const insert = async (list, parent) => {
    for (const [i, it] of list.entries()) {
      const url = /^https?:/.test(it.url) ? (toPath(it.url).startsWith('http') ? it.url : toPath(it.url)) : it.url;
      const obj = pathIndex.get(url) || { object_type: 'custom', object_id: null };
      const [row] = await rest('POST', 'menu_items', { menu_id: menu.id, parent_id: parent, position: i, title: decodeEntities(it.title), url, target: it.target || null, ...obj, classes: it.classes || [] }, '', 'return=representation');
      menuItemCount++;
      if (it.children?.length) await insert(it.children, row.id);
    }
  };
  await insert(items, null);
}
for (const n of navs) await rest('POST', 'menus', { id: n.id, slug: `wp-navigation-${n.slug}`, name: decodeEntities(n.title?.rendered), location: null, source: 'wp_navigation' });
console.log(`menus: ${Object.keys(menusHtml).length + navs.length}, menu_items: ${menuItemCount}`);

// ================================================================== settings
const root = rd('rest/root.json');
const tokens = fs.existsSync(path.join(EXPORT, 'design/tokens.json')) ? rd('design/tokens.json') : null;
const cart = rd('rest/store_cart.json');
const settings = [
  { key: 'general', is_public: true, value: { name: root.name, description: root.description, home: '/', timezone: root.timezone_string || 'Asia/Taipei', gmt_offset: Number(root.gmt_offset), language: 'zh-TW', site_icon_url: rewrite(root.site_icon_url || ''), old_url: root.url } },
  { key: 'permalinks', is_public: true, value: { post: '/%postname%', page: '/%pagename%', category_base: 'category', tag_base: 'tag', author_base: 'author', product_base: 'product', product_category_base: 'product-category', product_tag_base: 'product-tag' } },
  { key: 'reading', is_public: true, value: { show_on_front: 'page', page_on_front: 6624, page_for_posts: null, blog_page_path: '/blog', posts_per_page: 10 } },
  { key: 'comments', is_public: true, value: { default_comment_status: 'open', require_name_email: true, moderation: true } },
  { key: 'woocommerce', is_public: true, value: { currency: cart.totals?.currency_code || 'TWD', currency_symbol: cart.totals?.currency_symbol || 'NT$', currency_minor_unit: cart.totals?.currency_minor_unit ?? 0, price_thousand_sep: ',', price_decimal_sep: '.', default_country: 'TW', shop_page_id: 6, cart_page_id: 7, checkout_page_id: 8, myaccount_page_id: 9, payment_methods: cart.payment_methods, payment_note: '新站不串接真實金流，只建立待付款訂單', coupons_enabled: true, wishlist_path: '/wishlist', compare_path: '/compare' } },
  { key: 'tracking', is_public: true, value: features.tracking_summary ? { gtm: 'GTM-TG4K2VR', ga4: 'G-D4TVJ4514B', facebook_pixel: '2908067342800431' } : {} },
  { key: 'social', is_public: true, value: { facebook: 'https://www.facebook.com/ccddandme' } },
  { key: 'theme', is_public: true, value: { source_theme: features.theme, tokens: tokens ? JSON.parse(rewrite(JSON.stringify(tokens))) : null, features: { sticky_header: true, sticky_sidebar: true, product_lightbox: 'photoswipe', quick_view: true, go_to_top: true, infinite_scroll: true } } },
  { key: 'seo', is_public: true, value: { plugin: 'rank_math', sitemaps: Object.keys(rd('urls.json').sitemaps || {}).map(toPath) } },
  { key: 'newsletter', is_public: false, value: features.newsletter_crm || {} },
];
await upsert('settings', settings, 'key');

// ================================================================== forms (public definitions observed in HTML)
const formDefs = [];
const seenForms = new Map();
const kindOf = (f) => f.class === 'pc-searchform' ? ['search', '站內搜尋'] : f.id === 'commentform' ? ['comment', '文章留言'] : /login/.test(f.class || '') ? ['login', '會員登入']
  : /ordering/.test(f.class || '') ? ['ordering', '商品排序'] : f.fields.some((x) => x.name === 'min_price') ? ['product_price_filter', '價格篩選'] : f.class === 'cart' ? ['add_to_cart', '加入購物車'] : ['other', f.class || 'form'];
for (const f of features.forms || []) {
  const [kind, title] = kindOf(f);
  const slug = kind.replace(/_/g, '-');
  const pagesList = (f.pages || []).map(toPath);
  if (seenForms.has(slug)) { const d = seenForms.get(slug); d.pages = [...new Set([...d.pages, ...pagesList])]; continue; }
  const d = { slug, title, kind, source: f.class === 'pc-searchform' ? 'soledad' : kind === 'comment' ? 'wordpress' : 'woocommerce', status: 'publish',
    action: f.action ? toPath(f.action) : null, method: (f.method || 'post').toLowerCase(),
    fields: f.fields.filter((x) => x.name && !/nonce/.test(x.name)).map((x) => ({ name: x.name, type: x.type || x.tag, required: !!x.required, placeholder: x.placeholder ?? null })),
    settings: {}, pages: pagesList };
  seenForms.set(slug, d); formDefs.push(d);
}
await upsert('forms', formDefs, 'slug');

// ================================================================== redirects (old attachment pages -> file)
const taken = new Set([...postRows.map((r) => r.link_path), ...ordered.map((t) => t.link_path), ...productRows.map((r) => r.link_path)]);
const redirects = [];
const seenR = new Set();
for (const r of mediaRows) {
  if (!r.link_path || r.link_path === '/' || taken.has(r.link_path) || seenR.has(r.link_path)) continue;
  seenR.add(r.link_path);
  redirects.push({ source_path: r.link_path, target: r.public_url, status_code: 301, kind: 'attachment' });
}
await upsert('redirects', redirects, 'source_path');

// ================================================================== report
const leftovers = {};
for (const r of postRows) for (const [k, re] of Object.entries({ 'loveccdd.com': /loveccdd\.com/g, 'l5910.zeabur.app': /l5910\.zeabur\.app/g, '/wp-content/uploads/': /\/wp-content\/uploads\//g })) {
  const n = (r.content.match(re) || []).length + (r.excerpt.match(re) || []).length;
  if (n) leftovers[k] = (leftovers[k] || 0) + n;
}
fs.writeFileSync(path.join(WORK, 'import_report.json'), JSON.stringify({ unresolved: Object.fromEntries(unresolved), leftovers }, null, 1));
console.log('unresolved upload refs:', unresolved.size, 'leftover old-domain refs in posts:', JSON.stringify(leftovers));
