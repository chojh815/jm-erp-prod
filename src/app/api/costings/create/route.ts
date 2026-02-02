// src/app/api/costings/create/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}
function bad(message: string, status = 400, extra: any = {}) {
  return NextResponse.json({ success: false, error: message, ...extra }, { status });
}

async function getColumns(table: string): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin
    .from("information_schema.columns")
    .select("column_name")
    .eq("table_schema", "public")
    .eq("table_name", table);

  if (error) throw error;
  return new Set((data ?? []).map((r: any) => String(r.column_name)));
}

/**
 * POST /api/costings/create
 * body: { style_no: string, stage?: string, currency?: string }
 *
 * - Creates a blank costing header if not exists.
 * - Returns { id } of costing_headers row.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const style_no = String(body?.style_no ?? "").trim();
    if (!style_no) return bad("style_no is required", 400);

    const stage = String(body?.stage ?? "SAMPLE").toUpperCase();
    const currency = String(body?.currency ?? "CNY").toUpperCase();

    // 1) If exists, return it
    const existing = await supabaseAdmin
      .from("costing_headers")
      .select("id, style_no")
      .eq("style_no", style_no)
      .eq("is_deleted", false)
      .maybeSingle();

    if (existing.data?.id) {
      return ok({ id: existing.data.id, already_exists: true });
    }

    // 2) Insert with dynamic columns (prevents "column does not exist" issues)
    const cols = await getColumns("costing_headers");

    const id = (globalThis.crypto as any)?.randomUUID
      ? (globalThis.crypto as any).randomUUID()
      : undefined;

    const nowIso = new Date().toISOString();

    const row: any = {};
    if (cols.has("id") && id) row.id = id;

    if (cols.has("style_no")) row.style_no = style_no;
    if (cols.has("stage")) row.stage = stage;
    if (cols.has("status")) row.status = "DRAFT";
    if (cols.has("currency")) row.currency = currency;

    // common audit columns (best-effort)
    if (cols.has("created_at")) row.created_at = nowIso;
    if (cols.has("updated_at")) row.updated_at = nowIso;

    // soft delete defaults
    if (cols.has("is_deleted")) row.is_deleted = false;

    // some projects use ver/version_no
    if (cols.has("ver")) row.ver = 1;
    if (cols.has("version_no")) row.version_no = 1;

    const ins = await supabaseAdmin
      .from("costing_headers")
      .insert(row)
      .select("id")
      .single();

    if (ins.error) return bad(ins.error.message, 500, { hint: "insert costing_headers failed" });

    return ok({ id: ins.data.id });
  } catch (e: any) {
    return bad(e?.message ?? "Unknown error", 500);
  }
}
