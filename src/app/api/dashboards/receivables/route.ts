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

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function monthKey(v?: string | null): string {
  if (!v) return "";
  return String(v).slice(0, 7);
}

function daysDiff(a: string, b: string): number {
  const aa = new Date(`${a}T00:00:00Z`).getTime();
  const bb = new Date(`${b}T00:00:00Z`).getTime();
  return Math.floor((aa - bb) / 86400000);
}

function calcNetReceived(row: any): number {
  return round2(
    Math.max(
      0,
      num(row?.total_received) -
        num(row?.bank_fee_amount) -
        num(row?.buyer_bank_fee_amount) -
        num(row?.claim_deduction_amount)
    )
  );
}

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const buyerId = searchParams.get("buyer_id") || "";

    const now = new Date();
    const defaultEnd = ymd(now);
    const defaultStartDate = new Date(now);
    defaultStartDate.setMonth(defaultStartDate.getMonth() - 11);
    defaultStartDate.setDate(1);
    const defaultStart = ymd(defaultStartDate);

    const start = searchParams.get("start") || defaultStart;
    const end = searchParams.get("end") || defaultEnd;

    const headerSelect = [
      "id",
      "buyer_id",
      "buyer_name",
      "buyer_code",
      "deposit_date",
      "method",
      "reference_no",
      "note",
      "created_at",
      "total_received",
      "bank_fee_amount",
      "buyer_bank_fee_amount",
      "buyer_wire_fee_writeoff_amount",
      "claim_deduction_amount",
      "net_received_amount",
      "is_deleted",
    ].join(",");

    let headerQ = supabaseAdmin
      .from("receipt_headers")
      .select(headerSelect)
      .eq("is_deleted", false)
      .gte("deposit_date", start)
      .lte("deposit_date", end)
      .order("deposit_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (buyerId) headerQ = headerQ.eq("buyer_id", buyerId);

    const { data: receiptHeaders, error: headerErr } = await headerQ;
    if (headerErr) throw headerErr;

    const headers = ((receiptHeaders || []) as any[]).map((h) => ({
      ...h,
      total_received: round2(num(h.total_received)),
      bank_fee_amount: round2(num(h.bank_fee_amount)),
      buyer_bank_fee_amount: round2(num(h.buyer_bank_fee_amount)),
      buyer_wire_fee_writeoff_amount: round2(num(h.buyer_wire_fee_writeoff_amount)),
      claim_deduction_amount: round2(num(h.claim_deduction_amount)),
      net_received_amount: calcNetReceived(h),
    }));

    const receiptIds = headers.map((x) => x.id).filter(Boolean);

    let lines: any[] = [];
    if (receiptIds.length) {
      const { data, error } = await supabaseAdmin
        .from("receipt_lines")
        .select("receipt_header_id, invoice_id, applied_amount, writeoff_amount, is_deleted")
        .in("receipt_header_id", receiptIds)
        .eq("is_deleted", false);
      if (error) throw error;
      lines = (data || []) as any[];
    }

    const invoiceIdsFromReceipts = Array.from(new Set(lines.map((x) => x.invoice_id).filter(Boolean)));
    let receiptInvoiceRows: any[] = [];
    if (invoiceIdsFromReceipts.length) {
      const { data, error } = await supabaseAdmin
        .from("invoice_headers")
        .select("id, invoice_no, invoice_date, total_amount, buyer_id, currency, created_at")
        .in("id", invoiceIdsFromReceipts);
      if (error) throw error;
      receiptInvoiceRows = (data || []) as any[];
    }
    const receiptInvoiceById = new Map<string, any>(receiptInvoiceRows.map((x) => [String(x.id), x]));

    const detailRows: any[] = [];
    const linesByHeader = new Map<string, any[]>();
    for (const line of lines) {
      const key = String(line.receipt_header_id || "");
      const arr = linesByHeader.get(key) || [];
      arr.push(line);
      linesByHeader.set(key, arr);
    }

    for (const h of headers) {
      const hLines = linesByHeader.get(String(h.id)) || [];
      const totalApplied = round2(hLines.reduce((s, x) => s + num(x.applied_amount), 0));
      const feeTotalBase = totalApplied || 1;
      for (const line of hLines) {
        const inv = receiptInvoiceById.get(String(line.invoice_id));
        const ratio = totalApplied > 0 ? num(line.applied_amount) / feeTotalBase : 0;
        const allocatedOurFee = round2(num(h.bank_fee_amount) * ratio);
        const allocatedBuyerFee = round2(
          num(h.buyer_bank_fee_amount) * ratio + num(h.buyer_wire_fee_writeoff_amount) * ratio
        );
        const allocatedClaim = round2(num(h.claim_deduction_amount) * ratio);
        detailRows.push({
          receipt_id: h.id,
          deposit_date: h.deposit_date,
          buyer_id: h.buyer_id,
          buyer_name: h.buyer_name,
          buyer_code: h.buyer_code,
          method: h.method,
          reference_no: h.reference_no,
          note: h.note,
          created_at: h.created_at,
          total_received: h.total_received,
          net_received_amount: h.net_received_amount,
          bank_fee_amount: h.bank_fee_amount,
          buyer_bank_fee_amount: h.buyer_bank_fee_amount,
          claim_deduction_amount: h.claim_deduction_amount,
          invoice_id: line.invoice_id,
          invoice_no: inv?.invoice_no ?? "",
          invoice_date: inv?.invoice_date ?? inv?.created_at ?? null,
          invoice_total: round2(num(inv?.total_amount)),
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
        });
      }
    }

    const kpis = {
      receipt_count: headers.length,
      gross_received: round2(headers.reduce((s, x) => s + num(x.total_received), 0)),
      our_fee: round2(headers.reduce((s, x) => s + num(x.bank_fee_amount), 0)),
      buyer_fee: round2(
        headers.reduce((s, x) => s + num(x.buyer_bank_fee_amount) + num(x.buyer_wire_fee_writeoff_amount), 0)
      ),
      claim_deduction: round2(headers.reduce((s, x) => s + num(x.claim_deduction_amount), 0)),
      net_received: round2(headers.reduce((s, x) => s + num(x.net_received_amount), 0)),
      applied_total: round2(lines.reduce((s, x) => s + num(x.applied_amount), 0)),
      writeoff_total: round2(lines.reduce((s, x) => s + num(x.writeoff_amount), 0)),
    };

    const receiptsByMonthMap = new Map<string, any>();
    const receiptsByBuyerMap = new Map<string, any>();
    for (const h of headers) {
      const m = monthKey(h.deposit_date);
      if (m) {
        const row = receiptsByMonthMap.get(m) || {
          month: m,
          gross_received: 0,
          net_received: 0,
          our_fee: 0,
          buyer_fee: 0,
          claim_deduction: 0,
          receipt_count: 0,
        };
        row.gross_received += num(h.total_received);
        row.net_received += num(h.net_received_amount);
        row.our_fee += num(h.bank_fee_amount);
        row.buyer_fee += num(h.buyer_bank_fee_amount) + num(h.buyer_wire_fee_writeoff_amount);
        row.claim_deduction += num(h.claim_deduction_amount);
        row.receipt_count += 1;
        receiptsByMonthMap.set(m, row);
      }

      const buyerKey = String(h.buyer_id || "UNKNOWN");
      const buyerRow = receiptsByBuyerMap.get(buyerKey) || {
        buyer_id: h.buyer_id || null,
        buyer_name: h.buyer_name || "Unknown",
        buyer_code: h.buyer_code || "",
        gross_received: 0,
        net_received: 0,
        our_fee: 0,
        buyer_fee: 0,
        claim_deduction: 0,
        receipt_count: 0,
      };
      buyerRow.gross_received += num(h.total_received);
      buyerRow.net_received += num(h.net_received_amount);
      buyerRow.our_fee += num(h.bank_fee_amount);
      buyerRow.buyer_fee += num(h.buyer_bank_fee_amount) + num(h.buyer_wire_fee_writeoff_amount);
      buyerRow.claim_deduction += num(h.claim_deduction_amount);
      buyerRow.receipt_count += 1;
      receiptsByBuyerMap.set(buyerKey, buyerRow);
    }

    const receipts_by_month = Array.from(receiptsByMonthMap.values())
      .map((x) => ({
        ...x,
        gross_received: round2(x.gross_received),
        net_received: round2(x.net_received),
        our_fee: round2(x.our_fee),
        buyer_fee: round2(x.buyer_fee),
        claim_deduction: round2(x.claim_deduction),
      }))
      .sort((a, b) => String(a.month).localeCompare(String(b.month)));

    const receipts_by_buyer = Array.from(receiptsByBuyerMap.values())
      .map((x) => ({
        ...x,
        gross_received: round2(x.gross_received),
        net_received: round2(x.net_received),
        our_fee: round2(x.our_fee),
        buyer_fee: round2(x.buyer_fee),
        claim_deduction: round2(x.claim_deduction),
      }))
      .sort((a, b) => b.net_received - a.net_received);

    let invQ = supabaseAdmin
      .from("invoice_headers")
      .select("id, invoice_no, invoice_date, created_at, total_amount, paid_amount, balance_amount, buyer_id, status, currency, is_deleted")
      .eq("is_deleted", false)
      .lte("invoice_date", end)
      .order("invoice_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (buyerId) invQ = invQ.eq("buyer_id", buyerId);
    if (start) invQ = invQ.gte("invoice_date", start);

    const { data: invoiceRows, error: invoiceErr } = await invQ;
    if (invoiceErr) throw invoiceErr;

    const rawInvoices = (invoiceRows || []) as any[];
    const buyerIds = Array.from(new Set(rawInvoices.map((x) => x.buyer_id).filter(Boolean)));
    let buyerRows: any[] = [];
    if (buyerIds.length) {
      const { data, error } = await supabaseAdmin
        .from("companies")
        .select("id, company_name, code")
        .in("id", buyerIds);
      if (!error) buyerRows = (data || []) as any[];
    }
    const buyerById = new Map<string, any>(buyerRows.map((x) => [String(x.id), x]));

    const openInvoices = rawInvoices
      .filter((x) => !["DELETED", "CANCELLED"].includes(String(x.status || "").toUpperCase()))
      .map((x) => ({
        id: x.id,
        invoice_no: x.invoice_no,
        invoice_date: x.invoice_date || x.created_at || null,
        buyer_id: x.buyer_id,
        buyer_name: buyerById.get(String(x.buyer_id))?.company_name || null,
        buyer_code: buyerById.get(String(x.buyer_id))?.code || null,
        total_amount: round2(num(x.total_amount)),
        paid_amount: round2(num(x.paid_amount)),
        balance_amount: round2(num(x.balance_amount)),
        currency: x.currency || null,
        status: x.status || null,
      }))
      .filter((x) => x.balance_amount > 0.000001);

    const outstandingByBuyerMap = new Map<string, any>();
    const outstandingByMonthMap = new Map<string, any>();
    const aging = {
      current: 0,
      d1_30: 0,
      d31_60: 0,
      d61_90: 0,
      d90_plus: 0,
    };

    for (const inv of openInvoices) {
      const bKey = String(inv.buyer_id || "UNKNOWN");
      const bRow = outstandingByBuyerMap.get(bKey) || {
        buyer_id: inv.buyer_id,
        buyer_name: inv.buyer_name || "Unknown",
        buyer_code: inv.buyer_code || "",
        invoice_count: 0,
        outstanding_amount: 0,
      };
      bRow.invoice_count += 1;
      bRow.outstanding_amount += num(inv.balance_amount);
      outstandingByBuyerMap.set(bKey, bRow);

      const m = monthKey(inv.invoice_date);
      if (m) {
        const mRow = outstandingByMonthMap.get(m) || {
          month: m,
          outstanding_amount: 0,
          invoice_count: 0,
        };
        mRow.invoice_count += 1;
        mRow.outstanding_amount += num(inv.balance_amount);
        outstandingByMonthMap.set(m, mRow);
      }

      const invoiceDate = String(inv.invoice_date || "").slice(0, 10);
      const ageDays = invoiceDate ? daysDiff(end, invoiceDate) : 0;
      if (ageDays <= 0) aging.current += num(inv.balance_amount);
      else if (ageDays <= 30) aging.d1_30 += num(inv.balance_amount);
      else if (ageDays <= 60) aging.d31_60 += num(inv.balance_amount);
      else if (ageDays <= 90) aging.d61_90 += num(inv.balance_amount);
      else aging.d90_plus += num(inv.balance_amount);
    }

    const outstanding_by_buyer = Array.from(outstandingByBuyerMap.values())
      .map((x) => ({ ...x, outstanding_amount: round2(x.outstanding_amount) }))
      .sort((a, b) => b.outstanding_amount - a.outstanding_amount);

    const outstanding_by_month = Array.from(outstandingByMonthMap.values())
      .map((x) => ({ ...x, outstanding_amount: round2(x.outstanding_amount) }))
      .sort((a, b) => String(a.month).localeCompare(String(b.month)));

    const ar_kpis = {
      open_invoice_count: openInvoices.length,
      outstanding_amount: round2(openInvoices.reduce((s, x) => s + num(x.balance_amount), 0)),
      overdue_amount: round2(aging.d1_30 + aging.d31_60 + aging.d61_90 + aging.d90_plus),
    };

    return NextResponse.json(
      {
        success: true,
        filters_echo: { start, end, buyer_id: buyerId || null },
        kpis,
        ar_kpis,
        receipts_by_month,
        receipts_by_buyer,
        outstanding_by_buyer,
        outstanding_by_month,
        aging: {
          current: round2(aging.current),
          d1_30: round2(aging.d1_30),
          d31_60: round2(aging.d31_60),
          d61_90: round2(aging.d61_90),
          d90_plus: round2(aging.d90_plus),
        },
        recent_receipts: headers.slice(0, 100).map((h) => ({
          id: h.id,
          deposit_date: h.deposit_date,
          buyer_name: h.buyer_name,
          buyer_code: h.buyer_code,
          method: h.method,
          reference_no: h.reference_no,
          total_received: round2(num(h.total_received)),
          bank_fee_amount: round2(num(h.bank_fee_amount)),
          buyer_bank_fee_amount: round2(num(h.buyer_bank_fee_amount)),
          claim_deduction_amount: round2(num(h.claim_deduction_amount)),
          net_received_amount: round2(num(h.net_received_amount)),
          note: h.note,
        })),
        receipt_details: detailRows.slice(0, 500),
        open_invoices: openInvoices.slice(0, 500),
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (e: any) {
    console.error("[dashboards/receivables]", e);
    return NextResponse.json(
      { success: false, error: e?.message || "Failed to load receivables dashboard" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
