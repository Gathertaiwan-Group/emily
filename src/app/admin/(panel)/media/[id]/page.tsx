import { notFound } from "next/navigation";
import { getMedia } from "@/lib/cms/media";
import { deleteMediaItem, saveMediaMeta } from "../../../actions";
import { ConfirmButton } from "../../../components/ConfirmButton";
import { Notice, dt, sp, type SP } from "../../../components/ui";

export const metadata = { title: "編輯媒體" };

export default async function MediaItem({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const q = await sp(searchParams);
  const m = await getMedia(Number(id));
  if (!m) notFound();
  return (
    <>
      <h1 className="adm-h1">
        編輯媒體
        <a className="adm-btn" href="/admin/media">
          返回媒體庫
        </a>
      </h1>
      <Notice q={q} />
      <div className="adm-grid">
        <div className="adm-card" style={{ textAlign: "center" }}>
          {m.media_type === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={m.public_url} alt={m.alt_text} style={{ maxWidth: "100%", maxHeight: "70vh" }} />
          ) : m.media_type === "video" ? (
            <video src={m.public_url} controls style={{ maxWidth: "100%" }} />
          ) : (
            <a href={m.public_url} target="_blank" rel="noreferrer">
              開啟檔案
            </a>
          )}
        </div>
        <form action={saveMediaMeta} className="adm-card">
          <input type="hidden" name="id" value={m.id} />
          <dl className="adm-kv">
            <dt>上傳日期</dt>
            <dd>{dt(m.date)}</dd>
            <dt>檔案類型</dt>
            <dd>{m.mime_type}</dd>
            <dt>尺寸</dt>
            <dd>{m.width ? `${m.width} × ${m.height}` : "—"}</dd>
            <dt>檔案大小</dt>
            <dd>{m.filesize ? `${Math.round(m.filesize / 1024)} KB` : "—"}</dd>
            <dt>舊檔名</dt>
            <dd>{m.old_file}</dd>
          </dl>
          <label className="adm-label">檔案網址</label>
          <input readOnly value={m.public_url} />
          <label className="adm-label">替代文字</label>
          <input name="alt_text" defaultValue={m.alt_text} />
          <label className="adm-label">標題</label>
          <input name="title" defaultValue={m.title} />
          <label className="adm-label">說明文字</label>
          <textarea name="caption" defaultValue={m.caption} rows={2} />
          <label className="adm-label">描述</label>
          <textarea name="description" defaultValue={m.description} rows={3} />
          <p className="adm-row" style={{ marginTop: 12 }}>
            <button className="adm-btn primary">更新</button>
            <ConfirmButton message="永久刪除此媒體？引用它的文章會失去圖片。" formAction={deleteMediaItem}>
              永久刪除
            </ConfirmButton>
          </p>
        </form>
      </div>
    </>
  );
}
