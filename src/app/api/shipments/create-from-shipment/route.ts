// src/app/api/invoices/create-from-shipment/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}
function okResponse(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}

// Invoice 번호 자동 생성기: IN + YYYYMM + 4자리 시퀀스
async function generateInvoiceNo() {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(
    2,
    "0"
  )}`;

  const prefix = `IN${ym}`;

  const { data, error } = await supabaseAdmin
    .from("invoice_headers")
    .select("invoice_no")
    .like("invoice_no", `${prefix}%`)
    .order("invoice_no", { ascending: false })
    .limit(1);

  if (error) throw new Error(error.message);

  let nextSeq = 1;
  if (data && data.length > 0) {
    const last = data[0].invoice_no;
    const num = parseInt(last.replace(prefix, ""), 10);
    nextSeq = num + 1;
  }

  return `${prefix}${String(nextSeq).padStart(4, "0")}`;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { shipmentId } = body;

    if (!shipmentId) return errorResponse("shipmentId is required.", 400);

    // 1️⃣ 이미 Invoice 연결 여부 확인
    const { data: existingLink, error: linkErr } = await supabaseAdmin
      .from("invoice_shipments")
      .select("invoice_id")
      .eq("shipment_id", shipmentId)
      .maybeSingle();

    if (linkErr)
      return errorResponse(
        "Error checking existing invoice link: " + linkErr.message,
        500
      );

    if (existingLink?.invoice_id) {
      // 이미 Invoice 만든 상태
      return okResponse({
        invoice_id: existingLink.invoice_id,
        already_exists: true,
      });
    }

    // 2️⃣ Shipment 로딩
    const { data: shipment, error: shErr } = await supabaseAdmin
      .from("shipments")
      .select("*")
      .eq("id", shipmentId)
      .maybeSingle();

    if (shErr || !shipment)
      return errorResponse("Shipment not found.", 404);

    // 3️⃣ Shipment Lines 로딩
    const { data: shLines, error: shLineErr } = await supabaseAdmin
      .from("shipment_lines")
      .select("*")
      .eq("shipment_id", shipmentId);

    if (shLineErr)
      return errorResponse("Error loading shipment lines.", 500);

    if (!shLines || shLines.length === 0)
      return errorResponse("Shipment has no lines.", 400);

    // 4️⃣ Invoice No 생성
    const invoiceNo = await generateInvoiceNo();

    // 5️⃣ Invoice Header 생성
    const headerInsert = {
      invoice_no: invoiceNo,
      buyer_id: shipment.buyer_id,
      buyer_name: shipment.buyer_name,
      bill_to: shipment.bill_to,
      ship_to: shipment.ship_to,
      currency: shipment.currency,
      incoterm: shipment.incoterm,
      payment_term: shipment.payment_term,
      destination: shipment.destination,
      shipping_origin_code: shipment.shipping_origin_code,
      etd: shipment.etd,
      eta: shipment.eta,
      status: "DRAFT",
      total_amount: shipment.total_amount ?? null,
      total_cartons: shipment.total_cartons ?? null,
      total_gw: shipment.total_gw ?? null,
      total_nw: shipment.total_nw ?? null,
      memo: shipment.memo ?? null,
    };

    const { data: newHeader, error: headerErr } = await supabaseAdmin
      .from("invoice_headers")
      .insert(headerInsert)
      .select()
      .single();

    if (headerErr)
      return errorResponse("Failed to create invoice header: " + headerErr.message, 500);

    const invoiceId = newHeader.id;

    // 6️⃣ Invoice Lines 생성
    const lineInserts = shLines.map((l) => ({
      invoice_id: invoiceId,
      shipment_id: shipmentId,
      po_line_id: l.po_line_id,
      po_header_id: l.po_header_id,
      po_no: shipment.po_no,
      line_no: l.line_no,
      style_no: l.style_no,
      description: l.description,
      color: l.color,
      size: l.size,
      qty: l.shipped_qty,
      unit_price: l.unit_price,
      amount: l.amount,
      cartons: l.cartons,
      gw: l.gw,
      nw: l.nw,
    }));

    const { error: lineErr } = await supabaseAdmin
      .from("invoice_lines")
      .insert(lineInserts);

    if (lineErr)
      return errorResponse("Failed to insert invoice lines: " + lineErr.message, 500);

    // 7️⃣ invoice_shipments 연결 생성
    const { error: linkInsertErr } = await supabaseAdmin
      .from("invoice_shipments")
      .insert({
        invoice_id: invoiceId,
        shipment_id: shipmentId,
      });

    if (linkInsertErr)
      return errorResponse(
        "Failed to create invoice_shipments link: " + linkInsertErr.message,
        500
      );

    return okResponse({
      invoice_id: invoiceId,
      invoice_no: invoiceNo,
      created: true,
    });
  } catch (err: any) {
    console.error("❌ create-from-shipment error:", err);
    return errorResponse("Unexpected server error: " + err.message, 500);
  }
}
