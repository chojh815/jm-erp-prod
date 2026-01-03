// src/app/api/invoices/packing-detail/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}
function bad(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function safeTrim(v: any) {
  return (v ?? "").toString().trim();
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isUuid(v: string) {
  return UUID_RE.test(v);
}

export async function GET(req: NextRequest) {
  try {
    // ✅ request.url 금지 -> req.nextUrl
    const sp = req.nextUrl.searchParams;

    // 보통 packing-detail은 invoice_id 또는 invoice_no 로 들어옴
    const invoiceId = safeTrim(sp.get("invoice_id") || sp.get("id"));
    const invoiceNo = safeTrim(sp.get("invoice_no"));
    const shipmentId = safeTrim(sp.get("shipment_id"));

    if (!invoiceId && !invoiceNo && !shipmentId) {
      return bad("Missing query. Provide one of: invoice_id | invoice_no | shipment_id", 400);
    }

    // 1) invoice header 찾기
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
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!error && data) header = data;
    }

    if (!header) {
      return bad("Invoice not found.", 404);
    }

    // 2) packing list header 찾기 (있으면)
    // 프로젝트마다 packing_list_headers 구조가 다를 수 있으니 실패해도 빌드는 깨지지 않게
    let packingHeader: any = null;
    try {
      // invoice_id 컬럼이 있는 경우가 가장 흔함
      const { data, error } = await supabaseAdmin
        .from("packing_list_headers")
        .select("*")
        .eq("invoice_id", header.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!error && data) packingHeader = data;
    } catch {
      // ignore
    }

    // 3) packing lines 가져오기 (있으면)
    let packingLines: any[] = [];
    if (packingHeader?.id) {
      try {
        const { data, error } = await supabaseAdmin
          .from("packing_list_lines")
          .select("*")
          .eq("packing_list_id", packingHeader.id)
          .order("created_at", { ascending: true });

        if (!error && Array.isArray(data)) packingLines = data;
      } catch {
        // ignore
      }
    }

    // 4) buyer/company (있으면)
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
