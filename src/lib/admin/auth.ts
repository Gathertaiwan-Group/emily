import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import type { Actor } from "@/lib/cms/core";

export type AdminUser = { id: string; email: string; role: string; display_name: string | null };

/** Admin cookies are scoped to /admin paths only and are httpOnly. */
export const ADMIN_COOKIE_OPTS = { path: "/", sameSite: "lax" as const, httpOnly: true, secure: process.env.NODE_ENV === "production" };
export const ADMIN_COOKIE_NAME = "emily-admin-auth";

/** Supabase Auth client bound to the request cookies (anon key, session only — data access uses the service client). */
export async function authClient() {
  const store = await cookies();
  return createServerClient(env.supabaseUrl(), env.anonKey(), {
    cookieOptions: { name: ADMIN_COOKIE_NAME, ...ADMIN_COOKIE_OPTS },
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, { ...options, ...ADMIN_COOKIE_OPTS });
        } catch {
          /* Server Component render: the proxy refreshes the session instead */
        }
      },
    },
  });
}

/** The signed-in user, only if listed in site_emily.admins. getUser() verifies the JWT with Supabase Auth. */
export const currentAdmin = cache(async (): Promise<AdminUser | null> => {
  const sb = await authClient();
  const { data, error } = await sb.auth.getUser();
  if (error || !data.user) return null;
  const { data: row } = await db().from("admins").select("user_id,email,role,display_name").eq("user_id", data.user.id).maybeSingle();
  if (!row) return null;
  return { id: row.user_id, email: row.email, role: row.role, display_name: row.display_name };
});

export async function requireAdmin(): Promise<AdminUser> {
  const a = await currentAdmin();
  if (!a) redirect("/admin/login");
  return a;
}

export async function actorOf(a: AdminUser): Promise<Actor> {
  const h = await headers();
  return {
    label: a.email,
    id: a.id,
    source: "admin",
    ip: (h.get("x-forwarded-for") || "").split(",")[0].trim() || null,
    ua: h.get("user-agent"),
  };
}

/** For route handlers / server actions: the admin actor or null. */
export async function adminActor(): Promise<Actor | null> {
  const a = await currentAdmin();
  return a ? actorOf(a) : null;
}
