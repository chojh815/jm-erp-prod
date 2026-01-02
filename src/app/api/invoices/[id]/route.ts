// src/app/api/invoices/[id]/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function bad(message: string, status = 400, extra: any = {}) {
  return NextResponse.json({ success: false, error: message, ...extra }, { status });
}
function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}

function isLockedStatus(status: any) {
  return String(status || "").toUpperCase() === "CONFIRMED";
}

/**
 * shipping_origin_code -> company_sites에서 shipper(법인명/주소) 찾아오기
 * - 1번 규칙: 선적지 site의 법인명 + 주소가 Shipper/Exporter
 * - company_sites 컬럼명은 프로젝트마다 다를 수 있어 방어적으로 처리
 */
async function resolveShipperByOrigin(shippingOriginCode: string | null) {
  const code = (shippingOriginCode || "").trim();
  if (!code) return { shipper_name: null as string | null, shipper_address: null as string | null };

  // 1) company_sites에 shipping_origin_code 컬럼이 있는 케이스를 우선 지원
  //    (없으면 supabase가 error를 내므로 try/catch로 안전하게)
  try {
    const { data, error } = await supabaseAdmin
      .from("company_sites")
      .select("*")
      .eq("shipping_origin_code", code)
      .maybeSingle();

    if (!error && data) {
      const shipperName =
        (data.site_legal_name ??
          data.legal_name ??
          data.shipper_name ??
          data.name ??
          null) as string | null;

      const shipperAddress =
        (data.site_address ??
          data.address ??
          data.shipper_address ??
          null) as string | null;

      return {
        shipper_name: shipperName ? String(shipperName) : null,
        shipper_address: shipperAddress ? String(shipperAddress) : null,
      };
    }
  } catch {
    // ignore
  }

  // 2) 혹시 company_sites에 "code" 같은 컬럼으로 site를 구분하는 경우 (예: KR_SEOUL / VN_BACNINH)
  try {
    const { data, error } = await supabaseAdmin
      .from("company_sites")
      .select("*")
      .eq("code", code)
      .maybeSingle();

    if (!error && data) {
      const shipperName =
        (data.site_legal_name ??
          data.legal_name ??
          data.shipper_name ??
          data.name ??
          null) as string | null;

      const shipperAddress =
        (data.site_address ??
          data.address ??
          data.shipper_address ??
          null) as string | null;

      return {
        shipper_name: shipperName ? String(shipperName) : null,
        shipper_address: shipperAddress ? String(shipperAddress) : null,
      };
    }
  } catch {
    // ignore
  }

  // 3) 그래도 못 찾으면 null (UI/PDF에서 default를 보여주도록)
  return { shipper_name: null, shipper_address: null };
}

async function getInvoiceHeaderOr404(id: string) {
  const { data, error } = await supabaseAdmin
    .from("invoice_headers")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ?? null;
}

async function getInvoiceLines(invoiceId: string) {
  // invoice_lines는 프로젝트가 invoice_id 또는 invoice_header_id 둘 중 하나로 연결되어 있을 수 있음
  // 둘 다 OR로 가져오고 is_deleted=false만 기본 필터
  const { data, error } = await supabaseAdmin
    .from("invoice_lines")
    .select("*")
    .or(`invoice_id.eq.${invoiceId},invoice_header_id.eq.${invoiceId}`)
    .eq("is_deleted", false)
    .order("line_no", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

async function ensureShipperFields(header: any) {
  // DB에 shipper_name/address가 NULL이면 shipping_origin_code로 찾아서 채움
  const needName = !header?.shipper_name || String(header.shipper_name).trim() === "";
  const needAddr = !header?.shipper_address || String(header.shipper_address).trim() === "";

  if (!needName && !needAddr) return header;

  const origin = header?.shipping_origin_code ?? null;
  const resolved = await resolveShipperByOrigin(origin);

  return {
    ...header,
    shipper_name: needName ? resolved.shipper_name : header.shipper_name,
    shipper_address: needAddr ? resolved.shipper_address : header.shipper_address,
  };
}

/**
 * GET /api/invoices/[id]
 * - header + lines 반환
 * - shipper_name/address가 비어있으면 origin 기반으로 "응답에서는" 채워서 내려줌
 *   (※ GET에서 DB 업데이트는 하지 않음. PUT 때 저장되게 함)
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const id = params?.id;
    if (!id) return bad("Invoice ID is required", 400);

    const header = await getInvoiceHeaderOr404(id);
    if (!header || header.is_deleted) return bad("Invoice not found", 404);

    const lines = await getInvoiceLines(id);
    const patchedHeader = await ensureShipperFields(header);

    return ok({ header: patchedHeader, lines });
  } catch (e: any) {
    console.error(e);
    return bad(e?.message || "Failed to load invoice", 500);
  }
}

/**
 * PUT /api/invoices/[id]
 * body: { header: {...}, lines: [...] }
 * - CONFIRMED 잠금(409)
 * - shipper_name/address가 비어있으면 origin 기준으로 DB에 자동 세팅(1번 규칙)
 * - lines는 id 기준 update, id 없으면 insert(가능하면)
 */
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = params?.id;
    if (!id) return bad("Invoice ID is required", 400);

    const existing = await getInvoiceHeaderOr404(id);
    if (!existing || existing.is_deleted) return bad("Invoice not found", 404);

    if (isLockedStatus(existing.status)) {
      return bad("Invoice is locked (CONFIRMED). Use Revision.", 409, {
        meta: { locked: true, lock_reason: "CONFIRMED" },
      });
    }

    const body = await req.json().catch(() => null);
    if (!body) return bad("Invalid JSON body", 400);

    const incomingHeader = body.header ?? {};
    const incomingLines: any[] = Array.isArray(body.lines) ? body.lines : [];

    // shipper 자동 세팅(1번 규칙)
    // - 사용자가 shipper_name/address를 비워서 저장해도, origin 기준으로 채워서 저장
    const mergedHeader = {
      ...incomingHeader,
      // invoice_headers에 존재하는 컬럼만 업데이트하도록(안전)
      invoice_no: incomingHeader.invoice_no ?? null,
      invoice_date: incomingHeader.invoice_date ?? null,

      currency: incomingHeader.currency ?? null,
      incoterm: incomingHeader.incoterm ?? null,
      payment_term: incomingHeader.payment_term ?? null,

      destination: incomingHeader.destination ?? null,

      shipping_origin_code: incomingHeader.shipping_origin_code ?? existing.shipping_origin_code ?? null,
      port_of_loading: incomingHeader.port_of_loading ?? null,
      final_destination: incomingHeader.final_destination ?? null,
      etd: incomingHeader.etd ?? null,
      eta: incomingHeader.eta ?? null,

      remarks: incomingHeader.remarks ?? null,
      consignee_text: incomingHeader.consignee_text ?? null,
      notify_party_text: incomingHeader.notify_party_text ?? null,

      shipper_name: incomingHeader.shipper_name ?? null,
      shipper_address: incomingHeader.shipper_address ?? null,

      coo_text: incomingHeader.coo_text ?? null,

      status: incomingHeader.status ?? existing.status ?? null,
      total_amount: incomingHeader.total_amount ?? null,
    };

    // shipper_name/address가 비어있으면 origin으로 채움
    const fixedHeader = await ensureShipperFields(mergedHeader);

    // 1) header update
    {
      const { error } = await supabaseAdmin
        .from("invoice_headers")
        .update({
          invoice_no: fixedHeader.invoice_no,
          invoice_date: fixedHeader.invoice_date,

          currency: fixedHeader.currency,
          incoterm: fixedHeader.incoterm,
          payment_term: fixedHeader.payment_term,

          destination: fixedHeader.destination,

          shipping_origin_code: fixedHeader.shipping_origin_code,
          port_of_loading: fixedHeader.port_of_loading,
          final_destination: fixedHeader.final_destination,
          etd: fixedHeader.etd,
          eta: fixedHeader.eta,

          remarks: fixedHeader.remarks,
          consignee_text: fixedHeader.consignee_text,
          notify_party_text: fixedHeader.notify_party_text,

          shipper_name: fixedHeader.shipper_name,
          shipper_address: fixedHeader.shipper_address,

          coo_text: fixedHeader.coo_text,

          status: fixedHeader.status,
          total_amount: fixedHeader.total_amount,
        })
        .eq("id", id);

      if (error) return bad(error.message, 500);
    }

    // 2) lines upsert (id 있으면 update, 없으면 insert)
    for (const l of incomingLines) {
      const lineId = l?.id ? String(l.id) : null;

      const payload = {
        // 연결키는 프로젝트 상황에 따라 둘 다 세팅(안전)
        invoice_id: id,
        invoice_header_id: id,

        po_no: l.po_no ?? null,
        line_no: l.line_no ?? null,

        style_no: l.style_no ?? null,
        description: l.description ?? null,

        color: l.color ?? null,
        size: l.size ?? null,

        qty: l.qty ?? null,
        unit_price: l.unit_price ?? null,
        amount: l.amount ?? null,

        cartons: l.cartons ?? null,
        gw: l.gw ?? null,
        nw: l.nw ?? null,

        material_content: l.material_content ?? null,
        hs_code: l.hs_code ?? null,

        is_deleted: !!l.is_deleted,
      };

      if (lineId) {
        const { error } = await supabaseAdmin.from("invoice_lines").update(payload).eq("id", lineId);
        if (error) return bad(error.message, 500);
      } else {
        const { error } = await supabaseAdmin.from("invoice_lines").insert(payload);
        if (error) return bad(error.message, 500);
      }
    }

    // 3) return fresh
    const header = await getInvoiceHeaderOr404(id);
    const lines = await getInvoiceLines(id);
    const patchedHeader = await ensureShipperFields(header);

    return ok({ header: patchedHeader, lines });
  } catch (e: any) {
    console.error(e);
    return bad(e?.message || "Save failed", 500);
  }
}

/**
 * DELETE /api/invoices/[id]
 * - CONFIRMED 잠금(409)
 * - soft delete: invoice_headers.is_deleted = true, invoice_lines.is_deleted = true
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const id = params?.id;
    if (!id) return bad("Invoice ID is required", 400);

    const existing = await getInvoiceHeaderOr404(id);
    if (!existing || existing.is_deleted) return bad("Invoice not found", 404);

    if (isLockedStatus(existing.status)) {
      return bad("Invoice is locked (CONFIRMED). Use Revision.", 409, {
        meta: { locked: true, lock_reason: "CONFIRMED" },
      });
    }

    // lines soft delete
    {
      const { error } = await supabaseAdmin
        .from("invoice_lines")
        .update({ is_deleted: true })
        .or(`invoice_id.eq.${id},invoice_header_id.eq.${id}`);

      if (error) return bad(error.message, 500);
    }

    // header soft delete
    {
      const { error } = await supabaseAdmin.from("invoice_headers").update({ is_deleted: true }).eq("id", id);
      if (error) return bad(error.message, 500);
    }

    return ok({});
  } catch (e: any) {
    console.error(e);
    return bad(e?.message || "Delete failed", 500);
  }
}
