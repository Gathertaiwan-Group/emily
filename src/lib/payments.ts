// Checkout payment methods, mirroring the old WooCommerce site (loveccdd.com) settings:
// enabled gateways, order (woocommerce_gateway_order), titles, descriptions and thank-you instructions.
// Public information only — 藍新 keys come from env (see lib/newebpay/index.ts).

export type GatewayId = "newebpay" | "bacs" | "cheque" | "cod" | "ry_newebpay_credit";

export type Gateway = {
  id: GatewayId;
  title: string;
  description: string; // shown under the radio at checkout (HTML allowed, static)
  instructions: string; // shown on the thank-you page
  online: boolean; // redirects to 藍新 MPG
  /** status after checkout (WooCommerce process_payment) */
  initialStatus: "pending" | "on-hold" | "processing";
  /** note added at checkout (WooCommerce update_status note) */
  checkoutNote?: string;
  /** RY WooCommerce Tools reduces stock when the order is placed; core WC gateways on status change */
  reduceStockAtCheckout?: boolean;
  /** MPG payment flags */
  mpg?: Record<string, 1>;
};

export const GATEWAYS: Gateway[] = [
  {
    id: "newebpay",
    title: "信用卡付款",
    description: "透過 藍新金流 付款。<br>會連結到 藍新金流 頁面。",
    instructions: "",
    online: true,
    initialStatus: "pending",
    mpg: { CREDIT: 1, LINEPAY: 1 }, // NwpPaymentMethodCredit / NwpPaymentMethodLinePay = yes
  },
  {
    id: "bacs",
    title: "銀行轉帳",
    description: "將您的款項直接匯入我們的銀行帳號。請使用您的訂單編號作為付款參考。您的訂單在還沒有確認收到款項之前不會出貨。",
    instructions: "",
    online: false,
    initialStatus: "on-hold",
    checkoutNote: "等待銀行轉帳付款",
  },
  {
    id: "cheque",
    title: "支票付款",
    description: "請將付款支票寄送到商店地址.",
    instructions: "",
    online: false,
    initialStatus: "on-hold",
    checkoutNote: "等待支票付款",
  },
  {
    id: "cod",
    title: "貨到付款",
    description: "收到貨時以現金付款。",
    instructions: "收到貨時以現金付款。",
    online: false,
    initialStatus: "processing",
    checkoutNote: "到貨時付款。",
  },
  {
    id: "ry_newebpay_credit",
    title: "信用卡一次付清",
    description: "使用信用卡付款",
    instructions: "",
    online: true,
    initialStatus: "pending",
    reduceStockAtCheckout: true,
    mpg: { CREDIT: 1 },
  },
];

/** woocommerce_bacs_accounts — shown publicly on the bank-transfer thank-you page (copied as-is from the old site). */
export const BACS_ACCOUNTS = [{ account_name: "測試用", account_number: "1234567890", bank_name: "合歡山", sort_code: "111", iban: "2222", bic: "3333" }];

/** woocommerce_hold_stock_minutes */
export const HOLD_STOCK_MINUTES = 60;
/** woocommerce_newebpay_settings.ExpireDate (days; used by ATM/CVS methods) */
export const NEWEBPAY_EXPIRE_DAYS = 7;

export const ONLINE_METHODS = GATEWAYS.filter((g) => g.online).map((g) => g.id);

export function gateway(id: string): Gateway | undefined {
  return GATEWAYS.find((g) => g.id === id);
}

/** Gateways a customer may choose: 藍新 only when its keys are configured. */
export function availableGateways(newebpayEnabled: boolean): Gateway[] {
  return GATEWAYS.filter((g) => !g.online || newebpayEnabled);
}
