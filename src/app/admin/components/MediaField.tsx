"use client";
import { useState } from "react";
import { MediaModal } from "./MediaModal";
import type { PickedMedia } from "./upload";

type Item = { id: number; url: string };

/** Hidden input holding one media id (or comma-separated ids when multiple), with preview + picker. */
export function MediaField({ name, initial, multiple = false, label = "設定圖片" }: { name: string; initial: Item[]; multiple?: boolean; label?: string }) {
  const [items, setItems] = useState<Item[]>(initial);
  const [open, setOpen] = useState(false);
  const pick = (ms: PickedMedia[]) => {
    const next = ms.map((m) => ({ id: m.id, url: m.public_url }));
    setItems(multiple ? [...items, ...next.filter((n) => !items.some((i) => i.id === n.id))] : next.slice(0, 1));
  };
  return (
    <div>
      <input type="hidden" name={name} value={items.map((i) => i.id).join(",")} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
        {items.map((i) => (
          <span key={i.id} style={{ position: "relative" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={i.url} alt="" style={{ width: multiple ? 64 : "100%", height: multiple ? 64 : "auto", objectFit: "cover", display: "block", border: "1px solid #dcdcde" }} />
            <button type="button" className="adm-btn small danger" style={{ position: "absolute", top: 2, right: 2 }} onClick={() => setItems(items.filter((x) => x.id !== i.id))} title="移除">
              ✕
            </button>
          </span>
        ))}
      </div>
      <button type="button" className="adm-btn small" onClick={() => setOpen(true)}>
        {items.length && !multiple ? "更換圖片" : label}
      </button>
      {open ? <MediaModal multiple={multiple} onClose={() => setOpen(false)} onPick={pick} /> : null}
    </div>
  );
}
