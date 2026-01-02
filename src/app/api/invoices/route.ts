// src/app/api/invoices/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// =======================
// 공통 응답 헬퍼
// =======================
function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}
function fail(message: string, status = 400, extra?: any) {
  return NextResponse.json(
    { success: false, error: message, ...(extra || {}) },
    { status }
  );
}

// =======================
// 안전 변환
// =======================
function safeNumber(v: any, fallback = 0) {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  if (Number.isNaN(n)) return fallback;
  return n;
}
function safeString(v: any, fallback: string | null = null) {
  if (v === null || v === undefined) return fallback;
  const s = String(v).trim();
  return s === "" ? fallback : s;
}

// =======================
// 번호 생성 (간단 버전)
// =======================
function pad(n: number, len: number) {
  return String(n).padStart(len, "0");
}

function makeInvoiceNo() {
  // INV-YYYYMMDD-HHMMSS
  const d = new Date();
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1, 2);
  const day = pad(d.getDate(), 2);
  const hh = pad(d.getHours(), 2);
  const mm = pad(d.getMinutes(), 2);
  const ss = pad(d.getSeconds(), 2);
  return `INV-${y}${m}${day}-${hh}${mm}${ss}`;
}

function makeShipmentNo() {
  // SHP-YYYYMMDD-HHMMSS
  const d = new Date();
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1, 2);
  const day = pad(d.getDate(), 2);
  const hh = pad(d.getHours(), 2);
  const mm = pad(d.getMinutes(), 2);
  const ss = pad(d.getSeconds(), 2);
  return `SHP-${y}${m}${day}-${hh}${mm}${ss}`;
}

// =======================
// POST /api/invoices
//  - invoice_headers 저장
//  - invoice_lines 저장 (invoice_header_id로 연결, invoice_no 컬럼 사용 X)
//  - shipment 자동 생성 (옵션)
// =======================
export async function POST(req: Request) {
  try {
    const body = await req.json();

    const invoiceHeader = body?.invoiceHeader ?? null;
    const invoiceLines = body?.invoiceLines ?? [];
    const createShipment = body?.createShipment ?? true; // 기본 true

    if (!invoiceHeader) return fail("invoiceHeader is required", 400);
    if (!Array.isArray(invoiceLines) || invoiceLines.length === 0) {
      return fail("invoiceLines must be a non-empty array", 400);
    }

    // qty > 0만 저장하도록 마지막 방어
    const effectiveLines = invoiceLines
      .map((l: any) => ({
        ...l,
        qty: safeNumber(l?.qty, 0),
        unit_price: safeNumber(l?.unit_price, 0),
        amount:
          l?.amount !== null && l?.amount !== undefined
            ? safeNumber(l?.amount, 0)
            : safeNumber(l?.qty, 0) * safeNumber(l?.unit_price, 0),
      }))
      .filter((l: any) => safeNumber(l.qty, 0) > 0);

    if (effectiveLines.length === 0) {
      return fail("All invoice lines have qty=0. Nothing to save.", 400);
    }

    // =========================
    // 1) Invoice Header 저장
    // =========================
    const invoice_no = makeInvoiceNo();

    const headerRow: any = {
      invoice_no,

      buyer_id: safeString(invoiceHeader?.buyer_id),
      buyer_name: safeString(invoiceHeader?.buyer_name),

      bill_to: safeString(invoiceHeader?.bill_to),
      ship_to: safeString(invoiceHeader?.ship_to),

      currency: safeString(invoiceHeader?.currency),

      incoterm: safeString(invoiceHeader?.incoterm),
      payment_term: safeString(invoiceHeader?.payment_term),

      shipping_origin_code: safeString(invoiceHeader?.shipping_origin_code),
      destination: safeString(invoiceHeader?.destination),

      // PO에는 없고 Invoice에서만 의미 있음 (당신이 말한 정책 그대로)
      etd: safeString(invoiceHeader?.etd),
      eta: safeString(invoiceHeader?.eta),

      status: safeString(invoiceHeader?.status, "DRAFT"),

      total_amount: safeNumber(invoiceHeader?.total_amount, 0),

      memo: safeString(invoiceHeader?.memo),
    };

    // insert + return
    const { data: headerInserted, error: headerErr } = await supabaseAdmin
      .from("invoice_headers")
      .insert(headerRow)
      .select("id, invoice_no")
      .single();

    if (headerErr) {
      console.error("[api/invoices] header insert error:", headerErr);
      return fail(headerErr.message || "Failed to insert invoice header", 500, {
        detail: headerErr,
      });
    }

    const invoiceHeaderId = headerInserted?.id;
    if (!invoiceHeaderId) {
      return fail("Failed to get invoice header id after insert", 500);
    }

    // =========================
    // 2) Invoice Lines 저장
    //  - !!! invoice_no 컬럼 절대 넣지 말 것 !!!
    // =========================
    const lineRows = effectiveLines.map((l: any, idx: number) => ({
      invoice_header_id: invoiceHeaderId, // ✅ 핵심
      line_no: safeNumber(l?.line_no, idx + 1),

      po_header_id: safeString(l?.po_header_id),
      po_line_id: safeString(l?.po_line_id),
      po_no: safeString(l?.po_no),

      style_no: safeString(l?.style_no),
      description: safeString(l?.description),

      qty: safeNumber(l?.qty, 0),
      unit_price: safeNumber(l?.unit_price, 0),
      amount: safeNumber(l?.amount, 0),

      // ⛔️ cartons/gw/nw/color/size 등은 인보이스에서 제거하기로 했으니 넣지 않음
    }));

    const { error: linesErr } = await supabaseAdmin
      .from("invoice_lines")
      .insert(lineRows);

    if (linesErr) {
      console.error("[api/invoices] lines insert error:", linesErr);
      return fail(linesErr.message || "Failed to insert invoice lines", 500, {
        detail: linesErr,
      });
    }

    // =========================
    // 3) Shipment 자동 생성 (원하면)
    // =========================
    let shipment_no: string | null = null;

    if (createShipment) {
      shipment_no = makeShipmentNo();

      const shipmentHeaderRow: any = {
        shipment_no,

        // invoice 기반으로 링크
        invoice_header_id: invoiceHeaderId,
        invoice_no,

        buyer_id: safeString(invoiceHeader?.buyer_id),
        buyer_name: safeString(invoiceHeader?.buyer_name),
        currency: safeString(invoiceHeader?.currency),

        incoterm: safeString(invoiceHeader?.incoterm),
        payment_term: safeString(invoiceHeader?.payment_term),
        shipping_origin_code: safeString(invoiceHeader?.shipping_origin_code),
        destination: safeString(invoiceHeader?.destination),

        etd: safeString(invoiceHeader?.etd),
        eta: safeString(invoiceHeader?.eta),

        status: "DRAFT",

        // Packing List에서 입력할 거라 0으로 시작
        total_cartons: 0,
        total_gw: 0,
        total_nw: 0,
      };

      const { data: shpInserted, error: shpErr } = await supabaseAdmin
        .from("shipment_headers")
        .insert(shipmentHeaderRow)
        .select("id, shipment_no")
        .single();

      if (shpErr) {
        console.error("[api/invoices] shipment header insert error:", shpErr);
        // Invoice는 저장됐으니 shipment 생성 실패만 알려주고 끝낼 수도 있음
        return ok({
          invoice_no,
          shipment_no: null,
          warning: `Invoice saved, but shipment creation failed: ${shpErr.message}`,
        });
      }

      const shipmentHeaderId = shpInserted?.id;

      // shipment_lines는 qty 기반으로 생성 (cartons/gw/nw는 packing list에서 채움)
      const shipmentLineRows = effectiveLines.map((l: any, idx: number) => ({
        shipment_header_id: shipmentHeaderId,
        line_no: safeNumber(l?.line_no, idx + 1),

        po_header_id: safeString(l?.po_header_id),
        po_line_id: safeString(l?.po_line_id),
        po_no: safeString(l?.po_no),

        style_no: safeString(l?.style_no),
        description: safeString(l?.description),

        shipped_qty: safeNumber(l?.qty, 0),
        unit_price: safeNumber(l?.unit_price, 0),
        amount: safeNumber(l?.amount, 0),

        cartons: 0,
        gw: 0,
        nw: 0,
      }));

      const { error: shpLinesErr } = await supabaseAdmin
        .from("shipment_lines")
        .insert(shipmentLineRows);

      if (shpLinesErr) {
        console.error("[api/invoices] shipment lines insert error:", shpLinesErr);
        return ok({
          invoice_no,
          shipment_no: shpInserted?.shipment_no ?? shipment_no,
          warning: `Invoice saved, shipment header created, but shipment lines failed: ${shpLinesErr.message}`,
        });
      }

      shipment_no = shpInserted?.shipment_no ?? shipment_no;
    }

    return ok({
      invoice_no,
      shipment_no,
      invoice_header_id: invoiceHeaderId,
    });
  } catch (err: any) {
    console.error("[api/invoices] unexpected error:", err);
    return fail(err?.message || "Unexpected error", 500);
  }
}
