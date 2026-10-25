import type { Metadata } from "next";
import type { ReactNode } from "react";
import "../globals.css";
import "./admin.css";

export const metadata: Metadata = {
  title: { default: "控制台 | The three of us", template: "%s | The three of us 後台" },
  robots: { index: false, follow: false },
};

/** Root layout for /admin (never cached). */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-TW">
      <body className="adm-body">{children}</body>
    </html>
  );
}
