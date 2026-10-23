import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";
import { SCHEMA } from "./site";

let admin: SupabaseClient<any, any, any> | null = null;

/** The shared Supabase project occasionally answers 502/503/504 (Cloudflare) under load:
 *  retry idempotent reads a few times instead of failing the whole page render. */
const retryingFetch: typeof fetch = async (input, init) => {
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const idempotent = method === "GET" || method === "HEAD";
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(input, init);
      if (!idempotent || attempt >= 3 || ![502, 503, 504].includes(res.status)) return res;
    } catch (e) {
      if (!idempotent || attempt >= 3) throw e;
    }
    await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
  }
};

/** Service-role client scoped to schema site_emily. Server only; never sent to the browser. */
export function db(): SupabaseClient<any, any, any> {
  if (!admin) {
    admin = createClient(env.supabaseUrl(), env.serviceKey(), {
      db: { schema: SCHEMA },
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "x-client-info": "emily-storefront" }, fetch: retryingFetch },
    });
  }
  return admin;
}

/** Verifies a Supabase access token (from the browser session) and returns the auth user. */
export async function userFromToken(token: string | null | undefined) {
  if (!token) return null;
  const { data, error } = await db().auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}
