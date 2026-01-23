import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { buyer_id, deposit_date, reference_no, note, lines } = body ?? {};
    if (!buyer_id) return NextResponse.json({ error: "buyer_id required" }, { status: 400 });
    if (!deposit_date) return NextResponse.json({ error: "date required (YYYY-MM-DD)" }, { status: 400 });
    if (!Array.isArray(lines) || lines.length === 0) return NextResponse.json({ error: "lines required" }, { status: 400 });

    // CREDIT NOTE: no cash movement, bank_account_id nullable
    const prepared = lines.map((l: any) => ({
      invoice_id: l.invoice_id,
      applied_amount: -Math.abs(toNum(l.amount)),
      note: l.note ?? null,
    })).filter((l: any) => l.invoice_id && l.applied_amount !== 0);

    if (prepared.length === 0) return NextResponse.json({ error: "No valid lines" }, { status: 400 });

    const total = prepared.reduce((s: number, l: any) => s + toNum(l.applied_amount), 0); // negative
    if (total >= 0) return NextResponse.json({ error: "Credit total must be negative" }, { status: 400 });

    const { data: header, error: hErr } = await supabaseAdmin
      .from("receipt_headers")
      .insert({
        buyer_id,
        bank_account_id: null,
        deposit_date,
        total_received: Number(total.toFixed(2)),
        method: "CREDIT_NOTE",
        reference_no: reference_no ?? null,
        note: note ?? null,
        receipt_type: "CREDIT",
      })
      .select()
      .single();

    if (hErr) throw hErr;

    const toInsert = prepared.map((l: any) => ({ ...l, receipt_header_id: header.id }));
    const { error: lErr } = await supabaseAdmin.from("receipt_lines").insert(toInsert);
    if (lErr) throw lErr;

    return NextResponse.json({ success: true, receipt_id: header.id });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e.message || "Credit save failed" }, { status: 500 });
  }
}
