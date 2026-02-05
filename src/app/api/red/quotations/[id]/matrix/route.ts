import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/app/api/_supabase";

export const dynamic = "force-dynamic";

// A안 표준: FX/Margin 키 통일 + 기존 키 호환 유지
export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createSupabaseServerClient();
    const quotationId = params.id;

    // 1) cost inputs (fx/margin)
    const { data: ci, error: ciErr } = await supabase
      .from("red_quotation_cost_inputs")
      .select("quotation_id, fx_rate_cny_per_usd, margin_percent, fx_margin_updated_at")
      .eq("quotation_id", quotationId)
      .maybeSingle();

    if (ciErr) throw ciErr;

    // 2) matrix rows (v1 legacy)
    const { data: rows, error: mErr } = await supabase
      .from("red_quotation_price_matrix")
      .select("*")
      .eq("quotation_id", quotationId)
      .order("created_at", { ascending: true });

    if (mErr) throw mErr;

    return NextResponse.json({
      // A안 표준 키
      fx_cny_per_usd: ci?.fx_rate_cny_per_usd ?? null,
      margin_pct: ci?.margin_percent ?? null,

      // legacy 호환
      fx_rate_cny_per_usd: ci?.fx_rate_cny_per_usd ?? null,
      margin_percent: ci?.margin_percent ?? null,

      rows: rows ?? [],
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "GET matrix failed" },
      { status: 500 }
    );
  }
}
