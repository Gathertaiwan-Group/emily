#!/usr/bin/env node
// Media migration: originals (no -WxH / -scaled variants) -> WebP (longest side 2000, q80) -> bucket site-emily.
// GIF / video / PDF are uploaded as-is. Byte-identical sources are uploaded once.
// Usage: EXPORT_DIR=... WORK_DIR=... SHARP_PATH=.../sharp node scripts/migrate/media.mjs [--plan-only]
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment (never written anywhere).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { makeGroupKey, uploadsRel, VARIANT_RE } from './media-keys.mjs';

const require = createRequire(import.meta.url);
const EXPORT = process.env.EXPORT_DIR;
const WORK = process.env.WORK_DIR;
const sharp = require(process.env.SHARP_PATH);
const BUCKET = 'site-emily';
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!EXPORT || !WORK || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('missing env');
fs.mkdirSync(WORK, { recursive: true });
const PLAN_ONLY = process.argv.includes('--plan-only');

const UP = path.join(EXPORT, 'media/uploads');
const index = JSON.parse(fs.readFileSync(path.join(EXPORT, 'media/index.json'), 'utf8'));
const library = JSON.parse(fs.readFileSync(path.join(EXPORT, 'rest/media.json'), 'utf8'));

const groupKey = makeGroupKey(library);
const VAR = VARIANT_RE;

const MEDIA_EXT = /\.(jpe?g|png|webp|gif|heic|avif|bmp|tiff?|mp4|mov|webm|m4v|mp3|m4a|wav|pdf)$/i;
const groups = new Map(); // key -> {key, files:[{rel,kind,bytes}], wp_ids:Set}
const G = (key) => { if (!groups.has(key)) groups.set(key, { key, files: [], wp_ids: new Set(), lib: [] }); return groups.get(key); };

for (const it of index) {
  if (it.status !== 200 || !it.local) continue;
  const rel = it.local.replace(/^media\/uploads\//, '');
  if (!MEDIA_EXT.test(rel)) continue; // elementor css etc. are not media
  const { key, kind } = groupKey(rel);
  const g = G(key);
  g.files.push({ rel, kind, bytes: it.bytes });
  if (it.id && it.source !== 'html_scan') g.wp_ids.add(it.id);
}
for (const m of library) {
  const f = m.media_details?.file || uploadsRel(m.source_url);
  const { key } = groupKey(f);
  const g = G(key);
  g.wp_ids.add(m.id);
  g.lib.push(m.id);
}
// recover attachment IDs for files outside the public library from wp-image-<id> classes in content
const contentSources = ['posts', 'pages', 'product'].flatMap((n) => JSON.parse(fs.readFileSync(path.join(EXPORT, `rest/${n}.json`), 'utf8')));
const libIds = new Set(library.map((m) => m.id));
const recovered = new Map(); // wp_id -> key
for (const p of contentSources) {
  const html = p.content?.rendered || '';
  for (const tag of html.match(/<img\b[^>]*>/gi) || []) {
    const id = /wp-image-(\d+)/.exec(tag)?.[1];
    const src = /\ssrc="([^"]+)"/.exec(tag)?.[1];
    if (!id || !src) continue;
    const rel = uploadsRel(src.replace(/&amp;/g, '&'));
    if (!rel) continue;
    const { key } = groupKey(rel);
    const g = groups.get(key);
    if (!g || g.lib.length) continue;
    if (libIds.has(+id)) continue;
    recovered.set(+id, key);
  }
}
for (const [id, key] of recovered) {
  const g = groups.get(key);
  if ([...groups.values()].some((x) => x !== g && x.wp_ids.has(id))) continue;
  g.wp_ids.add(id);
}

const exists = (rel) => fs.existsSync(path.join(UP, rel));
function pickSource(g) {
  const rotated = g.files.find((f) => f.kind === 'rotated');
  if (rotated) return { rel: rotated.rel, how: 'rotated' };
  if (exists(g.key)) return { rel: g.key, how: 'original' };
  const scaled = g.files.find((f) => f.kind === 'scaled');
  if (scaled) return { rel: scaled.rel, how: 'scaled' };
  const vars = g.files.filter((f) => f.kind === 'variant').map((f) => {
    const v = VAR.exec(f.rel); return { ...f, area: +v[2] * +v[3] };
  }).sort((a, b) => b.area - a.area);
  if (vars.length) return { rel: vars[0].rel, how: 'largest_variant' };
  return null;
}

const usedPaths = new Map(); // storage path -> sha1
function storageName(key, ext, sha1) {
  const dir = path.posix.dirname(key);
  const stem = path.posix.basename(key).replace(/\.[^.]+$/, '');
  let safe = /^[A-Za-z0-9._-]+$/.test(stem) ? stem
    : (stem.normalize('NFKD').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'file') + '-' + sha1.slice(0, 8);
  let p = `uploads/${dir === '.' ? '' : dir + '/'}${safe}${ext}`;
  if (usedPaths.has(p) && usedPaths.get(p) !== sha1) p = `uploads/${dir === '.' ? '' : dir + '/'}${safe}-${sha1.slice(0, 8)}${ext}`;
  usedPaths.set(p, sha1);
  return p;
}

const statePath = path.join(WORK, 'media_state.json');
const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {};
const saveState = () => fs.writeFileSync(statePath, JSON.stringify(state));
const publicUrl = (p) => `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${p.split('/').map(encodeURIComponent).join('/')}`;

async function convert(srcAbs, ext) {
  if (/\.(mp4|mov|webm|m4v|mp3|m4a|wav|pdf|gif)$/i.test(ext)) {
    return { buf: fs.readFileSync(srcAbs), mime: { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.m4v': 'video/mp4', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.pdf': 'application/pdf', '.gif': 'image/gif' }[ext.toLowerCase()], converted: false, outExt: ext.toLowerCase() };
  }
  let input = srcAbs;
  if (/\.heic$/i.test(ext)) {
    const tmp = path.join(WORK, 'heic-tmp.jpg');
    execFileSync('sips', ['-s', 'format', 'jpeg', srcAbs, '--out', tmp], { stdio: 'ignore' });
    input = tmp;
  }
  const img = sharp(input, { animated: /\.webp$/i.test(ext), failOn: 'none' }).rotate()
    .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 });
  const { data, info } = await img.toBuffer({ resolveWithObject: true });
  return { buf: data, mime: 'image/webp', converted: true, outExt: '.webp', width: info.width, height: info.pageHeight || info.height };
}

async function upload(p, buf, mime) {
  const url = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${p.split('/').map(encodeURIComponent).join('/')}`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, apikey: SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': mime, 'x-upsert': 'true', 'cache-control': 'max-age=31536000' },
      body: buf,
    });
    if (r.ok) return;
    const t = await r.text();
    if (attempt === 4 || r.status < 500 && r.status !== 429) throw new Error(`upload ${p}: ${r.status} ${t.slice(0, 200)}`);
    await new Promise((res) => setTimeout(res, 1000 * attempt));
  }
}

const plan = [];
const bySha = new Map();
const entries = [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
let missing = 0;
for (const g of entries) {
  const src = pickSource(g);
  if (!src) { missing++; continue; }
  const abs = path.join(UP, src.rel);
  const sha1 = crypto.createHash('sha1').update(fs.readFileSync(abs)).digest('hex');
  const ext = path.extname(src.rel);
  const isPassthrough = /\.(mp4|mov|webm|m4v|mp3|m4a|wav|pdf|gif)$/i.test(ext);
  let storage_path, duplicate_of = null;
  if (bySha.has(sha1)) { storage_path = bySha.get(sha1).storage_path; duplicate_of = bySha.get(sha1).key; }
  else { storage_path = storageName(g.key, isPassthrough ? ext.toLowerCase() : '.webp', sha1); }
  const item = {
    key: g.key, source: src.rel, source_how: src.how, sha1, original_ext: ext.toLowerCase(), original_bytes: fs.statSync(abs).size,
    storage_path, public_url: publicUrl(storage_path), duplicate_of,
    wp_ids: [...g.wp_ids].sort((a, b) => a - b), lib_ids: g.lib,
    old_paths: [...new Set([g.key, ...g.files.map((f) => f.rel)])],
  };
  if (!duplicate_of) bySha.set(sha1, item);
  plan.push(item);
}
console.log(`groups=${groups.size} planned=${plan.length} unique_files=${bySha.size} no_source=${missing} recovered_ids=${recovered.size}`);
if (PLAN_ONLY) { fs.writeFileSync(path.join(WORK, 'media_plan.json'), JSON.stringify(plan, null, 1)); process.exit(0); }

const uniques = plan.filter((p) => !p.duplicate_of);
let done = 0, failed = 0, bytes = 0;
async function worker() {
  while (uniques.length) {
    const it = uniques.shift();
    try {
      if (!state[it.storage_path] || state[it.storage_path].sha1 !== it.sha1) {
        const out = await convert(path.join(UP, it.source), it.original_ext);
        await upload(it.storage_path, out.buf, out.mime);
        state[it.storage_path] = { sha1: it.sha1, size: out.buf.length, mime: out.mime, converted: out.converted, width: out.width ?? null, height: out.height ?? null };
      }
      bytes += state[it.storage_path].size;
      if (++done % 100 === 0) { saveState(); console.log(`uploaded ${done} (${(bytes / 1048576).toFixed(1)} MB)`); }
    } catch (e) { failed++; console.error('FAIL', it.source, e.message); }
  }
}
// HEIC conversion uses one temp file -> serialize those first
const heic = uniques.filter((u) => u.original_ext === '.heic');
for (const h of heic) { uniques.splice(uniques.indexOf(h), 1); }
uniques.unshift(...heic);
await (async () => { const first = heic.length; const tmp = uniques.splice(0, first); const keep = uniques.splice(0); uniques.push(...tmp); await worker(); uniques.push(...keep); })();
await Promise.all(Array.from({ length: 6 }, worker));
// prune objects uploaded by earlier runs that are no longer part of the plan (e.g. merged -rotated duplicates)
const planned = new Set(plan.map((p) => p.storage_path));
const orphans = Object.keys(state).filter((k) => !planned.has(k));
for (let i = 0; i < orphans.length; i += 100) {
  const batch = orphans.slice(i, i + 100);
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, { method: 'DELETE', headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, apikey: SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: batch }) });
  if (!r.ok) throw new Error(`prune: ${r.status} ${await r.text()}`);
  for (const k of batch) delete state[k];
}
console.log(`pruned=${orphans.length}`);
saveState();
for (const p of plan) Object.assign(p, state[p.storage_path] ? { stored: state[p.storage_path] } : {});
fs.writeFileSync(path.join(WORK, 'media_plan.json'), JSON.stringify(plan, null, 1));
console.log(`done=${done} failed=${failed} uploaded_MB=${(bytes / 1048576).toFixed(1)}`);
