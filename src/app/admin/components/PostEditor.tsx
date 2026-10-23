import { db } from "@/lib/db";
import { listTerms, treeOrder } from "@/lib/cms/terms";
import { decodeSlug } from "@/lib/cms/core";
import { savePost, trashPost } from "../actions";
import { RichEditor } from "./RichEditor";
import { MediaField } from "./MediaField";
import { POST_STATUS_LABEL, localInput } from "./ui";

type P = {
  id?: number;
  post_type: "post" | "page";
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  status: string;
  date: string | null;
  author_id: number | null;
  featured_media_id: number | null;
  parent_id: number | null;
  menu_order: number;
  template: string;
  comment_status: string;
  sticky: boolean;
  link_path: string | null;
  seo: Record<string, any>;
  term_ids: number[];
  password: string | null;
  builder?: string | null;
};

export async function PostEditor({ post }: { post: P }) {
  const type = post.post_type;
  const [authors, cats, tags, pages, fm] = await Promise.all([
    db().from("authors").select("id,name").order("id"),
    type === "post" ? listTerms("category") : Promise.resolve([]),
    type === "post" && post.term_ids.length ? db().from("terms").select("id,name").eq("taxonomy", "post_tag").in("id", post.term_ids) : Promise.resolve({ data: [] }),
    type === "page" ? db().from("posts").select("id,title,link_path").eq("post_type", "page").neq("status", "trash").order("link_path") : Promise.resolve({ data: [] }),
    post.featured_media_id ? db().from("media").select("id,public_url").eq("id", post.featured_media_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const visibility = post.password ? "password" : post.status === "private" ? "private" : "public";
  const isPublished = post.status === "publish" || post.status === "private" || post.status === "future";
  const label = type === "page" ? "頁面" : "文章";
  return (
    <form action={savePost}>
      {post.id ? <input type="hidden" name="id" value={post.id} /> : null}
      <input type="hidden" name="type" value={type} />
      <div className="adm-grid">
        <div>
          <input className="adm-title-input" name="title" defaultValue={post.title} placeholder="在此輸入標題" aria-label="標題" />
          <div className="adm-row" style={{ margin: "8px 0 12px", fontSize: 13 }}>
            <span>固定網址：</span>
            <code>{post.link_path && post.link_path !== "/" ? post.link_path.replace(/[^/]+$/, "") : "/"}</code>
            <input name="slug" defaultValue={decodeSlug(post.slug)} placeholder="代稱（留空依標題產生）" style={{ maxWidth: 320 }} aria-label="代稱" disabled={post.link_path === "/"} />
            {post.status === "publish" && post.link_path ? (
              <a href={post.link_path} target="_blank" rel="noreferrer">
                檢視{label} ↗
              </a>
            ) : null}
          </div>
          {post.builder === "elementor" ? <div className="adm-notice warn">此{label}原本以 Elementor 建立，內容含版面標記；視覺模式可編輯文字，結構調整建議切換「HTML」模式。</div> : null}
          <RichEditor name="content" initial={post.content} />
          <div className="adm-card" style={{ marginTop: 16 }}>
            <h2 className="adm-h2">SEO（Rank Math）</h2>
            <label className="adm-label">SEO 標題</label>
            <input name="seo_title" defaultValue={post.seo?.title ?? ""} placeholder={`${post.title} - The three of us`} />
            <label className="adm-label">Meta 描述</label>
            <textarea name="seo_description" defaultValue={post.seo?.description ?? ""} rows={3} />
          </div>
          {type === "post" ? (
            <div className="adm-card">
              <h2 className="adm-h2">摘要</h2>
              <textarea name="excerpt" defaultValue={post.excerpt} rows={3} />
            </div>
          ) : null}
        </div>
        <div>
          <div className="adm-card">
            <h2 className="adm-h2">發布</h2>
            <p style={{ margin: "0 0 6px" }}>
              狀態：<b>{POST_STATUS_LABEL[post.status] ?? post.status}</b>
            </p>
            {isPublished ? (
              <>
                <label className="adm-label">變更狀態</label>
                <select name="status" defaultValue={post.status}>
                  <option value={post.status}>維持（{POST_STATUS_LABEL[post.status]}）</option>
                  <option value="draft">改為草稿（下架）</option>
                  <option value="pending">待審</option>
                </select>
              </>
            ) : null}
            <label className="adm-label">可見度</label>
            <select name="visibility" defaultValue={visibility}>
              <option value="public">公開</option>
              <option value="private">私密</option>
              <option value="password">密碼保護</option>
            </select>
            <input name="password" defaultValue={post.password ?? ""} placeholder="密碼（選擇密碼保護時）" style={{ marginTop: 4 }} />
            <label className="adm-label">發布時間（台北時間）</label>
            <input type="datetime-local" name="date" defaultValue={localInput(post.date)} />
            <p className="adm-help">設定未來時間再按「發布」即為排程；留空＝立即。</p>
            <div className="adm-row" style={{ marginTop: 12, justifyContent: "space-between" }}>
              {!isPublished ? (
                <button className="adm-btn" name="intent" value="draft">
                  儲存草稿
                </button>
              ) : null}
              {!isPublished ? (
                <button className="adm-btn" name="intent" value="preview">
                  儲存並預覽
                </button>
              ) : null}
              {isPublished ? (
                <button className="adm-btn primary" name="intent" value="save">
                  更新
                </button>
              ) : (
                <button className="adm-btn primary" name="intent" value="publish">
                  發布／排程
                </button>
              )}
            </div>
            {post.id ? (
              <p className="adm-help" style={{ marginTop: 10 }}>
                <a href={`/admin-preview/${post.id}`} target="_blank" rel="noreferrer">
                  開新視窗預覽目前儲存的版本 ↗
                </a>
              </p>
            ) : null}
          </div>
          {type === "page" ? (
            <div className="adm-card">
              <h2 className="adm-h2">頁面屬性</h2>
              <label className="adm-label">上層頁面</label>
              <select name="parent_id" defaultValue={post.parent_id ?? ""}>
                <option value="">（無上層）</option>
                {((pages.data ?? []) as any[])
                  .filter((p) => p.id !== post.id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.link_path} — {p.title}
                    </option>
                  ))}
              </select>
              <label className="adm-label">範本</label>
              <select name="template" defaultValue={post.template}>
                <option value="">預設範本</option>
                <option value="page-fullwidth.php">全寬頁面</option>
              </select>
              <label className="adm-label">排序</label>
              <input type="number" name="menu_order" defaultValue={post.menu_order} />
            </div>
          ) : (
            <>
              <div className="adm-card">
                <h2 className="adm-h2">分類</h2>
                <input type="hidden" name="cats_present" value="1" />
                <div className="adm-checklist">
                  {treeOrder(cats).map((c) => (
                    <label key={c.id} style={{ paddingLeft: c.depth * 16 }}>
                      <input type="checkbox" name="category_ids" value={c.id} defaultChecked={post.term_ids.includes(c.id)} />
                      {c.name}
                    </label>
                  ))}
                </div>
                <p className="adm-help">
                  <a href="/admin/terms?taxonomy=category">管理分類</a>
                </p>
              </div>
              <div className="adm-card">
                <h2 className="adm-h2">標籤</h2>
                <input name="tags" defaultValue={((tags.data ?? []) as any[]).map((t) => t.name).join(", ")} placeholder="以逗號分隔" />
                <p className="adm-help">不存在的標籤會自動建立。</p>
              </div>
            </>
          )}
          <div className="adm-card">
            <h2 className="adm-h2">精選圖片</h2>
            <MediaField name="featured_media_id" initial={fm.data ? [{ id: (fm.data as any).id, url: (fm.data as any).public_url }] : []} label="設定精選圖片" />
          </div>
          <div className="adm-card">
            <h2 className="adm-h2">作者與討論</h2>
            <select name="author_id" defaultValue={post.author_id ?? ""} aria-label="作者">
              {((authors.data ?? []) as any[]).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <input type="hidden" name="comment_status_present" value="1" />
            <label style={{ display: "block", marginTop: 8 }}>
              <input type="checkbox" name="comment_status" defaultChecked={post.comment_status === "open"} />
              允許留言
            </label>
            {type === "post" ? (
              <>
                <input type="hidden" name="sticky_present" value="1" />
                <label style={{ display: "block" }}>
                  <input type="checkbox" name="sticky" defaultChecked={post.sticky} />
                  置頂文章
                </label>
              </>
            ) : null}
          </div>
        </div>
      </div>
      {post.id && post.status !== "trash" ? (
        <p>
          <button className="adm-link-danger" formAction={trashPost}>
            移到回收桶
          </button>
        </p>
      ) : null}
    </form>
  );
}
