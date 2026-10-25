// Shared helpers for reading the private WordPress table dump (DB_DIR/<table>.jsonl, one JSON row per line).
// The dump contains personal data: never copy it into the repo/export, never log row contents.
import fs from 'node:fs';
import path from 'node:path';

export function table(dir, name) {
  const f = path.join(dir, `${name}.jsonl`);
  if (!fs.existsSync(f)) return [];
  const out = [];
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) if (line.trim()) out.push(JSON.parse(line));
  return out;
}

/** Group wp_postmeta / wp_usermeta style rows: id -> { meta_key: meta_value } (last value wins). */
export function metaMap(rows, idKey) {
  const m = new Map();
  for (const r of rows) {
    const id = r[idKey];
    if (!m.has(id)) m.set(id, {});
    m.get(id)[r.meta_key] = r.meta_value;
  }
  return m;
}

/** Minimal PHP unserialize (strings are measured in UTF-8 bytes). Returns undefined on malformed input. */
export function unserialize(s) {
  if (typeof s !== 'string' || !/^[aOsibdN][:;]/.test(s)) return undefined;
  const buf = Buffer.from(s, 'utf8');
  let i = 0;
  const readUntil = (ch) => {
    const j = buf.indexOf(ch, i);
    if (j < 0) throw new Error('eof');
    const v = buf.toString('utf8', i, j);
    i = j + 1;
    return v;
  };
  const parse = () => {
    const t = String.fromCharCode(buf[i]);
    i += 2; // "x:"
    switch (t) {
      case 'N': return null; // "N;"
      case 'b': return readUntil(';') === '1';
      case 'i': return parseInt(readUntil(';'), 10);
      case 'd': return parseFloat(readUntil(';'));
      case 's': {
        const len = parseInt(readUntil(':'), 10);
        i += 1; // opening quote
        const v = buf.toString('utf8', i, i + len);
        i += len + 2; // closing quote + ;
        return v;
      }
      case 'a': {
        const n = parseInt(readUntil(':'), 10);
        i += 1; // {
        const obj = {};
        let isList = true;
        for (let k = 0; k < n; k++) {
          const key = parse();
          const val = parse();
          if (key !== k) isList = false;
          obj[key] = val;
        }
        i += 1; // }
        return isList ? Object.values(obj) : obj;
      }
      case 'O': {
        readUntil(':'); readUntil(':'); // class name length + "name"
        const n = parseInt(readUntil(':'), 10);
        i += 1;
        const obj = {};
        for (let k = 0; k < n; k++) { const key = parse(); obj[key] = parse(); }
        i += 1;
        return obj;
      }
      default: throw new Error('bad type ' + t);
    }
  };
  try { return parse(); } catch { return undefined; }
}

export const tz = (local) => (local && !local.startsWith('0000') ? `${local.replace(' ', 'T')}+08:00` : null);
export const gmt = (g) => (g && !g.startsWith('0000') ? `${g.replace(' ', 'T')}Z` : null);
export const num = (v) => (v === undefined || v === null || v === '' ? 0 : Number(v));
export const dec = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
