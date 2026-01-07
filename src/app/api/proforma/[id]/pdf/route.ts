// src/app/api/proforma/[id]/pdf/route.ts
import React from "react";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { renderToStream } from "@react-pdf/renderer";
import ProformaInvoicePDF from "@/pdf/ProformaInvoicePDF";

export const runtime = "nodejs"; // react-pdf는 node 런타임 사용
export const dynamic = "force-dynamic";

function safe(v: any) {
  return (v ?? "").toString().trim();
}

function pickFirst(obj: any, keys: string[]) {
  for (const k of keys) {
    const val = obj?.[k];
    if (val !== null && val !== undefined && safe(val) !== "") return val;
  }
  return null;
}

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
      // 원래 네 로직 유지: 4자리까지 찍고 불필요 0 제거, 최소 2자리 보장
      let formatted = v.toFixed(4).replace(/\.?0+$/, "");
      if (!formatted.includes(".")) formatted += ".00";
      const decimals = formatted.split(".")[1];
      if (decimals.length < 2) formatted += "0".repeat(2 - decimals.length);
      return formatted;
    };

    const formatAmount = (v: number) =>
      new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(Number(v || 0));

    // 4) 라인 포맷 적용 (display 값은 PDF에서 안 써도 harmless)
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

    // 5) total 계산
    const headerTotal =
      typeof (header as any).total_amount === "number"
        ? (header as any).total_amount
        : safeLines.reduce((sum, l) => {
            const amt =
              l.amount ??
              Number(l.qty || 0) *
                Number(l.unit_price ?? (l as any).unitPrice ?? 0);
            return sum + Number(amt || 0);
          }, 0);

    const totalDisplay = `$${formatAmount(headerTotal)}`;

    // ✅ 6) PDF header 키 정규화 (DB 컬럼명이 흔들려도 PDF는 절대 안 깨지게)
    const normalizedHeader: any = {
      ...header,

      // buyer
      buyer_name: pickFirst(header, ["buyer_name", "buyer_company_name", "buyer"]),
      buyer_brand_name: pickFirst(header, ["buyer_brand_name", "brand_name", "brand"]),
      buyer_dept_name: pickFirst(header, ["buyer_dept_name", "dept_name", "department"]),

      // shipper
      shipper_name: pickFirst(header, ["shipper_name", "exporter_name"]),
      shipper_address: pickFirst(header, ["shipper_address", "exporter_address"]),

      // terms / remarks
      payment_term: pickFirst(header, ["payment_term", "payment_terms", "payment_term_text", "terms"]),
      remarks: pickFirst(header, ["remarks", "remark", "note", "notes"]),

      // consignee / notify
      consignee_text: pickFirst(header, [
        "consignee_text",
        "consignee",
        "consignee_address",
        "consignee_addr",
      ]),
      notify_party_text: pickFirst(header, [
        "notify_party_text",
        "notify_party",
        "notify",
        "notify_address",
        "notify_addr",
      ]),

      // port / destination
      port_of_loading: pickFirst(header, ["port_of_loading", "pol", "port_loading"]),
      final_destination: pickFirst(header, ["final_destination", "destination", "final_dest"]),

      // incoterm / ship_mode
      incoterm: pickFirst(header, ["incoterm", "incoterms"]),
      ship_mode: pickFirst(header, ["ship_mode", "ship_mode_text", "ship_mode_code"]),

      // coo
      coo_text: pickFirst(header, ["coo_text", "coo", "country_of_origin_text"]),

      // totals (기존 유지)
      total_display: totalDisplay,
    };

    // ✅ B안: signatureUrl은 “가능한 후보들”에서 pickFirst로 흡수
    const signatureUrl = pickFirst(header, [
      "signature_url",
      "signatureUrl",
      "signature_url_public",
      "signature_public_url",
      "sign_url",
    ]);

    // 7) PDF 스트림 생성 (B안: signatureUrl 전달)
    const element = React.createElement(ProformaInvoicePDF as any, {
      header: normalizedHeader,
      lines: finalLines,
      signatureUrl: signatureUrl || undefined,
    });

    const pdfStream = await renderToStream(element);

    const resHeaders = new Headers();
    resHeaders.set("Content-Type", "application/pdf");

    const invNo =
      safe((header as any).invoice_no) ||
      safe((header as any).invoiceNo) ||
      "proforma";

    // 파일명에 특수문자/공백이 있으면 브라우저가 깨질 수 있어 최소 정리
    const safeFile = invNo.replace(/[^\w\-\.]+/g, "_");

    resHeaders.set(
      "Content-Disposition",
      `inline; filename="${safeFile}.pdf"`
    );

    // @ts-ignore - ReadableStream 타입 이슈 무시
    return new Response(pdfStream as any, { headers: resHeaders });
  } catch (err) {
    console.error("PI PDF error", err);
    return NextResponse.json(
      { error: "Failed to generate PI PDF" },
      { status: 500 }
    );
  }
}
