// src/app/api/shipments/from-po/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// =======================
// 공통 헬퍼
// =======================

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function okResponse(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}

function safeNumber(v: any, fallback = 0): number {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  if (Number.isNaN(n)) return fallback;
  return n;
}

// =======================
// 내부 공용 로더
//  - po_header + po_lines 한 번에 불러오고
//  - 이미 Shipment 된 수량을 빼서 "남은 수량" 기준으로 라인 구성
// =======================

async function loadPoForShipment(poHeaderId: string) {
  // 1) PO Header
  const { data: poHeader, error: headerErr } = await supabaseAdmin
    .from("po_headers")
    .select("*")
    .eq("id", poHeaderId)
    .single();

  if (headerErr || !poHeader) {
    console.error("[shipments/from-po] headerErr:", headerErr);
    throw new Error("PO header 를 찾을 수 없습니다.");
  }

  // 2) PO Lines
  const { data: poLines, error: lineErr } = await supabaseAdmin
    .from("po_lines")
    .select("*")
    .eq("po_header_id", poHeaderId)
    .order("line_no", { ascending: true });

  if (lineErr) {
    console.error("[shipments/from-po] lineErr:", lineErr);
    throw new Error("PO line 데이터를 불러오는 중 오류가 발생했습니다.");
  }

  const poLineIds = (poLines ?? []).map((l: any) => l.id);

  // 3) 기존 Shipment 에서 이미 출고된 수량 합계
  let shippedMap: Record<string, number> = {};
  if (poLineIds.length > 0) {
    const { data: shippedLines, error: shippedErr } = await supabaseAdmin
      .from("shipment_lines")
      .select("po_line_id, shipped_qty")
      .in("po_line_id", poLineIds);

    if (shippedErr) {
      console.error("[shipments/from-po] shippedErr:", shippedErr);
      throw new Error("기존 Shipment 라인 조회 중 오류가 발생했습니다.");
    }

    shippedMap = (shippedLines || []).reduce(
      (acc: Record<string, number>, row: any) => {
        const key = row.po_line_id;
        const qty = safeNumber(row.shipped_qty);
        acc[key] = (acc[key] || 0) + qty;
        return acc;
      },
      {}
    );
  }

  // 4) Shipment 화면용 헤더
  const shipmentHeader = {
    po_header_id: poHeader.id,
    po_no: poHeader.po_no ?? null,
    buyer_id: poHeader.buyer_id ?? null,
    buyer_name: poHeader.buyer_name ?? null,
    currency: poHeader.currency ?? null,
    incoterm: poHeader.incoterm ?? null,
    payment_term: poHeader.payment_term ?? null,
    shipping_origin_code: poHeader.shipping_origin_code ?? null,
    destination: poHeader.destination ?? null,
    order_date: poHeader.order_date ?? null,
    delivery_date: poHeader.delivery_date ?? null,
  };

  // 5) 남은 수량(= 주문수량 - 이미 선적된 수량) 이 있는 라인만 구성
  const shipmentLines =
    poLines
      ?.map((line: any) => {
        const orderedQty = safeNumber(line.order_qty);
        const shippedSoFar = shippedMap[line.id] || 0;
        const remaining = Math.max(orderedQty - shippedSoFar, 0);

        // 이미 전량 선적된 스타일은 제외
        if (remaining <= 0) return null;

        const unitPrice = safeNumber(line.unit_price);
        const amount = remaining * unitPrice;

        return {
          po_line_id: line.id,
          po_header_id: line.po_header_id,
          line_no: line.line_no,
          style_no: line.style_no,
          description: line.description,
          color: line.color ?? null,
          size: line.size ?? null,
          // 이번 선적에 사용 가능한 "남은 수량"
          order_qty: remaining,
          // 기본값: 남은 수량 전량 선적 (사용자가 줄이거나 0으로 만들어서 제외 가능)
          shipped_qty: remaining,
          unit_price: unitPrice,
          amount,
          // Shipment용 기본값
          cartons: 0,
          gw: 0,
          nw: 0,
          // 참고용 (UI에서 보여만 줄 수 있음)
          ordered_total_qty: orderedQty,
          shipped_so_far: shippedSoFar,
        };
      })
      .filter(Boolean) ?? [];

  return {
    poHeader,
    poLines,
    shipmentHeader,
    shipmentLines,
  };
}

// =======================
// POST /api/shipments/from-po
// body: { poHeaderId: string }
// =======================

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const poHeaderId =
      body?.poHeaderId ??
      body?.po_header_id ??
      body?.poId ??
      body?.po_id ??
      null;

    if (!poHeaderId || typeof poHeaderId !== "string") {
      return errorResponse("poHeaderId 가 필요합니다.", 400);
    }

    const data = await loadPoForShipment(poHeaderId);
    return okResponse(data);
  } catch (err: any) {
    console.error("[shipments/from-po] POST error:", err);
    return errorResponse(err.message || "알 수 없는 오류가 발생했습니다.", 500);
  }
}

// =======================
// (옵션) GET /api/shipments/from-po?poHeaderId=...
// =======================

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const poHeaderId =
      searchParams.get("poHeaderId") ||
      searchParams.get("po_header_id") ||
      searchParams.get("poId") ||
      searchParams.get("po_id");

    if (!poHeaderId) {
      return errorResponse("poHeaderId 쿼리 파라미터가 필요합니다.", 400);
    }

    const data = await loadPoForShipment(poHeaderId);
    return okResponse(data);
  } catch (err: any) {
    console.error("[shipments/from-po] GET error:", err);
    return errorResponse(err.message || "알 수 없는 오류가 발생했습니다.", 500);
  }
}
