import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./admin.css";

export const metadata: Metadata = {
  title: { default: "控制台 | The three of us", template: "%s | The three of us 後台" },
  robots: { index: false, follow: false },
};

/** The root layout renders a bare <html><body class="adm-body"> for /admin paths. */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return children;
}
