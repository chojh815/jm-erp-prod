import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabaseServer";

const FK_CANDIDATES = ["header_id", "costing_header_id", "costing_id"];

function isUndefinedColumnError(e: any) {
  // Postgres undefined_column: 42703
  return e?.code === "42703" || /column .* does not exist/i.test(e?.message || "");
}

async function selectByFirstWorkingFK(supabase: any, table: string, headerId: string) {
  let lastErr: any = null;

  for (const fk of FK_CANDIDATES) {
    const { data, error } = await supabase.from(table).select("*").eq(fk, headerId);
    if (!error) return { rows: data ?? [], fk };
    lastErr = error;
    if (!isUndefinedColumnError(error)) break;
  }

  throw lastErr || new Error(`Failed to load ${table}`);
}

async function insertByFirstWorkingFK(supabase: any, table: string, headerId: string, rows: any[]) {
  let lastErr: any = null;

  for (const fk of FK_CANDIDATES) {
    const payload = rows.map((r) => ({ ...r, [fk]: headerId }));
    const { error } = await supabase.from(table).insert(payload);
    if (!error) return { fk };
    lastErr = error;
    if (!isUndefinedColumnError(error)) break;
  }

  throw lastErr || new Error(`Failed to insert into ${table}`);
}

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  const id = ctx.params.id;
  const supabase = createSupabaseServerClient();

  // header
  const { data: header, error: hErr } = await supabase
    .from("costing_headers")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (hErr) return NextResponse.json({ success: false, error: hErr.message }, { status: 500 });
  if (!header) return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });

  // lines (fk column differs by DB history - be defensive)
  let materials: any[] = [];
  let labors: any[] = [];
  try {
    const m = await selectByFirstWorkingFK(supabase, "costing_material_lines", id);
    materials = m.rows;
  } catch (e: any) {
    // allow header UI to load even if lines table differs
    materials = [];
  }
  try {
    const l = await selectByFirstWorkingFK(supabase, "costing_labor_lines", id);
    labors = l.rows;
  } catch (e: any) {
    labors = [];
  }

  return NextResponse.json({
    success: true,
    header,
    material_lines: materials,
    labor_lines: labors,
  });
}

export async function PUT(req: Request, ctx: { params: { id: string } }) {
  const id = ctx.params.id;
  const supabase = createSupabaseServerClient();

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });

  const headerPatch = body.header ?? {};
  const materialLines = Array.isArray(body.material_lines) ? body.material_lines : [];
  const laborLines = Array.isArray(body.labor_lines) ? body.labor_lines : [];

  // update header
  const { error: hErr } = await supabase.from("costing_headers").update(headerPatch).eq("id", id);
  if (hErr) return NextResponse.json({ success: false, error: hErr.message }, { status: 500 });

  // replace lines (best-effort)
  try {
    // delete by first working fk
    for (const fk of FK_CANDIDATES) {
      const { error } = await supabase.from("costing_material_lines").delete().eq(fk, id);
      if (!error) break;
      if (!isUndefinedColumnError(error)) break;
    }
    for (const fk of FK_CANDIDATES) {
      const { error } = await supabase.from("costing_labor_lines").delete().eq(fk, id);
      if (!error) break;
      if (!isUndefinedColumnError(error)) break;
    }

    if (materialLines.length) await insertByFirstWorkingFK(supabase, "costing_material_lines", id, materialLines);
    if (laborLines.length) await insertByFirstWorkingFK(supabase, "costing_labor_lines", id, laborLines);
  } catch (e: any) {
    // Do not fail whole save if line schema differs; return warning
    return NextResponse.json({
      success: true,
      warning: e?.message || "Lines save skipped",
    });
  }

  return NextResponse.json({ success: true });
}
