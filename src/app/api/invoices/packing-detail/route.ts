// src/app/api/invoices/packing-detail/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// 공통 응답 헬퍼
function errorResponse(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function okResponse(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}

/**
 * GET /api/invoices/packing-detail?id=... or ?invoiceNo=...
 *
 * 반환:
 * {
 *   success: true,
 *   header: invoice_headers row,
 *   lines: invoice_lines[],   // cartons, gw, nw 포함
 *   shipments: invoice_shipments[]
 * }
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const invoiceNo = searchParams.get("invoiceNo");

    if (!id && !invoiceNo) {
      return errorResponse("Need invoice id or invoiceNo.", 400);
    }

    // =========================
    // 1) HEADER 조회
    // =========================
    let headerQuery = supabaseAdmin
      .from("invoice_headers")
      .select("*")
      .limit(1);

    if (id) {
      headerQuery = headerQuery.eq("id", id);
    } else if (invoiceNo) {
      headerQuery = headerQuery.eq("invoice_no", invoiceNo);
    }

    const { data: headerRows, error: headerErr } = await headerQuery;

    if (headerErr) {
      console.error(
        "GET /api/invoices/packing-detail header error:",
        headerErr
      );
      return errorResponse(headerErr.message, 500);
    }

    const header = headerRows?.[0];

    if (!header) {
      return errorResponse("Invoice not found.", 404);
    }

    const invoiceId = header.id as string;

    // =========================
    // 2) LINES 조회 (Packing에 필요한 필드 포함)
    // =========================
    const { data: lineRows, error: lineErr } = await supabaseAdmin
      .from("invoice_lines")
      .select(
        `
          id,
          invoice_id,
          invoice_header_id,
          shipment_id,
          shipment_line_id,
          po_header_id,
          po_line_id,
          po_no,
          line_no,
          style_no,
          description,
          color,
          size,
          qty,
          cartons,
          gw,
          nw,
          unit_price,
          amount,
          created_at
        `
      )
      .eq("invoice_header_id", invoiceId)
      .order("line_no", { ascending: true });

    if (lineErr) {
      console.error(
        "GET /api/invoices/packing-detail lines error:",
        lineErr
      );
      return errorResponse(lineErr.message, 500);
    }

    const lines = lineRows ?? [];

    // =========================
    // 3) SHIPMENTS 조회
    // =========================
    const { data: shipRows, error: shipErr } = await supabaseAdmin
      .from("invoice_shipments")
      .select(
        `
          id,
          invoice_id,
          shipment_id,
          created_at,
          updated_at
        `
      )
      .eq("invoice_id", invoiceId);

    if (shipErr) {
      console.error(
        "GET /api/invoices/packing-detail shipments error:",
        shipErr
      );
      return errorResponse(shipErr.message, 500);
    }

    const shipments = shipRows ?? [];

    // =========================
    // 최종 응답
    // =========================
    return okResponse({
      header,
      lines,
      shipments,
    });
  } catch (err: any) {
    console.error("GET /api/invoices/packing-detail exception:", err);
    return errorResponse("Failed to load packing detail.", 500);
  }
}
