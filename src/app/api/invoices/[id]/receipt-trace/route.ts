import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toNum(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function safe(v: any): string {
  return (v ?? "").toString().trim();
}

async function loadInvoice(invoiceId: string) {
  const { data, error } = await supabaseAdmin
    .from("invoice_headers")
    .select("id, invoice_no, invoice_date, total_amount, balance_amount, paid_amount, currency")
    .eq("id", invoiceId)
    .eq("is_deleted", false)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function loadReceiptHeadersByIds(ids: string[]) {
  if (!ids.length) return [];
  const { data, error } = await supabaseAdmin
    .from("receipt_headers")
    .select("*")
    .in("id", ids)
    .eq("is_deleted", false)
    .order("deposit_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const invoiceId = safe(params.id);
    if (!invoiceId) {
      return NextResponse.json(
        { success: false, error: "invoice id required" },
        { status: 400 }
      );
    }

    const invoice = await loadInvoice(invoiceId);
    if (!invoice) {
      return NextResponse.json(
        { success: false, error: "Invoice not found" },
        { status: 404 }
      );
    }

    const { data: lines, error: lErr } = await supabaseAdmin
      .from("receipt_lines")
      .select("id, receipt_header_id, invoice_id, applied_amount, writeoff_amount, is_deleted")
      .eq("invoice_id", invoiceId)
      .eq("is_deleted", false);

    if (lErr) throw lErr;

    const receiptHeaderIds = Array.from(
      new Set((lines || []).map((x: any) => String(x.receipt_header_id || "")).filter(Boolean))
    );

    const headers = await loadReceiptHeadersByIds(receiptHeaderIds);
    const headerById = new Map<string, any>();
    for (const h of headers) {
      headerById.set(String((h as any).id), h);
    }

    const rows = (lines || [])
      .map((line: any) => {
        const header = headerById.get(String(line.receipt_header_id || ""));
        if (!header) return null;

        const gross = round2(toNum(header.received_amount ?? header.total_received));

        const totalAppliedForHeader = round2(
          (lines || [])
            .filter(
              (x: any) =>
                String(x.receipt_header_id || "") === String(line.receipt_header_id || "")
            )
            .reduce((s: number, x: any) => s + toNum(x.applied_amount), 0)
        );

        const ratio =
          totalAppliedForHeader > 0
            ? toNum(line.applied_amount) / totalAppliedForHeader
            : 0;

        const ourFee = round2(ratio * toNum(header.bank_fee_amount));
        const buyerFee = round2(ratio * toNum(header.buyer_bank_fee_amount));
        const claim = round2(ratio * toNum(header.claim_deduction_amount));
        const writeoff = round2(toNum(line.writeoff_amount));

        return {
          receipt_id: String(header.id),
          receipt_no: safe(header.reference_no) || String(header.id),
          receipt_date: header.deposit_date ?? header.receipt_date ?? null,
          gross_amount: gross,
          applied_amount: round2(toNum(line.applied_amount)),
          writeoff_amount: writeoff,
          our_fee_amount: ourFee,
          buyer_fee_amount: buyerFee,
          claim_amount: claim,
          method: header.method ?? header.payment_method ?? null,
          reference_no: header.reference_no ?? null,
          note: header.note ?? null,
          created_by_email: header.created_by_email ?? null,
          created_at: header.created_at ?? null,
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => {
        const da = String(a.receipt_date || "");
        const db = String(b.receipt_date || "");
        return db.localeCompare(da) || String(b.created_at || "").localeCompare(String(a.created_at || ""));
      });

    const invoiceTotal = round2(toNum(invoice.total_amount));
    const grossReceivedTotal = round2(
      rows.reduce((s: number, r: any) => s + toNum(r.gross_amount), 0)
    );
    const appliedTotal = round2(
      rows.reduce((s: number, r: any) => s + toNum(r.applied_amount), 0)
    );

    // Fees / claims / writeoffs are settlement items, not open A/R.
    const settlementAdjTotal = round2(
      rows.reduce(
        (s: number, r: any) =>
          s +
          toNum(r.our_fee_amount) +
          toNum(r.buyer_fee_amount) +
          toNum(r.claim_amount) +
          toNum(r.writeoff_amount),
        0
      )
    );

    const effectivePaidTotal = round2(appliedTotal + settlementAdjTotal);

    const explicitBalance = toNum(invoice.balance_amount);
    const fallbackBalance = round2(Math.max(0, invoiceTotal - effectivePaidTotal));

    const balance =
      explicitBalance > 0 && Math.abs(explicitBalance - fallbackBalance) < 0.01
        ? explicitBalance
        : fallbackBalance;

    const tol = 0.005;
    const paymentStatus =
      effectivePaidTotal <= tol
        ? "UNPAID"
        : effectivePaidTotal < invoiceTotal - tol
        ? "PARTIALLY_PAID"
        : Math.abs(effectivePaidTotal - invoiceTotal) <= tol
        ? "PAID"
        : "OVERPAID";

    return NextResponse.json({
      success: true,
      data: {
        invoice_id: invoice.id,
        invoice_no: invoice.invoice_no ?? null,
        currency: invoice.currency ?? "USD",
        invoice_total: invoiceTotal,
        gross_received_total: grossReceivedTotal,
        applied_total: appliedTotal,
        settlement_adjustment_total: settlementAdjTotal,
        effective_paid_total: effectivePaidTotal,
        balance: round2(balance),
        payment_status: paymentStatus,
        rows,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e?.message || "Failed to load receipt trace" },
      { status: 500 }
    );
  }
}
