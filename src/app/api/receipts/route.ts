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

function netOf(header: any) {
  return round2(
    toNum(header.total_received_amount ?? header.total_received)
      - toNum(header.bank_fee_amount)
      - toNum(header.buyer_bank_fee_amount)
      - toNum(header.claim_deduction_amount)
  );
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
  const invoiceIds = Array.from(new Set(activeLines.map((x: any) => String(x.invoice_id || "")).filter(Boolean)));

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

  return rows.map((row: any) => {
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
        settled_amount: round2(toNum(line.applied_amount) + writeoff + allocatedOurFee),
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
          (toNum(row.total_received) - toNum(row.bank_fee_amount) - toNum(row.buyer_bank_fee_amount) - toNum(row.claim_deduction_amount))
      ),
      applied_total: appliedTotal,
      line_writeoff_total: lineWriteoffTotal,
      settled_total: settledTotal,
      invoice_ids: details.map((d) => d.invoice_id).filter(Boolean),
      details,
    };
  });
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
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
    return NextResponse.json({ success: false, error: e?.message || "Failed to load receipts" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const buyer_id = String(body?.buyer_id || "");
    const allocations = Array.isArray(body?.allocations) ? body.allocations : [];

    if (!buyer_id) return NextResponse.json({ success: false, error: "buyer_id is required" }, { status: 400 });
    if (!body?.deposit_date) return NextResponse.json({ success: false, error: "deposit_date is required" }, { status: 400 });
    if (allocations.length === 0) return NextResponse.json({ success: false, error: "allocations are required" }, { status: 400 });

    const total_received = round2(toNum(body.total_received_amount ?? body.total_received));
    const bank_fee_amount = round2(toNum(body.bank_fee_amount));
    const buyer_bank_fee_amount = round2(toNum(body.buyer_bank_fee_amount));
    const claim_deduction_amount = round2(toNum(body.claim_deduction_amount));
    const buyer_wire_fee_writeoff_amount = round2(toNum(body.buyer_wire_fee_writeoff_amount));
    const net_received_amount = netOf({ total_received, bank_fee_amount, buyer_bank_fee_amount, claim_deduction_amount });

    const invoiceIds = allocations.map((x: any) => String(x.invoice_id || "")).filter(Boolean);
    if (invoiceIds.length === 0) return NextResponse.json({ success: false, error: "No invoice allocations" }, { status: 400 });

    const { data: buyer } = await supabaseAdmin
      .from("companies")
      .select("id, company_name, code")
      .eq("id", buyer_id)
      .maybeSingle();

    const { data: header, error: hErr } = await supabaseAdmin
      .from("receipt_headers")
      .insert({
        invoice_id: invoiceIds[0],
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
      })
      .select("id")
      .single();
    if (hErr) throw hErr;

    const lineRows = allocations.map((x: any) => ({
      receipt_header_id: header.id,
      invoice_id: String(x.invoice_id),
      applied_amount: round2(toNum(x.apply_amount ?? x.applied_amount)),
      writeoff_amount: round2(toNum(x.writeoff_amount)),
      is_deleted: false,
    }));

    const { error: lErr } = await supabaseAdmin.from("receipt_lines").insert(lineRows);
    if (lErr) throw lErr;

    await recalcInvoicesFromReceipts(supabaseAdmin as any, invoiceIds);
    return NextResponse.json({ success: true, receipt_id: header.id });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || "Receipt save failed" }, { status: 500 });
  }
}
