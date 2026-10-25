import { requireAdmin } from "@/lib/admin/auth";
import { listPosts, statusCounts } from "@/lib/cms/posts";
import { listTerms } from "@/lib/cms/terms";
import { db } from "@/lib/db";
import { deletePostForever, restorePost, trashPost } from "../../actions";
import { ConfirmButton } from "../../components/ConfirmButton";
import { Badge, Notice, Pager, POST_STATUS_LABEL, SubNav, dt, sp, type SP } from "../../components/ui";

export const metadata = { title: "文章" };

export default async function PostsPage({ searchParams }: { searchParams: SP }) {
  await requireAdmin();
  const q = await sp(searchParams);
  const type = q.type === "page" ? "page" : "post";
  const status = q.status || "all";
  const page = Number(q.page || 1);
  const termId = q.cat ? Number(q.cat) : undefined;
  const [list, counts, cats, authors] = await Promise.all([
    listPosts({ type, status, search: q.s, termId, page, per: 20 }),
    statusCounts(type),
    type === "post" ? listTerms("category") : Promise.resolve([]),
    db().from("authors").select("id,name"),
  ]);
  const authorName = new Map(((authors.data ?? []) as any[]).map((a) => [a.id, a.name]));
  const label = type === "page" ? "頁面" : "文章";
  const base = `/admin/posts`;
  const all = Object.entries(counts).filter(([k]) => k !== "trash").reduce((a, [, v]) => a + v, 0);
  return (
    <>
      <h1 className="adm-h1">
        {label}
        <a className="adm-btn" href={`/admin/posts/new?type=${type}`}>
          新增{label}
        </a>
      </h1>
      <Notice q={q} />
      <SubNav
        current={status}
        items={[
          { key: "all", label: `全部 (${all})`, href: `${base}?type=${type}` },
          ...(["publish", "future", "draft", "pending", "private", "trash"] as const)
            .filter((k) => counts[k])
            .map((k) => ({ key: k, label: `${POST_STATUS_LABEL[k]} (${counts[k]})`, href: `${base}?type=${type}&status=${k}` })),
        ]}
      />
      <form className="adm-filters" action={base}>
        <input type="hidden" name="type" value={type} />
        <input type="hidden" name="status" value={status} />
        {type === "post" ? (
          <select name="cat" defaultValue={q.cat ?? ""}>
            <option value="">所有分類</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        ) : null}
        <input type="search" name="s" defaultValue={q.s ?? ""} placeholder={`搜尋${label}`} />
        <button className="adm-btn">篩選</button>
      </form>
      <table className="adm-table">
        <thead>
          <tr>
            <th>標題</th>
            <th>作者</th>
            <th>狀態</th>
            <th>日期</th>
          </tr>
        </thead>
        <tbody>
          {list.rows.map((p) => (
            <tr key={p.id}>
              <td>
                <a href={`/admin/posts/${p.id}`}>
                  <b>{p.title || "（無標題）"}</b>
                </a>
                <div className="actions">
                  {p.status !== "trash" ? (
                    <>
                      <a href={`/admin/posts/${p.id}`}>編輯</a>
                      {p.status === "publish" && p.link_path ? (
                        <a href={p.link_path} target="_blank" rel="noreferrer">
                          檢視
                        </a>
                      ) : (
                        <a href={`/admin-preview/${p.id}`} target="_blank" rel="noreferrer">
                          預覽
                        </a>
                      )}
                      <form action={trashPost} style={{ display: "inline" }}>
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="type" value={type} />
                        <button className="adm-link-danger">移到回收桶</button>
                      </form>
                    </>
                  ) : (
                    <>
                      <form action={restorePost} style={{ display: "inline" }}>
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="type" value={type} />
                        <button className="adm-link-danger" style={{ color: "var(--adm-accent)" }}>
                          還原
                        </button>
                      </form>
                      <form action={deletePostForever} style={{ display: "inline" }}>
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="type" value={type} />
                        <ConfirmButton message="永久刪除後無法復原，確定？">永久刪除</ConfirmButton>
                      </form>
                    </>
                  )}
                </div>
              </td>
              <td>{p.author_id ? authorName.get(p.author_id) ?? p.author_id : "—"}</td>
              <td>
                <Badge s={p.status} label={POST_STATUS_LABEL[p.status]} />
              </td>
              <td>{dt(p.date)}</td>
            </tr>
          ))}
          {!list.rows.length ? (
            <tr>
              <td colSpan={4}>找不到{label}。</td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <Pager total={list.total} page={list.page} per={list.per} base={base} q={q} />
    </>
  );
}
