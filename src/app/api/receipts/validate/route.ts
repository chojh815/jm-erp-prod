import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getReceiptSettlementByInvoice } from "@/lib/receipts/recalc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const buyer_id = body?.buyer_id;
    const lines = Array.isArray(body?.lines) ? body.lines : [];
    const total_received = round2(toNum(body?.total_received ?? body?.total_received_amount));
    const bank_fee_amount = round2(toNum(body?.bank_fee_amount));
    const buyer_bank_fee_amount = round2(toNum(body?.buyer_bank_fee_amount));
    const claim_deduction_amount = round2(toNum(body?.claim_deduction_amount));

    if (!buyer_id || !lines.length) {
      return NextResponse.json({ valid: false, error: "Invalid payload" }, { status: 400 });
    }

    const net = round2(total_received - bank_fee_amount - buyer_bank_fee_amount - claim_deduction_amount);
    const applyTotal = round2(lines.reduce((s: number, l: any) => s + toNum(l.applied_amount), 0));
    if (Math.abs(applyTotal - net) > 0.01) {
      return NextResponse.json({ valid: false, error: `Apply total (${applyTotal}) must equal net received (${net})` }, { status: 400 });
    }

    const invoiceIds = Array.from(new Set(lines.map((l: any) => l.invoice_id).filter(Boolean)));
    const { data: invoices, error: invErr } = await supabaseAdmin
      .from("invoice_headers")
      .select("id, buyer_id, invoice_no, total_amount, paid_amount, balance_amount, status")
      .in("id", invoiceIds)
      .eq("is_deleted", false);
    if (invErr) throw invErr;
    if (!invoices || invoices.length !== invoiceIds.length) {
      return NextResponse.json({ valid: false, error: "Invoice not found" }, { status: 400 });
    }

    const settlementMap = await getReceiptSettlementByInvoice(invoiceIds);
    for (const line of lines) {
      const inv = invoices.find((i: any) => i.id === line.invoice_id);
      if (!inv) {
        return NextResponse.json({ valid: false, error: "Invoice not found", invoice_id: line.invoice_id }, { status: 400 });
      }
      if (String(inv.buyer_id || "") !== String(buyer_id)) {
        return NextResponse.json({ valid: false, error: "Invoice buyer mismatch", invoice_id: inv.id }, { status: 400 });
      }
      const settlement = settlementMap.get(String(inv.id));
      const already = settlement ? settlement.settled_total : round2(toNum(inv.paid_amount));
      const remaining = round2(Math.max(0, toNum(inv.total_amount) - already));
      const apply = round2(toNum(line.applied_amount));
      if (apply <= 0) {
        return NextResponse.json({ valid: false, error: "Applied amount must be > 0", invoice_id: inv.id }, { status: 400 });
      }
      if (apply - remaining > 0.01) {
        return NextResponse.json({ valid: false, error: `Applied exceeds invoice balance (${remaining})`, invoice_id: inv.id }, { status: 400 });
      }
    }

    return NextResponse.json({ valid: true, summary: { invoice_count: lines.length, total_applied: applyTotal, net_received_amount: net } });
  } catch (e: any) {
    return NextResponse.json({ valid: false, error: e?.message || "Validation failed" }, { status: 500 });
  }
}
