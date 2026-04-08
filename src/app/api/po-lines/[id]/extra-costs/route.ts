import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function toNum(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { data, error } = await supabaseAdmin
      .from("po_line_extra_costs")
      .select("*")
      .eq("po_line_id", params.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) throw error;

    return NextResponse.json({ success: true, rows: data ?? [] }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e?.message ?? "Failed to load extra costs" },
      { status: 500 }
    );
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json().catch(() => ({}));
    const rows = Array.isArray(body?.rows) ? body.rows : [];

    const cleaned = rows.map((r: any, idx: number) => ({
      id: r?.id || undefined,
      po_line_id: params.id,
      cost_name: String(r?.cost_name ?? "").trim() || `Cost ${idx + 1}`,
      unit_cost: toNum(r?.unit_cost, 0),
      enabled: Boolean(r?.enabled),
      sort_order: Number.isFinite(Number(r?.sort_order)) ? Number(r?.sort_order) : idx,
      remark: r?.remark ? String(r.remark) : null,
    }));

    const keepIds = cleaned.map((r: any) => r.id).filter(Boolean);

    const { error: delErr } = await supabaseAdmin
      .from("po_line_extra_costs")
      .delete()
      .eq("po_line_id", params.id)
      .not("id", "in", `(${keepIds.length ? keepIds.map((x: string) => `"${x}"`).join(",") : '"00000000-0000-0000-0000-000000000000"'})`);

    if (delErr && !String(delErr.message).includes("invalid input syntax")) throw delErr;

    if (cleaned.length > 0) {
      const { error: upsertErr } = await supabaseAdmin
        .from("po_line_extra_costs")
        .upsert(cleaned, { onConflict: "id" });
      if (upsertErr) throw upsertErr;
    }

    const { data, error } = await supabaseAdmin
      .from("po_line_extra_costs")
      .select("*")
      .eq("po_line_id", params.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) throw error;

    return NextResponse.json({ success: true, rows: data ?? [] });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e?.message ?? "Failed to save extra costs" },
      { status: 500 }
    );
  }
}
