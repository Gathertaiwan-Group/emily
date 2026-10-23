# The three of us — storefront (Next.js)

Rebuild of https://loveccdd.com (WordPress + Soledad + WooCommerce) on Next.js App Router, reading
content from Supabase schema `site_emily`.

- `src/app/[[...slug]]/page.tsx` resolves every old WordPress URL (posts, pages, categories, tags,
  authors, date archives, search `?s=`, shop, product categories/tags, products, cart, checkout,
  my-account, wishlist, compare) — see `src/lib/route.ts`.
- `src/proxy.ts` reproduces WordPress redirects: trailing slash → 301, attachment pages → 301 to the
  file (`site_emily.redirects`), `/wp-content/uploads/*` → 301 to the migrated file, Rank Math
  sitemaps and `/feed`.
- Layout/markup mirrors the Soledad theme and uses its original stylesheets (`public/wp/**`); the
  jQuery behaviours are re-implemented in `src/components/client/SiteScripts.tsx`.
- Cart / checkout create **pending-payment orders only** (`/api/checkout`); no payment gateway is called.
- Form submissions are stored in `site_emily.form_submissions` (`/api/forms/[slug]`).

Environment (server only): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
optional `SITE_URL` (canonical origin, defaults to `https://loveccdd.com`).

```
npm install && npm run build && npm start
```

## 後台 /admin 與 MCP

- `/admin`：Supabase Auth 登入，只有 `site_emily.admins` 內的使用者可進入。功能：文章／頁面（所見即所得編輯器、草稿、預覽 `/admin-preview/<id>`、發布、排程）、分類／標籤／商品屬性、商品（價格、特價期間、庫存、屬性、變體）、訂單（列表、明細、狀態、備註、CSV 匯出）、顧客、優惠券、數量折扣規則、媒體庫（上傳自動轉 WebP，最長邊 2000、品質 80）、選單、表單提交（檢視、狀態、CSV 匯出）、網站設定（名稱、logo、聯絡資訊、社群、追蹤碼）、轉址、稽核紀錄。
- 寫入邏輯集中在 `src/lib/cms/*`，後台 server actions 與 MCP 共用；每次寫入都寫一筆 `site_emily.audit_log`（source = admin / mcp / system）。
- `/api/mcp`：MCP Streamable HTTP（stateless、JSON 回應），`Authorization: Bearer $MCP_TOKEN`。工具清單見 `src/lib/mcp/server.ts`。
- 需要的環境變數：`SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、`MCP_TOKEN`（≥ 32 字元）。
- 排程發布：status=future 的文章在到期後，於下一次前台請求（每分鐘最多一次）、後台載入或 MCP 呼叫時自動發布。
