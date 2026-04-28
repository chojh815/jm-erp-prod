import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function num(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function norm(v: any) {
  return String(v ?? "").trim().toLowerCase();
}

function pickInvoiceBuyerId(r: any) {
  return r?.buyer_id ?? r?.buyerId ?? r?.company_id ?? null;
}

function pickInvoiceBuyerName(r: any) {
  return r?.buyer_name ?? r?.buyerName ?? r?.company_name ?? r?.name ?? null;
}

function pickInvoiceBuyerCode(r: any) {
  return r?.buyer_code ?? r?.buyerCode ?? r?.company_code ?? r?.code ?? null;
}

function pickReceiptHeaderId(r: any) {
  return r?.id ?? r?.receipt_header_id ?? r?.receipt_id ?? r?.header_id ?? null;
}

function pickReceiptDate(r: any) {
  return r?.deposit_date ?? r?.receipt_date ?? r?.date ?? r?.created_at ?? null;
}

function pickReceiptLineInvoiceId(r: any) {
  return r?.invoice_id ?? r?.invoice_header_id ?? r?.inv_id ?? null;
}

function pickReceiptLineInvoiceNo(r: any) {
  return r?.invoice_no ?? r?.inv_no ?? r?.invoice_number ?? null;
}

function pickReceiptLineAppliedAmount(r: any) {
  const candidates = [
    r?.applied_amount,
    r?.apply_amount,
    r?.amount_applied,
    r?.amount,
    r?.applied_usd,
    r?.applied_amount_usd,
    r?.amount_usd,
  ];
  for (const v of candidates) {
    const n = Number(v);
    if (Number.isFinite(n) && n !== 0) return n;
  }
  return 0;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const buyerId = String(searchParams.get("buyer_id") || "").trim();
    const asOf = String(searchParams.get("as_of") || "").trim().slice(0, 10);

    if (!buyerId) {
      return NextResponse.json({ rows: [] });
    }

    const companyRes = await supabaseAdmin
      .from("companies")
      .select("*")
      .eq("id", buyerId)
      .maybeSingle();

    const buyer = companyRes.data || null;
    const buyerNameKey = norm(
      buyer?.company_name ?? buyer?.buyer_name ?? buyer?.name
    );
    const buyerCodeKey = norm(
      buyer?.company_code ?? buyer?.buyer_code ?? buyer?.code
    );

    const [invRes, receiptHeadersRes, receiptLinesRes] = await Promise.all([
      supabaseAdmin.from("invoice_headers").select("*").order("invoice_date", { ascending: false }).order("invoice_no", { ascending: false }),
      supabaseAdmin.from("receipt_headers").select("*"),
      supabaseAdmin.from("receipt_lines").select("*"),
    ]);

    if (invRes.error) {
      return NextResponse.json(
        { error: invRes.error.message || "Failed to load unpaid invoices" },
        { status: 500 }
      );
    }

    const invoices = invRes.data || [];
    const receiptHeaders = receiptHeadersRes.data || [];
    const receiptLines = receiptLinesRes.data || [];

    const EXCLUDED_STATUSES = new Set(["DELETED", "CANCELLED", "CANCELED"]);

    const invoiceMatchesBuyer = (r: any) => {
      const rowBuyerId = String(pickInvoiceBuyerId(r) ?? "").trim();
      const rowBuyerName = norm(pickInvoiceBuyerName(r));
      const rowBuyerCode = norm(pickInvoiceBuyerCode(r));
      if (rowBuyerId && rowBuyerId === buyerId) return true;
      if (buyerNameKey && rowBuyerName && rowBuyerName === buyerNameKey) return true;
      if (buyerCodeKey && rowBuyerCode && rowBuyerCode === buyerCodeKey) return true;
      return false;
    };

    const invoicesScoped = invoices
      .filter((r: any) => r?.is_deleted !== true)
      .filter((r: any) => !EXCLUDED_STATUSES.has(String(r?.status ?? "").toUpperCase()))
      .filter(invoiceMatchesBuyer)
      .filter((r: any) => {
        const d = String(r?.invoice_date ?? "").slice(0, 10);
        if (!asOf || !d) return true;
        return d <= asOf;
      });

    const receiptHeaderIdsScoped = new Set(
      receiptHeaders
        .filter((r: any) => r?.is_deleted !== true)
        .filter((r: any) => !EXCLUDED_STATUSES.has(String(r?.status ?? "").toUpperCase()))
        .filter((r: any) => {
          const d = String(pickReceiptDate(r) ?? "").slice(0, 10);
          if (!asOf || !d) return true;
          return d <= asOf;
        })
        .map((r: any) => String(pickReceiptHeaderId(r) ?? "").trim())
        .filter(Boolean)
    );

    const appliedByInvoiceId = new Map<string, number>();
    const appliedByInvoiceNo = new Map<string, number>();
    const settledByInvoiceId = new Map<string, number>();
    const settledByInvoiceNo = new Map<string, number>();

    for (const line of receiptLines) {
      if (line?.is_deleted === true) continue;
      const hid = String(pickReceiptHeaderId(line) ?? "").trim();
      if (hid && !receiptHeaderIdsScoped.has(hid)) continue;

      const amt = pickReceiptLineAppliedAmount(line);
      const writeoff = num(line?.writeoff_amount ?? line?.writeoff_amount_usd);
      if (!amt) continue;

      const invId = String(pickReceiptLineInvoiceId(line) ?? "").trim();
      const invNo = String(pickReceiptLineInvoiceNo(line) ?? "").trim();

      if (invId) appliedByInvoiceId.set(invId, (appliedByInvoiceId.get(invId) || 0) + amt);
      if (invNo) appliedByInvoiceNo.set(invNo, (appliedByInvoiceNo.get(invNo) || 0) + amt);
      if (writeoff > 0) {
        if (invId) settledByInvoiceId.set(invId, (settledByInvoiceId.get(invId) || 0) + writeoff);
        if (invNo) settledByInvoiceNo.set(invNo, (settledByInvoiceNo.get(invNo) || 0) + writeoff);
      }
    }

    const receiptHeaderById = new Map<string, any>();
    for (const h of receiptHeaders) {
      const hid = String(pickReceiptHeaderId(h) ?? "").trim();
      if (hid) receiptHeaderById.set(hid, h);
    }

    const receiptLinesByHeader = new Map<string, any[]>();
    for (const line of receiptLines) {
      if (line?.is_deleted === true) continue;
      const hid = String(pickReceiptHeaderId(line) ?? "").trim();
      if (!hid) continue;
      if (!receiptHeaderIdsScoped.has(hid)) continue;
      const arr = receiptLinesByHeader.get(hid) || [];
      arr.push(line);
      receiptLinesByHeader.set(hid, arr);
    }

    for (const [headerId, rows] of receiptLinesByHeader.entries()) {
      const header = receiptHeaderById.get(headerId);
      if (!header) continue;
      const totalAppliedForHeader = rows.reduce((sum, row) => sum + pickReceiptLineAppliedAmount(row), 0);
      if (totalAppliedForHeader <= 0) continue;

      for (const row of rows) {
        const applied = pickReceiptLineAppliedAmount(row);
        if (applied <= 0) continue;
        const ratio = applied / totalAppliedForHeader;
        const settledExtra =
          ratio * num(header?.bank_fee_amount) +
          ratio * (num(header?.buyer_bank_fee_amount) + num(header?.buyer_wire_fee_writeoff_amount)) +
          ratio * num(header?.claim_deduction_amount);

        if (settledExtra <= 0) continue;

        const invId = String(pickReceiptLineInvoiceId(row) ?? "").trim();
        const invNo = String(pickReceiptLineInvoiceNo(row) ?? "").trim();
        if (invId) settledByInvoiceId.set(invId, (settledByInvoiceId.get(invId) || 0) + settledExtra);
        if (invNo) settledByInvoiceNo.set(invNo, (settledByInvoiceNo.get(invNo) || 0) + settledExtra);
      }
    }

    const rows = invoicesScoped
      .map((r: any) => {
        const total = num(
          r?.total_amount ??
          r?.grand_total ??
          r?.subtotal ??
          r?.invoice_amount ??
          r?.amount
        );

        const explicitPaid = num(r?.paid_amount);
        const explicitBalanceRaw = r?.balance_amount;
        const explicitBalanceExists = explicitBalanceRaw !== null && explicitBalanceRaw !== undefined && explicitBalanceRaw !== "";
        const explicitBalance = num(explicitBalanceRaw);

        const invId = String(r?.id ?? "").trim();
        const invNo = String(r?.invoice_no ?? "").trim();

        const appliedById = invId ? (appliedByInvoiceId.get(invId) || 0) : 0;
        const appliedByNo = invNo ? (appliedByInvoiceNo.get(invNo) || 0) : 0;
        const applied = Math.max(appliedById, appliedByNo, explicitPaid);
        const settled = applied + Math.max(invId ? (settledByInvoiceId.get(invId) || 0) : 0, invNo ? (settledByInvoiceNo.get(invNo) || 0) : 0);
        const fallbackBalance = Math.max(0, total - settled);
        const hasComputedSettlement = settled > 0.0001;
        const balance =
          hasComputedSettlement
            ? fallbackBalance
            : explicitBalanceExists
              ? explicitBalance
              : fallbackBalance;

        return {
          invoice_id: r.id,
          invoice_no: invNo,
          invoice_date: r.invoice_date || "",
          total_amount: Math.round(total * 100) / 100,
          paid_amount: Math.round(applied * 100) / 100,
          balance_amount: Math.round(balance * 100) / 100,
          status: r.status || "",
        };
      })
      .filter((r: any) => r.invoice_no)
      .filter((r: any) => String(r.status || "").toUpperCase() !== "PAID")
      .filter((r: any) => r.balance_amount > 0.0001)
      .sort((a: any, b: any) => {
        const da = String(a.invoice_date || "");
        const db = String(b.invoice_date || "");
        return db.localeCompare(da) || String(b.invoice_no).localeCompare(String(a.invoice_no));
      });

    return NextResponse.json({
      rows,
      meta: {
        buyer_id: buyerId,
        buyer_name_key: buyerNameKey,
        buyer_code_key: buyerCodeKey,
        invoices_scoped: invoicesScoped.length,
        receipt_lines_scoped: Array.from(receiptHeaderIdsScoped).length,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Unexpected server error" },
      { status: 500 }
    );
  }
}
