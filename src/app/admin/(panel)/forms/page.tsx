import { requireAdmin } from "@/lib/admin/auth";
import { listForms } from "@/lib/cms/site";
import { Notice, sp, type SP } from "../../components/ui";

export const metadata = { title: "表單" };

export default async function FormsPage({ searchParams }: { searchParams: SP }) {
  await requireAdmin();
  const q = await sp(searchParams);
  const forms = await listForms();
  return (
    <>
      <h1 className="adm-h1">
        表單提交
        <a className="adm-btn" href="/admin/export/forms">
          匯出全部 CSV
        </a>
      </h1>
      <Notice q={q} />
      <table className="adm-table">
        <thead>
          <tr>
            <th>表單</th>
            <th>類型</th>
            <th>來源外掛</th>
            <th>使用頁面</th>
            <th className="num">提交數</th>
            <th className="num">未讀</th>
          </tr>
        </thead>
        <tbody>
          {forms.map((f) => (
            <tr key={f.id}>
              <td>
                <a href={`/admin/forms/${f.id}`}>
                  <b>{f.title}</b>
                </a>
                <div className="actions">{f.slug}</div>
              </td>
              <td>{f.kind}</td>
              <td>{f.source}</td>
              <td>{(f.pages ?? []).join(", ")}</td>
              <td className="num">{f.submissions}</td>
              <td className="num">{f.unread ? <b>{f.unread}</b> : 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
