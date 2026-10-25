import { requireAdmin } from "@/lib/admin/auth";
import { notFound } from "next/navigation";
import { ORDER_STATUSES, getCustomer } from "@/lib/cms/commerce";
import { saveCustomer } from "../../../actions";
import { Badge, Notice, dt, money, sp, type SP } from "../../../components/ui";

export const metadata = { title: "顧客" };
const F: [string, string][] = [
  ["last_name", "姓"],
  ["first_name", "名"],
  ["company", "公司"],
  ["country", "國家"],
  ["postcode", "郵遞區號"],
  ["state", "縣市"],
  ["city", "鄉鎮市區"],
  ["address_1", "地址"],
  ["address_2", "地址 2"],
  ["phone", "電話"],
  ["email", "Email"],
];

export default async function CustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  await requireAdmin();
  const { id } = await params;
  const q = await sp(searchParams);
  const c = await getCustomer(Number(id));
  if (!c) notFound();
  return (
    <>
      <h1 className="adm-h1">
        顧客 #{c.id} {c.display_name}
        <a className="adm-btn" href="/admin/customers">
          返回列表
        </a>
      </h1>
      <Notice q={q} />
      <div className="adm-grid">
        <form action={saveCustomer} className="adm-card">
          <input type="hidden" name="id" value={c.id} />
          <div className="adm-cols">
            <div>
              <label className="adm-label">姓</label>
              <input name="last_name" defaultValue={c.last_name} />
            </div>
            <div>
              <label className="adm-label">名</label>
              <input name="first_name" defaultValue={c.first_name} />
            </div>
            <div>
              <label className="adm-label">顯示名稱</label>
              <input name="display_name" defaultValue={c.display_name} />
            </div>
            <div>
              <label className="adm-label">Email</label>
              <input type="email" name="email" defaultValue={c.email ?? ""} />
            </div>
          </div>
          <div className="adm-cols" style={{ marginTop: 12 }}>
            {(["billing", "shipping"] as const).map((g) => (
              <div key={g}>
                <h3 style={{ fontSize: 14 }}>{g === "billing" ? "帳單地址" : "運送地址"}</h3>
                {F.filter(([k]) => g === "billing" || k !== "email").map(([k, l]) => (
                  <div key={k}>
                    <label className="adm-label">{l}</label>
                    <input name={`${g}_${k}`} defaultValue={c[g]?.[k] ?? ""} />
                  </div>
                ))}
              </div>
            ))}
          </div>
          <p>
            <button className="adm-btn primary">更新顧客</button>
          </p>
        </form>
        <div className="adm-card">
          <dl className="adm-kv">
            <dt>帳號</dt>
            <dd>{c.username || "—"}</dd>
            <dt>註冊</dt>
            <dd>{dt(c.date_created)}</dd>
            <dt>訂單數</dt>
            <dd>{c.order_count}</dd>
            <dt>消費總額</dt>
            <dd>{money(c.total_spent)}</dd>
          </dl>
          <h2 className="adm-h2" style={{ marginTop: 12 }}>
            訂單
          </h2>
          {c.orders.map((o: any) => (
            <p key={o.id} style={{ margin: "4px 0" }}>
              <a href={`/admin/orders/${o.id}`}>#{o.number ?? o.id}</a> {dt(o.date_created)} <Badge s={o.status} label={ORDER_STATUSES[o.status]} /> {money(o.total)}
            </p>
          ))}
        </div>
      </div>
    </>
  );
}
