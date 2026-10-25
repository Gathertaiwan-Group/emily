#!/usr/bin/env node
// Reconcile the private DB dump against site_emily: counts per data type, order totals, items, statuses.
// Prints counts and sums only (no personal data).
// Usage: DB_DIR=... node scripts/migrate/reconcile-private.mjs   (needs SUPABASE_ACCESS_TOKEN)
import { table, metaMap, num } from './wpdb.mjs';

const { DB_DIR, SUPABASE_ACCESS_TOKEN } = process.env;
if (!DB_DIR || !SUPABASE_ACCESS_TOKEN) throw new Error('missing env');
async function q(sql) {
  const r = await fetch('https://api.supabase.com/v1/projects/ozwftlkgqmewtadypsfi/database/query', {
    method: 'POST', headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }),
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return (await r.json())[0];
}
const posts = table(DB_DIR, 'wp_posts');
const pm = metaMap(table(DB_DIR, 'wp_postmeta'), 'post_id');
const comments = table(DB_DIR, 'wp_comments');
const orders = posts.filter((p) => p.post_type === 'shop_order');
const cnt = (arr, f) => arr.filter(f).length;
const statusCounts = {};
for (const o of orders) statusCounts[o.post_status.replace(/^wc-/, '')] = (statusCounts[o.post_status.replace(/^wc-/, '')] || 0) + 1;
const items = table(DB_DIR, 'wp_woocommerce_order_items');
const src = {
  orders: orders.length,
  orders_in_wc_order_stats: table(DB_DIR, 'wp_wc_order_stats').length,
  orders_hpos_wc_orders: table(DB_DIR, 'wp_wc_orders').length,
  order_total_sum: orders.reduce((s, o) => s + num(pm.get(o.ID)?._order_total), 0),
  order_stats_total_sales_sum: table(DB_DIR, 'wp_wc_order_stats').reduce((s, r) => s + num(r.total_sales), 0),
  order_items: items.length,
  order_line_items: cnt(items, (i) => i.order_item_type === 'line_item'),
  order_shipping_lines: cnt(items, (i) => i.order_item_type === 'shipping'),
  order_notes: cnt(comments, (c) => c.comment_type === 'order_note'),
  order_status: statusCounts,
  customers: table(DB_DIR, 'wp_wc_customer_lookup').length,
  coupons: cnt(posts, (p) => p.post_type === 'shop_coupon'),
  discount_rules: cnt(posts, (p) => p.post_type === 'ywdpd_discount'),
  comments: cnt(comments, (c) => c.comment_type !== 'order_note'),
  menus: table(DB_DIR, 'wp_term_taxonomy').filter((t) => t.taxonomy === 'nav_menu').length,
  menu_items: cnt(posts, (p) => p.post_type === 'nav_menu_item'),
  reusable_blocks: cnt(posts, (p) => p.post_type === 'wp_block'),
  attachments: cnt(posts, (p) => p.post_type === 'attachment'),
  posts_pages: cnt(posts, (p) => ['post', 'page'].includes(p.post_type) && ['publish', 'draft', 'private', 'pending', 'future'].includes(p.post_status)),
  post_passwords: cnt(posts, (p) => ['post', 'page'].includes(p.post_type) && p.post_password),
  newsletter_forms: cnt(posts, (p) => p.post_type === 'mc4wp-form') + table(DB_DIR, 'wp_sib_model_forms').length,
  form_submissions: 0, // WPForms Lite keeps no entries (wp_wpforms_entries absent), mc4wp/Brevo store none locally
};
const db = await q(`select
  (select count(*) from site_emily.orders where type='shop_order') orders,
  (select coalesce(sum(total),0) from site_emily.orders where type='shop_order') order_total_sum,
  (select count(*) from site_emily.order_items) order_items,
  (select count(*) from site_emily.order_items where item_type='line_item') order_line_items,
  (select count(*) from site_emily.order_items where item_type='shipping') order_shipping_lines,
  (select count(*) from site_emily.order_notes) order_notes,
  (select jsonb_object_agg(status, n) from (select status, count(*) n from site_emily.orders group by 1) s) order_status,
  (select count(*) from site_emily.customers) customers,
  (select count(*) from site_emily.coupons) coupons,
  (select count(*) from site_emily.quantity_discount_rules) discount_rules,
  (select count(*) from site_emily.comments) comments,
  (select count(*) from site_emily.menus where source='nav_menu') menus,
  (select count(*) from site_emily.menu_items i join site_emily.menus m on m.id=i.menu_id where m.source='nav_menu') menu_items,
  (select count(*) from site_emily.posts where post_type='wp_block') reusable_blocks,
  (select count(distinct wp_id) from site_emily.media where wp_id is not null) attachments,
  (select count(*) from site_emily.posts where post_type in ('post','page')) posts_pages,
  (select count(*) from site_emily.post_passwords) post_passwords,
  (select count(*) from site_emily.forms where kind='newsletter') newsletter_forms,
  (select count(*) from site_emily.form_submissions) form_submissions`);
let bad = 0;
for (const k of Object.keys(src)) {
  if (!(k in db)) { console.log(`${k.padEnd(28)} source=${JSON.stringify(src[k])} (source-only check)`); continue; }
  const a = JSON.stringify(typeof src[k] === 'object' ? Object.fromEntries(Object.entries(src[k]).sort()) : Number(src[k]));
  const b = JSON.stringify(typeof db[k] === 'object' && db[k] ? Object.fromEntries(Object.entries(db[k]).sort()) : Number(db[k]));
  const ok = a === b;
  if (!ok) bad++;
  console.log(`${ok ? 'OK  ' : 'DIFF'} ${k.padEnd(24)} source=${a} db=${b}`);
}
console.log(bad ? `MISMATCHES: ${bad}` : 'ALL MATCH');
process.exit(bad ? 1 : 0);
