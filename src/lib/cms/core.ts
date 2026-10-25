import { revalidatePath } from "next/cache";
import "server-only";
import { db } from "@/lib/db";
import { invalidateMemo } from "@/lib/data";

/** Who performed a write. Every write in lib/cms records one audit_log row with this actor. */
export type Actor = {
  label: string; // admin email, or "mcp"
  id?: string | null; // auth user id
  source: "admin" | "mcp" | "system";
  ip?: string | null;
  ua?: string | null;
};

export const SYSTEM: Actor = { label: "system", source: "system" };

export class CmsError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export function must<T>(r: { data: T | null; error: any }, what: string): T {
  if (r.error) throw new CmsError(`${what}：${r.error.message}`, 500);
  return r.data as T;
}

function validIp(ip?: string | null) {
  if (!ip) return null;
  return /^[0-9a-f:.]+$/i.test(ip) ? ip : null;
}

/** Writes one row to site_emily.audit_log. Never throws (an audit failure is logged, not fatal). */
export async function audit(actor: Actor, action: string, entityType: string, entityId: string | number | null, before?: unknown, after?: unknown) {
  const { error } = await db()
    .from("audit_log")
    .insert({
      actor: actor.label,
      actor_user_id: actor.id ?? null,
      source: actor.source,
      action,
      entity_type: entityType,
      entity_id: entityId == null ? null : String(entityId),
      before: before === undefined ? null : before,
      after: after === undefined ? null : after,
      ip: validIp(actor.ip),
      user_agent: actor.ua ?? null,
    });
  if (error) console.error("[audit]", error.message);
}

/**
 * After a write: clear this instance's storefront memo and mark every cached (ISR) storefront page
 * stale so the change shows on the next visit. revalidatePath throws when called during a render
 * (e.g. the scheduled-post publisher); those pages then refresh within the ISR window (300 s).
 */
export function changed(prefix?: string) {
  invalidateMemo(prefix);
  try {
    revalidatePath("/[[...slug]]", "layout");
    revalidatePath("/", "layout");
  } catch {
    /* not in a server action / route handler */
  }
}

/** WordPress-style slug: keep unicode letters, lowercase, dashes; stored percent-encoded (lowercase hex) like WP. */
export function makeSlug(input: string): string {
  const s = input
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return encodeWpSlug(s || "untitled");
}

export function encodeWpSlug(s: string): string {
  let dec = s;
  try {
    dec = decodeURIComponent(s);
  } catch {
    /* keep */
  }
  return encodeURIComponent(dec).replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase());
}

export function decodeSlug(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function pick<T extends object>(obj: T, keys: (keyof T)[]): Partial<T> {
  const out: Partial<T> = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

/** Page through a query builder factory and collect all rows. */
export async function all<T>(q: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>, what: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const r = await q(from, from + 999);
    const rows = must(r, what) ?? [];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

/** Escape a user search term for PostgREST ilike filters inside or(). */
export function ilikeTerm(q: string): string {
  return q.replace(/[%_\\]/g, (m) => "\\" + m).replace(/[,()]/g, " ");
}
