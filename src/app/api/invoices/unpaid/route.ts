import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const buyer_id = searchParams.get("buyer_id");
    if (!buyer_id) return NextResponse.json({ success: false, error: "buyer_id required" }, { status: 400 });

    const { data: invoices, error: invErr } = await supabaseAdmin
      .from("invoice_headers")
      .select("id, invoice_no, buyer_id, currency, total_amount, status, created_at, etd, eta, is_deleted")
      .eq("buyer_id", buyer_id)
      .eq("is_deleted", false)
      .order("created_at", { ascending: false });

    if (invErr) throw invErr;

    const ids = (invoices || []).map((x) => x.id);
    if (ids.length === 0) return NextResponse.json({ success: true, rows: [] });

    const { data: lines, error: lErr } = await supabaseAdmin
      .from("receipt_lines")
      .select("invoice_id, applied_amount")
      .in("invoice_id", ids);

    if (lErr) throw lErr;

    const applied = new Map<string, number>();
    for (const l of lines || []) {
      applied.set(l.invoice_id, (applied.get(l.invoice_id) || 0) + toNum(l.applied_amount));
    }

    const rows = (invoices || []).map((inv: any) => {
      const a = applied.get(inv.id) || 0;
      const bal = toNum(inv.total_amount) - a;
      return {
        id: inv.id,
        invoice_no: inv.invoice_no,
        currency: inv.currency,
        total_amount: toNum(inv.total_amount),
        applied_amount: Number(a.toFixed(2)),
        balance: Number(bal.toFixed(2)),
        status: inv.status,
        created_at: inv.created_at,
      };
    }).filter((r: any) => r.balance > 0.00001);

    return NextResponse.json({ success: true, rows });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ success: false, error: e.message || "Failed" }, { status: 500 });
  }
}
