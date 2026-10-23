import { listMedia } from "@/lib/cms/media";
import { Uploader } from "../../components/Uploader";
import { Notice, Pager, SubNav, sp, type SP } from "../../components/ui";

export const metadata = { title: "媒體庫" };

export default async function MediaPage({ searchParams }: { searchParams: SP }) {
  const q = await sp(searchParams);
  const type = q.type || "all";
  const list = await listMedia({ search: q.s, type, page: Number(q.page || 1), per: 60 });
  return (
    <>
      <h1 className="adm-h1">媒體庫</h1>
      <Notice q={q} />
      <Uploader />
      <SubNav
        current={type}
        items={[
          ["all", "全部"],
          ["image", "圖片"],
          ["video", "影片"],
          ["audio", "音訊"],
          ["file", "文件"],
        ].map(([k, l]) => ({ key: k, label: l, href: `/admin/media?type=${k}` }))}
      />
      <form className="adm-filters" action="/admin/media">
        <input type="hidden" name="type" value={type} />
        <input type="search" name="s" defaultValue={q.s ?? ""} placeholder="搜尋媒體" />
        <button className="adm-btn">搜尋</button>
      </form>
      <div className="adm-media-grid">
        {list.rows.map((m) => (
          <a key={m.id} className="item" href={`/admin/media/${m.id}`} title={m.title}>
            {m.media_type === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={m.public_url} alt={m.alt_text} loading="lazy" />
            ) : (
              <span className="ph">{m.mime_type}</span>
            )}
            <div className="cap">{m.title || m.old_file}</div>
          </a>
        ))}
      </div>
      <Pager total={list.total} page={list.page} per={list.per} base="/admin/media" q={q} />
    </>
  );
}
