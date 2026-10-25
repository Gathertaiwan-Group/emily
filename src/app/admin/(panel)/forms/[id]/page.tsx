import { requireAdmin } from "@/lib/admin/auth";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { listSubmissions } from "@/lib/cms/site";
import { setSubmissionStatus } from "../../../actions";
import { Notice, Pager, SubNav, dt, sp, type SP } from "../../../components/ui";

export const metadata = { title: "表單提交" };

export default async function FormSubs({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  await requireAdmin();
  const { id } = await params;
  const q = await sp(searchParams);
  const form = (await db().from("forms").select("id,title,slug,fields").eq("id", Number(id)).maybeSingle()).data as any;
  if (!form) notFound();
  const status = q.status || "all";
  const list = await listSubmissions({ formId: form.id, status, page: Number(q.page || 1), per: 50 });
  const ret = `/admin/forms/${form.id}?status=${status}`;
  return (
    <>
      <h1 className="adm-h1">
        {form.title}
        <a className="adm-btn" href={`/admin/export/forms?form=${form.id}`}>
          匯出 CSV
        </a>
        <a className="adm-btn" href="/admin/forms">
          返回
        </a>
      </h1>
      <Notice q={q} />
      <SubNav
        current={status}
        items={[
          ["all", "全部"],
          ["new", "未讀"],
          ["read", "已讀"],
          ["spam", "垃圾"],
          ["trash", "回收桶"],
        ].map(([k, l]) => ({ key: k, label: l, href: `/admin/forms/${form.id}?status=${k}` }))}
      />
      <table className="adm-table">
        <thead>
          <tr>
            <th>時間</th>
            <th>內容</th>
            <th>頁面</th>
            <th>狀態</th>
          </tr>
        </thead>
        <tbody>
          {list.rows.map((r) => (
            <tr key={r.id} style={r.status === "new" ? { fontWeight: 600 } : undefined}>
              <td>{dt(r.created_at)}</td>
              <td>
                <dl className="adm-kv">
                  {Object.entries(r.data ?? {}).map(([k, v]) => (
                    <div key={k} style={{ display: "contents" }}>
                      <dt>{k}</dt>
                      <dd>{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd>
                    </div>
                  ))}
                </dl>
              </td>
              <td>{r.page_url ?? "—"}</td>
              <td>
                {r.status}
                <div className="actions">
                  {(["read", "new", "spam", "trash"] as const)
                    .filter((s) => s !== r.status)
                    .map((s) => (
                      <form key={s} action={setSubmissionStatus} style={{ display: "inline" }}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="status" value={s} />
                        <input type="hidden" name="return" value={ret} />
                        <button className="adm-link-danger" style={{ color: s === "trash" || s === "spam" ? undefined : "var(--adm-accent)" }}>
                          {{ read: "標為已讀", new: "標為未讀", spam: "垃圾", trash: "刪除" }[s]}
                        </button>
                      </form>
                    ))}
                </div>
              </td>
            </tr>
          ))}
          {!list.rows.length ? (
            <tr>
              <td colSpan={4}>沒有提交紀錄。</td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <Pager total={list.total} page={list.page} per={list.per} base={`/admin/forms/${form.id}`} q={q} />
    </>
  );
}
