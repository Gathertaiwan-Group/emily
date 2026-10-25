#!/usr/bin/env node
// Import the PRIVATE WordPress data (DB dump, contains personal data) into site_emily via PostgREST (service role):
// customers, orders (+items, shipping lines, notes), comments (+private author fields), WordPress nav menus,
// draft/private posts & pages (+terms), attachment metadata not in the public REST library, newsletter forms,
// WooCommerce / Rank Math / theme settings. Idempotent (upserts on primary keys).
// Never prints row contents — only counts.
// Usage: DB_DIR=... EXPORT_DIR=... WORK_DIR=... node scripts/migrate/import-private.mjs
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment (never written anywhere).
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { table, metaMap, unserialize, tz, gmt, num, dec } from './wpdb.mjs';
import { makeGroupKey, uploadsRel } from './media-keys.mjs';

const { DB_DIR, EXPORT_DIR: EXPORT, WORK_DIR: WORK, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: KEY } = process.env;
if (!DB_DIR || !EXPORT || !WORK || !SUPABASE_URL || !KEY) throw new Error('missing env');
const SCHEMA = 'site_emily';
const T = (n) => table(DB_DIR, n);

// ------------------------------------------------------------------ REST helpers
async function rest(method, tbl, body, query = '', prefer = 'return=minimal') {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${tbl}${query}`, {
    method,
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', 'Content-Profile': SCHEMA, 'Accept-Profile': SCHEMA, Prefer: prefer },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${tbl}: ${r.status} ${t.slice(0, 300).replace(/"[^"]*@[^"]*"/g, '"<redacted>"')}`);
  return t ? JSON.parse(t) : null;
}
async function upsert(tbl, rows, onConflict = 'id') {
  for (let i = 0; i < rows.length; i += 200) {
    await rest('POST', tbl, rows.slice(i, i + 200), `?on_conflict=${onConflict}`, 'resolution=merge-duplicates,return=minimal');
  }
  console.log(`${tbl}: ${rows.length}`);
}
async function selectAll(tbl, cols, filter = '') {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${tbl}?select=${cols}${filter}`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Accept-Profile': SCHEMA, Range: `${from}-${from + 999}` },
    });
    if (!r.ok) throw new Error(`select ${tbl}: ${r.status}`);
    const rows = await r.json();
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

// ------------------------------------------------------------------ source tables
const posts = T('wp_posts');
const postById = new Map(posts.map((p) => [p.ID, p]));
const pm = metaMap(T('wp_postmeta'), 'post_id');
const um = metaMap(T('wp_usermeta'), 'user_id');
const users = new Map(T('wp_users').map((u) => [u.ID, u]));
const options = new Map(T('wp_options').map((o) => [o.option_name, o.option_value]));
const comments = T('wp_comments');
const terms = new Map(T('wp_terms').map((t) => [t.term_id, t]));
const ttax = T('wp_term_taxonomy');
const ttById = new Map(ttax.map((t) => [t.term_taxonomy_id, t]));
const rels = T('wp_term_relationships');

// ------------------------------------------------------------------ URL rewriting (old site -> new)
const plan = JSON.parse(fs.readFileSync(path.join(WORK, 'media_plan.json'), 'utf8'));
const privPlan = fs.existsSync(path.join(WORK, 'private_media_plan.json')) ? JSON.parse(fs.readFileSync(path.join(WORK, 'private_media_plan.json'), 'utf8')) : {};
const library = JSON.parse(fs.readFileSync(path.join(EXPORT, 'rest/media.json'), 'utf8'));
const groupKey = makeGroupKey(library);
const planByKey = new Map(plan.map((p) => [p.key, p]));
const privByPath = new Map(); // any old uploads path of a private attachment -> entry
const VAR = /^(.*)-(\d+)x(\d+)(\.[A-Za-z0-9]+)$/;
for (const e of Object.values(privPlan)) {
  if (!e.done) continue;
  const md = unserialize(pm.get(e.id)?._wp_attachment_metadata) || {};
  const dir = path.posix.dirname(e.attached);
  const add = (rel, kind) => { if (rel && !privByPath.has(rel)) privByPath.set(rel, { e, kind }); };
  add(e.attached, 'original');
  if (md.original_image) add(path.posix.join(dir, md.original_image), 'original');
  add(e.attached.replace(/-scaled(\.[^.]+)$/, '$1'), 'original');
  for (const s of Object.values(md.sizes || {})) if (s?.file) add(path.posix.join(dir, s.file), 'variant');
}
const unresolved = new Map();
function mediaUrlFor(relRaw) {
  const rel = dec(relRaw.split(/[?#]/)[0]);
  const pe = privByPath.get(rel);
  if (pe) return pe.e.public_url;
  const p = planByKey.get(groupKey(rel).key);
  if (p) return p.public_url;
  const v = VAR.exec(rel);
  if (v && privByPath.has(v[1] + v[4])) return privByPath.get(v[1] + v[4]).e.public_url;
  unresolved.set(rel, (unresolved.get(rel) || 0) + 1);
  return null;
}
const OLD_HOST = String.raw`(?:https?:)?//(?:www\.)?(?:loveccdd\.com|l5910\.zeabur\.app)`;
const RE_UPLOAD = new RegExp(`(?:${OLD_HOST}|(?<=["'(\\s=,]))/wp-content/uploads/([^"'\\s<>)\\\\]+)`, 'gi');
const RE_LINK = new RegExp(`${OLD_HOST}(/[^"'\\s<>\\\\]*)?`, 'gi');
function rewrite(html) {
  if (!html) return html ?? '';
  let out = html.replace(RE_UPLOAD, (m, rel) => mediaUrlFor(rel.replace(/&amp;/g, '&')) ?? m);
  out = out.replace(RE_LINK, (m, p) => (p ? p.replace(/^\/{2,}/, '/') : '/'));
  out = out.replace(/\s(?:data-)?srcset="[^"]*\/storage\/v1\/object\/public\/[^"]*"/g, '');
  return out;
}
const toPath = (url) => {
  if (!url) return url;
  try {
    const u = new URL(url, 'https://loveccdd.com');
    const host = u.hostname.replace(/^www\./, '');
    if (host !== 'loveccdd.com' && host !== 'l5910.zeabur.app') return url;
    return (dec(u.pathname).replace(/\/+$/, '') || '/') + u.search + u.hash;
  } catch { return url; }
};

// classic-editor content -> paragraphs (simplified wpautop)
function autop(s) {
  if (!s || s.includes('<!-- wp:') || !/\n/.test(s)) return s;
  const BLOCK = /^\s*<\/?(p|div|h[1-6]|ul|ol|li|blockquote|table|figure|pre|hr|iframe|section|img|br)\b/i;
  return s.replace(/\r\n/g, '\n').split(/\n\s*\n/).map((para) => {
    const t = para.trim();
    if (!t) return '';
    if (BLOCK.test(t)) return t;
    return `<p>${t.replace(/\n/g, '<br />\n')}</p>`;
  }).filter(Boolean).join('\n\n');
}

const ip = (v) => (v && net.isIP(v) ? v : null);
const stats = {};

// ================================================================== 1. attachment metadata from DB
const mediaRows = [];
const mapRows = [];
for (const e of Object.values(privPlan)) {
  if (!e.done) continue;
  const a = postById.get(e.id);
  const meta = pm.get(e.id) || {};
  const md = unserialize(meta._wp_attachment_metadata) || {};
  const oldFile = e.attached.replace(/-scaled(\.[^.]+)$/, '$1');
  const sizes = Object.fromEntries(Object.entries(md.sizes || {}).map(([k, s]) => [k, { file: s.file, width: s.width, height: s.height, mime_type: s['mime-type'] }]));
  mediaRows.push({
    id: e.id, wp_id: e.id, slug: a.post_name || null, title: a.post_title || '', caption: a.post_excerpt || '', description: a.post_content || '',
    alt_text: meta._wp_attachment_image_alt || '', mime_type: e.mime, original_mime_type: a.post_mime_type,
    media_type: /^image\//.test(a.post_mime_type) ? 'image' : /^video\//.test(a.post_mime_type) ? 'video' : /^audio\//.test(a.post_mime_type) ? 'audio' : 'file',
    width: e.width, height: e.height, filesize: e.size, original_filesize: md.filesize ?? e.original_bytes,
    parent_post_id: a.post_parent || null, author_id: a.post_author || null, status: 'inherit',
    date: tz(a.post_date), modified: tz(a.post_modified), old_file: oldFile,
    old_url: `https://loveccdd.com/wp-content/uploads/${e.attached}`, storage_path: e.storage_path, public_url: e.public_url,
    link_path: null, sha1: e.sha1, converted: e.converted, metadata_source: 'db', sizes,
    meta: { original_width: md.width ?? null, original_height: md.height ?? null, original_image: md.original_image ?? null, parent_status: postById.get(a.post_parent)?.post_status ?? null },
    variants: e.variants,
  });
}
for (const [rel, { e, kind }] of privByPath) mapRows.push({ old_path: rel, media_id: e.id, kind, new_url: e.public_url });
stats.media_db = mediaRows.length;
if (mediaRows.length) {
  await upsert('media', mediaRows);
  await upsert('media_url_map', mapRows, 'old_path');
}
const mediaIds = new Set((await selectAll('media', 'id')).map((m) => Number(m.id)));

// ================================================================== 2. draft / private posts and pages
const existingPosts = await selectAll('posts', 'id,post_type,slug,parent_id');
const takenSlugs = new Set(existingPosts.map((p) => `${p.post_type}|${p.slug}|${p.parent_id ?? ''}`));
const existingIds = new Set(existingPosts.map((p) => Number(p.id)));
const authorIds = new Set((await selectAll('authors', 'id')).map((a) => Number(a.id)));
const termRows = await selectAll('terms', 'id,taxonomy,link_path');
const termIds = new Set(termRows.map((t) => Number(t.id)));
const drafts = posts.filter((p) => ['post', 'page'].includes(p.post_type) && ['draft', 'private', 'pending', 'future'].includes(p.post_status));
const slugify = (title, id) => {
  const base = (title || '').trim().toLowerCase().replace(/[\s　]+/g, '-').replace(/[^\p{L}\p{N}_-]/gu, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return base ? encodeURIComponent(base).toLowerCase() : String(id);
};
const postRows = [];
for (const p of drafts) {
  const meta = pm.get(p.ID) || {};
  let slug = p.post_name || slugify(p.post_title, p.ID);
  const parent = p.post_parent && (existingIds.has(p.post_parent) || drafts.some((d) => d.ID === p.post_parent)) ? p.post_parent : null;
  if (!existingIds.has(p.ID)) {
    let s = slug, n = 2;
    while (takenSlugs.has(`${p.post_type}|${s}|${parent ?? ''}`)) s = `${slug}-${n++}`;
    slug = s;
    takenSlugs.add(`${p.post_type}|${slug}|${parent ?? ''}`);
  }
  const thumb = Number(meta._thumbnail_id) || null;
  postRows.push({
    id: p.ID, post_type: p.post_type, slug, status: p.post_status, title: p.post_title || '',
    content: rewrite(autop(p.post_content || '')), excerpt: rewrite(p.post_excerpt || ''),
    author_id: authorIds.has(p.post_author) ? p.post_author : null,
    featured_media_id: thumb && mediaIds.has(thumb) ? thumb : null,
    parent_id: parent, menu_order: p.menu_order || 0,
    template: meta._wp_page_template && meta._wp_page_template !== 'default' ? meta._wp_page_template : '',
    format: 'standard', sticky: false, comment_status: p.comment_status || 'open', ping_status: p.ping_status || 'open',
    builder: meta._elementor_edit_mode === 'builder' ? 'elementor' : null, link_path: null,
    date: tz(p.post_date), date_gmt: gmt(p.post_date_gmt), modified: tz(p.post_modified), modified_gmt: gmt(p.post_modified_gmt),
    seo: {}, meta: { guid: p.guid, source: 'db', primary_category: meta.rank_math_primary_category ? Number(meta.rank_math_primary_category) : undefined, wp_slug_empty: !p.post_name || undefined },
  });
}
// parents first (page hierarchy)
postRows.sort((a, b) => (a.parent_id ? 1 : 0) - (b.parent_id ? 1 : 0) || a.id - b.id);
stats.posts_private = postRows.length;
await upsert('posts', postRows);
const draftIds = new Set(postRows.map((r) => r.id));
const ptRows = [];
for (const r of rels) {
  if (!draftIds.has(r.object_id)) continue;
  const tt = ttById.get(r.term_taxonomy_id);
  if (!tt || !termIds.has(tt.term_id)) continue;
  ptRows.push({ post_id: r.object_id, term_id: tt.term_id, term_order: r.term_order || 0 });
}
stats.post_terms_private = ptRows.length;
await upsert('post_terms', ptRows, 'post_id,term_id');

// ================================================================== 3. customers
const lookup = T('wp_wc_customer_lookup');
const orderStats = new Map(T('wp_wc_order_stats').map((s) => [s.order_id, s]));
const orderPosts = posts.filter((p) => p.post_type === 'shop_order' || p.post_type === 'shop_order_refund');
const ADDR = ['first_name', 'last_name', 'company', 'address_1', 'address_2', 'city', 'state', 'postcode', 'country', 'email', 'phone'];
const addr = (m, prefix, keys = ADDR) => {
  const o = {};
  for (const k of keys) { const v = m[`${prefix}${k}`]; if (v !== undefined && v !== '') o[k] = v; }
  return o;
};
const PAID = new Set(['wc-processing', 'wc-completed']);
const custRows = [];
for (const c of lookup) {
  const mine = orderPosts.filter((o) => o.post_type === 'shop_order' && orderStats.get(o.ID)?.customer_id === c.customer_id).sort((a, b) => b.ID - a.ID);
  const latest = mine[0] ? pm.get(mine[0].ID) || {} : {};
  const u = c.user_id ? users.get(c.user_id) : null;
  const m = c.user_id ? um.get(c.user_id) || {} : {};
  let billing = c.user_id ? addr(m, 'billing_') : {};
  let shipping = c.user_id ? addr(m, 'shipping_', ADDR.filter((k) => k !== 'email')) : {};
  if (!Object.keys(billing).length) billing = addr(latest, '_billing_');
  if (!Object.keys(shipping).length) shipping = addr(latest, '_shipping_', ADDR.filter((k) => k !== 'email'));
  const caps = unserialize(m.wp_capabilities) || {};
  const paid = mine.filter((o) => PAID.has(o.post_status));
  custRows.push({
    id: c.customer_id, email: c.email || billing.email || null, username: c.username || u?.user_login || null,
    first_name: c.first_name || '', last_name: c.last_name || '', display_name: u?.display_name || [c.last_name, c.first_name].filter(Boolean).join('') || '',
    role: 'customer', billing, shipping, is_paying_customer: paid.length > 0, order_count: mine.length,
    total_spent: paid.reduce((s, o) => s + num(pm.get(o.ID)?._order_total), 0),
    date_created: gmt(c.date_registered) || (mine.length ? gmt(mine[mine.length - 1].post_date_gmt) : null), date_last_active: gmt(c.date_last_active),
    meta: { wp_user_id: c.user_id ?? null, wp_role: Object.keys(caps)[0] ?? null, guest: !c.user_id, source: 'wc_customer_lookup' },
  });
}
stats.customers = custRows.length;
await upsert('customers', custRows);

// ================================================================== 4. orders, items, notes
const OMETA_SKIP = /^(_billing_|_shipping_|_order_key$|_order_total$|_order_tax$|_order_shipping|_cart_discount|_customer_|_payment_method|_transaction_id$|_created_via$|_order_currency$|_prices_include_tax$|_edit_|pys_|_pys_|_cart_hash$)/;
const BILLING_EXTRA = ['Buyer', 'UBN', 'invoiceFlag', 'invoiceFlagNum', 'needUBN'];
const orderRows = [], itemRows = [], noteRows = [];
const items = T('wp_woocommerce_order_items');
const imeta = metaMap(T('wp_woocommerce_order_itemmeta'), 'order_item_id');
for (const o of orderPosts.sort((a, b) => a.ID - b.ID)) {
  const m = pm.get(o.ID) || {};
  const st = orderStats.get(o.ID) || {};
  const billing = addr(m, '_billing_');
  for (const k of BILLING_EXTRA) if (m[`_billing_${k}`] !== undefined && m[`_billing_${k}`] !== '') billing[k] = m[`_billing_${k}`];
  const shipping = addr(m, '_shipping_', ADDR.filter((k) => k !== 'email'));
  for (const k of Object.keys(m)) if (k.startsWith('_shipping_cvs_')) shipping[k.slice(10)] = m[k];
  const myItems = items.filter((i) => i.order_id === o.ID);
  const lineSubtotal = myItems.filter((i) => i.order_item_type === 'line_item').reduce((s, i) => s + num(imeta.get(i.order_item_id)?._line_subtotal), 0);
  const meta = {};
  for (const [k, v] of Object.entries(m)) if (!OMETA_SKIP.test(k)) meta[k.replace(/^_/, '')] = v;
  orderRows.push({
    id: o.ID, parent_id: o.post_type === 'shop_order_refund' ? o.post_parent : null, type: o.post_type,
    order_key: m._order_key || null, number: String(o.ID), status: o.post_status.replace(/^wc-/, ''),
    currency: m._order_currency || 'TWD', customer_id: st.customer_id ?? null, billing_email: billing.email || null, billing, shipping,
    payment_method: m._payment_method || null, payment_method_title: m._payment_method_title || null, transaction_id: m._transaction_id || null,
    customer_note: o.post_excerpt || null, prices_include_tax: m._prices_include_tax === 'yes',
    subtotal: lineSubtotal, discount_total: num(m._cart_discount), discount_tax: num(m._cart_discount_tax),
    shipping_total: num(m._order_shipping), shipping_tax: num(m._order_shipping_tax), cart_tax: num(m._order_tax),
    total_tax: num(m._order_tax) + num(m._order_shipping_tax), total: num(m._order_total),
    customer_ip: ip(m._customer_ip_address), customer_user_agent: m._customer_user_agent || null, created_via: m._created_via || null,
    date_created: gmt(o.post_date_gmt) || tz(o.post_date), date_modified: gmt(o.post_modified_gmt) || tz(o.post_modified),
    date_paid: gmt(st.date_paid) || (m._date_paid ? new Date(Number(m._date_paid) * 1000).toISOString() : null),
    date_completed: gmt(st.date_completed) || (m._date_completed ? new Date(Number(m._date_completed) * 1000).toISOString() : null),
    meta,
  });
  for (const i of myItems) {
    const im = imeta.get(i.order_item_id) || {};
    if (i.order_item_type === 'line_item') {
      const qty = num(im._qty) || 1;
      const attrs = {};
      for (const [k, v] of Object.entries(im)) if (!k.startsWith('_')) attrs[dec(k)] = v;
      itemRows.push({
        id: i.order_item_id, order_id: o.ID, item_type: 'line_item', name: i.order_item_name,
        product_id: num(im._product_id) || null, variation_id: num(im._variation_id) || null, sku: null, quantity: qty,
        unit_price: num(im._line_subtotal) / qty, subtotal: num(im._line_subtotal), subtotal_tax: num(im._line_subtotal_tax),
        total: num(im._line_total), total_tax: num(im._line_tax), meta: { attributes: attrs, tax_class: im._tax_class || '' },
      });
    } else {
      const type = ['shipping', 'fee', 'coupon', 'tax'].includes(i.order_item_type) ? i.order_item_type : 'fee';
      const extra = {};
      for (const [k, v] of Object.entries(im)) if (!['cost', 'total_tax', 'taxes', '_line_total', '_line_tax'].includes(k)) extra[dec(k)] = v;
      itemRows.push({
        id: i.order_item_id, order_id: o.ID, item_type: type, name: i.order_item_name, product_id: null, variation_id: null, sku: null,
        quantity: 1, unit_price: null, subtotal: num(im.cost ?? im._line_total ?? im.discount_amount), subtotal_tax: 0,
        total: num(im.cost ?? im._line_total ?? im.discount_amount), total_tax: num(im.total_tax ?? im._line_tax), meta: extra,
      });
    }
  }
}
for (const c of comments) {
  if (c.comment_type !== 'order_note') continue;
  if (!postById.has(c.comment_post_ID)) continue;
  noteRows.push({ id: c.comment_ID, order_id: c.comment_post_ID, content: c.comment_content, is_customer_note: false, added_by: c.comment_author || 'WooCommerce', date: gmt(c.comment_date_gmt) || tz(c.comment_date) });
}
stats.orders = orderRows.length; stats.order_items = itemRows.length; stats.order_notes = noteRows.length;
await upsert('orders', orderRows);
await upsert('order_items', itemRows);
await upsert('order_notes', noteRows);

// ================================================================== 5. comments (+ private fields)
const STATUS = { 1: 'approved', 0: 'hold', spam: 'spam', trash: 'trash', 'post-trashed': 'trash' };
const cRows = [], cpRows = [];
const cs = comments.filter((c) => c.comment_type !== 'order_note').sort((a, b) => a.comment_ID - b.comment_ID);
const cIds = new Set(cs.map((c) => c.comment_ID));
for (const c of cs) {
  const target = postById.get(c.comment_post_ID);
  cRows.push({
    id: c.comment_ID, post_id: c.comment_post_ID, object_type: target?.post_type === 'product' ? 'product' : 'post',
    parent_id: c.comment_parent && cIds.has(c.comment_parent) ? c.comment_parent : null, author_user_id: c.user_id || null,
    author_name: c.comment_author || '', author_url: c.comment_author_url || '', content: c.comment_content || '',
    status: STATUS[c.comment_approved] ?? 'hold', type: c.comment_type || 'comment',
    date: tz(c.comment_date) || gmt(c.comment_date_gmt), date_gmt: gmt(c.comment_date_gmt),
  });
  cpRows.push({ comment_id: c.comment_ID, author_email: c.comment_author_email || null, author_ip: ip(c.comment_author_IP), user_agent: c.comment_agent || null });
}
stats.comments = cRows.length;
// parents before children
const ordered = [], seen = new Set();
const visit = (r) => { if (seen.has(r.id)) return; if (r.parent_id) visit(cRows.find((x) => x.id === r.parent_id)); seen.add(r.id); ordered.push(r); };
cRows.forEach(visit);
await upsert('comments', ordered);
await upsert('comment_private', cpRows, 'comment_id');

// ================================================================== 6. WordPress nav menus (replace HTML-derived menus)
const locRaw = unserialize(options.get('theme_mods_soledad'))?.nav_menu_locations || {};
const locByMenu = {};
for (const [loc, id] of Object.entries(locRaw)) (locByMenu[id] ||= []).push(loc);
const pageLinks = new Map((await selectAll('posts', 'id,link_path', '&post_type=eq.page')).map((p) => [Number(p.id), p.link_path]));
const termLinks = new Map(termRows.map((t) => [Number(t.id), t.link_path]));
const menuRows = [], miRows = [];
const navMenus = ttax.filter((t) => t.taxonomy === 'nav_menu');
for (const t of navMenus) {
  const term = terms.get(t.term_id);
  const locs = locByMenu[t.term_id] || [];
  // one location per menu row: main-menu / footer-menu are rendered by the theme, topbar-menu is not displayed
  const loc = locs.includes('main-menu') ? 'main-menu' : locs.includes('footer-menu') ? 'footer-menu' : locs[0] || null;
  menuRows.push({ id: t.term_id, slug: term.slug, name: term.name, location: loc, source: 'nav_menu' });
  const mine = rels.filter((r) => r.term_taxonomy_id === t.term_taxonomy_id).map((r) => postById.get(r.object_id)).filter((p) => p && p.post_type === 'nav_menu_item');
  const mineIds = new Set(mine.map((p) => p.ID));
  for (const p of mine) {
    const m = pm.get(p.ID) || {};
    const objId = Number(m._menu_item_object_id) || null;
    let url = m._menu_item_url || '';
    let title = p.post_title;
    if (m._menu_item_type === 'post_type') {
      url = pageLinks.get(objId) || toPath(url) || '';
      if (!title) title = postById.get(objId)?.post_title || '';
    } else if (m._menu_item_type === 'taxonomy') {
      url = termLinks.get(objId) || '';
      if (!title) title = terms.get(objId)?.name || '';
    } else url = toPath(url);
    const parent = Number(m._menu_item_menu_item_parent) || null;
    const classes = (unserialize(m._menu_item_classes) || []).filter(Boolean);
    miRows.push({
      id: p.ID, menu_id: t.term_id, parent_id: parent && mineIds.has(parent) ? parent : null, position: p.menu_order,
      title: title || '', url: url || '#', target: m._menu_item_target || null, object_type: m._menu_item_object || 'custom', object_id: objId, classes,
    });
  }
}
miRows.sort((a, b) => (a.parent_id ? 1 : 0) - (b.parent_id ? 1 : 0) || a.position - b.position);
// nested parents: insert in topological order
const miOrdered = [], miSeen = new Set();
const miVisit = (r) => { if (miSeen.has(r.id)) return; if (r.parent_id) miVisit(miRows.find((x) => x.id === r.parent_id)); miSeen.add(r.id); miOrdered.push(r); };
miRows.forEach(miVisit);
stats.menus = menuRows.length; stats.menu_items = miRows.length;
await upsert('menus', menuRows);
await upsert('menu_items', miOrdered);
// HTML-derived menus are superseded by the real WordPress menus
await rest('DELETE', 'menus', undefined, '?source=eq.html');

// ================================================================== 7. newsletter forms (definitions only; no secrets)
const formRows = [];
for (const f of posts.filter((p) => p.post_type === 'mc4wp-form')) {
  const m = pm.get(f.ID) || {};
  const names = [...(f.post_content || '').matchAll(/<input[^>]*\bname="([^"]+)"[^>]*>/gi)].map((x) => x[0]);
  const fields = names.map((tag) => ({ name: /name="([^"]+)"/.exec(tag)[1], type: /type="([^"]+)"/.exec(tag)?.[1] || 'text', required: /\brequired\b/.test(tag), placeholder: /placeholder="([^"]*)"/.exec(tag)?.[1] || '' }));
  const settings = {};
  for (const [k, v] of Object.entries(m)) if (k.startsWith('text_')) settings[k] = v;
  formRows.push({ id: f.ID, slug: `mc4wp-form-${f.ID}`, title: f.post_title || 'Mailchimp form', kind: 'newsletter', source: 'mc4wp', status: f.post_status === 'publish' ? 'publish' : 'draft', action: null, method: 'post', fields, settings, pages: [] });
}
await upsert('forms', formRows);
const sibForms = T('wp_sib_model_forms').map((f) => ({
  slug: `brevo-form-${f.id}`, title: f.title || 'Brevo form', kind: 'newsletter', source: 'brevo', status: 'publish', action: null, method: 'post',
  fields: [...(f.html || '').matchAll(/<input[^>]*\bname="([^"]+)"[^>]*>/gi)].map((x) => ({ name: x[1], type: /type="([^"]+)"/.exec(x[0])?.[1] || 'text', required: /\brequired\b/.test(x[0]) })),
  settings: { success_message: f.successMsg || '', error_message: f.errorMsg || '', exists_message: f.existMsg || '', invalid_message: f.invalidMsg || '', required_message: f.requiredMsg || '', double_opt_in: f.isDopt === '1' || f.isDopt === 1 },
  pages: [],
}));
await upsert('forms', sibForms, 'slug');
stats.forms_newsletter = formRows.length + sibForms.length;

// ================================================================== 8. settings (public, front-end relevant only; gateway credentials excluded)
const cur = Object.fromEntries((await selectAll('settings', 'key,value')).map((r) => [r.key, r.value]));
const opt = (k) => options.get(k);
const yes = (k) => opt(k) === 'yes';
const gatewaySettings = (id) => { const s = unserialize(opt(`woocommerce_${id}_settings`)) || {}; return { enabled: s.enabled === 'yes', title: s.title || '', description: s.description || '' }; };
const zones = T('wp_woocommerce_shipping_zones').map((z) => ({
  id: z.zone_id, name: z.zone_name, order: z.zone_order,
  methods: T('wp_woocommerce_shipping_zone_methods').filter((m) => m.zone_id === z.zone_id).sort((a, b) => a.method_order - b.method_order).map((m) => {
    const s = unserialize(opt(`woocommerce_${m.method_id}_${m.instance_id}_settings`)) || {};
    return { instance_id: m.instance_id, method_id: m.method_id, order: m.method_order, enabled: !!m.is_enabled, title: s.title || '', cost: s.cost ?? null, min_amount: s.min_amount ?? null, requires: s.requires ?? null, tax_status: s.tax_status ?? null };
  }),
}));
const woo = {
  ...(cur.woocommerce || {}),
  currency: opt('woocommerce_currency') || 'TWD', currency_pos: opt('woocommerce_currency_pos'), price_num_decimals: Number(opt('woocommerce_price_num_decimals') ?? 0),
  price_thousand_sep: opt('woocommerce_price_thousand_sep'), price_decimal_sep: opt('woocommerce_price_decimal_sep'), default_country: opt('woocommerce_default_country'),
  ship_to_countries: opt('woocommerce_ship_to_countries'), specific_ship_to_countries: unserialize(opt('woocommerce_specific_ship_to_countries')) || [],
  coupons_enabled: yes('woocommerce_enable_coupons'), calc_discounts_sequentially: yes('woocommerce_calc_discounts_sequentially'),
  tax: { calc_taxes: yes('woocommerce_calc_taxes'), prices_include_tax: yes('woocommerce_prices_include_tax'), tax_based_on: opt('woocommerce_tax_based_on'), shipping_tax_class: opt('woocommerce_shipping_tax_class'), round_at_subtotal: yes('woocommerce_tax_round_at_subtotal'), display_shop: opt('woocommerce_tax_display_shop'), display_cart: opt('woocommerce_tax_display_cart'), total_display: opt('woocommerce_tax_total_display'), rates: [] },
  shipping: { zones, hide_rates_when_free: yes('woocommerce_shipping_hide_rates_when_free'), cost_requires_address: yes('woocommerce_shipping_cost_requires_address'), enable_shipping_calc: yes('woocommerce_enable_shipping_calc'), ship_to_destination: opt('woocommerce_ship_to_destination') },
  checkout: {
    guest_checkout: yes('woocommerce_enable_guest_checkout'), login_reminder: yes('woocommerce_enable_checkout_login_reminder'), signup_and_login_from_checkout: yes('woocommerce_enable_signup_and_login_from_checkout'),
    myaccount_registration: yes('woocommerce_enable_myaccount_registration'), company_field: opt('woocommerce_checkout_company_field'), address_2_field: opt('woocommerce_checkout_address_2_field'), phone_field: opt('woocommerce_checkout_phone_field'),
    highlight_required_fields: yes('woocommerce_checkout_highlight_required_fields'), privacy_policy_text: opt('woocommerce_checkout_privacy_policy_text') || '', terms_checkbox_text: opt('woocommerce_checkout_terms_and_conditions_checkbox_text') || '',
  },
  reviews: { enabled: yes('woocommerce_enable_reviews'), rating: yes('woocommerce_enable_review_rating') },
  gateways: Object.fromEntries(['bacs', 'cheque', 'cod', 'paypal', 'newebpay', 'ry_newebpay_credit'].map((g) => [g, gatewaySettings(g)])),
};
const rmTitles = unserialize(opt('rank-math-options-titles')) || {};
const rmGeneral = unserialize(opt('rank-math-options-general')) || {};
const SEO_KEYS = /^(title_separator|homepage_|knowledgegraph_|website_name|website_alternate_name|local_business_type|open_graph_image|twitter_card_type|social_url_|facebook_|pt_(post|page|product)_|tax_(category|post_tag|product_cat|product_tag)_|author_|date_archive_|search_title|404_title|noindex_|nofollow_|disable_author_archives|disable_date_archives)/;
const SECRET = /(secret|token|api|key|password|oauth)/i;
const pick = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => SEO_KEYS.test(k) && !SECRET.test(k)));
const seo = { ...(cur.seo || {}), rank_math_titles: pick(rmTitles), rank_math_general: Object.fromEntries(Object.entries(rmGeneral).filter(([k]) => /^(breadcrumbs|strip_category_base|attachment_redirect|url_strip_stopwords|nofollow_external|new_window_external|add_img_alt|img_alt_format|add_img_title|img_title_format|wc_remove_)/.test(k) && !SECRET.test(k))) };
const theme = { ...(cur.theme || {}), nav_menu_locations: locRaw };
await upsert('settings', [
  { key: 'woocommerce', value: woo, is_public: true },
  { key: 'seo', value: seo, is_public: true },
  { key: 'theme', value: theme, is_public: true },
], 'key');

// ================================================================== summary (counts only)
console.log(JSON.stringify({ stats, unresolved_upload_urls: unresolved.size }, null, 1));
