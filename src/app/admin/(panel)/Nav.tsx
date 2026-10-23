"use client";
import { usePathname, useSearchParams } from "next/navigation";

const ITEMS: ({ href: string; label: string; sub?: boolean; match?: (p: string, q: URLSearchParams) => boolean } | "sep")[] = [
  { href: "/admin", label: "控制台", match: (p) => p === "/admin" },
  "sep",
  { href: "/admin/posts", label: "文章", match: (p, q) => p.startsWith("/admin/posts") && q.get("type") !== "page" && !p.includes("/page") },
  { href: "/admin/terms?taxonomy=category", label: "分類", sub: true, match: (p, q) => p === "/admin/terms" && q.get("taxonomy") === "category" },
  { href: "/admin/terms?taxonomy=post_tag", label: "標籤", sub: true, match: (p, q) => p === "/admin/terms" && q.get("taxonomy") === "post_tag" },
  { href: "/admin/media", label: "媒體", match: (p) => p.startsWith("/admin/media") },
  { href: "/admin/posts?type=page", label: "頁面", match: (p, q) => p.startsWith("/admin/posts") && q.get("type") === "page" },
  "sep",
  { href: "/admin/orders", label: "訂單", match: (p) => p.startsWith("/admin/orders") },
  { href: "/admin/customers", label: "顧客", match: (p) => p.startsWith("/admin/customers") },
  { href: "/admin/coupons", label: "優惠券", match: (p) => p.startsWith("/admin/coupons") },
  { href: "/admin/discounts", label: "數量折扣", match: (p) => p.startsWith("/admin/discounts") },
  { href: "/admin/products", label: "商品", match: (p) => p.startsWith("/admin/products") },
  { href: "/admin/terms?taxonomy=product_cat", label: "商品分類", sub: true, match: (p, q) => p === "/admin/terms" && q.get("taxonomy") === "product_cat" },
  { href: "/admin/terms?taxonomy=product_tag", label: "商品標籤", sub: true, match: (p, q) => p === "/admin/terms" && q.get("taxonomy") === "product_tag" },
  { href: "/admin/terms?taxonomy=pa_colors", label: "商品屬性", sub: true, match: (p, q) => p === "/admin/terms" && (q.get("taxonomy") ?? "").startsWith("pa_") },
  "sep",
  { href: "/admin/menus", label: "選單", match: (p) => p.startsWith("/admin/menus") },
  { href: "/admin/forms", label: "表單提交", match: (p) => p.startsWith("/admin/forms") },
  { href: "/admin/redirects", label: "轉址", match: (p) => p.startsWith("/admin/redirects") },
  { href: "/admin/settings", label: "網站設定", match: (p) => p.startsWith("/admin/settings") },
  { href: "/admin/audit", label: "稽核紀錄", match: (p) => p.startsWith("/admin/audit") },
];

export function Nav() {
  const p = usePathname();
  const q = useSearchParams();
  return (
    <nav>
      {ITEMS.map((it, i) =>
        it === "sep" ? (
          <div key={i} className="sep" />
        ) : (
          <a key={it.href} href={it.href} className={`${it.sub ? "sub " : ""}${it.match?.(p, q) ? "on" : ""}`}>
            {it.label}
          </a>
        ),
      )}
    </nav>
  );
}
