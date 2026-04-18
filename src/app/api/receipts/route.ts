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

function netOf(header: any) {
  return round2(
    toNum(header.total_received_amount ?? header.total_received) -
      toNum(header.bank_fee_amount) -
      toNum(header.buyer_bank_fee_amount) -
      toNum(header.claim_deduction_amount)
  );
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
    const writeoff = round2(
      toNum((l as any).writeoff_amount) + ratio * toNum(header?.buyer_wire_fee_writeoff_amount)
    );

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

function receiptHistorySignature(row: any) {
  const details = Array.isArray(row.details) ? row.details : [];
  return JSON.stringify({
    buyer_id: safe(row.buyer_id),
    deposit_date: safe(row.deposit_date || row.receipt_date),
    method: safe(row.method),
    gross: round2(toNum(row.total_received ?? row.received_amount)),
    our_fee: round2(toNum(row.bank_fee_amount)),
    buyer_fee: round2(toNum(row.buyer_bank_fee_amount)),
    claim: round2(toNum(row.claim_deduction_amount)),
    net: round2(toNum(row.net_received_amount)),
    applied: round2(toNum(row.applied_total)),
    settled: round2(toNum(row.settled_total)),
    details: details
      .map((d: any) => ({
        invoice_id: safe(d.invoice_id),
        invoice_no: safe(d.invoice_no),
        applied_amount: round2(toNum(d.applied_amount)),
        writeoff_amount: round2(toNum(d.writeoff_amount)),
        settled_amount: round2(toNum(d.settled_amount)),
      }))
      .sort((a: any, b: any) => `${a.invoice_id}|${a.invoice_no}`.localeCompare(`${b.invoice_id}|${b.invoice_no}`)),
  });
}

async function buildReceiptRows(baseRows: any[]) {
  const rows = baseRows || [];
  const receiptIds = rows.map((r) => String(r.id)).filter(Boolean);
  const buyerIds = rows.map((r) => String(r.buyer_id || "")).filter(Boolean);

  const [{ data: buyers }, { data: lines }] = await Promise.all([
    buyerIds.length
      ? supabaseAdmin.from("companies").select("id, company_name, code").in("id", buyerIds)
      : Promise.resolve({ data: [] as any[] }),
    receiptIds.length
      ? supabaseAdmin
          .from("receipt_lines")
          .select("id, receipt_header_id, invoice_id, applied_amount, writeoff_amount, is_deleted")
          .in("receipt_header_id", receiptIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const activeLines = (lines || []).filter((x: any) => !x.is_deleted);
  const invoiceIds = Array.from(
    new Set(activeLines.map((x: any) => String(x.invoice_id || "")).filter(Boolean))
  );

  const { data: invoices } = invoiceIds.length
    ? await supabaseAdmin
        .from("invoice_headers")
        .select("id, invoice_no, invoice_date, total_amount")
        .in("id", invoiceIds)
    : { data: [] as any[] };

  const buyerById = new Map<string, any>();
  for (const b of buyers || []) buyerById.set(String((b as any).id), b);

  const invoiceById = new Map<string, any>();
  for (const i of invoices || []) invoiceById.set(String((i as any).id), i);

  const linesByReceipt = new Map<string, any[]>();
  for (const line of activeLines) {
    const key = String(line.receipt_header_id || "");
    const arr = linesByReceipt.get(key) || [];
    arr.push(line);
    linesByReceipt.set(key, arr);
  }

  const materialized = rows.map((row: any) => {
    const buyer = buyerById.get(String(row.buyer_id || ""));
    const receiptLines = linesByReceipt.get(String(row.id)) || [];
    const totalAppliedThisReceipt = round2(
      receiptLines.reduce((s, r) => s + toNum(r.applied_amount), 0)
    );

    const details = receiptLines.map((line: any) => {
      const inv = invoiceById.get(String(line.invoice_id || ""));
      const ratio = totalAppliedThisReceipt > 0 ? toNum(line.applied_amount) / totalAppliedThisReceipt : 0;
      const allocatedOurFee = round2(ratio * toNum(row.bank_fee_amount));
      const allocatedBuyerFee = round2(ratio * toNum(row.buyer_bank_fee_amount));
      const allocatedClaim = round2(ratio * toNum(row.claim_deduction_amount));
      const allocatedWireWriteoff = round2(ratio * toNum(row.buyer_wire_fee_writeoff_amount));
      const writeoff = toNum(line.writeoff_amount) + allocatedWireWriteoff;

      return {
        invoice_id: line.invoice_id,
        invoice_no: inv?.invoice_no ?? null,
        invoice_date: inv?.invoice_date ?? null,
        invoice_total: toNum(inv?.total_amount),
        applied_amount: round2(toNum(line.applied_amount)),
        writeoff_amount: round2(writeoff),
        allocated_our_fee: allocatedOurFee,
        allocated_buyer_fee: allocatedBuyerFee,
        allocated_claim_deduction: allocatedClaim,
        settled_amount: round2(
          toNum(line.applied_amount) + writeoff + allocatedOurFee + allocatedBuyerFee + allocatedClaim
        ),
      };
    });

    const appliedTotal = round2(details.reduce((s, d) => s + toNum(d.applied_amount), 0));
    const lineWriteoffTotal = round2(details.reduce((s, d) => s + toNum(d.writeoff_amount), 0));
    const settledTotal = round2(details.reduce((s, d) => s + toNum(d.settled_amount), 0));

    return {
      ...row,
      buyer_name: row.buyer_name ?? buyer?.company_name ?? null,
      buyer_code: row.buyer_code ?? buyer?.code ?? null,
      total_received: toNum(row.total_received),
      net_received_amount: round2(
        toNum(row.net_received_amount) ||
          (toNum(row.total_received) -
            toNum(row.bank_fee_amount) -
            toNum(row.buyer_bank_fee_amount) -
            toNum(row.claim_deduction_amount))
      ),
      applied_total: appliedTotal,
      line_writeoff_total: lineWriteoffTotal,
      settled_total: settledTotal,
      invoice_ids: details.map((d) => d.invoice_id).filter(Boolean),
      details,
    };
  });

  // 1) orphan receipt header 숨김
  const withDetails = materialized.filter((r: any) => (r.details?.length || 0) > 0);

  // 2) 논리적으로 같은 receipt는 최신 1건만 유지
  const deduped = new Map<string, any>();
  for (const row of withDetails) {
    const signature = receiptHistorySignature(row);
    const prev = deduped.get(signature);

    if (!prev) {
      deduped.set(signature, row);
      continue;
    }

    const prevTs = String(prev.updated_at || prev.created_at || "");
    const nextTs = String(row.updated_at || row.created_at || "");
    if (nextTs > prevTs) deduped.set(signature, row);
  }

  return Array.from(deduped.values()).sort((a: any, b: any) => {
    const da = String(a.deposit_date || "");
    const db = String(b.deposit_date || "");
    return db.localeCompare(da) || String(b.created_at || "").localeCompare(String(a.created_at || ""));
  });
}

async function loadBuyerRows() {
  let data: any[] | null = null;

  const r = await supabaseAdmin
    .from("companies")
    .select("id, company_name, code, company_type, is_deleted")
    .eq("is_deleted", false)
    .order("company_name", { ascending: true });

  if (!r.error) {
    data = (r.data || []) as any[];
  } else {
    const msg = String((r.error as any)?.message || "").toLowerCase();
    if (msg.includes("companies.is_deleted") && msg.includes("does not exist")) {
      const r2 = await supabaseAdmin
        .from("companies")
        .select("id, company_name, code, company_type")
        .order("company_name", { ascending: true });

      if (r2.error) throw r2.error;
      data = (r2.data || []) as any[];
    } else {
      throw r.error;
    }
  }

  return (data || [])
    .filter((x: any) => /buyer/i.test(String(x?.company_type || "")))
    .map((r: any) => ({
      id: String(r.id),
      company_name: r.company_name ?? null,
      code: r.code ?? null,
      company_type: r.company_type ?? null,
    }));
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const mode = safe(sp.get("mode"));

    if (mode === "buyers") {
      const rows = await loadBuyerRows();
      return NextResponse.json({ success: true, rows });
    }

    const buyerId = sp.get("buyer_id") || "";
    const limit = Math.max(1, Math.min(500, Number(sp.get("limit") || 100)));

    let q = supabaseAdmin
      .from("receipt_headers")
      .select(
        "id, invoice_id, buyer_id, buyer_name, buyer_code, deposit_date, method, reference_no, note, total_received, bank_fee_amount, buyer_bank_fee_amount, buyer_wire_fee_writeoff_amount, claim_deduction_amount, net_received_amount, bank_account_id, bank_account_label, created_at, updated_at, is_deleted"
      )
      .eq("is_deleted", false)
      .order("deposit_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limit);

    if (buyerId) q = q.eq("buyer_id", buyerId);

    const { data, error } = await q;
    if (error) throw error;

    const rows = await buildReceiptRows(data || []);
    return NextResponse.json({ success: true, rows });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e?.message || "Failed to load receipts" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const buyer_id = String(body?.buyer_id || "");

    if (!buyer_id) {
      return NextResponse.json(
        { success: false, error: "buyer_id is required" },
        { status: 400 }
      );
    }
    if (!body?.deposit_date) {
      return NextResponse.json(
        { success: false, error: "deposit_date is required" },
        { status: 400 }
      );
    }

    const rawAllocations = Array.isArray(body?.allocations) ? body.allocations : [];
    const allocations = rawAllocations
      .map((x: any) => ({
        invoice_id: safe(x?.invoice_id),
        applied_amount: round2(toNum(x?.apply_amount ?? x?.applied_amount)),
        writeoff_amount: round2(toNum(x?.writeoff_amount)),
      }))
      .filter(
        (x) => x.invoice_id && (Math.abs(x.applied_amount) > 0 || Math.abs(x.writeoff_amount) > 0)
      );

    if (allocations.length === 0) {
      return NextResponse.json(
        { success: false, error: "No non-zero invoice allocations" },
        { status: 400 }
      );
    }

    const total_received = round2(toNum(body.total_received_amount ?? body.total_received));
    const bank_fee_amount = round2(toNum(body.bank_fee_amount));
    const buyer_bank_fee_amount = round2(toNum(body.buyer_bank_fee_amount));
    const claim_deduction_amount = round2(toNum(body.claim_deduction_amount));
    const buyer_wire_fee_writeoff_amount = round2(toNum(body.buyer_wire_fee_writeoff_amount));
    const net_received_amount = netOf({
      total_received,
      bank_fee_amount,
      buyer_bank_fee_amount,
      claim_deduction_amount,
    });

    const invoiceIds = allocations.map((x) => x.invoice_id);

    const { data: buyer } = await supabaseAdmin
      .from("companies")
      .select("id, company_name, code")
      .eq("id", buyer_id)
      .maybeSingle();

    const representativeInvoiceId = allocations[0].invoice_id;

    const { data: header, error: hErr } = await supabaseAdmin
      .from("receipt_headers")
      .insert({
        invoice_id: representativeInvoiceId,
        buyer_id,
        buyer_name: buyer?.company_name ?? null,
        buyer_code: buyer?.code ?? null,
        deposit_date: body.deposit_date,
        total_received,
        bank_fee_amount,
        buyer_bank_fee_amount,
        buyer_wire_fee_writeoff_amount,
        claim_deduction_amount,
        net_received_amount,
        method: body.method ?? null,
        reference_no: body.reference_no ?? null,
        note: body.note ?? null,
        bank_account_id: body.bank_account_id ?? null,
        bank_account_label: body.bank_account_label ?? null,
      })
      .select("id")
      .single();

    if (hErr) throw hErr;

    const lineRows = allocations.map((x) => ({
      receipt_header_id: header.id,
      invoice_id: x.invoice_id,
      applied_amount: x.applied_amount,
      writeoff_amount: x.writeoff_amount,
      is_deleted: false,
    }));

    const { error: lErr } = await supabaseAdmin.from("receipt_lines").insert(lineRows);
    if (lErr) throw lErr;

    await recalcInvoicesWithSettlement(invoiceIds);

    return NextResponse.json({
      success: true,
      receipt_id: header.id,
      representative_invoice_id: representativeInvoiceId,
      allocation_count: allocations.length,
    });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e?.message || "Receipt save failed" },
      { status: 500 }
    );
  }
}
