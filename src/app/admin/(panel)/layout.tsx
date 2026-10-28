import type { ReactNode } from "react";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/admin/auth";
import { publishDue } from "@/lib/cms/posts";
import { newebpayConfigIssue } from "@/lib/newebpay";
import { logout } from "../login/actions";
import { Nav } from "./Nav";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: ReactNode }) {
  const a = await requireAdmin();
  await publishDue({ label: "scheduler", source: "system" }).catch(() => null);
  const payIssue = newebpayConfigIssue();
  return (
    <div className="adm-wrap">
      <aside className="adm-side">
        <a className="adm-brand" href="/admin">
          The three of us
        </a>
        <Suspense>
          <Nav />
        </Suspense>
      </aside>
      <main className="adm-main">
        <div className="adm-top">
          <a href="/" target="_blank" rel="noreferrer">
            查看網站 ↗
          </a>
          <span>
            {a.display_name || a.email}（{a.role}）{" "}
            <form action={logout}>
              <button className="adm-btn small">登出</button>
            </form>
          </span>
        </div>
        {payIssue === "test_env_in_production" ? (
          <div className="adm-notice err" role="alert">
            <strong>藍新金流已停用：</strong>正式環境（Vercel Production）設定了 NEWEBPAY_ENV=test。正式站不接受測試模式，結帳不會顯示藍新、不會建立付款，付款通知也不會標記已付款。請在
            Vercel Production 改設正式金鑰與 NEWEBPAY_ENV=production；測試金鑰只放在 Preview 環境。
          </div>
        ) : null}
        {children}
      </main>
    </div>
  );
}
