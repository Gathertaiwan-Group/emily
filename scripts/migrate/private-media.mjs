#!/usr/bin/env node
// Attachments that were not in the public REST library (their parent post is a draft), recovered from the
// private DB dump. Downloads the file WordPress serves (the -scaled copy when present, else the original) from
// the old site politely, converts to WebP (longest side 2000, q80) + responsive variants (480/960/1440, q75,
// never upscaled), uploads to bucket site-emily and writes WORK_DIR/private_media_plan.json for import-private.mjs.
// Usage: DB_DIR=... WORK_DIR=... node scripts/migrate/private-media.mjs [--plan-only]
// Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in the environment (never written anywhere).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { table, metaMap, unserialize } from './wpdb.mjs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const { DB_DIR, WORK_DIR: WORK, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: KEY } = process.env;
if (!DB_DIR || !WORK || !SUPABASE_URL || !KEY) throw new Error('missing env');
const BUCKET = 'site-emily';
const OLD = 'https://loveccdd.com/wp-content/uploads/';
const PUB = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`;
const WIDTHS = [480, 960, 1440];
const PLAN_ONLY = process.argv.includes('--plan-only');
const DL = path.join(WORK, 'private-media');
fs.mkdirSync(DL, { recursive: true });

const posts = table(DB_DIR, 'wp_posts');
const byId = new Map(posts.map((p) => [p.ID, p]));
const pm = metaMap(table(DB_DIR, 'wp_postmeta'), 'post_id');
const publicPlan = JSON.parse(fs.readFileSync(path.join(WORK, 'media_plan.json'), 'utf8'));
const knownIds = new Set(publicPlan.flatMap((p) => p.wp_ids || []));
const usedPaths = new Set(publicPlan.map((p) => p.storage_path));

const atts = posts.filter((p) => p.post_type === 'attachment' && !knownIds.has(p.ID)).sort((a, b) => a.ID - b.ID);
console.log(`private attachments: ${atts.length}`);

const statePath = path.join(WORK, 'private_media_plan.json');
const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {};
const save = () => fs.writeFileSync(statePath, JSON.stringify(state, null, 1));

const SAFE = /^[A-Za-z0-9._-]+$/;
function storagePathFor(rel, sha1, id) {
  const dir = path.posix.dirname(rel);
  const stem = path.posix.basename(rel).replace(/\.[^.]+$/, '').replace(/-scaled$/, '');
  let name = SAFE.test(stem) ? stem : `file-${sha1.slice(0, 8)}`;
  let p = `uploads/${dir}/${name}.webp`;
  if (usedPaths.has(p)) p = `uploads/${dir}/${name}-${id}.webp`;
  usedPaths.add(p);
  return p;
}

async function upload(p, buf, type) {
  const url = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${p.split('/').map(encodeURIComponent).join('/')}`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, apikey: KEY, 'Content-Type': type, 'x-upsert': 'true', 'cache-control': 'public, max-age=31536000, immutable' },
      body: buf,
    });
    if (r.ok) return;
    const t = await r.text();
    if (attempt === 4 || (r.status < 500 && r.status !== 429)) throw new Error(`upload ${p}: ${r.status} ${t.slice(0, 200)}`);
    await new Promise((res) => setTimeout(res, 1000 * attempt));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let nextSlot = 0; // global politeness: ≥150ms between any two requests to the old site
async function polite() {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + 200;
  if (at > now) await sleep(at - now);
}
async function download(rel) {
  const local = path.join(DL, rel);
  if (fs.existsSync(local) && fs.statSync(local).size > 0) return local;
  fs.mkdirSync(path.dirname(local), { recursive: true });
  const url = OLD + rel.split('/').map(encodeURIComponent).join('/');
  for (let attempt = 1; attempt <= 3; attempt++) {
    await polite();
    const r = await fetch(url, { headers: { 'User-Agent': 'GatherMigrator/1.0' } });
    if (r.ok) { fs.writeFileSync(local, Buffer.from(await r.arrayBuffer())); return local; }
    if (r.status === 404) return null;
    await sleep(1000 * attempt);
  }
  return null;
}

const jobs = atts.filter((a) => !state[a.ID]?.done);
console.log(`to process: ${jobs.length}`);
if (PLAN_ONLY) process.exit(0);

let done = 0, failed = 0, upBytes = 0;
async function worker() {
  while (jobs.length) {
    const a = jobs.shift();
    const meta = pm.get(a.ID) || {};
    const attached = meta._wp_attached_file;
    const md = unserialize(meta._wp_attachment_metadata) || {};
    try {
      if (!attached) throw new Error('no _wp_attached_file');
      let src = await download(attached);
      let srcRel = attached;
      if (!src && md.original_image) {
        srcRel = path.posix.join(path.posix.dirname(attached), md.original_image);
        src = await download(srcRel);
      }
      if (!src) throw new Error('download failed');
      const bytes = fs.readFileSync(src);
      const sha1 = crypto.createHash('sha1').update(bytes).digest('hex');
      const isImage = /^image\/(jpeg|png|webp|heic|heif|bmp|tiff)$/i.test(a.post_mime_type);
      const entry = { id: a.ID, attached, source: srcRel, sha1, original_mime: a.post_mime_type, original_bytes: bytes.length };
      if (isImage) {
        const sp = state[a.ID]?.storage_path || storagePathFor(attached, sha1, a.ID);
        const { data, info } = await sharp(bytes, { failOn: 'none' }).rotate()
          .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
        await upload(sp, data, 'image/webp');
        upBytes += data.length;
        const variants = [];
        for (const w of WIDTHS.filter((x) => x < info.width)) {
          const vp = `v/${w}/${sp.replace(/\.[^.]+$/, '')}.webp`;
          const v = await sharp(bytes, { failOn: 'none' }).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: 75 }).toBuffer({ resolveWithObject: true });
          await upload(vp, v.data, 'image/webp');
          upBytes += v.data.length;
          variants.push({ w: v.info.width, h: v.info.height, path: vp });
        }
        Object.assign(entry, { storage_path: sp, public_url: PUB + sp, mime: 'image/webp', width: info.width, height: info.height, size: data.length, converted: true, variants });
      } else {
        const sp = `uploads/${attached}`;
        await upload(sp, bytes, a.post_mime_type || 'application/octet-stream');
        upBytes += bytes.length;
        Object.assign(entry, { storage_path: sp, public_url: PUB + sp, mime: a.post_mime_type, width: md.width ?? null, height: md.height ?? null, size: bytes.length, converted: false, variants: [] });
      }
      entry.done = true;
      state[a.ID] = entry;
      if (++done % 25 === 0) { save(); console.log(`done ${done} (${(upBytes / 1048576).toFixed(1)} MB uploaded)`); }
    } catch (e) {
      failed++;
      state[a.ID] = { id: a.ID, attached, done: false, error: e.message };
      console.error('FAIL', a.ID, e.message);
    }
  }
}
await Promise.all([worker(), worker(), worker()]);
save();
console.log(`private media done=${done} failed=${failed} uploaded_MB=${(upBytes / 1048576).toFixed(1)}`);
