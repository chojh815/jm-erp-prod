// src/app/receipts/[id]/pdf/route.ts
import React from "react";
import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import ReceiptPDF, { ReceiptPdfData } from "@/components/pdf/ReceiptPDF";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

function num(x: any) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}
function s(v: any) {
  return (v ?? "").toString().trim();
}
function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function pickFirst<T>(...vals: Array<T | null | undefined>): T | null {
  for (const v of vals) {
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return null;
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const id = s(ctx.params.id);
    if (!id) {
      return NextResponse.json({ error: "receipt id required" }, { status: 400 });
    }

    // 1) receipt header
    const { data: rh, error: rhErr } = await supabaseAdmin
      .from("receipt_headers")
      .select("*")
      .eq("id", id)
      .eq("is_deleted", false)
      .maybeSingle();

    if (rhErr) throw rhErr;
    if (!rh) {
      return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
    }

    // 2) buyer/company
    let buyerName: string | null = s((rh as any).buyer_name) || null;
    let buyerCode: string | null = s((rh as any).buyer_code) || null;
    const buyerId = s((rh as any).buyer_id ?? (rh as any).company_id) || null;

    if (buyerId && (!buyerName || !buyerCode)) {
      const { data: buyer, error: bErr } = await supabaseAdmin
        .from("companies")
        .select("id, name, company_name, code, buyer_code")
        .eq("id", buyerId)
        .maybeSingle();

      if (!bErr && buyer) {
        buyerName =
          buyerName ||
          s((buyer as any).company_name) ||
          s((buyer as any).name) ||
          null;
        buyerCode =
          buyerCode ||
          s((buyer as any).buyer_code) ||
          s((buyer as any).code) ||
          null;
      }
    }

    // 3) bank account (optional)
    let bankAccountName: string | null = s((rh as any).bank_account_label) || null;
    let bankAccountNumber: string | null = null;
    let bankSwift: string | null = null;
    const bankAccountId = s((rh as any).bank_account_id) || null;

    if (bankAccountId) {
      const { data: ba, error: baErr } = await supabaseAdmin
        .from("bank_accounts")
        .select("*")
        .eq("id", bankAccountId)
        .maybeSingle();

      if (!baErr && ba) {
        bankAccountName =
          bankAccountName ||
          s((ba as any).account_name) ||
          s((ba as any).bank_name) ||
          s((ba as any).name) ||
          null;
        bankAccountNumber =
          s((ba as any).account_no) ||
          s((ba as any).account_number) ||
          s((ba as any).account_no_masked) ||
          null;
        bankSwift =
          s((ba as any).swift) ||
          s((ba as any).swift_code) ||
          null;
      }
    }

    // 4) receipt lines -> invoices
    const { data: lines, error: lineErr } = await supabaseAdmin
      .from("receipt_lines")
      .select("id, receipt_header_id, invoice_id, applied_amount, writeoff_amount, is_deleted")
      .eq("receipt_header_id", id)
      .eq("is_deleted", false);

    if (lineErr) throw lineErr;

    const aliveLines = (lines || []).filter((x: any) => x && x.is_deleted !== true);
    const invoiceIds = Array.from(
      new Set(aliveLines.map((x: any) => s(x.invoice_id)).filter(Boolean))
    );

    const invoiceMap = new Map<string, any>();
    if (invoiceIds.length > 0) {
      const { data: invs, error: invErr } = await supabaseAdmin
        .from("invoice_headers")
        .select("id, invoice_no, invoice_date, total_amount, paid_amount, balance_amount")
        .in("id", invoiceIds);
      if (invErr) throw invErr;
      for (const inv of invs || []) {
        invoiceMap.set(String((inv as any).id), inv);
      }
    }

    const lineTotal = round2(
      aliveLines.reduce((sum: number, line: any) => sum + num(line.applied_amount), 0)
    );

    const invoices = aliveLines.map((line: any) => {
      const invoiceId = s(line.invoice_id) || null;
      const inv = invoiceId ? invoiceMap.get(invoiceId) : null;
      const ratio = lineTotal > 0 ? num(line.applied_amount) / lineTotal : 0;

      return {
        invoice_id: invoiceId,
        invoice_no: s(inv?.invoice_no) || null,
        invoice_date: inv?.invoice_date ?? null,
        invoice_total: num(inv?.total_amount),
        applied_amount: round2(num(line.applied_amount)),
        writeoff_amount: round2(num(line.writeoff_amount)),
        allocated_our_fee: round2(ratio * num((rh as any).bank_fee_amount)),
        allocated_buyer_fee: round2(ratio * num((rh as any).buyer_bank_fee_amount)),
        allocated_claim_deduction: round2(ratio * num((rh as any).claim_deduction_amount)),
        settled_amount: round2(
          num(line.applied_amount) +
            ratio * num((rh as any).bank_fee_amount) +
            ratio * num((rh as any).buyer_bank_fee_amount) +
            ratio * num((rh as any).claim_deduction_amount) +
            num(line.writeoff_amount)
        ),
      };
    });

    const currency = s((rh as any).currency) || "USD";

    const data: ReceiptPdfData = {
      receipt_id: String((rh as any).id),
      receipt_no: pickFirst((rh as any).reference_no, (rh as any).receipt_no, (rh as any).id) as any,
      deposit_date: pickFirst((rh as any).deposit_date, (rh as any).receipt_date) as any,
      currency,

      buyer_name: buyerName,
      buyer_code: buyerCode,

      method: pickFirst((rh as any).method, (rh as any).payment_method, "WIRE") as any,
      reference_no: pickFirst((rh as any).reference_no, null) as any,
      note: pickFirst((rh as any).note, null) as any,

      total_received_amount: num((rh as any).total_received ?? (rh as any).received_amount),
      bank_fee_our_amount: num((rh as any).bank_fee_amount),
      bank_fee_buyer_amount: num((rh as any).buyer_bank_fee_amount),
      claim_deduction_amount: num((rh as any).claim_deduction_amount),
      net_received_amount: num((rh as any).net_received_amount),

      bank_account_name: bankAccountName,
      bank_account_number: bankAccountNumber,
      bank_swift: bankSwift,

      invoices,
    };

    const element = React.createElement(ReceiptPDF as any, { data }) as any;
    const pdf = await renderToBuffer(element);

    const filename = data.reference_no
      ? `Receipt-${data.reference_no}.pdf`
      : `Receipt-${data.receipt_id}.pdf`;

    return new NextResponse(pdf as any, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
