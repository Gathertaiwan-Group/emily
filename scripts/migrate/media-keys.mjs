// Shared logic: map any old uploads path (original, -scaled, -rotated, -WxH variant) to its attachment "group key"
// (the original upload path, YYYY/MM/name.ext). Used by media.mjs and import.mjs so both agree.
import path from 'node:path';

export const dec = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
export const uploadsRel = (url) => {
  const m = /\/wp-content\/uploads\/(.+)$/.exec(String(url).split(/[?#]/)[0]);
  return m ? dec(m[1]) : null;
};
const VAR = /^(.*)-(\d+)x(\d+)(\.[A-Za-z0-9]+)$/;
const SCALED = /^(.*)-scaled(\.[A-Za-z0-9]+)$/;

export function makeGroupKey(library) {
  const libOriginals = new Set();
  const alias = new Map(); // edited file (-scaled / -rotated) -> original upload
  for (const m of library) {
    const f = m.media_details?.file ? dec(m.media_details.file) : uploadsRel(m.source_url);
    if (!f) continue;
    libOriginals.add(f);
    const src = uploadsRel(m.source_url);
    if (m.media_details?.original_image) {
      const orig = path.posix.join(path.posix.dirname(f), m.media_details.original_image);
      libOriginals.add(orig);
      if (orig !== f) alias.set(f, orig);
      if (src && src !== orig) alias.set(src, orig);
    }
  }
  // WP renders sub-sizes of HEIC/AVIF uploads as .jpg (IMG_1.heic -> IMG_1-300x200.jpg)
  const convertedStem = new Map();
  for (const f of libOriginals) if (/\.(heic|heif|avif)$/i.test(f)) convertedStem.set(f.replace(/\.[^.]+$/, ''), f);
  return function groupKey(rel) {
    if (alias.has(rel)) return { key: alias.get(rel), kind: /-rotated\./.test(rel) ? 'rotated' : 'scaled' };
    let k = rel, kind = 'original';
    if (!libOriginals.has(k)) { const v = VAR.exec(k); if (v) { k = v[1] + v[4]; kind = 'variant'; } }
    if (alias.has(k)) return { key: alias.get(k), kind };
    if (kind === 'variant' && !libOriginals.has(k) && convertedStem.has(k.replace(/\.[^.]+$/, ''))) return { key: convertedStem.get(k.replace(/\.[^.]+$/, '')), kind };
    const s = SCALED.exec(k);
    if (s) { k = s[1] + s[2]; if (kind === 'original') kind = 'scaled'; }
    return { key: k, kind };
  };
}
export const VARIANT_RE = VAR;
