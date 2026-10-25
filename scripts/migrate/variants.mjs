#!/usr/bin/env node
// Responsive WebP variants for every converted image: widths 480 / 960 / 1440 (quality 75, never upscaled),
// generated from the local original (export/media) and uploaded to site-emily/v/<w>/<storage_path>
// with "cache-control: public, max-age=31536000, immutable". Writes media.variants for every row
// sharing that storage_path.
// Usage: EXPORT_DIR=... WORK_DIR=... SHARP_PATH=.../sharp node scripts/migrate/variants.mjs [--plan-only]
// Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ACCESS_TOKEN in the environment (never written anywhere).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { EXPORT_DIR: EXPORT, WORK_DIR: WORK, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ACCESS_TOKEN } = process.env;
if (!EXPORT || !WORK || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ACCESS_TOKEN) throw new Error('missing env');
const sharp = require(process.env.SHARP_PATH);
const BUCKET = 'site-emily';
const WIDTHS = [480, 960, 1440];
const UP = path.join(EXPORT, 'media/uploads');
const PLAN_ONLY = process.argv.includes('--plan-only');
const CONCURRENCY = 4;

const plan = JSON.parse(fs.readFileSync(path.join(WORK, 'media_plan.json'), 'utf8'));
const statePath = path.join(WORK, 'variants_state.json');
const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {};
const save = () => fs.writeFileSync(statePath, JSON.stringify(state));

const items = plan.filter((p) => !p.duplicate_of && p.stored?.converted && p.stored.mime === 'image/webp' && p.stored.width);
const vpath = (w, sp) => `v/${w}/${sp.replace(/\.[^.]+$/, '')}.webp`;
const jobs = items.map((it) => ({ it, widths: WIDTHS.filter((w) => w < it.stored.width) })).filter((j) => j.widths.length);
console.log(`images=${items.length} with_variants=${jobs.length} files=${jobs.reduce((n, j) => n + j.widths.length, 0)}`);
if (PLAN_ONLY) process.exit(0);

async function upload(p, buf) {
  const url = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${p.split('/').map(encodeURIComponent).join('/')}`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, apikey: SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'image/webp', 'x-upsert': 'true', 'cache-control': 'public, max-age=31536000, immutable' },
      body: buf,
    });
    if (r.ok) return;
    const t = await r.text();
    if (attempt === 4 || (r.status < 500 && r.status !== 429)) throw new Error(`upload ${p}: ${r.status} ${t.slice(0, 200)}`);
    await new Promise((res) => setTimeout(res, 1000 * attempt));
  }
}

let n = 0, failed = 0, bytes = 0, wid = 0;
async function worker(id) {
  while (jobs.length) {
    const { it, widths } = jobs.shift();
    const key = it.storage_path;
    try {
      if (!state[key] || state[key].sha1 !== it.sha1 || state[key].variants.length !== widths.length) {
        let input = path.join(UP, it.source);
        if (/\.hei[cf]$/i.test(it.source)) {
          const tmp = path.join(WORK, `variants-heic-${id}.jpg`);
          execFileSync('sips', ['-s', 'format', 'jpeg', input, '--out', tmp], { stdio: 'ignore' });
          input = tmp;
        }
        const src = await fs.promises.readFile(input);
        const variants = [];
        for (const w of widths) {
          const { data, info } = await sharp(src, { animated: /\.webp$/i.test(it.source), failOn: 'none' }).rotate()
            .resize({ width: w, withoutEnlargement: true }).webp({ quality: 75 }).toBuffer({ resolveWithObject: true });
          const p = vpath(w, key);
          await upload(p, data);
          variants.push({ w: info.width, h: info.pageHeight || info.height, path: p, bytes: data.length });
        }
        state[key] = { sha1: it.sha1, variants };
      }
      bytes += state[key].variants.reduce((s, v) => s + v.bytes, 0);
      if (++n % 100 === 0) { save(); console.log(`done ${n} (${(bytes / 1048576).toFixed(1)} MB)`); }
    } catch (e) { failed++; console.error('FAIL', it.source, e.message); }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));
save();
console.log(`variants done=${n} failed=${failed} uploaded_MB=${(bytes / 1048576).toFixed(1)}`);

// write media.variants (all rows sharing a storage_path) via the Management API, 300 paths per statement
const rows = Object.entries(state).map(([sp, s]) => ({ sp, v: s.variants.map(({ w, h, path: p }) => ({ w, h, path: p })) }));
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
for (let i = 0; i < rows.length; i += 300) {
  const batch = rows.slice(i, i + 300);
  const values = batch.map((r) => `(${lit(r.sp)}, ${lit(JSON.stringify(r.v))}::jsonb)`).join(',\n');
  const sql = `update site_emily.media m set variants = x.v from (values ${values}) as x(sp, v) where m.storage_path = x.sp;`;
  const r = await fetch('https://api.supabase.com/v1/projects/ozwftlkgqmewtadypsfi/database/query', {
    method: 'POST', headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }),
  });
  if (!r.ok) throw new Error(`db update: ${r.status} ${(await r.text()).slice(0, 300)}`);
}
console.log(`media.variants updated for ${rows.length} storage paths`);
