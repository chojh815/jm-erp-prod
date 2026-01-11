// src/app/api/proforma/detail/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}
function bad(message: string, status = 400, extra: any = {}) {
  return NextResponse.json({ success: false, error: message, ...extra }, { status });
}
function safe(v: any) {
  return (v ?? "").toString().trim();
}

// ✅ query param 읽기 (invoiceNo / invoice_no 둘 다 허용)
function getInvoiceNo(req: NextRequest) {
  const u = new URL(req.url);
  const invoiceNo = safe(u.searchParams.get("invoiceNo"));
  const invoice_no = safe(u.searchParams.get("invoice_no"));
  return invoiceNo || invoice_no || "";
}

export async function GET(req: NextRequest) {
  try {
    const invoiceNo = getInvoiceNo(req);
    if (!invoiceNo) return bad("Missing invoiceNo", 400);

    // =========================
    // ✅ 헤더: proforma_headers (사용자 스키마 기준)
    //  - invoice_no 컬럼명 주의
    //  - is_deleted=false 필터
    // =========================
    const { data: header, error: headerErr } = await supabaseAdmin
      .from("proforma_headers")
      .select("*")
      .eq("invoice_no", invoiceNo)
      .eq("is_deleted", false)
      .maybeSingle();

    if (headerErr) {
      return bad("Failed to load proforma header", 500, { detail: headerErr.message });
    }
    if (!header) {
      return bad("Proforma not found", 404, { invoiceNo });
    }

    // =========================
    // ✅ 라인: proforma_lines
    //  - proforma_header_id FK
    //  - is_deleted=false
    //  - line_no 정렬
    // =========================
    const { data: lines, error: linesErr } = await supabaseAdmin
      .from("proforma_lines")
      .select("*")
      .eq("proforma_header_id", header.id)
      .eq("is_deleted", false)
      .order("line_no", { ascending: true });

    if (linesErr) {
      return bad("Failed to load proforma lines", 500, { detail: linesErr.message });
    }

    // ✅ 프론트가 쓰기 편하게 camelCase도 같이 내려주기(기존 UI 호환용)
    const headerOut = {
      ...header,
      invoiceNo: header.invoice_no,
      poNo: header.po_no,
      buyerName: header.buyer_name,
      paymentTerm: header.payment_term,
      shipMode: header.ship_mode,
      finalDestination: header.final_destination,
      portOfLoading: header.port_of_loading,
      createdAt: header.created_at,
    };

    const linesOut = (lines ?? []).map((l: any) => ({
      ...l,
      lineNo: l.line_no,
      buyerStyleNo: l.buyer_style_no,
      jmStyleNo: l.jm_style_no,
      unitPrice: l.unit_price,
      upcCode: l.upc_code,
    }));

    return ok({
      invoiceNo,
      header: headerOut,
      lines: linesOut,
    });
  } catch (e: any) {
    return bad("Unexpected error", 500, { detail: e?.message ?? String(e) });
  }
}
