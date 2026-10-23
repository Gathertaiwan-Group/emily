"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { encPath, logForm, money, sbCfg } from "./util";

type Order = { id: number; number: string | null; status: string; date_created: string; total: number; payment_method_title: string | null; items: { name: string; quantity: number; total: number }[] };
const STATUS: Record<string, string> = {
  pending: "待付款",
  processing: "處理中",
  "on-hold": "保留",
  completed: "完成",
  cancelled: "已取消",
  refunded: "已退費",
  failed: "失敗",
  "checkout-draft": "草稿",
};

function useSb(): SupabaseClient | null {
  return useMemo(() => {
    if (typeof window === "undefined") return null;
    const cfg = sbCfg();
    return cfg ? createClient(cfg.url, cfg.anon, { auth: { persistSession: true, storageKey: "emily-auth" } }) : null;
  }, []);
}

export default function AccountView({ base, sub }: { base: string; sub: string[] }) {
  const sb = useSb();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [showReg, setShowReg] = useState(false);
  const endpoint = sub[0] ?? "";

  useEffect(() => {
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, [sb]);

  useEffect(() => {
    if (!session || endpoint !== "orders") return;
    fetch("/api/account/orders", { headers: { authorization: `Bearer ${session.access_token}` } })
      .then((r) => r.json())
      .then((j) => setOrders(j.orders ?? []))
      .catch(() => setOrders([]));
  }, [session, endpoint]);

  async function login(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!sb) return;
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("username") ?? "").trim();
    const password = String(fd.get("password") ?? "");
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    logForm("login", { username: email, rememberme: fd.get("rememberme") ? "forever" : "", success: error ? "no" : "yes" });
    if (error) return setNotice({ text: "錯誤：電子郵件地址或密碼不正確。", error: true });
    await fetch("/api/account/link", { method: "POST", headers: { authorization: `Bearer ${data.session!.access_token}` } });
    setNotice(null);
  }

  async function register(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!sb) return;
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") ?? "").trim();
    const password = String(fd.get("password") ?? "");
    if (password.length < 8) return setNotice({ text: "密碼至少需要 8 個字元。", error: true });
    const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: `${location.origin}${base}` } });
    logForm("register", { email, success: error ? "no" : "yes" });
    if (error) return setNotice({ text: `註冊失敗：${error.message}`, error: true });
    if (data.session) {
      await fetch("/api/account/link", { method: "POST", headers: { authorization: `Bearer ${data.session.access_token}` } });
      setNotice({ text: "註冊成功，已為你登入。" });
    } else setNotice({ text: "註冊成功！請到信箱點擊確認連結後再登入。" });
  }

  async function lost(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!sb) return;
    const email = String(new FormData(e.currentTarget).get("user_login") ?? "").trim();
    await sb.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}${base}` });
    logForm("lost-password", { user_login: email });
    setNotice({ text: "如果該電子郵件地址已註冊，重設密碼的連結已寄出。" });
  }

  const notices = (
    <div className="woocommerce-notices-wrapper">
      {notice && (
        <div className={notice.error ? "woocommerce-error" : "woocommerce-message"} role="alert">
          {notice.text}
        </div>
      )}
    </div>
  );

  if (endpoint === "lost-password" && !session) {
    return (
      <div className="woocommerce">
        {notices}
        <form method="post" className="woocommerce-ResetPassword lost_reset_password" onSubmit={lost} data-form="lost-password">
          <p>忘記密碼了嗎？請輸入你的電子郵件地址，你會收到一封電子郵件，其中包含建立新密碼的連結。</p>
          <p className="woocommerce-form-row woocommerce-form-row--first form-row form-row-first">
            <label htmlFor="user_login">
              電子郵件&nbsp;<span className="required">*</span>
            </label>
            <input className="woocommerce-Input woocommerce-Input--text input-text" type="text" name="user_login" id="user_login" autoComplete="email" required />
          </p>
          <div className="clear"></div>
          <p className="woocommerce-form-row form-row">
            <button type="submit" className="woocommerce-Button button" value="重設密碼">
              重設密碼
            </button>
          </p>
        </form>
      </div>
    );
  }

  if (!ready || !session) {
    return (
      <div className="woocommerce">
        {notices}
        <div id="customer_login">
          <div>
            <h2>登入</h2>
            <form className="woocommerce-form woocommerce-form-login login" method="post" noValidate onSubmit={login} data-form="login">
              <p className="woocommerce-form-row woocommerce-form-row--wide form-row form-row-wide">
                <label htmlFor="username">
                  使用者名稱 或 電子郵件&nbsp;<span className="required" aria-hidden="true">*</span>
                  <span className="screen-reader-text">必填</span>
                </label>
                <input type="text" className="woocommerce-Input woocommerce-Input--text input-text" name="username" id="username" autoComplete="username" required aria-required="true" />
              </p>
              <p className="woocommerce-form-row woocommerce-form-row--wide form-row form-row-wide">
                <label htmlFor="password">
                  密碼&nbsp;<span className="required" aria-hidden="true">*</span>
                  <span className="screen-reader-text">必填</span>
                </label>
                <input className="woocommerce-Input woocommerce-Input--text input-text" type="password" name="password" id="password" autoComplete="current-password" required aria-required="true" />
              </p>
              <p className="form-row">
                <label className="woocommerce-form__label woocommerce-form__label-for-checkbox woocommerce-form-login__rememberme">
                  <input className="woocommerce-form__input woocommerce-form__input-checkbox" name="rememberme" type="checkbox" id="rememberme" value="forever" /> <span>保持登入</span>
                </label>
                <button type="submit" className="woocommerce-button button woocommerce-form-login__submit" name="login" value="登入">
                  登入
                </button>
              </p>
              <p className="woocommerce-LostPassword lost_password">
                <a href={`${base}/lost-password`}>忘記密碼？</a>
                <span style={{ marginLeft: 15 }}>
                  還沒有帳號？
                  <a href="#register" onClick={(e) => (e.preventDefault(), setShowReg(!showReg))}>
                    註冊新帳號
                  </a>
                </span>
              </p>
            </form>
          </div>
          <div id="register" style={{ display: showReg ? "block" : "none", marginTop: 30 }}>
            <h2>註冊</h2>
            <form method="post" className="woocommerce-form woocommerce-form-register register" onSubmit={register} data-form="register">
              <p className="woocommerce-form-row woocommerce-form-row--wide form-row form-row-wide">
                <label htmlFor="reg_email">
                  電子郵件地址&nbsp;<span className="required" aria-hidden="true">*</span>
                </label>
                <input type="email" className="woocommerce-Input woocommerce-Input--text input-text" name="email" id="reg_email" autoComplete="email" required />
              </p>
              <p className="woocommerce-form-row woocommerce-form-row--wide form-row form-row-wide">
                <label htmlFor="reg_password">
                  密碼&nbsp;<span className="required" aria-hidden="true">*</span>
                </label>
                <input type="password" className="woocommerce-Input woocommerce-Input--text input-text" name="password" id="reg_password" autoComplete="new-password" required minLength={8} />
              </p>
              <div className="woocommerce-privacy-policy-text">
                <p>
                  你的個人資料將用於支援你在此網站中的使用體驗、管理帳號存取權，以及用於
                  <a href="/%e9%9a%b1%e7%a7%81%e6%94%bf%e7%ad%96" className="woocommerce-privacy-policy-link" target="_blank">
                    隱私權政策
                  </a>
                  中說明的其他用途。
                </p>
              </div>
              <p className="woocommerce-form-row form-row">
                <button type="submit" className="woocommerce-Button woocommerce-button button woocommerce-form-register__submit" name="register" value="註冊">
                  註冊
                </button>
              </p>
            </form>
          </div>
        </div>
      </div>
    );
  }

  const nav = [
    { ep: "", label: "控制台" },
    { ep: "orders", label: "訂單" },
    { ep: "edit-account", label: "帳號詳細資料" },
  ];
  return (
    <div className="woocommerce">
      {notices}
      <nav className="woocommerce-MyAccount-navigation" aria-label="帳號頁面">
        <ul>
          {nav.map((n) => (
            <li key={n.ep} className={`woocommerce-MyAccount-navigation-link woocommerce-MyAccount-navigation-link--${n.ep || "dashboard"}${endpoint === n.ep ? " is-active" : ""}`}>
              <a href={`${base}${n.ep ? "/" + n.ep : ""}`}>{n.label}</a>
            </li>
          ))}
          <li className="woocommerce-MyAccount-navigation-link woocommerce-MyAccount-navigation-link--customer-logout">
            <a href="#" onClick={async (e) => (e.preventDefault(), await sb?.auth.signOut(), (location.href = base))}>
              登出
            </a>
          </li>
        </ul>
      </nav>
      <div className="woocommerce-MyAccount-content">
        {endpoint === "orders" ? (
          orders == null ? (
            <p>載入中…</p>
          ) : orders.length === 0 ? (
            <div className="woocommerce-message woocommerce-message--info woocommerce-Message woocommerce-Message--info woocommerce-info">
              尚無任何訂單。{" "}
              <a className="woocommerce-Button button" href="/shop">
                瀏覽商品
              </a>
            </div>
          ) : (
            <table className="woocommerce-orders-table woocommerce-MyAccount-orders shop_table shop_table_responsive my_account_orders account-orders-table penci-account-orders">
              <thead>
                <tr>
                  <th>訂單</th>
                  <th>日期</th>
                  <th>狀態</th>
                  <th>總計</th>
                  <th>商品</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className={`woocommerce-orders-table__row woocommerce-orders-table__row--status-${o.status} order`}>
                    <td data-title="訂單">#{o.number ?? o.id}</td>
                    <td data-title="日期">
                      <time dateTime={o.date_created}>{new Date(o.date_created).toLocaleDateString("zh-TW")}</time>
                    </td>
                    <td data-title="狀態">{STATUS[o.status] ?? o.status}</td>
                    <td data-title="總計">
                      {money(Number(o.total))}（{o.items.reduce((s, i) => s + i.quantity, 0)} 件商品）
                    </td>
                    <td data-title="商品">{o.items.map((i) => `${i.name} × ${i.quantity}`).join("、")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : endpoint === "edit-account" ? (
          <p>
            登入帳號：<strong>{session.user.email}</strong>
            <br />
            若需修改密碼，請使用 <a href={`${base}/lost-password`}>忘記密碼</a> 寄送重設連結（需先登出）。
          </p>
        ) : (
          <>
            <p>
              你好 <strong>{session.user.email}</strong>（不是 {session.user.email}？
              <a href="#" onClick={async (e) => (e.preventDefault(), await sb?.auth.signOut(), (location.href = base))}>
                登出
              </a>
              ）
            </p>
            <p>
              從帳號控制台中，你可以檢視<a href={encPath(`${base}/orders`)}>近期訂單</a>，以及<a href={encPath(`${base}/edit-account`)}>編輯密碼和帳號詳細資料</a>。
            </p>
          </>
        )}
      </div>
    </div>
  );
}
