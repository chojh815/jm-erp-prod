import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/app/api/_supabase";
import { applyFxMarginToRows } from "@/lib/redMatrixCalc";

export const dynamic = "force-dynamic";

type Body = {
  fx_rate_cny_per_usd: number;
  margin_percent: number;
};

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createSupabaseServerClient();
    const quotationId = params.id;

    const body = (await req.json().catch(() => null)) as Body | null;
    const fx = Number(body?.fx_rate_cny_per_usd);
    const margin = Number(body?.margin_percent);

    if (!Number.isFinite(fx) || fx <= 0) {
      return NextResponse.json({ error: "Invalid fx_rate_cny_per_usd" }, { status: 400 });
    }
    if (!Number.isFinite(margin) || margin < 0) {
      return NextResponse.json({ error: "Invalid margin_percent" }, { status: 400 });
    }

    // 1) Upsert cost_inputs (FX/Margin)
    // - cost_inputs row가 없을 수도 있으니 upsert로 정리
    const { error: upErr } = await supabase
      .from("red_quotation_cost_inputs")
      .upsert(
        {
          quotation_id: quotationId,
          fx_rate_cny_per_usd: fx,
          margin_percent: margin,
          fx_margin_updated_at: new Date().toISOString(),
        },
        { onConflict: "quotation_id" }
      );

    if (upErr) throw upErr;

    // 2) Load matrix rows
    const { data: rows, error: mErr } = await supabase
      .from("red_quotation_price_matrix")
      .select("*")
      .eq("quotation_id", quotationId)
      .order("created_at", { ascending: true });

    if (mErr) throw mErr;

    const nextRows = applyFxMarginToRows(rows ?? [], fx, margin);

    // 3) Persist computed fields + snapshot
    // - id가 있는 row는 update
    // - (프로젝트에 따라 PK가 다를 수 있어 ADAPT 필요)
    //   기본은 id(uuid) PK 가 있다고 가정.
    const updates = (nextRows || [])
      .filter((r: any) => r?.id)
      .map((r: any) => ({
        id: r.id,
        quotation_id: quotationId,
        fob_cny: r.fob_cny,
        offer_usd: r.offer_usd,
        fx_rate_snapshot: r.fx_rate_snapshot,
        margin_snapshot: r.margin_snapshot,
        computed_at: r.computed_at,
      }));

    if (updates.length) {
      const { error: uErr } = await supabase
        .from("red_quotation_price_matrix")
        .upsert(updates, { onConflict: "id" });

      if (uErr) throw uErr;
    }

    // 4) Return
    return NextResponse.json({
      fx_rate_cny_per_usd: fx,
      margin_percent: margin,
      rows: nextRows,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "POST autofill failed" },
      { status: 500 }
    );
  }
}
