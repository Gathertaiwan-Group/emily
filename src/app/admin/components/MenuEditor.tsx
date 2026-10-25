"use client";
import { useState } from "react";
import { saveMenu } from "../actions";

type Item = { key: string; depth: number; title: string; url: string; target: string | null; object_type: string | null; object_id: number | null; classes: string[] };
type Source = { label: string; url: string; object_type: string; object_id: number };

/** Flat list with depth (like wp-admin's nav-menus): reorder with ↑↓, indent with ←→. Parent = nearest previous item one level up. */
export function MenuEditor({ menu, initial, sources }: { menu: { id: number; name: string; location: string | null }; initial: Item[]; sources: Source[] }) {
  const [items, setItems] = useState<Item[]>(initial);
  const [pick, setPick] = useState("");
  const set = (i: number, patch: Partial<Item>) => setItems(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const n = [...items];
    [n[i], n[j]] = [n[j], n[i]];
    setItems(fix(n));
  };
  const indent = (i: number, d: -1 | 1) => setItems(fix(items.map((x, j) => (j === i ? { ...x, depth: Math.max(0, x.depth + d) } : x))));
  const fix = (n: Item[]) => n.map((x, i) => ({ ...x, depth: Math.min(x.depth, i === 0 ? 0 : n[i - 1].depth + 1) }));
  const payload = () => {
    const stack: string[] = [];
    return items.map((x) => {
      stack.length = x.depth;
      const parent = x.depth ? stack[x.depth - 1] ?? null : null;
      stack[x.depth] = x.key;
      return { key: x.key, parent_key: parent, title: x.title, url: x.url, target: x.target, object_type: x.object_type, object_id: x.object_id, classes: x.classes };
    });
  };
  const add = (it: Omit<Item, "key" | "depth">) => setItems([...items, { ...it, key: `n${Date.now()}${Math.random().toString(36).slice(2, 6)}`, depth: 0 }]);
  return (
    <form action={saveMenu}>
      <input type="hidden" name="id" value={menu.id} />
      <input type="hidden" name="items" value={JSON.stringify(payload())} />
      <div className="adm-grid" style={{ gridTemplateColumns: "300px minmax(0,1fr)" }}>
        <div>
          <div className="adm-card">
            <h2 className="adm-h2">新增項目</h2>
            <select value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">選擇頁面或分類…</option>
              {sources.map((s, i) => (
                <option key={i} value={i}>
                  {s.label}
                </option>
              ))}
            </select>
            <p>
              <button
                type="button"
                className="adm-btn small"
                disabled={pick === ""}
                onClick={() => {
                  const s = sources[Number(pick)];
                  add({ title: s.label.replace(/^[^：]+：/, ""), url: s.url, target: null, object_type: s.object_type, object_id: s.object_id, classes: [] });
                  setPick("");
                }}
              >
                加入選單
              </button>{" "}
              <button type="button" className="adm-btn small" onClick={() => add({ title: "自訂連結", url: "https://", target: null, object_type: "custom", object_id: null, classes: [] })}>
                加入自訂連結
              </button>
            </p>
          </div>
          <div className="adm-card">
            <label className="adm-label">選單名稱</label>
            <input name="name" defaultValue={menu.name} />
            <label className="adm-label">顯示位置</label>
            <select name="location" defaultValue={menu.location ?? ""}>
              <option value="">（無）</option>
              <option value="main-menu">主選單（頁首＋行動版）</option>
              <option value="footer-menu">頁尾選單</option>
              <option value="topbar-menu">頂部列選單（佈景未顯示）</option>
            </select>
          </div>
        </div>
        <div className="adm-card">
          <h2 className="adm-h2">選單結構</h2>
          <p className="adm-help">↑↓ 調整順序，→ 變成上一項的子項目，← 提升一層。</p>
          {items.map((x, i) => (
            <div key={x.key} className="adm-menu-item" style={{ marginLeft: x.depth * 28 }}>
              <input value={x.title} onChange={(e) => set(i, { title: e.target.value })} aria-label="標題" style={{ flex: 1 }} />
              <input value={x.url} onChange={(e) => set(i, { url: e.target.value })} aria-label="網址" style={{ flex: 2 }} />
              <label title="另開新視窗" style={{ whiteSpace: "nowrap", fontSize: 12 }}>
                <input type="checkbox" checked={x.target === "_blank"} onChange={(e) => set(i, { target: e.target.checked ? "_blank" : null })} />
                新視窗
              </label>
              <button type="button" className="adm-btn small" onClick={() => move(i, -1)} title="上移">
                ↑
              </button>
              <button type="button" className="adm-btn small" onClick={() => move(i, 1)} title="下移">
                ↓
              </button>
              <button type="button" className="adm-btn small" onClick={() => indent(i, -1)} title="提升一層">
                ←
              </button>
              <button type="button" className="adm-btn small" onClick={() => indent(i, 1)} title="變成子項目">
                →
              </button>
              <button type="button" className="adm-btn small danger" onClick={() => setItems(fix(items.filter((_, j) => j !== i)))} title="移除">
                ✕
              </button>
            </div>
          ))}
          <p>
            <button className="adm-btn primary">儲存選單</button>
          </p>
        </div>
      </div>
    </form>
  );
}
