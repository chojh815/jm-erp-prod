// src/app/api/proforma/[id]/pdf/route.ts
import React from "react";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { renderToStream } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import ProformaInvoicePDF from "@/pdf/ProformaInvoicePDF";

export const runtime = "nodejs";
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

    // 1) header
    const { data: header, error: headerErr } = await supabaseAdmin
      .from("proforma_invoices")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (headerErr || !header) {
      console.error("PI header error", headerErr);
      return NextResponse.json({ error: "PI not found" }, { status: 404 });
    }

    // 2) lines
    const { data: lines, error: linesErr } = await supabaseAdmin
      .from("proforma_invoice_lines")
      .select("*")
      .eq("proforma_invoice_id", id)
      .order("line_no", { ascending: true });

    if (linesErr) {
      console.error("PI lines error", linesErr);
      return NextResponse.json({ error: "Could not load PI lines" }, { status: 500 });
    }

    const safeLines = (lines || []) as any[];

    // 3) formatter
    const formatUnitPrice = (value: number) => {
      const v = Number(value || 0);
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

    const finalLines = safeLines.map((l) => ({
      ...l,
      unit_price_display: `$${formatUnitPrice(
        l.unit_price ?? (l as any).unitPrice ?? 0
      )}`,
      amount_display: `$${formatAmount(
        l.amount ??
          Number(l.qty || 0) * Number(l.unit_price ?? (l as any).unitPrice ?? 0)
      )}`,
    }));

    // 4) total
    const headerTotal =
      typeof (header as any).total_amount === "number"
        ? (header as any).total_amount
        : safeLines.reduce((sum, l) => {
            const amt =
              l.amount ??
              Number(l.qty || 0) * Number(l.unit_price ?? (l as any).unitPrice ?? 0);
            return sum + Number(amt || 0);
          }, 0);

    const totalDisplay = `$${formatAmount(headerTotal)}`;

    // ✅ 5) buyer fallback from companies
    const buyerId =
      pickFirst(header, ["buyer_id", "buyer_company_id", "company_id", "buyer_company"]) ||
      null;

    let buyerRow: any = null;

    if (buyerId) {
      const { data: c, error: cErr } = await supabaseAdmin
        .from("companies")
        .select("id, company_name, buyer_consignee, buyer_notify_party")
        .eq("id", buyerId)
        .maybeSingle();

      if (!cErr && c) buyerRow = c;
    }

    // buyerId가 없거나 매칭이 안되면 buyer_name으로 한번 더 시도(최후 fallback)
    if (!buyerRow) {
      const buyerNameGuess =
        pickFirst(header, ["buyer_name", "buyer_company_name", "buyer"]) || null;

      if (buyerNameGuess) {
        const { data: c2, error: c2Err } = await supabaseAdmin
          .from("companies")
          .select("id, company_name, buyer_consignee, buyer_notify_party")
          .ilike("company_name", `%${safe(buyerNameGuess)}%`)
          .limit(1)
          .maybeSingle();

        if (!c2Err && c2) buyerRow = c2;
      }
    }

    // ✅ 6) normalize (consignee/notify는 header → companies → buyerName 순)
    const buyerName =
      safe(pickFirst(header, ["buyer_name", "buyer_company_name", "buyer"])) ||
      safe(buyerRow?.company_name) ||
      "-";

    const normalizedHeader: any = {
      ...header,

      buyer_name: buyerName,
      buyer_brand_name: pickFirst(header, ["buyer_brand_name", "brand_name", "brand"]),
      buyer_dept_name: pickFirst(header, ["buyer_dept_name", "dept_name", "department"]),

      shipper_name: pickFirst(header, ["shipper_name", "exporter_name"]),
      shipper_address: pickFirst(header, ["shipper_address", "exporter_address"]),

      payment_term: pickFirst(header, [
        "payment_term",
        "payment_terms",
        "payment_term_text",
        "terms",
      ]),
      remarks: pickFirst(header, ["remarks", "remark", "note", "notes"]),

      consignee_text:
        pickFirst(header, ["consignee_text", "consignee", "consignee_address", "consignee_addr"]) ||
        safe(buyerRow?.buyer_consignee) ||
        buyerName,

      notify_party_text:
        pickFirst(header, [
          "notify_party_text",
          "notify_party",
          "notify",
          "notify_address",
          "notify_addr",
        ]) ||
        safe(buyerRow?.buyer_notify_party) ||
        buyerName,

      port_of_loading: pickFirst(header, ["port_of_loading", "pol", "port_loading"]),
      final_destination: pickFirst(header, ["final_destination", "destination", "final_dest"]),

      incoterm: pickFirst(header, ["incoterm", "incoterms"]),
      ship_mode: pickFirst(header, ["ship_mode", "ship_mode_text", "ship_mode_code"]),

      coo_text: pickFirst(header, ["coo_text", "coo", "country_of_origin_text"]),
      total_display: totalDisplay,
    };

    // ✅ 7) signatureUrl (B안)
    const signatureUrl =
      pickFirst(header, [
        "signature_url",
        "signatureUrl",
        "signature_url_public",
        "signature_public_url",
        "sign_url",
      ]) ||
      process.env.DEFAULT_PI_SIGNATURE_URL ||
      undefined;

    // ✅ 8) render (TS 빌드 에러 완전 차단)
    // ProformaInvoicePDF는 내부에서 <Document>를 반환한다고 가정.
    // TS는 이를 추론 못하므로 DocumentProps로 캐스팅해서 renderToStream 타입 만족시킴.
    const element = React.createElement(ProformaInvoicePDF as any, {
      header: normalizedHeader,
      lines: finalLines,
      signatureUrl,
    }) as unknown as React.ReactElement<DocumentProps>;

    const pdfStream = await renderToStream(element);

    const resHeaders = new Headers();
    resHeaders.set("Content-Type", "application/pdf");

    const invNo = safe((header as any).invoice_no) || safe((header as any).invoiceNo) || "proforma";
    const safeFile = invNo.replace(/[^\w\-\.]+/g, "_");
    resHeaders.set("Content-Disposition", `inline; filename="${safeFile}.pdf"`);

    return new Response(pdfStream as any, { headers: resHeaders });
  } catch (err) {
    console.error("PI PDF error", err);
    return NextResponse.json({ error: "Failed to generate PI PDF" }, { status: 500 });
  }
}
