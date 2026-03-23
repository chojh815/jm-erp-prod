import type { SupabaseClient } from "@supabase/supabase-js";

function toNum(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
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
      const ratio =
        headerAppliedTotal > 0 ? toNum(line.applied_amount) / headerAppliedTotal : 0;

      applied += toNum(line.applied_amount);
      lineWriteoff += toNum(line.writeoff_amount);
      allocOurFee += ratio * toNum(header?.bank_fee_amount);
      allocBuyerWireWriteoff +=
        ratio * toNum(header?.buyer_wire_fee_writeoff_amount);
    }

    const total = toNum((inv as any).total_amount);
    const settled = round2(
      applied + lineWriteoff + allocOurFee + allocBuyerWireWriteoff
    );
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

export async function recalcInvoiceTotals(
  supabaseOrInvoiceIds: SupabaseClient | string[],
  maybeInvoiceIds?: string[]
): Promise<{ rows: any[] }> {
  if (Array.isArray(supabaseOrInvoiceIds)) {
    return {
      rows: supabaseOrInvoiceIds.map((id) => ({
        invoice_id: id,
      })),
    };
  }

  await recalcInvoicesFromReceipts(supabaseOrInvoiceIds, maybeInvoiceIds || []);

  return {
    rows: (maybeInvoiceIds || []).map((id) => ({
      invoice_id: id,
    })),
  };
}

export async function getReceiptSettlementByInvoice(
  headerOrInvoiceIds: any,
  maybeLines?: any[]
): Promise<any> {
  if (Array.isArray(headerOrInvoiceIds) && maybeLines === undefined) {
    const ids = headerOrInvoiceIds.map((x) => String(x));
    const map: Record<string, any> = {};
    for (const id of ids) {
      map[id] = {
        invoice_id: id,
        applied_amount: 0,
        writeoff_amount: 0,
        allocated_our_fee: 0,
        allocated_buyer_fee: 0,
        allocated_claim_deduction: 0,
        settled_amount: 0,
      };
    }
    return map;
  }

  const header = headerOrInvoiceIds;
  const src = Array.isArray(maybeLines) ? maybeLines : [];

  const totalApplied = round2(
    src.reduce((sum, line) => sum + toNum(line?.applied_amount), 0)
  );

  return src.map((line) => {
    const applied = toNum(line?.applied_amount);
    const writeoff = toNum(line?.writeoff_amount);
    const ratio = totalApplied > 0 ? applied / totalApplied : 0;

    const allocatedOurFee = round2(ratio * toNum(header?.bank_fee_amount));
    const allocatedBuyerFee = round2(
      ratio *
        (toNum(header?.buyer_bank_fee_amount) +
          toNum(header?.buyer_wire_fee_writeoff_amount))
    );
    const allocatedClaim = round2(
      ratio * toNum(header?.claim_deduction_amount)
    );

    return {
      invoice_id: String(line?.invoice_id || ""),
      applied_amount: applied,
      writeoff_amount: writeoff,
      allocated_our_fee: allocatedOurFee,
      allocated_buyer_fee: allocatedBuyerFee,
      allocated_claim_deduction: allocatedClaim,
      settled_amount: round2(
        applied +
          writeoff +
          allocatedOurFee +
          allocatedBuyerFee +
          allocatedClaim
      ),
    };
  });
}
