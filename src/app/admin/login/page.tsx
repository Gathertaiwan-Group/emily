import { redirect } from "next/navigation";
import { currentAdmin } from "@/lib/admin/auth";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "登入" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await currentAdmin()) redirect("/admin");
  return (
    <div className="adm-login">
      <h1>The three of us 後台</h1>
      <LoginForm />
      <p className="adm-help" style={{ textAlign: "center" }}>
        <a href="/">← 回到網站</a>
      </p>
    </div>
  );
}
