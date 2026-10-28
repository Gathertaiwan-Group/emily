import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CmsError, type Actor } from "@/lib/cms/core";
import * as posts from "@/lib/cms/posts";
import * as terms from "@/lib/cms/terms";
import * as products from "@/lib/cms/products";
import * as commerce from "@/lib/cms/commerce";
import * as media from "@/lib/cms/media";
import * as site from "@/lib/cms/site";
import { SITE_URL } from "@/lib/site";

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
function fail(e: unknown) {
  const msg = e instanceof CmsError ? e.message : `內部錯誤：${(e as Error)?.message ?? e}`;
  if (!(e instanceof CmsError)) console.error("[mcp]", e);
  return { content: [{ type: "text" as const, text: msg }], isError: true };
}
function h<A>(fn: (args: A) => Promise<unknown>) {
  return async (args: A) => {
    try {
      return ok(await fn(args));
    } catch (e) {
      return fail(e);
    }
  };
}

const RO = { readOnlyHint: true, openWorldHint: false } as const;
const WR = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const DEL = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const;

const id = z.number().int().positive();
const page = z.number().int().min(1).optional().describe("頁碼，預設 1");
const per = z.number().int().min(1).max(200).optional().describe("每頁筆數，預設 20");

const postFields = {
  title: z.string().optional().describe("標題"),
  slug: z.string().optional().describe("網址代稱（可用中文，留空依標題產生）"),
  content: z.string().optional().describe("內文 HTML"),
  excerpt: z.string().optional().describe("摘要"),
  status: z.enum(["draft", "pending", "publish", "future", "private"]).optional().describe("狀態；新增時預設 draft"),
  date: z.string().optional().describe("發布時間 ISO 8601；status=future 時必須是未來時間（排程）"),
  author_id: z.number().int().nullable().optional(),
  featured_media_id: z.number().int().nullable().optional().describe("精選圖片的媒體 ID"),
  parent_id: z.number().int().nullable().optional().describe("上層頁面 ID（只用於頁面）"),
  menu_order: z.number().int().optional(),
  comment_status: z.enum(["open", "closed"]).optional(),
  sticky: z.boolean().optional(),
  seo_title: z.string().nullable().optional().describe("SEO 標題（Rank Math）；空字串＝清除"),
  seo_description: z.string().nullable().optional().describe("Meta 描述；空字串＝清除"),
  category_ids: z.array(z.number().int()).optional().describe("文章分類 ID（給了就整組取代）"),
  tag_ids: z.array(z.number().int()).optional().describe("文章標籤 ID（給了就整組取代）"),
};

const productFields = {
  name: z.string().optional(),
  slug: z.string().optional(),
  type: z.enum(["simple", "variable", "grouped", "external"]).optional(),
  status: z.enum(["publish", "draft", "pending", "private"]).optional().describe("新增時預設 draft"),
  description: z.string().optional().describe("商品描述 HTML"),
  short_description: z.string().optional().describe("簡短描述 HTML"),
  sku: z.string().nullable().optional(),
  regular_price: z.number().nonnegative().nullable().optional().describe("原價（TWD）"),
  sale_price: z.number().nonnegative().nullable().optional().describe("特價；null＝取消特價"),
  manage_stock: z.boolean().optional(),
  stock_quantity: z.number().int().nullable().optional(),
  stock_status: z.enum(["instock", "outofstock", "onbackorder"]).optional(),
  featured: z.boolean().optional(),
  catalog_visibility: z.enum(["visible", "catalog", "search", "hidden"]).optional(),
  featured_media_id: z.number().int().nullable().optional(),
  gallery_media_ids: z.array(z.number().int()).optional(),
  category_ids: z.array(z.number().int()).optional().describe("商品分類 ID（整組取代）"),
  tag_ids: z.array(z.number().int()).optional().describe("商品標籤 ID（整組取代）"),
  seo_title: z.string().nullable().optional(),
  seo_description: z.string().nullable().optional(),
};

export function buildServer(actor: Actor) {
  const server = new McpServer(
    { name: "emily-loveccdd-cms", version: "1.0.0" },
    {
      instructions:
        "The three of us（loveccdd.com）網站管理：文章、頁面、WooCommerce 商品（價格、庫存、變體）、分類、媒體、訂單、表單提交、網站設定、轉址。" +
        "所有寫入都會寫入稽核紀錄（site_emily.audit_log）。新增內容預設為草稿（status=draft），確認後再用 update_post / update_product 設 status=publish。" +
        "刪除預設移到回收桶（force=true 才永久刪除）。金額單位 TWD。藍新金流訂單由 NotifyURL 自動更新狀態；銀行轉帳／支票／貨到付款需人工確認收款。",
    },
  );

  /* ---------------------------------------------------------------- site */
  server.registerTool("site_info", { title: "網站概況", description: "網站網址、名稱與各類內容數量。", inputSchema: {}, annotations: RO }, h(async () => ({ url: SITE_URL, counts: await site.dashboardCounts() })));
  server.registerTool(
    "get_settings",
    { title: "讀取網站設定", description: "讀取全部網站設定（general、contact、social、tracking、reading、woocommerce、seo…）。", inputSchema: {}, annotations: RO },
    h(async () => site.getAllSettings(true)),
  );
  server.registerTool(
    "update_setting",
    {
      title: "修改網站設定",
      description: "以淺層合併方式修改一組設定。例：key=general, value={name:'…', logo_url:'…'}；key=tracking, value={gtm:'GTM-XXXX', ga4:'G-XXXX', facebook_pixel:'123'}；欄位值 null 代表移除該欄位。",
      inputSchema: { key: z.string().describe("設定鍵：general/contact/social/tracking/reading/comments/woocommerce/seo/newsletter"), value: z.record(z.string(), z.any()) },
      annotations: WR,
    },
    h(async ({ key, value }) => site.setSetting(actor, key, value)),
  );

  /* ---------------------------------------------------------------- posts & pages */
  server.registerTool(
    "list_posts",
    {
      title: "列出文章／頁面",
      description: "列出文章（type=post）或頁面（type=page），可依狀態、關鍵字、分類篩選。回傳 id、標題、狀態、網址等。",
      inputSchema: { type: z.enum(["post", "page"]).optional(), status: z.enum(["all", "draft", "pending", "publish", "future", "private", "trash"]).optional(), search: z.string().optional(), term_id: z.number().int().optional(), page, per },
      annotations: RO,
    },
    h(async (a) => posts.listPosts({ type: a.type, status: a.status, search: a.search, termId: a.term_id, page: a.page, per: a.per })),
  );
  server.registerTool(
    "get_post",
    { title: "讀取文章／頁面", description: "以 ID 讀取完整文章或頁面（含內文 HTML、分類 ID、SEO）。", inputSchema: { id }, annotations: RO },
    h(async ({ id }) => {
      const p = await posts.getPost(id);
      if (!p) throw new CmsError(`找不到文章／頁面 ${id}`, 404);
      return { ...p, url: p.link_path ? SITE_URL + p.link_path : null, preview_path: posts.previewPathOf(p) };
    }),
  );
  server.registerTool(
    "create_post",
    { title: "新增文章／頁面", description: "新增文章或頁面，預設為草稿。", inputSchema: { type: z.enum(["post", "page"]).default("post"), ...postFields }, annotations: WR },
    h(async ({ type, ...input }) => posts.createPost(actor, type ?? "post", input)),
  );
  server.registerTool(
    "update_post",
    { title: "修改文章／頁面", description: "修改文章或頁面；只送要改的欄位。發布：status=publish；排程：status=future + date。", inputSchema: { id, ...postFields }, annotations: WR },
    h(async ({ id, ...input }) => posts.updatePost(actor, id, input)),
  );
  server.registerTool(
    "delete_post",
    { title: "刪除文章／頁面", description: "預設移到回收桶；force=true 永久刪除。", inputSchema: { id, force: z.boolean().optional() }, annotations: DEL },
    h(async ({ id, force }) => posts.deletePost(actor, id, !!force)),
  );

  /* ---------------------------------------------------------------- products */
  server.registerTool(
    "list_products",
    { title: "列出商品", description: "列出商品（含價格、庫存）。", inputSchema: { status: z.enum(["all", "publish", "draft", "pending", "private", "trash"]).optional(), search: z.string().optional(), term_id: z.number().int().optional(), page, per }, annotations: RO },
    h(async (a) => products.listProducts({ status: a.status, search: a.search, termId: a.term_id, page: a.page, per: a.per })),
  );
  server.registerTool(
    "get_product",
    { title: "讀取商品", description: "讀取商品完整資料，含變體、屬性與分類 ID。", inputSchema: { id }, annotations: RO },
    h(async ({ id }) => {
      const p = await products.getProduct(id);
      if (!p) throw new CmsError(`找不到商品 ${id}`, 404);
      return p;
    }),
  );
  server.registerTool("create_product", { title: "新增商品", description: "新增商品，預設為草稿。", inputSchema: productFields, annotations: WR }, h(async (input) => products.createProduct(actor, input)));
  server.registerTool(
    "update_product",
    { title: "修改商品", description: "修改商品欄位；只送要改的欄位。", inputSchema: { id, ...productFields }, annotations: WR },
    h(async ({ id, ...input }) => products.updateProduct(actor, id, input)),
  );
  server.registerTool(
    "delete_product",
    { title: "刪除商品", description: "預設移到回收桶；force=true 永久刪除。", inputSchema: { id, force: z.boolean().optional() }, annotations: DEL },
    h(async ({ id, force }) => products.deleteProduct(actor, id, !!force)),
  );
  server.registerTool(
    "set_product_price",
    {
      title: "調整價格",
      description: "調整商品（或指定變體）的原價／特價與特價期間。",
      inputSchema: {
        product_id: id,
        variation_id: z.number().int().optional(),
        regular_price: z.number().nonnegative().nullable().optional(),
        sale_price: z.number().nonnegative().nullable().optional(),
        date_on_sale_from: z.string().nullable().optional(),
        date_on_sale_to: z.string().nullable().optional(),
      },
      annotations: WR,
    },
    h(async ({ product_id, ...p }) => products.setPrice(actor, product_id, p)),
  );
  server.registerTool(
    "set_product_stock",
    {
      title: "調整庫存",
      description: "設定庫存數量（stock_quantity）或增減（adjust_by，可負數），或直接設定庫存狀態。可指定變體。",
      inputSchema: {
        product_id: id,
        variation_id: z.number().int().optional(),
        manage_stock: z.boolean().optional(),
        stock_quantity: z.number().int().nullable().optional(),
        adjust_by: z.number().int().optional(),
        stock_status: z.enum(["instock", "outofstock", "onbackorder"]).optional(),
      },
      annotations: WR,
    },
    h(async ({ product_id, ...s }) => products.setStock(actor, product_id, s)),
  );
  server.registerTool(
    "upsert_variation",
    {
      title: "新增／修改變體",
      description: "可變商品的變體。給 variation_id 就修改，否則新增。attributes 例：{\"pa_colors\":\"blue\"}。",
      inputSchema: {
        product_id: id,
        variation_id: z.number().int().optional(),
        attributes: z.record(z.string(), z.string()).optional(),
        sku: z.string().nullable().optional(),
        regular_price: z.number().nonnegative().nullable().optional(),
        sale_price: z.number().nonnegative().nullable().optional(),
        manage_stock: z.boolean().optional(),
        stock_quantity: z.number().int().nullable().optional(),
        stock_status: z.enum(["instock", "outofstock", "onbackorder"]).optional(),
        image_id: z.number().int().nullable().optional(),
        status: z.enum(["publish", "private"]).optional(),
      },
      annotations: WR,
    },
    h(async ({ product_id, variation_id, ...v }) => (variation_id ? products.updateVariation(actor, variation_id, v, "variation.update", product_id) : products.createVariation(actor, product_id, v))),
  );
  server.registerTool(
    "delete_variation",
    { title: "刪除變體", description: "永久刪除一個變體。", inputSchema: { variation_id: id }, annotations: DEL },
    h(async ({ variation_id }) => products.deleteVariation(actor, variation_id)),
  );

  /* ---------------------------------------------------------------- taxonomies */
  server.registerTool(
    "list_terms",
    { title: "列出分類／標籤", description: "taxonomy：category（文章分類）、post_tag、product_cat、product_tag、pa_colors、pa_brands。", inputSchema: { taxonomy: z.string().optional(), search: z.string().optional() }, annotations: RO },
    h(async ({ taxonomy, search }) => terms.listTerms(taxonomy, search)),
  );
  server.registerTool(
    "create_term",
    { title: "新增分類／標籤", description: "新增分類或標籤。", inputSchema: { taxonomy: z.string(), name: z.string(), slug: z.string().optional(), description: z.string().optional(), parent_id: z.number().int().nullable().optional() }, annotations: WR },
    h(async ({ taxonomy, ...input }) => terms.createTerm(actor, taxonomy, input)),
  );
  server.registerTool(
    "update_term",
    { title: "修改分類／標籤", description: "修改名稱、代稱、描述或上層。改代稱會自動建立舊網址 301。", inputSchema: { id, name: z.string().optional(), slug: z.string().optional(), description: z.string().optional(), parent_id: z.number().int().nullable().optional() }, annotations: WR },
    h(async ({ id, ...input }) => terms.updateTerm(actor, id, input)),
  );
  server.registerTool("delete_term", { title: "刪除分類／標籤", description: "刪除分類或標籤（子分類上移一層）。", inputSchema: { id }, annotations: DEL }, h(async ({ id }) => terms.deleteTerm(actor, id)));

  /* ---------------------------------------------------------------- media */
  server.registerTool(
    "list_media",
    { title: "列出媒體", description: "媒體庫列表。", inputSchema: { search: z.string().optional(), type: z.enum(["all", "image", "video", "audio", "file"]).optional(), page, per }, annotations: RO },
    h(async (a) => media.listMedia(a)),
  );
  server.registerTool(
    "upload_media",
    {
      title: "上傳媒體",
      description: "由公開網址（url）或 base64 內容（data_base64 + filename + mime_type）上傳。圖片自動轉 WebP（最長邊 2000）。",
      inputSchema: {
        url: z.string().optional(),
        data_base64: z.string().optional(),
        filename: z.string().optional(),
        mime_type: z.string().optional(),
        title: z.string().optional(),
        alt_text: z.string().optional(),
      },
      annotations: { ...WR, openWorldHint: true },
    },
    h(async (a) => {
      let file: { name: string; type: string; data: Buffer };
      if (a.url) file = await media.fetchRemote(a.url);
      else if (a.data_base64 && a.filename && a.mime_type) file = { name: a.filename, type: a.mime_type, data: Buffer.from(a.data_base64, "base64") };
      else throw new CmsError("請提供 url，或 data_base64 + filename + mime_type");
      if (a.filename) file.name = a.filename;
      return media.uploadMedia(actor, file, { title: a.title, alt_text: a.alt_text });
    }),
  );
  server.registerTool(
    "update_media",
    { title: "修改媒體資訊", description: "修改標題、替代文字、說明。", inputSchema: { id, title: z.string().optional(), alt_text: z.string().optional(), caption: z.string().optional(), description: z.string().optional() }, annotations: WR },
    h(async ({ id, ...p }) => media.updateMedia(actor, id, p)),
  );
  server.registerTool("delete_media", { title: "刪除媒體", description: "永久刪除媒體（檔案若無其他引用一併刪除）。", inputSchema: { id }, annotations: DEL }, h(async ({ id }) => media.deleteMedia(actor, id)));

  /* ---------------------------------------------------------------- orders / customers / coupons */
  server.registerTool(
    "list_orders",
    { title: "查詢訂單", description: "依狀態、關鍵字（Email、訂單編號）查詢訂單。", inputSchema: { status: z.string().optional().describe("pending/processing/on-hold/completed/cancelled/refunded/failed/all"), search: z.string().optional(), page, per }, annotations: RO },
    h(async (a) => commerce.listOrders(a)),
  );
  server.registerTool(
    "get_order",
    { title: "讀取訂單", description: "訂單明細（品項、地址、備註）。", inputSchema: { id }, annotations: RO },
    h(async ({ id }) => {
      const o = await commerce.getOrder(id);
      if (!o) throw new CmsError(`找不到訂單 ${id}`, 404);
      return o;
    }),
  );
  server.registerTool(
    "update_order_status",
    { title: "更新訂單狀態", description: "變更訂單狀態並自動加一則訂單備註。", inputSchema: { id, status: z.enum(["pending", "processing", "on-hold", "completed", "cancelled", "refunded", "failed"]), note: z.string().optional() }, annotations: WR },
    h(async ({ id, status, note }) => commerce.updateOrderStatus(actor, id, status, note)),
  );
  server.registerTool(
    "add_order_note",
    { title: "新增訂單備註", description: "新增訂單備註（is_customer_note=true 為給顧客的備註）。", inputSchema: { id, content: z.string(), is_customer_note: z.boolean().optional() }, annotations: WR },
    h(async ({ id, content, is_customer_note }) => commerce.addOrderNote(actor, id, content, !!is_customer_note)),
  );
  server.registerTool(
    "list_customers",
    { title: "查詢顧客", description: "依 Email／姓名查詢顧客。", inputSchema: { search: z.string().optional(), page, per }, annotations: RO },
    h(async (a) => commerce.listCustomers(a)),
  );
  server.registerTool("list_coupons", { title: "列出優惠券", description: "全部優惠券。", inputSchema: {}, annotations: RO }, h(async () => commerce.listCoupons()));
  server.registerTool(
    "upsert_coupon",
    {
      title: "新增／修改優惠券",
      description: "給 id 就修改，否則新增。discount_type：percent／fixed_cart／fixed_product。",
      inputSchema: {
        id: z.number().int().optional(),
        code: z.string().optional(),
        discount_type: z.enum(["percent", "fixed_cart", "fixed_product"]).optional(),
        amount: z.number().nonnegative().optional(),
        description: z.string().optional(),
        date_expires: z.string().nullable().optional(),
        usage_limit: z.number().int().nullable().optional(),
        minimum_amount: z.number().nullable().optional(),
        free_shipping: z.boolean().optional(),
        status: z.enum(["publish", "draft"]).optional(),
      },
      annotations: WR,
    },
    h(async ({ id, ...c }) => commerce.saveCoupon(actor, id ?? null, c)),
  );

  /* ---------------------------------------------------------------- forms, redirects, audit */
  server.registerTool(
    "list_forms",
    { title: "列出表單", description: "表單與各自的提交數。", inputSchema: {}, annotations: RO },
    h(async () => (await site.listForms()).map(({ fields: _f, ...f }) => f)),
  );
  server.registerTool(
    "list_form_submissions",
    { title: "查詢表單提交", description: "查詢表單提交內容。", inputSchema: { form_id: z.number().int().optional(), status: z.enum(["all", "new", "read", "spam", "trash"]).optional(), since: z.string().optional().describe("ISO 時間，只取此後的提交"), page, per }, annotations: RO },
    h(async (a) => site.listSubmissions({ formId: a.form_id, status: a.status, since: a.since, page: a.page, per: a.per })),
  );
  server.registerTool(
    "list_redirects",
    { title: "列出轉址", description: "301/302 轉址規則。", inputSchema: { search: z.string().optional(), kind: z.string().optional(), page, per }, annotations: RO },
    h(async (a) => site.listRedirects(a)),
  );
  server.registerTool(
    "upsert_redirect",
    { title: "新增／修改轉址", description: "給 id 就修改，否則新增。", inputSchema: { id: z.number().int().optional(), source_path: z.string(), target: z.string(), status_code: z.number().int().optional() }, annotations: WR },
    h(async ({ id, ...r }) => site.saveRedirect(actor, id ?? null, r)),
  );
  server.registerTool("delete_redirect", { title: "刪除轉址", description: "刪除一條轉址。", inputSchema: { id }, annotations: DEL }, h(async ({ id }) => site.deleteRedirect(actor, id)));
  server.registerTool(
    "list_audit_log",
    { title: "稽核紀錄", description: "最近的寫入紀錄。", inputSchema: { entity_type: z.string().optional(), source: z.enum(["all", "admin", "mcp", "system"]).optional(), search: z.string().optional(), page, per }, annotations: RO },
    h(async (a) => site.listAudit({ entityType: a.entity_type, source: a.source, search: a.search, page: a.page, per: a.per })),
  );

  return server;
}
