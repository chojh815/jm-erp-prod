import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

export async function GET(
  _req: NextRequest,
  ctx: { params: { id: string } }
) {
  try {
    const invoiceId = String(ctx.params.id || "").trim();
    if (!invoiceId) {
      return NextResponse.json(
        { success: false, error: "Invoice id is required" },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const { data: invoice, error: invErr } = await supabaseAdmin
      .from("invoice_headers")
      .select("id, invoice_no, invoice_date, total_amount, paid_amount, balance_amount, buyer_id, buyer_name, status, currency, created_at")
      .eq("id", invoiceId)
      .maybeSingle();
    if (invErr) throw invErr;
    if (!invoice) {
      return NextResponse.json(
        { success: false, error: "Invoice not found" },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }

    const { data: lines, error: lineErr } = await supabaseAdmin
      .from("receipt_lines")
      .select("id, receipt_header_id, invoice_id, applied_amount, writeoff_amount, created_at, is_deleted")
      .eq("invoice_id", invoiceId)
      .eq("is_deleted", false);
    if (lineErr) throw lineErr;

    const headerIds = Array.from(new Set((lines || []).map((x: any) => x.receipt_header_id).filter(Boolean)));
    let headers: any[] = [];
    if (headerIds.length) {
      const { data, error } = await supabaseAdmin
        .from("receipt_headers")
        .select("id, deposit_date, buyer_id, buyer_name, buyer_code, method, reference_no, total_received, bank_fee_amount, buyer_bank_fee_amount, buyer_wire_fee_writeoff_amount, claim_deduction_amount, note, created_at, is_deleted")
        .in("id", headerIds)
        .eq("is_deleted", false);
      if (error) throw error;
      headers = (data || []) as any[];
    }

    const linesByHeader = new Map<string, any[]>();
    for (const line of lines || []) {
      const key = String(line.receipt_header_id || "");
      const arr = linesByHeader.get(key) || [];
      arr.push(line);
      linesByHeader.set(key, arr);
    }

    const headerById = new Map<string, any>(headers.map((x) => [String(x.id), x]));

    const trace = (lines || [])
      .map((line: any) => {
        const header = headerById.get(String(line.receipt_header_id));
        const siblings = linesByHeader.get(String(line.receipt_header_id)) || [];
        const totalApplied = round2(siblings.reduce((s, x) => s + num(x.applied_amount), 0));
        const ratio = totalApplied > 0 ? num(line.applied_amount) / totalApplied : 0;
        const allocatedOurFee = round2(num(header?.bank_fee_amount) * ratio);
        const allocatedBuyerFee = round2(
          num(header?.buyer_bank_fee_amount) * ratio +
            num(header?.buyer_wire_fee_writeoff_amount) * ratio
        );
        const allocatedClaim = round2(num(header?.claim_deduction_amount) * ratio);

        return {
          receipt_id: line.receipt_header_id,
          receipt_line_id: line.id,
          deposit_date: header?.deposit_date || null,
          method: header?.method || null,
          reference_no: header?.reference_no || null,
          note: header?.note || null,
          total_received: round2(num(header?.total_received)),
          bank_fee_amount: round2(num(header?.bank_fee_amount)),
          buyer_bank_fee_amount: round2(num(header?.buyer_bank_fee_amount)),
          claim_deduction_amount: round2(num(header?.claim_deduction_amount)),
          applied_amount: round2(num(line.applied_amount)),
          writeoff_amount: round2(num(line.writeoff_amount)),
          allocated_our_fee: allocatedOurFee,
          allocated_buyer_fee: allocatedBuyerFee,
          allocated_claim: allocatedClaim,
          settled_amount: round2(
            num(line.applied_amount) +
              num(line.writeoff_amount) +
              allocatedOurFee +
              allocatedBuyerFee +
              allocatedClaim
          ),
          created_at: header?.created_at || line.created_at || null,
        };
      })
      .sort((a, b) => String(a.deposit_date || a.created_at).localeCompare(String(b.deposit_date || b.created_at)));

    let cumulative = 0;
    const partial_payment_history = trace.map((t, idx) => {
      cumulative = round2(cumulative + num(t.applied_amount) + num(t.writeoff_amount));
      return {
        seq: idx + 1,
        ...t,
        cumulative_paid: cumulative,
      };
    });

    const reconcile = {
      invoice_total: round2(num(invoice.total_amount)),
      paid_amount: round2(num(invoice.paid_amount)),
      balance_amount: round2(num(invoice.balance_amount)),
      traced_applied_amount: round2(trace.reduce((s, x) => s + num(x.applied_amount), 0)),
      traced_writeoff_amount: round2(trace.reduce((s, x) => s + num(x.writeoff_amount), 0)),
      traced_settled_amount: round2(trace.reduce((s, x) => s + num(x.settled_amount), 0)),
      delta_paid_vs_trace: round2(num(invoice.paid_amount) - trace.reduce((s, x) => s + num(x.applied_amount) + num(x.writeoff_amount), 0)),
    };

    return NextResponse.json(
      {
        success: true,
        invoice: {
          id: invoice.id,
          invoice_no: invoice.invoice_no,
          invoice_date: invoice.invoice_date || invoice.created_at || null,
          buyer_id: invoice.buyer_id,
          buyer_name: invoice.buyer_name || null,
          total_amount: round2(num(invoice.total_amount)),
          paid_amount: round2(num(invoice.paid_amount)),
          balance_amount: round2(num(invoice.balance_amount)),
          currency: invoice.currency || null,
          status: invoice.status || null,
        },
        reconcile,
        receipt_trace: trace,
        partial_payment_history,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (e: any) {
    console.error("[dashboards/receivables/invoice]", e);
    return NextResponse.json(
      { success: false, error: e?.message || "Failed to load invoice trace" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
