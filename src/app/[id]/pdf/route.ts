// src/app/[id]/pdf/route.ts
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

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = params?.id?.toString().trim();
    if (!id) return NextResponse.json({ error: "Missing PI ID" }, { status: 400 });

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

    const poNo = safe(pickFirst(header, ["po_no", "poNo", "po_reference"]));
    let poHeader: any = null;

    if (poNo) {
      const { data: po, error: poErr } = await supabaseAdmin
        .from("po_headers")
        .select("shipping_origin_code, origin_code, origin")
        .eq("po_no", poNo)
        .eq("is_deleted", false)
        .maybeSingle();

      if (!poErr) poHeader = po;
    }

    const shippingOriginCode =
      safe(pickFirst(header, ["shipping_origin_code"])) ||
      safe(pickFirst(poHeader, ["shipping_origin_code"])) ||
      safe(pickFirst(header, ["origin_code", "origin"])) ||
      safe(pickFirst(poHeader, ["origin_code", "origin"])) ||
      null;

    // 3) signatureUrl (fallback)
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

    const normalizedHeader: any = {
      ...header,
      shipping_origin_code: shippingOriginCode,
    };

    // ✅ JSX 금지: route.ts에서는 createElement로 만든다
    const element = React.createElement(ProformaInvoicePDF as any, {
      header: normalizedHeader,
      lines: safeLines,
      signatureUrl,
      assetsBaseUrl: _req.nextUrl.origin,
    }) as unknown as React.ReactElement<DocumentProps>;

    const pdfStream = await renderToStream(element);

    const resHeaders = new Headers();
    resHeaders.set("Content-Type", "application/pdf");

    const invNo =
      safe((header as any).invoice_no) || safe((header as any).invoiceNo) || "proforma";
    const safeFile = invNo.replace(/[^\w\-\.]+/g, "_");
    resHeaders.set("Content-Disposition", `inline; filename="${safeFile}.pdf"`);

    return new Response(pdfStream as any, { headers: resHeaders });
  } catch (err) {
    console.error("PI PDF error", err);
    return NextResponse.json({ error: "Failed to generate PI PDF" }, { status: 500 });
  }
}
