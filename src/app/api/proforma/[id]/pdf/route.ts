// src/app/api/proforma/[id]/pdf/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { renderToStream } from "@react-pdf/renderer";
import ProformaInvoicePDF from "@/pdf/ProformaInvoicePDF";
import React from "react";

export const runtime = "nodejs"; // react-pdf는 node 런타임 사용

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = params.id;

    if (!id) {
      return NextResponse.json({ error: "Missing PI ID" }, { status: 400 });
    }

    // 1) 헤더 로드
    const { data: header, error: headerErr } = await supabaseAdmin
      .from("proforma_invoices")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (headerErr || !header) {
      console.error("PI header error", headerErr);
      return NextResponse.json({ error: "PI not found" }, { status: 404 });
    }

    // 2) 라인 로드
    const { data: lines, error: linesErr } = await supabaseAdmin
      .from("proforma_invoice_lines")
      .select("*")
      .eq("proforma_invoice_id", id)
      .order("line_no", { ascending: true });

    if (linesErr) {
      console.error("PI lines error", linesErr);
      return NextResponse.json(
        { error: "Could not load PI lines" },
        { status: 500 }
      );
    }

    const safeLines = (lines || []) as any[];

    // 3) 숫자 포맷 함수
    const formatUnitPrice = (value: number) => {
      const v = Number(value || 0);
      let formatted = v.toFixed(4).replace(/\.?0+$/, "");
      if (!formatted.includes(".")) formatted += ".00";
      const decimals = formatted.split(".")[1];
      if (decimals.length < 2) {
        formatted += "0".repeat(2 - decimals.length);
      }
      return formatted;
    };

    const formatAmount = (v: number) =>
      new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(Number(v || 0));

    // 4) 라인 포맷 적용
    const finalLines = safeLines.map((l) => ({
      ...l,
      unit_price_display: `$${formatUnitPrice(
        l.unit_price ?? (l as any).unitPrice ?? 0
      )}`,
      amount_display: `$${formatAmount(
        l.amount ??
          Number(l.qty || 0) *
            Number(l.unit_price ?? (l as any).unitPrice ?? 0)
      )}`,
    }));

    const headerTotal =
      typeof header.total_amount === "number"
        ? header.total_amount
        : safeLines.reduce(
            (sum, l) =>
              sum +
              Number(
                l.amount ??
                  Number(l.qty || 0) *
                    Number(l.unit_price ?? (l as any).unitPrice ?? 0)
              ),
            0
          );

    const totalDisplay = `$${formatAmount(headerTotal)}`;

    const signatureUrl = (header as any).signature_url || null;

    // 5) PDF 스트림 생성 (여기가 핵심 수정 부분)
    const element = React.createElement(ProformaInvoicePDF, {
      header: { ...header, total_display: totalDisplay },
      lines: finalLines,
      signatureUrl,
    });

    const pdfStream = await renderToStream(element);

    const resHeaders = new Headers();
    resHeaders.set("Content-Type", "application/pdf");
    resHeaders.set(
      "Content-Disposition",
      `inline; filename="${header.invoice_no || "proforma"}.pdf"`
    );

    // @ts-ignore - ReadableStream 타입 이슈 무시
    return new Response(pdfStream, { headers: resHeaders });
  } catch (err) {
    console.error("PI PDF error", err);
    return NextResponse.json(
      { error: "Failed to generate PI PDF" },
      { status: 500 }
    );
  }
}
