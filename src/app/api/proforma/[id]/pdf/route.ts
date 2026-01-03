// src/app/api/proforma/[id]/pdf/route.ts
import React from "react";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { renderToStream } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import ProformaInvoicePDF from "@/pdf/ProformaInvoicePDF";

export const runtime = "nodejs"; // react-pdf는 node 런타임 사용
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = params?.id?.toString().trim();

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

      // 일단 4자리까지 만들고, 뒤의 불필요한 0 제거
      let formatted = v.toFixed(4).replace(/\.?0+$/, "");

      // 소수점이 아예 없으면 .00 붙임
      if (!formatted.includes(".")) formatted += ".00";

      // 소수점 최소 2자리 보장
      const decimals = formatted.split(".")[1] ?? "";
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
    const finalLines = safeLines.map((l) => {
      const unitPrice = Number(l.unit_price ?? (l as any).unitPrice ?? 0);
      const qty = Number(l.qty || 0);
      const amount = Number(l.amount ?? qty * unitPrice);

      return {
        ...l,
        unit_price_display: `$${formatUnitPrice(unitPrice)}`,
        amount_display: `$${formatAmount(amount)}`,
      };
    });

    const headerTotal =
      typeof (header as any).total_amount === "number"
        ? (header as any).total_amount
        : safeLines.reduce((sum, l) => {
            const unitPrice = Number(l.unit_price ?? (l as any).unitPrice ?? 0);
            const qty = Number(l.qty || 0);
            const amount = Number(l.amount ?? qty * unitPrice);
            return sum + amount;
          }, 0);

    const totalDisplay = `$${formatAmount(headerTotal)}`;
    const signatureUrl = (header as any).signature_url || null;

    // 5) PDF 스트림 생성 (✅ 타입 에러 해결: DocumentProps로 캐스팅)
    const element = React.createElement(ProformaInvoicePDF as any, {
      header: { ...header, total_display: totalDisplay },
      lines: finalLines,
      signatureUrl,
    }) as unknown as React.ReactElement<DocumentProps>;

    const pdfStream = await renderToStream(element);

    const resHeaders = new Headers();
    resHeaders.set("Content-Type", "application/pdf");
    resHeaders.set(
      "Content-Disposition",
      `inline; filename="${(header as any).invoice_no || "proforma"}.pdf"`
    );

    return new Response(pdfStream as any, { headers: resHeaders });
  } catch (err) {
    console.error("PI PDF error", err);
    return NextResponse.json(
      { error: "Failed to generate PI PDF" },
      { status: 500 }
    );
  }
}
