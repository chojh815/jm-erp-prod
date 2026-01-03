// src/app/api/invoices/[id]/pdf/route.tsx
import React from "react";
import { NextRequest, NextResponse } from "next/server";
import { renderToStream } from "@react-pdf/renderer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

import CommercialInvoicePDF, {
  InvoiceHeaderPDF,
  InvoiceLinePDF,
} from "@/pdf/CommercialInvoicePDF";

const safeNumber = (v: any, fallback = 0): number => {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isNaN(n) ? fallback : n;
};

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = supabaseAdmin; // ✅ createClient 결과(객체) 그대로 사용
  const invoiceId = params.id;

  try {
    // 1) header
    const { data: header, error: hErr } = await supabase
      .from("invoice_headers")
      .select(
        `
        id,
        invoice_no,
        buyer_name,
        bill_to,
        ship_to,
        currency,
        incoterm,
        payment_term,
        shipping_origin_code,
        destination,
        etd,
        eta,
        status,
        total_amount,
        total_cartons,
        total_gw,
        total_nw
      `
      )
      .eq("id", invoiceId)
      .single();

    if (hErr || !header) {
      throw new Error(hErr?.message || "Invoice header not found");
    }

    // 2) lines
    const { data: linesRaw, error: lErr } = await supabase
      .from("invoice_lines")
      .select(
        `
        line_no,
        po_no,
        style_no,
        description,
        color,
        size,
        qty,
        unit_price,
        amount,
        cartons,
        gw,
        nw
      `
      )
      .eq("invoice_header_id", invoiceId)
      .order("line_no", { ascending: true });

    if (lErr) throw lErr;

    // ✅ InvoiceHeaderPDF는 CommercialInvoicePDF.tsx에 정의된 "snake_case" 필드만 넣어야 함
    const headerPdf: InvoiceHeaderPDF = {
      invoice_no: header.invoice_no ?? "",
      buyer_name: header.buyer_name ?? "",
      bill_to: header.bill_to ?? "",
      ship_to: header.ship_to ?? "",
      currency: header.currency ?? "",
      incoterm: header.incoterm ?? "",
      payment_term: header.payment_term ?? "",
      shipping_origin_code: header.shipping_origin_code ?? "",
      destination: header.destination ?? "",
      etd: header.etd ?? "",
      eta: header.eta ?? "",
      status: header.status ?? "",
      total_amount: safeNumber(header.total_amount),
      total_cartons: safeNumber(header.total_cartons),
      total_gw: safeNumber(header.total_gw),
      total_nw: safeNumber(header.total_nw),
    };

    // ✅ InvoiceLinePDF도 CommercialInvoicePDF.tsx의 인터페이스와 동일하게 snake_case로
    const lines: InvoiceLinePDF[] = (linesRaw || []).map((l: any, idx: number) => ({
      line_no: l.line_no ?? idx + 1,
      po_no: l.po_no ?? "",
      style_no: l.style_no ?? "",
      description: l.description ?? "",
      color: l.color ?? "",
      size: l.size ?? "",
      qty: safeNumber(l.qty),
      unit_price: safeNumber(l.unit_price),
      amount: safeNumber(l.amount),
      cartons: safeNumber(l.cartons),
      gw: safeNumber(l.gw),
      nw: safeNumber(l.nw),
    }));

    const stream = await renderToStream(
      <CommercialInvoicePDF header={headerPdf} lines={lines} />
    );

    return new NextResponse(stream as any, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${header.invoice_no || "invoice"}.pdf"`,
      },
    });
  } catch (err: any) {
    console.error("[Invoice PDF] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to generate invoice PDF" },
      { status: 500 }
    );
  }
}
