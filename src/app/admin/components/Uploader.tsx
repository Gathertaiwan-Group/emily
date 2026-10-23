"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { uploadFile } from "./upload";

/** Drag & drop / multi-file uploader for the media library page. */
export function Uploader() {
  const [log, setLog] = useState<string[]>([]);
  const [over, setOver] = useState(false);
  const router = useRouter();
  async function run(files: FileList | null) {
    if (!files?.length) return;
    for (const f of Array.from(files)) {
      setLog((l) => [`上傳中：${f.name}…`, ...l]);
      try {
        const m = await uploadFile(f);
        setLog((l) => [`✓ ${f.name} → ${m.public_url.split("/").slice(-3).join("/")}`, ...l.slice(1)]);
      } catch (e) {
        setLog((l) => [`✗ ${(e as Error).message}`, ...l.slice(1)]);
      }
    }
    router.refresh();
  }
  return (
    <div
      className="adm-card"
      style={{ borderStyle: "dashed", borderWidth: 2, textAlign: "center", background: over ? "#f0f6fc" : undefined }}
      onDragOver={(e) => (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void run(e.dataTransfer.files);
      }}
    >
      <p>將檔案拖放到此處上傳，或</p>
      <label className="adm-btn primary">
        選擇檔案
        <input type="file" multiple hidden onChange={(e) => run(e.target.files)} />
      </label>
      <p className="adm-help">圖片會自動轉成 WebP（最長邊 2000px、品質 80）；GIF、影片、PDF 原檔上傳。單檔上限約 4.4 MB（大圖會先在瀏覽器縮小）。</p>
      {log.length ? (
        <pre className="adm-json" style={{ textAlign: "left" }}>
          {log.join("\n")}
        </pre>
      ) : null}
    </div>
  );
}
