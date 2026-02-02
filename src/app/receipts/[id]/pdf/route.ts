// src/app/receipts/[id]/pdf/route.ts
import React from "react";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { renderToBuffer } from "@react-pdf/renderer";
import ReceiptPDF, { ReceiptPdfData } from "@/components/pdf/ReceiptPDF";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

function num(x: any) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}
function pickFirst<T>(...vals: Array<T | null | undefined>): T | null {
  for (const v of vals) if (v !== undefined && v !== null) return v;
  return null;
}

function getSupabase() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        // Route handlers can't set cookies via this client in a reliable way (we're read-only here)
        set() {},
        remove() {},
      },
    }
  );
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const id = ctx.params.id;
    const supabase = getSupabase();

    // 1) receipt header
    const { data: rh, error: rhErr } = await supabase
      .from("receipt_headers")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (rhErr) throw rhErr;
    if (!rh) return NextResponse.json({ error: "Receipt not found" }, { status: 404 });

    // 2) buyer/company (do NOT assume companies.is_deleted exists)
    let buyerName: string | null = null;
    let buyerCode: string | null = null;
    const buyerId = (rh as any).buyer_id ?? (rh as any).company_id ?? null;
    if (buyerId) {
      const { data: buyer, error: bErr } = await supabase
        .from("companies")
        .select("id, name, company_name, code, buyer_code")
        .eq("id", buyerId)
        .maybeSingle();
      if (!bErr && buyer) {
        buyerName = (buyer as any).name ?? (buyer as any).company_name ?? null;
        buyerCode = (buyer as any).buyer_code ?? (buyer as any).code ?? null;
      }
    }

    // 3) bank account (optional)
    let bankAccountName: string | null = null;
    let bankAccountNumber: string | null = null;
    let bankSwift: string | null = null;
    const bankAccountId = (rh as any).bank_account_id ?? null;
    if (bankAccountId) {
      const { data: ba, error: baErr } = await supabase
        .from("bank_accounts")
        .select("*")
        .eq("id", bankAccountId)
        .maybeSingle();
      if (!baErr && ba) {
        bankAccountName =
          (ba as any).account_name ?? (ba as any).bank_name ?? (ba as any).name ?? null;
        bankAccountNumber =
          (ba as any).account_no ?? (ba as any).account_number ?? null;
        bankSwift =
          (ba as any).swift ?? (ba as any).swift_code ?? null;
      }
    }

    // 4) receipt applications → invoices
    const { data: apps, error: appErr } = await supabase
      .from("receipt_applications")
      .select("id, invoice_id, applied_amount, is_deleted")
      .eq("receipt_id", id);

    if (appErr) throw appErr;

    const aliveApps = (apps || []).filter((a: any) => a && a.is_deleted !== true);
    const invoiceIds = Array.from(
      new Set(aliveApps.map((a: any) => a.invoice_id).filter(Boolean))
    );

    const invoiceMap = new Map<string, any>();
    if (invoiceIds.length > 0) {
      const { data: invs, error: invErr } = await supabase
        .from("invoice_headers")
        .select("id, invoice_no, invoice_date, total_amount")
        .in("id", invoiceIds as any);
      if (invErr) throw invErr;
      (invs || []).forEach((inv: any) => invoiceMap.set(inv.id, inv));
    }

    const invoices = aliveApps.map((a: any) => {
      const inv = a.invoice_id ? invoiceMap.get(a.invoice_id) : null;
      return {
        invoice_id: a.invoice_id ?? null,
        invoice_no: inv?.invoice_no ?? null,
        invoice_date: inv?.invoice_date ?? null,
        invoice_total: num(inv?.total_amount ?? 0),
        applied_amount: num(a.applied_amount ?? 0),
      };
    });

    const currency = (rh as any).currency ?? "USD";

    const data: ReceiptPdfData = {
      receipt_id: (rh as any).id,
      receipt_no: (rh as any).receipt_no ?? null,
      deposit_date: pickFirst((rh as any).deposit_date, (rh as any).received_date) as any,
      currency,

      buyer_name: buyerName,
      buyer_code: buyerCode,

      method: (rh as any).method ?? "WIRE",
      reference_no: (rh as any).reference_no ?? null,
      note: (rh as any).note ?? null,

      total_received_amount: num((rh as any).total_received_amount ?? (rh as any).total_amount ?? 0),
      bank_fee_our_amount: num((rh as any).bank_fee_our_amount ?? 0),
      bank_fee_buyer_amount: num((rh as any).bank_fee_buyer_amount ?? 0),
      claim_deduction_amount: num((rh as any).claim_deduction_amount ?? 0),
      net_received_amount: num((rh as any).net_received_amount ?? 0),

      bank_account_name: bankAccountName,
      bank_account_number: bankAccountNumber,
      bank_swift: bankSwift,

      invoices,
    };

    // 5) render PDF buffer
    // NOTE: @react-pdf/renderer renderToBuffer expects a ReactElement<DocumentProps>.
    // Your ReceiptPDF component returns a <Document />, but TS can't always infer that.
    // Cast to break the overly-strict generic constraint.
    const element = React.createElement(ReceiptPDF as any, { data }) as any;
    const pdf = await renderToBuffer(element);

    const filename = data.receipt_no
      ? `Receipt-${data.receipt_no}.pdf`
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
