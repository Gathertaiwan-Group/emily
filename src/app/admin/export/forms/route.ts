import { adminActor } from "@/lib/admin/auth";
import { audit } from "@/lib/cms/core";
import { listSubmissions, submissionsCsv } from "@/lib/cms/site";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const actor = await adminActor();
  if (!actor) return new Response("unauthorized", { status: 401 });
  const formId = Number(new URL(req.url).searchParams.get("form") || 0) || undefined;
  const rows: any[] = [];
  for (let page = 1; page < 100; page++) {
    const r = await listSubmissions({ formId, status: "all", page, per: 1000 });
    rows.push(...r.rows);
    if (r.rows.length < 1000) break;
  }
  await audit(actor, "form_submission.export", "form", formId ?? "all", null, { rows: rows.length });
  return new Response(submissionsCsv(rows), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="form-submissions-${formId ?? "all"}.csv"`, "cache-control": "no-store" },
  });
}
