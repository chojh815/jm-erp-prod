import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../_supabase";

/**
 * PUT /api/quotations/[id]/tiers
 * Body: { updates: Array<{ tier_id: string, unit_price: number }> }
 *
 * ✅ IMPORTANT:
 * - quotation_item_tiers has only unit_price (no unit_price_usd in your DB).
 * - So we update ONLY unit_price.
 */

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const body = await req.json().catch(() => ({}));
  const updates = Array.isArray(body?.updates) ? body.updates : [];

  if (!updates.length) {
    return NextResponse.json({ success: false, error: "updates is required" }, { status: 400 });
  }

  const payload = updates
    .map((u: any) => ({ id: u?.tier_id, unit_price: Number(u?.unit_price) }))
    .filter((x: any) => x.id && Number.isFinite(x.unit_price));

  if (!payload.length) {
    return NextResponse.json({ success: false, error: "No valid updates" }, { status: 400 });
  }

  for (const p of payload) {
    const { error } = await supabase
      .from("quotation_item_tiers")
      .update({ unit_price: p.unit_price })
      .eq("id", p.id);

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}
