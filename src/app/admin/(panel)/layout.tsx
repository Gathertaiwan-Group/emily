import type { ReactNode } from "react";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/admin/auth";
import { publishDue } from "@/lib/cms/posts";
import { logout } from "../login/actions";
import { Nav } from "./Nav";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: ReactNode }) {
  const a = await requireAdmin();
  await publishDue({ label: "scheduler", source: "system" }).catch(() => null);
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
        {children}
      </main>
    </div>
  );
}
