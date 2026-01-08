// src/app/api/invoices/packing-detail/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}
function bad(message: string, status = 400, extra?: any) {
  return NextResponse.json({ success: false, error: message, ...(extra ?? {}) }, { status });
}

function safeTrim(v: any) {
  return (v ?? "").toString().trim();
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isUuid(v: string) {
  return UUID_RE.test(v);
}

async function findInvoiceHeader(args: {
  invoiceId?: string;
  invoiceNo?: string;
  shipmentId?: string;
}) {
  const { invoiceId, invoiceNo, shipmentId } = args;

  let header: any = null;

  if (invoiceId && isUuid(invoiceId)) {
    const { data, error } = await supabaseAdmin
      .from("invoice_headers")
      .select("*")
      .eq("id", invoiceId)
      .limit(1)
      .maybeSingle();
    if (!error && data) header = data;
  }

  if (!header && invoiceNo) {
    const { data, error } = await supabaseAdmin
      .from("invoice_headers")
      .select("*")
      .eq("invoice_no", invoiceNo)
      .limit(1)
      .maybeSingle();
    if (!error && data) header = data;
  }

  if (!header && shipmentId) {
    const { data, error } = await supabaseAdmin
      .from("invoice_headers")
      .select("*")
      .eq("shipment_id", shipmentId)
      // created_at 없을 수 있어 order 제거(안전)
      .limit(1)
      .maybeSingle();
    if (!error && data) header = data;
  }

  return header;
}

async function findPackingHeader(args: {
  invoiceId?: string;
  invoiceNo?: string;
  shipmentId?: string;
}) {
  const { invoiceId, invoiceNo, shipmentId } = args;

  // packing_list_headers 구조가 프로젝트마다 다를 수 있으니:
  // - 실패하더라도 route 자체는 죽지 않게 최대한 방어적으로 시도
  const tryQuery = async (qb: any) => {
    // created_at 없을 수 있어 order는 updated_at 우선, 없으면 order 없이
    const q1 = qb.order("updated_at", { ascending: false }).limit(1);
    const r1 = await q1.maybeSingle();
    if (!r1.error && r1.data) return r1.data;

    // updated_at도 없으면 order 없이
    const q2 = qb.limit(1);
    const r2 = await q2.maybeSingle();
    if (!r2.error && r2.data) return r2.data;

    return null;
  };

  let packingHeader: any = null;

  // 1) invoice_id
  if (invoiceId && isUuid(invoiceId)) {
    try {
      packingHeader = await tryQuery(
        supabaseAdmin
          .from("packing_list_headers")
          .select("*")
          .eq("invoice_id", invoiceId)
          .eq("is_deleted", false)
      );
      if (packingHeader) return packingHeader;
    } catch {
      // ignore
    }
  }

  // 2) shipment_id
  if (shipmentId && isUuid(shipmentId)) {
    try {
      packingHeader = await tryQuery(
        supabaseAdmin
          .from("packing_list_headers")
          .select("*")
          .eq("shipment_id", shipmentId)
          .eq("is_deleted", false)
      );
      if (packingHeader) return packingHeader;
    } catch {
      // ignore
    }
  }

  // 3) invoice_no(text) 컬럼(있을 때)
  if (invoiceNo) {
    try {
      packingHeader = await tryQuery(
        supabaseAdmin
          .from("packing_list_headers")
          .select("*")
          .eq("invoice_no", invoiceNo)
          .eq("is_deleted", false)
      );
      if (packingHeader) return packingHeader;
    } catch {
      // ignore
    }
  }

  return null;
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;

    const invoiceId = safeTrim(sp.get("invoice_id") || sp.get("id"));
    const invoiceNo = safeTrim(sp.get("invoice_no"));
    const shipmentId = safeTrim(sp.get("shipment_id"));

    if (!invoiceId && !invoiceNo && !shipmentId) {
      return bad(
        "Missing query. Provide one of: invoice_id | invoice_no | shipment_id",
        400
      );
    }

    // 1) invoice header
    const header = await findInvoiceHeader({ invoiceId, invoiceNo, shipmentId });
    if (!header) return bad("Invoice not found.", 404);

    // 2) packing header (fallback: invoice_id -> shipment_id -> invoice_no)
    const packingHeader = await findPackingHeader({
      invoiceId: header.id,
      invoiceNo: safeTrim(header.invoice_no) || invoiceNo,
      shipmentId: safeTrim(header.shipment_id) || shipmentId,
    });

    // 3) packing lines
    let packingLines: any[] = [];
    if (packingHeader?.id) {
      try {
        const { data, error } = await supabaseAdmin
          .from("packing_list_lines")
          .select("*")
          .eq("packing_list_id", packingHeader.id)
          .eq("is_deleted", false)
          // created_at 없을 수 있어 안전 정렬
          .order("carton_no_from", { ascending: true })
          .order("po_no", { ascending: true })
          .order("style_no", { ascending: true });

        if (!error && Array.isArray(data)) packingLines = data;
      } catch {
        // ignore
      }
    }

    // 4) buyer/company
    let buyer: any = null;
    try {
      const buyerId = header.buyer_id;
      if (buyerId && isUuid(String(buyerId))) {
        const { data } = await supabaseAdmin
          .from("companies")
          .select("*")
          .eq("id", buyerId)
          .limit(1)
          .maybeSingle();
        if (data) buyer = data;
      }
    } catch {
      // ignore
    }

    return ok({
      invoice_header: header,
      buyer,
      packing_header: packingHeader,
      packing_lines: packingLines,
    });
  } catch (e: any) {
    return bad(e?.message || "Failed to load packing detail", 500);
  }
}
