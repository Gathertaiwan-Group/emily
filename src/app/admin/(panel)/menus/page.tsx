import { listMenus } from "@/lib/cms/site";
import { Notice, sp, type SP } from "../../components/ui";

export const metadata = { title: "選單" };
const LOC: Record<string, string> = { "menu-beta": "主選單（頁首）", "menu-footer-menu": "頁尾選單", "menu-beta-1": "行動版選單" };

export default async function MenusPage({ searchParams }: { searchParams: SP }) {
  const q = await sp(searchParams);
  const menus = await listMenus();
  return (
    <>
      <h1 className="adm-h1">選單</h1>
      <Notice q={q} />
      <table className="adm-table">
        <thead>
          <tr>
            <th>選單</th>
            <th>顯示位置</th>
            <th className="num">項目數</th>
          </tr>
        </thead>
        <tbody>
          {menus.map((m) => (
            <tr key={m.id}>
              <td>
                <a href={`/admin/menus/${m.id}`}>
                  <b>{m.name}</b>
                </a>
                <div className="actions">{m.slug}</div>
              </td>
              <td>{m.location ? LOC[m.location] ?? m.location : "—"}</td>
              <td className="num">{m.items}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
