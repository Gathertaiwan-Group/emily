import { getAllSettings } from "@/lib/cms/site";
import { saveSettings } from "../../actions";
import { Notice, SubNav, sp, type SP } from "../../components/ui";

export const metadata = { title: "網站設定" };

type Field = { k: string; label: string; help?: string; kind?: "textarea" | "bool" | "int" | "select"; options?: [string, string][] };
const TABS: Record<string, { label: string; fields: Field[] }> = {
  general: {
    label: "一般",
    fields: [
      { k: "name", label: "網站名稱" },
      { k: "description", label: "網站標語" },
      { k: "logo_url", label: "Logo 圖片網址", help: "可從媒體庫複製檔案網址；留空使用原本的 logo。" },
      { k: "site_icon_url", label: "網站圖示（favicon）網址" },
      { k: "timezone", label: "時區" },
    ],
  },
  contact: {
    label: "聯絡資訊",
    fields: [
      { k: "email", label: "聯絡 Email" },
      { k: "phone", label: "電話" },
      { k: "address", label: "地址", kind: "textarea" },
      { k: "line", label: "LINE ID" },
      { k: "business_hours", label: "營業／回覆時間" },
    ],
  },
  social: {
    label: "社群連結",
    fields: [
      { k: "facebook", label: "Facebook" },
      { k: "instagram", label: "Instagram" },
      { k: "email", label: "Email 圖示連結（mailto:）" },
      { k: "line", label: "LINE 連結" },
      { k: "youtube", label: "YouTube" },
    ],
  },
  tracking: {
    label: "追蹤碼",
    fields: [
      { k: "gtm", label: "Google Tag Manager 容器 ID", help: "例：GTM-TG4K2VR；清空即停用。" },
      { k: "ga4", label: "GA4 評估 ID", help: "例：G-D4TVJ4514B（目前經由 GTM 載入）。" },
      { k: "facebook_pixel", label: "Facebook Pixel ID", help: "清空即停用。" },
      { k: "facebook_domain_verification", label: "Facebook 網域驗證碼" },
    ],
  },
  reading: { label: "閱讀", fields: [{ k: "posts_per_page", label: "每頁文章數", kind: "int" }] },
  comments: {
    label: "討論",
    fields: [
      { k: "default_comment_status", label: "新文章預設留言", kind: "select", options: [["open", "允許"], ["closed", "關閉"]] },
      { k: "moderation", label: "留言需經人工核准", kind: "bool" },
      { k: "require_name_email", label: "留言者必須填寫姓名與 Email", kind: "bool" },
    ],
  },
};

export default async function SettingsPage({ searchParams }: { searchParams: SP }) {
  const q = await sp(searchParams);
  const tab = TABS[q.tab] ? q.tab : "general";
  const all = await getAllSettings(true);
  const cur = all[tab] ?? {};
  return (
    <>
      <h1 className="adm-h1">網站設定</h1>
      <Notice q={q} />
      <SubNav current={tab} items={Object.entries(TABS).map(([k, v]) => ({ key: k, label: v.label, href: `/admin/settings?tab=${k}` }))} />
      <form action={saveSettings} className="adm-card" style={{ maxWidth: 760 }}>
        <input type="hidden" name="key" value={tab} />
        {TABS[tab].fields.map((f) => (
          <div key={f.k}>
            {f.kind === "bool" ? (
              <label style={{ display: "block", margin: "10px 0" }}>
                <input type="checkbox" name={f.k} defaultChecked={!!cur[f.k]} />
                {f.label}
              </label>
            ) : (
              <>
                <label className="adm-label" htmlFor={`f-${f.k}`}>
                  {f.label}
                </label>
                {f.kind === "textarea" ? (
                  <textarea id={`f-${f.k}`} name={f.k} defaultValue={cur[f.k] ?? ""} rows={3} />
                ) : f.kind === "select" ? (
                  <select id={`f-${f.k}`} name={f.k} defaultValue={cur[f.k] ?? ""}>
                    {f.options!.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input id={`f-${f.k}`} name={f.k} type={f.kind === "int" ? "number" : "text"} defaultValue={cur[f.k] ?? ""} />
                )}
                {f.help ? <p className="adm-help">{f.help}</p> : null}
              </>
            )}
          </div>
        ))}
        <p>
          <button className="adm-btn primary">儲存設定</button>
        </p>
      </form>
      <details className="adm-card">
        <summary>其他設定（唯讀，可透過 MCP update_setting 修改）</summary>
        {Object.entries(all)
          .filter(([k]) => !TABS[k])
          .map(([k, v]) => (
            <div key={k}>
              <h3 style={{ fontSize: 13 }}>{k}</h3>
              <pre className="adm-json">{JSON.stringify(v, null, 2)}</pre>
            </div>
          ))}
      </details>
    </>
  );
}
