"use client";
import { useActionState } from "react";
import { login } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="adm-card">
      {state?.error ? <div className="adm-notice err">{state.error}</div> : null}
      <label className="adm-label" htmlFor="email">
        電子郵件
      </label>
      <input id="email" name="email" type="email" autoComplete="username" required />
      <label className="adm-label" htmlFor="password">
        密碼
      </label>
      <input id="password" name="password" type="password" autoComplete="current-password" required />
      <p style={{ marginTop: 16 }}>
        <button className="adm-btn primary" disabled={pending} style={{ width: "100%", justifyContent: "center" }}>
          {pending ? "登入中…" : "登入"}
        </button>
      </p>
    </form>
  );
}
