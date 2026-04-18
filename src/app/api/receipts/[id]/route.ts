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

async function recalcInvoicesWithSettlement(invoiceIds: string[]) {
  const ids = Array.from(new Set((invoiceIds || []).map((x) => safe(x)).filter(Boolean)));
  if (!ids.length) return;

  const { data: invoices, error: invErr } = await supabaseAdmin
    .from("invoice_headers")
    .select("id, total_amount, status")
    .in("id", ids)
    .eq("is_deleted", false);

  if (invErr) throw invErr;
  if (!invoices?.length) return;

  const { data: lines, error: lineErr } = await supabaseAdmin
    .from("receipt_lines")
    .select("id, receipt_header_id, invoice_id, applied_amount, writeoff_amount, is_deleted")
    .in("invoice_id", ids)
    .eq("is_deleted", false);

  if (lineErr) throw lineErr;

  const headerIds = Array.from(
    new Set((lines || []).map((x: any) => safe(x.receipt_header_id)).filter(Boolean))
  );

  const { data: headers, error: hdrErr } = headerIds.length
    ? await supabaseAdmin
        .from("receipt_headers")
        .select(
          "id, bank_fee_amount, buyer_bank_fee_amount, claim_deduction_amount, buyer_wire_fee_writeoff_amount, is_deleted"
        )
        .in("id", headerIds)
        .eq("is_deleted", false)
    : { data: [], error: null as any };

  if (hdrErr) throw hdrErr;

  const headerById = new Map<string, any>();
  for (const h of headers || []) headerById.set(String((h as any).id), h);

  const sumAppliedByHeader = new Map<string, number>();
  for (const l of lines || []) {
    const key = safe((l as any).receipt_header_id);
    sumAppliedByHeader.set(key, round2((sumAppliedByHeader.get(key) || 0) + toNum((l as any).applied_amount)));
  }

  const totalsByInvoice = new Map<
    string,
    { applied: number; writeoff: number; ourFee: number; buyerFee: number; claim: number }
  >();

  for (const l of lines || []) {
    const invoiceId = safe((l as any).invoice_id);
    if (!invoiceId) continue;

    const headerId = safe((l as any).receipt_header_id);
    const header = headerById.get(headerId);
    const totalAppliedForHeader = round2(sumAppliedByHeader.get(headerId) || 0);
    const applied = round2(toNum((l as any).applied_amount));
    const ratio = totalAppliedForHeader > 0 ? applied / totalAppliedForHeader : 0;

    const ourFee = round2(ratio * toNum(header?.bank_fee_amount));
    const buyerFee = round2(ratio * toNum(header?.buyer_bank_fee_amount));
    const claim = round2(ratio * toNum(header?.claim_deduction_amount));
    const writeoff = round2(toNum((l as any).writeoff_amount) + ratio * toNum(header?.buyer_wire_fee_writeoff_amount));

    const prev = totalsByInvoice.get(invoiceId) || {
      applied: 0,
      writeoff: 0,
      ourFee: 0,
      buyerFee: 0,
      claim: 0,
    };

    prev.applied = round2(prev.applied + applied);
    prev.writeoff = round2(prev.writeoff + writeoff);
    prev.ourFee = round2(prev.ourFee + ourFee);
    prev.buyerFee = round2(prev.buyerFee + buyerFee);
    prev.claim = round2(prev.claim + claim);

    totalsByInvoice.set(invoiceId, prev);
  }

  for (const inv of invoices || []) {
    const t = totalsByInvoice.get(String((inv as any).id)) || {
      applied: 0,
      writeoff: 0,
      ourFee: 0,
      buyerFee: 0,
      claim: 0,
    };

    const totalAmount = round2(toNum((inv as any).total_amount));
    const paidAmount = round2(t.applied);
    const effectivePaid = round2(t.applied + t.writeoff + t.ourFee + t.buyerFee + t.claim);
    const balanceAmount = round2(Math.max(0, totalAmount - effectivePaid));
    const tol = 0.01;

    const nextStatus =
      balanceAmount <= tol || (totalAmount > 0 && effectivePaid >= totalAmount - tol)
        ? "PAID"
        : effectivePaid > tol
        ? "PARTIALLY_PAID"
        : "UNPAID";

    const { error: updErr } = await supabaseAdmin
      .from("invoice_headers")
      .update({
        paid_amount: paidAmount,
        balance_amount: balanceAmount,
        status: nextStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", (inv as any).id);

    if (updErr) throw updErr;
  }
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

    const filteredAllocations = allocations
      .map((x: any) => ({
        invoice_id: safe(x?.invoice_id),
        applied_amount: round2(toNum(x?.apply_amount ?? x?.applied_amount)),
        writeoff_amount: round2(toNum(x?.writeoff_amount)),
      }))
      .filter(
        (x) => x.invoice_id && (Math.abs(x.applied_amount) > 0 || Math.abs(x.writeoff_amount) > 0)
      );

    if (filteredAllocations.length === 0) {
      return NextResponse.json({ success: false, error: "No non-zero allocations" }, { status: 400 });
    }

    const newInvoiceIds = filteredAllocations.map((x: any) => String(x.invoice_id || "")).filter(Boolean);

    const total_received = round2(toNum(body.total_received_amount ?? body.total_received));
    const bank_fee_amount = round2(toNum(body.bank_fee_amount));
    const buyer_bank_fee_amount = round2(toNum(body.buyer_bank_fee_amount));
    const buyer_wire_fee_writeoff_amount = round2(toNum(body.buyer_wire_fee_writeoff_amount));
    const claim_deduction_amount = round2(toNum(body.claim_deduction_amount));
    const net_received_amount = round2(
      total_received - bank_fee_amount - buyer_bank_fee_amount - claim_deduction_amount
    );

    const buyerId = String(body?.buyer_id || existing.buyer_id || "");
    const { data: buyer } = buyerId
      ? await supabaseAdmin.from("companies").select("id, company_name, code").eq("id", buyerId).maybeSingle()
      : { data: null as any };

    const representativeInvoiceId = newInvoiceIds[0] || existing.invoice_id;

    const { error: hErr } = await supabaseAdmin
      .from("receipt_headers")
      .update({
        invoice_id: representativeInvoiceId,
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
        bank_account_label: body.bank_account_label ?? existing.bank_account_label ?? null,
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

    const lineRows = filteredAllocations.map((x: any) => ({
      receipt_header_id: receiptId,
      invoice_id: String(x.invoice_id),
      applied_amount: round2(toNum(x.applied_amount)),
      writeoff_amount: round2(toNum(x.writeoff_amount)),
      is_deleted: false,
    }));
    const { error: iErr } = await supabaseAdmin.from("receipt_lines").insert(lineRows);
    if (iErr) throw iErr;

    const affectedInvoiceIds = Array.from(new Set([...oldInvoiceIds, ...newInvoiceIds]));
    await recalcInvoicesWithSettlement(affectedInvoiceIds);

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

    await recalcInvoicesWithSettlement(invoiceIds);

    return NextResponse.json({ success: true, id: receiptId });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || "Receipt delete failed" }, { status: 500 });
  }
}
