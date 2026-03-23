import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { recalcInvoicesFromReceipts } from "@/lib/receipts/recalc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toNum(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

async function fetchReceipt(receiptId: string) {
  const { data: header, error: hErr } = await supabaseAdmin
    .from("receipt_headers")
    .select("*")
    .eq("id", receiptId)
    .eq("is_deleted", false)
    .maybeSingle();
  if (hErr) throw hErr;
  if (!header) return null;

  const { data: lines, error: lErr } = await supabaseAdmin
    .from("receipt_lines")
    .select("id, receipt_header_id, invoice_id, applied_amount, writeoff_amount, is_deleted")
    .eq("receipt_header_id", receiptId)
    .eq("is_deleted", false);
  if (lErr) throw lErr;

  const invoiceIds = (lines || []).map((x: any) => String(x.invoice_id || "")).filter(Boolean);
  const { data: invoices } = invoiceIds.length
    ? await supabaseAdmin
        .from("invoice_headers")
        .select("id, invoice_no, invoice_date, total_amount, paid_amount, balance_amount")
        .in("id", invoiceIds)
    : { data: [] as any[] };

  const invoiceById = new Map<string, any>();
  for (const inv of invoices || []) invoiceById.set(String((inv as any).id), inv);

  const lineTotal = round2((lines || []).reduce((s: number, x: any) => s + toNum(x.applied_amount), 0));
  const details = (lines || []).map((line: any) => {
    const inv = invoiceById.get(String(line.invoice_id || ""));
    const ratio = lineTotal > 0 ? toNum(line.applied_amount) / lineTotal : 0;
    return {
      invoice_id: line.invoice_id,
      invoice_no: inv?.invoice_no ?? null,
      invoice_date: inv?.invoice_date ?? null,
      invoice_total: toNum(inv?.total_amount),
      invoice_paid: toNum(inv?.paid_amount),
      invoice_balance: toNum(inv?.balance_amount),
      applied_amount: round2(toNum(line.applied_amount)),
      writeoff_amount: round2(toNum(line.writeoff_amount)),
      allocated_our_fee: round2(ratio * toNum(header.bank_fee_amount)),
      allocated_buyer_fee: round2(ratio * toNum(header.buyer_bank_fee_amount)),
      allocated_claim_deduction: round2(ratio * toNum(header.claim_deduction_amount)),
    };
  });

  return {
    ...header,
    details,
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const row = await fetchReceipt(params.id);
    if (!row) return NextResponse.json({ success: false, error: "Receipt not found" }, { status: 404 });
    return NextResponse.json({ success: true, row });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || "Failed to load receipt" }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const receiptId = params.id;
    const body = await req.json().catch(() => ({}));
    const allocations = Array.isArray(body?.allocations) ? body.allocations : [];
    if (allocations.length === 0) {
      return NextResponse.json({ success: false, error: "allocations are required" }, { status: 400 });
    }

    const existing = await fetchReceipt(receiptId);
    if (!existing) return NextResponse.json({ success: false, error: "Receipt not found" }, { status: 404 });

    const oldInvoiceIds = (existing.details || []).map((x: any) => String(x.invoice_id || "")).filter(Boolean);
    const newInvoiceIds = allocations.map((x: any) => String(x.invoice_id || "")).filter(Boolean);

    const total_received = round2(toNum(body.total_received_amount ?? body.total_received));
    const bank_fee_amount = round2(toNum(body.bank_fee_amount));
    const buyer_bank_fee_amount = round2(toNum(body.buyer_bank_fee_amount));
    const buyer_wire_fee_writeoff_amount = round2(toNum(body.buyer_wire_fee_writeoff_amount));
    const claim_deduction_amount = round2(toNum(body.claim_deduction_amount));
    const net_received_amount = round2(total_received - bank_fee_amount - buyer_bank_fee_amount - claim_deduction_amount);

    const buyerId = String(body?.buyer_id || existing.buyer_id || "");
    const { data: buyer } = buyerId
      ? await supabaseAdmin.from("companies").select("id, company_name, code").eq("id", buyerId).maybeSingle()
      : { data: null as any };

    const { error: hErr } = await supabaseAdmin
      .from("receipt_headers")
      .update({
        invoice_id: newInvoiceIds[0] || existing.invoice_id,
        buyer_id: buyerId || existing.buyer_id,
        buyer_name: buyer?.company_name ?? existing.buyer_name ?? null,
        buyer_code: buyer?.code ?? existing.buyer_code ?? null,
        deposit_date: body.deposit_date ?? existing.deposit_date,
        total_received,
        bank_fee_amount,
        buyer_bank_fee_amount,
        buyer_wire_fee_writeoff_amount,
        claim_deduction_amount,
        net_received_amount,
        method: body.method ?? existing.method ?? null,
        reference_no: body.reference_no ?? null,
        note: body.note ?? null,
        bank_account_id: body.bank_account_id ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", receiptId);
    if (hErr) throw hErr;

    const { error: dErr } = await supabaseAdmin
      .from("receipt_lines")
      .update({ is_deleted: true })
      .eq("receipt_header_id", receiptId)
      .eq("is_deleted", false);
    if (dErr) throw dErr;

    const lineRows = allocations.map((x: any) => ({
      receipt_header_id: receiptId,
      invoice_id: String(x.invoice_id),
      applied_amount: round2(toNum(x.apply_amount ?? x.applied_amount)),
      writeoff_amount: round2(toNum(x.writeoff_amount)),
      is_deleted: false,
    }));
    const { error: iErr } = await supabaseAdmin.from("receipt_lines").insert(lineRows);
    if (iErr) throw iErr;

    await recalcInvoicesFromReceipts(supabaseAdmin as any, Array.from(new Set([...oldInvoiceIds, ...newInvoiceIds])));
    return NextResponse.json({ success: true, receipt_id: receiptId });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || "Receipt update failed" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const receiptId = params.id;
    const existing = await fetchReceipt(receiptId);
    if (!existing) return NextResponse.json({ success: false, error: "Receipt not found" }, { status: 404 });

    const invoiceIds = (existing.details || []).map((x: any) => String(x.invoice_id || "")).filter(Boolean);

    const { error: lErr } = await supabaseAdmin
      .from("receipt_lines")
      .update({ is_deleted: true })
      .eq("receipt_header_id", receiptId)
      .eq("is_deleted", false);
    if (lErr) throw lErr;

    const { error: hErr } = await supabaseAdmin
      .from("receipt_headers")
      .update({ is_deleted: true, updated_at: new Date().toISOString() })
      .eq("id", receiptId);
    if (hErr) throw hErr;

    await recalcInvoicesFromReceipts(supabaseAdmin as any, invoiceIds);
    return NextResponse.json({ success: true, id: receiptId });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || "Receipt delete failed" }, { status: 500 });
  }
}
