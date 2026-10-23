import type { ReactNode } from "react";

export type SP = Promise<Record<string, string | string[] | undefined>>;

export async function sp(p: SP) {
  const raw = await p;
  const o: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) if (v != null) o[k] = Array.isArray(v) ? v[0] : v;
  return o;
}

export function Notice({ q }: { q: Record<string, string> }) {
  return (
    <>
      {q.msg ? <div className="adm-notice ok">{q.msg}</div> : null}
      {q.err ? <div className="adm-notice err">{q.err}</div> : null}
    </>
  );
}

export function dt(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

/** ISO → value for <input type=datetime-local> in Asia/Taipei. */
export function localInput(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(Date.parse(iso) + 8 * 3600_000);
  return d.toISOString().slice(0, 16);
}

export function money(n: unknown) {
  if (n == null || n === "") return "—";
  return "NT$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function Badge({ s, label }: { s: string; label?: string }) {
  return <span className={`adm-badge ${s}`}>{label ?? s}</span>;
}

export const POST_STATUS_LABEL: Record<string, string> = { publish: "已發布", draft: "草稿", pending: "待審", future: "已排程", private: "私密", trash: "回收桶", all: "全部" };

export function Pager({ total, page, per, base, q }: { total: number; page: number; per: number; base: string; q: Record<string, string> }) {
  const pages = Math.max(1, Math.ceil(total / per));
  const href = (p: number) => {
    const u = new URLSearchParams({ ...q, page: String(p) });
    u.delete("msg");
    u.delete("err");
    return `${base}?${u}`;
  };
  return (
    <div className="adm-pager">
      <span>{total} 個項目</span>
      {page > 1 ? <a className="adm-btn small" href={href(page - 1)}>‹</a> : null}
      <span>
        第 {page} / {pages} 頁
      </span>
      {page < pages ? <a className="adm-btn small" href={href(page + 1)}>›</a> : null}
    </div>
  );
}

export function SubNav({ items, current }: { items: { key: string; label: ReactNode; href: string }[]; current: string }) {
  return (
    <div className="adm-sub">
      {items.map((it, i) => (
        <span key={it.key}>
          {i ? " | " : ""}
          <a href={it.href} className={it.key === current ? "on" : ""}>
            {it.label}
          </a>
        </span>
      ))}
    </div>
  );
}
