import type { SupabaseClient } from "@supabase/supabase-js";

function toNum(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export type ReceiptSettlementLine = {
  receipt_header_id?: string | null;
  invoice_id?: string | null;
  applied_amount?: number | null;
  writeoff_amount?: number | null;
};

export type ReceiptSettlementHeader = {
  id?: string | null;
  bank_fee_amount?: number | null;
  buyer_bank_fee_amount?: number | null;
  buyer_wire_fee_writeoff_amount?: number | null;
  claim_deduction_amount?: number | null;
};

export type ReceiptSettlementByInvoiceRow = {
  invoice_id: string;
  applied_amount: number;
  writeoff_amount: number;
  allocated_our_fee: number;
  allocated_buyer_fee: number;
  allocated_claim_deduction: number;
  settled_amount: number;
};

export function getReceiptSettlementByInvoice(
  header: ReceiptSettlementHeader | null | undefined,
  lines: ReceiptSettlementLine[] | null | undefined
): ReceiptSettlementByInvoiceRow[] {
  const src = Array.isArray(lines) ? lines : [];
  const activeLines = src.filter((x) => !!x && !!x.invoice_id);

  const totalApplied = round2(
    activeLines.reduce((sum, line) => sum + toNum(line.applied_amount), 0)
  );

  const grouped = new Map<string, ReceiptSettlementByInvoiceRow>();

  for (const line of activeLines) {
    const invoiceId = String(line.invoice_id || "");
    if (!invoiceId) continue;

    const prev =
      grouped.get(invoiceId) ||
      {
        invoice_id: invoiceId,
        applied_amount: 0,
        writeoff_amount: 0,
        allocated_our_fee: 0,
        allocated_buyer_fee: 0,
        allocated_claim_deduction: 0,
        settled_amount: 0,
      };

    const ratio = totalApplied > 0 ? toNum(line.applied_amount) / totalApplied : 0;

    prev.applied_amount = round2(prev.applied_amount + toNum(line.applied_amount));
    prev.writeoff_amount = round2(prev.writeoff_amount + toNum(line.writeoff_amount));
    prev.allocated_our_fee = round2(
      prev.allocated_our_fee + ratio * toNum(header?.bank_fee_amount)
    );
    prev.allocated_buyer_fee = round2(
      prev.allocated_buyer_fee +
        ratio *
          (toNum(header?.buyer_bank_fee_amount) +
            toNum(header?.buyer_wire_fee_writeoff_amount))
    );
    prev.allocated_claim_deduction = round2(
      prev.allocated_claim_deduction + ratio * toNum(header?.claim_deduction_amount)
    );

    grouped.set(invoiceId, prev);
  }

  const rows = Array.from(grouped.values());
  for (const row of rows) {
    row.settled_amount = round2(
      row.applied_amount +
        row.writeoff_amount +
        row.allocated_our_fee +
        row.allocated_buyer_fee +
        row.allocated_claim_deduction
    );
  }
  return rows;
}

export async function recalcInvoicesFromReceipts(
  supabase: SupabaseClient,
  invoiceIds: string[]
) {
  const ids = Array.from(new Set((invoiceIds || []).filter(Boolean)));
  if (ids.length === 0) return;

  const { data: invoices, error: invErr } = await supabase
    .from("invoice_headers")
    .select("id, total_amount, status")
    .in("id", ids);
  if (invErr) throw invErr;

  const { data: allLines, error: lineErr } = await supabase
    .from("receipt_lines")
    .select("id, receipt_header_id, invoice_id, applied_amount, writeoff_amount, is_deleted")
    .in("invoice_id", ids);
  if (lineErr) throw lineErr;

  const activeLines = (allLines || []).filter((x: any) => !x.is_deleted);
  const headerIds = Array.from(
    new Set(activeLines.map((x: any) => String(x.receipt_header_id || "")).filter(Boolean))
  );

  let headers: any[] = [];
  if (headerIds.length > 0) {
    const { data, error } = await supabase
      .from("receipt_headers")
      .select(
        "id, bank_fee_amount, buyer_bank_fee_amount, buyer_wire_fee_writeoff_amount, claim_deduction_amount, is_deleted"
      )
      .in("id", headerIds);
    if (error) throw error;
    headers = (data || []).filter((x: any) => !x.is_deleted);
  }

  const headerById = new Map<string, any>();
  for (const h of headers) headerById.set(String(h.id), h);

  const linesByHeader = new Map<string, any[]>();
  for (const line of activeLines) {
    const hid = String(line.receipt_header_id || "");
    if (!headerById.has(hid)) continue;
    const arr = linesByHeader.get(hid) || [];
    arr.push(line);
    linesByHeader.set(hid, arr);
  }

  for (const inv of invoices || []) {
    const invId = String(inv.id);
    const lines = activeLines.filter(
      (x: any) =>
        String(x.invoice_id) === invId && headerById.has(String(x.receipt_header_id))
    );

    let applied = 0;
    let lineWriteoff = 0;
    let allocOurFee = 0;
    let allocBuyerWireWriteoff = 0;

    for (const line of lines) {
      const hid = String(line.receipt_header_id);
      const header = headerById.get(hid);
      const siblings = linesByHeader.get(hid) || [];
      const headerAppliedTotal = round2(
        siblings.reduce((s, r) => s + toNum(r.applied_amount), 0)
      );
      const ratio = headerAppliedTotal > 0 ? toNum(line.applied_amount) / headerAppliedTotal : 0;

      applied += toNum(line.applied_amount);
      lineWriteoff += toNum(line.writeoff_amount);
      allocOurFee += ratio * toNum(header?.bank_fee_amount);
      allocBuyerWireWriteoff += ratio * toNum(header?.buyer_wire_fee_writeoff_amount);
    }

    const total = toNum((inv as any).total_amount);
    const settled = round2(applied + lineWriteoff + allocOurFee + allocBuyerWireWriteoff);
    const paid = round2(Math.min(total, Math.max(0, settled)));
    const balance = round2(Math.max(0, total - paid));

    let status = (inv as any).status || "OPEN";
    const currentUpper = String(status || "").toUpperCase();
    if (!["DELETED", "CANCELLED"].includes(currentUpper)) {
      status = balance <= 0.009 ? "PAID" : paid > 0 ? "PARTIAL" : "OPEN";
    }

    const { error: upErr } = await supabase
      .from("invoice_headers")
      .update({
        paid_amount: paid,
        balance_amount: balance,
        status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", invId);

    if (upErr) throw upErr;
  }
}
