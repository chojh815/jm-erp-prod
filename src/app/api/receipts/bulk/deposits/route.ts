import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const buyerId = (searchParams.get("buyer_id") || "").trim();
    const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit") || "30")));

    if (!buyerId) {
      return NextResponse.json({ success: false, error: "buyer_id is required" }, { status: 400 });
    }

    const res = await supabaseAdmin
      .from("receipt_deposits")
      .select("id, buyer_id, currency, deposit_date, payment_method, reference_no, total_amount, applied_amount, unapplied_amount, note, created_at, is_deleted")
      .eq("buyer_id", buyerId)
      .eq("is_deleted", false)
      .order("deposit_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limit);

    if (res.error) {
      return NextResponse.json({ success: false, error: res.error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, rows: res.data || [] });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ success: false, error: e?.message || "Unknown error" }, { status: 500 });
  }
}
