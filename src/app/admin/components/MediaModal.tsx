"use client";
import { useCallback, useEffect, useState } from "react";
import { uploadFile, type PickedMedia } from "./upload";

/** Media library picker with upload (like wp.media). */
export function MediaModal({ multiple = false, type = "image", onPick, onClose }: { multiple?: boolean; type?: string; onPick: (items: PickedMedia[]) => void; onClose: () => void }) {
  const [rows, setRows] = useState<PickedMedia[]>([]);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [sel, setSel] = useState<PickedMedia[]>([]);
  const [busy, setBusy] = useState("");
  const load = useCallback(async () => {
    const r = await fetch(`/admin/api/media?type=${type}&page=${page}&q=${encodeURIComponent(q)}`).then((r) => r.json());
    setRows(r.rows ?? []);
    setTotal(r.total ?? 0);
  }, [page, q, type]);
  useEffect(() => {
    void load();
  }, [load]);
  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    const up: PickedMedia[] = [];
    for (const f of Array.from(files)) {
      setBusy(`上傳中：${f.name}`);
      try {
        up.push(await uploadFile(f));
      } catch (e) {
        alert((e as Error).message);
      }
    }
    setBusy("");
    setPage(1);
    await load();
    setSel(multiple ? [...sel, ...up] : up.slice(0, 1));
  }
  const toggle = (m: PickedMedia) => setSel((s) => (s.some((x) => x.id === m.id) ? s.filter((x) => x.id !== m.id) : multiple ? [...s, m] : [m]));
  return (
    <div className="adm-modal-bg" onClick={onClose}>
      <div className="adm-modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <b>媒體庫</b>
          <input type="search" placeholder="搜尋媒體…" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} style={{ maxWidth: 240 }} />
          <label className="adm-btn">
            上傳檔案
            <input type="file" multiple={multiple} accept={type === "image" ? "image/*" : undefined} hidden onChange={(e) => onFiles(e.target.files)} />
          </label>
          <span className="adm-help">{busy}</span>
          <span style={{ flex: 1 }} />
          <button type="button" className="adm-btn small" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="body">
          <div className="adm-media-grid">
            {rows.map((m) => (
              <button type="button" key={m.id} className={`item ${sel.some((s) => s.id === m.id) ? "sel" : ""}`} onClick={() => toggle(m)} title={m.title}>
                {m.mime_type.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={(m as PickedMedia & { thumb_url?: string }).thumb_url ?? m.public_url} alt="" loading="lazy" decoding="async" />
                ) : (
                  <span className="ph">{m.mime_type}</span>
                )}
                <div className="cap">{m.title || m.public_url.split("/").pop()}</div>
              </button>
            ))}
          </div>
          <div className="adm-pager">
            <span>{total} 個項目</span>
            <button type="button" className="adm-btn small" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              ‹
            </button>
            <span>第 {page} 頁</span>
            <button type="button" className="adm-btn small" disabled={page * 40 >= total} onClick={() => setPage(page + 1)}>
              ›
            </button>
          </div>
        </div>
        <footer>
          <span className="adm-help">已選 {sel.length} 個</span>
          <button
            type="button"
            className="adm-btn primary"
            disabled={!sel.length}
            onClick={() => {
              onPick(sel);
              onClose();
            }}
          >
            選取
          </button>
        </footer>
      </div>
    </div>
  );
}
