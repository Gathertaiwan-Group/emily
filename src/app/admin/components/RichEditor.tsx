"use client";
import { useEffect, useRef, useState } from "react";
import { MediaModal } from "./MediaModal";
import type { PickedMedia } from "./upload";

/** Strip scripts / inline handlers before showing stored HTML in the editable area (no script runs in the back office). */
function sanitizeForEditing(html: string) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"');
}

/**
 * WYSIWYG editor (contentEditable): block format, bold/italic/underline/strike, lists, alignment, links,
 * images from the media library, horizontal rule, undo/redo and an HTML source mode.
 * If the content is never touched the original HTML is submitted unchanged (Elementor / Gutenberg markup stays intact).
 */
export function RichEditor({ name, initial, minHeight = 360 }: { name: string; initial: string; minHeight?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"visual" | "html">("visual");
  const [html, setHtml] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [picker, setPicker] = useState(false);
  const saved = useRef<Range | null>(null);

  useEffect(() => {
    if (mode === "visual" && ref.current) ref.current.innerHTML = sanitizeForEditing(html);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // keep the caret position even for input that fires no key/mouse events (IME, paste, programmatic insertText)
  useEffect(() => {
    const onSel = () => {
      const sel = window.getSelection();
      if (sel && sel.rangeCount && ref.current && ref.current.contains(sel.anchorNode)) saved.current = sel.getRangeAt(0).cloneRange();
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);

  const sync = () => {
    if (ref.current) {
      setHtml(ref.current.innerHTML);
      setDirty(true);
    }
  };
  const save = () => {
    const s = window.getSelection();
    if (s && s.rangeCount && ref.current?.contains(s.anchorNode)) saved.current = s.getRangeAt(0).cloneRange();
  };
  const restore = () => {
    const s = window.getSelection();
    if (saved.current && s) {
      s.removeAllRanges();
      s.addRange(saved.current);
    } else ref.current?.focus();
  };
  const exec = (cmd: string, val?: string) => {
    if (mode !== "visual") return;
    ref.current?.focus();
    restore();
    document.execCommand(cmd, false, val);
    save();
    sync();
  };
  const link = () => {
    save();
    const url = window.prompt("連結網址（例如 /about-me 或 https://…）", "https://");
    if (!url || /^\s*javascript:/i.test(url)) return;
    exec("createLink", url);
  };
  const insertImages = (items: PickedMedia[]) => {
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    const tags = items
      .map(
        (i) =>
          `<figure class="wp-block-image size-large"><img src="${esc(i.public_url)}" alt="${esc(i.alt_text || "")}"${i.width ? ` width="${i.width}"` : ""}${i.height ? ` height="${i.height}"` : ""} class="wp-image-${i.id}" loading="lazy" decoding="async"></figure>`,
      )
      .join("");
    exec("insertHTML", tags);
  };
  const B = ({ cmd, val, label, title }: { cmd: string; val?: string; label: React.ReactNode; title: string }) => (
    <button type="button" title={title} onMouseDown={(e) => e.preventDefault()} onClick={() => exec(cmd, val)} disabled={mode !== "visual"}>
      {label}
    </button>
  );

  return (
    <div className="adm-rte">
      <input type="hidden" name={name} value={dirty ? html : initial} />
      <div className="bar">
        <select
          aria-label="段落格式"
          defaultValue=""
          disabled={mode !== "visual"}
          onChange={(e) => {
            if (e.target.value) exec("formatBlock", e.target.value);
            e.target.value = "";
          }}
        >
          <option value="">段落格式</option>
          <option value="p">段落</option>
          <option value="h2">標題 2</option>
          <option value="h3">標題 3</option>
          <option value="h4">標題 4</option>
          <option value="blockquote">引言</option>
          <option value="pre">預先格式化</option>
        </select>
        <span className="sp" />
        {B({ cmd: "bold", label: <b>B</b>, title: "粗體" })}
        {B({ cmd: "italic", label: <i>I</i>, title: "斜體" })}
        {B({ cmd: "underline", label: <u>U</u>, title: "底線" })}
        {B({ cmd: "strikeThrough", label: <s>S</s>, title: "刪除線" })}
        <span className="sp" />
        {B({ cmd: "insertUnorderedList", label: "• 清單", title: "項目符號清單" })}
        {B({ cmd: "insertOrderedList", label: "1. 清單", title: "編號清單" })}
        <span className="sp" />
        {B({ cmd: "justifyLeft", label: "靠左", title: "靠左對齊" })}
        {B({ cmd: "justifyCenter", label: "置中", title: "置中" })}
        {B({ cmd: "justifyRight", label: "靠右", title: "靠右對齊" })}
        <span className="sp" />
        <button type="button" title="插入連結" onMouseDown={(e) => e.preventDefault()} onClick={link} disabled={mode !== "visual"}>
          連結
        </button>
        {B({ cmd: "unlink", label: "移除連結", title: "移除連結" })}
        <button
          type="button"
          title="從媒體庫插入圖片"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            save();
            setPicker(true);
          }}
          disabled={mode !== "visual"}
        >
          插入圖片
        </button>
        {B({ cmd: "insertHorizontalRule", label: "分隔線", title: "水平分隔線" })}
        {B({ cmd: "removeFormat", label: "清除格式", title: "清除格式" })}
        <span className="sp" />
        {B({ cmd: "undo", label: "↶", title: "復原" })}
        {B({ cmd: "redo", label: "↷", title: "重做" })}
        <span style={{ flex: 1 }} />
        <button type="button" className={mode === "visual" ? "on" : ""} onClick={() => setMode("visual")}>
          視覺
        </button>
        <button
          type="button"
          className={mode === "html" ? "on" : ""}
          onClick={() => {
            if (mode === "visual" && dirty && ref.current) setHtml(ref.current.innerHTML);
            setMode("html");
          }}
        >
          HTML
        </button>
      </div>
      {mode === "visual" ? (
        <div ref={ref} className="ed" contentEditable suppressContentEditableWarning style={{ minHeight }} onInput={sync} onKeyUp={save} onMouseUp={save} onBlur={save} />
      ) : (
        <textarea
          className="src"
          value={html}
          spellCheck={false}
          onChange={(e) => {
            setHtml(e.target.value);
            setDirty(true);
          }}
        />
      )}
      {picker ? <MediaModal multiple onClose={() => setPicker(false)} onPick={insertImages} /> : null}
    </div>
  );
}
