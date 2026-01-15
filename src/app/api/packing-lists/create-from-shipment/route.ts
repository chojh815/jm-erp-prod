// src/app/api/packing-lists/create-from-shipment/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}
function bad(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isUuid(v: string) {
  return UUID_RE.test(v);
}

function n(v: any, fallback = 0) {
  if (v === null || v === undefined || v === "") return fallback;
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function notDeletedOrNull(q: any, col = "is_deleted") {
  // ✅ is_deleted가 null인 기존 데이터도 “살아있는 데이터”로 취급
  return q.or(`${col}.is.null,${col}.eq.false`);
}

function derivePackingListNoFromInvoiceNo(invoiceNo: string) {
  // invoice: JMI-LDC-25-0001  -> PL-LDC-25-0001
  // invoice: JMI-251234       -> PL-251234
  if (!invoiceNo) return null;
  if (invoiceNo.startsWith("JMI-")) return invoiceNo.replace(/^JMI-/, "PL-");
  return `PL-${invoiceNo}`;
}

function safeText(v: any) {
  return (v ?? "").toString().trim();
}

/**
 * ✅ Shipment에 연결된 Invoice 찾기 (긴 버전)
 * 우선순위:
 * 1) invoice_shipments 테이블이 있으면: shipment_id -> invoice_id -> invoice_headers
 * 2) fallback: invoice_headers.shipment_id = shipmentId (예전 스키마 호환)
 */
async function findInvoiceByShipmentId(shipmentId: string) {
  let invoice: any = null;

  // 1) invoice_shipments 우선
  try {
    let linkQ = supabaseAdmin
      .from("invoice_shipments")
      .select("invoice_id, is_deleted")
      .eq("shipment_id", shipmentId);

    linkQ = notDeletedOrNull(linkQ);

    const { data: link, error: linkErr } = await linkQ.maybeSingle();
    if (linkErr) throw new Error(linkErr.message);

    const invId = link?.invoice_id ?? null;
    if (invId && isUuid(String(invId))) {
      let invQ = supabaseAdmin
        .from("invoice_headers")
        .select("id, invoice_no, invoice_date, is_deleted")
        .eq("id", invId);

      invQ = notDeletedOrNull(invQ);

      const { data: invRow, error: invErr } = await invQ.maybeSingle();
      if (invErr) throw new Error(invErr.message);

      if (invRow?.id) invoice = invRow;
    }
  } catch (e) {
    // invoice_shipments가 없거나 구조가 다르면 여기서 실패할 수 있음 → fallback 진행
    console.warn("findInvoiceByShipmentId: invoice_shipments path failed:", e);
  }

  // 2) fallback: invoice_headers.shipment_id
  if (!invoice) {
    let invQ2 = supabaseAdmin
      .from("invoice_headers")
      .select("id, invoice_no, invoice_date, is_deleted")
      .eq("shipment_id", shipmentId);

    invQ2 = notDeletedOrNull(invQ2);

    const { data: invRow2, error: invErr2 } = await invQ2.maybeSingle();
    if (invErr2) throw new Error(invErr2.message);

    if (invRow2?.id) invoice = invRow2;
  }

  return invoice;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const shipmentId = body?.shipmentId;
    if (!shipmentId || !isUuid(shipmentId)) return bad("Invalid shipmentId", 400);

    // ------------------------------------------------------------
    // 0) 이미 PL 있으면 재사용 (중복 생성 방지)
    //    ✅ 단, 기존 PL의 invoice_id/no가 비어 있으면 여기서 같이 백필
    // ------------------------------------------------------------
    {
      let q = supabaseAdmin
        .from("packing_list_headers")
        .select("*")
        .eq("shipment_id", shipmentId);
      q = notDeletedOrNull(q);

      const { data: existing, error } = await q.maybeSingle();
      if (error) throw new Error(error.message);

      if (existing?.id) {
        // ✅ invoice_id/no 누락된 기존 데이터 백필
        const needBackfill =
          (existing.invoice_id == null || safeText(existing.invoice_id) === "") ||
          (existing.invoice_no == null || safeText(existing.invoice_no) === "");

        if (needBackfill) {
          const invoice = await findInvoiceByShipmentId(shipmentId).catch(() => null);
          if (invoice?.id && safeText(invoice?.invoice_no)) {
            await supabaseAdmin
              .from("packing_list_headers")
              .update({
                invoice_id: invoice.id,
                invoice_no: safeText(invoice.invoice_no),
                updated_at: new Date().toISOString(),
              })
              .eq("id", existing.id);

            // response에도 반영
            existing.invoice_id = invoice.id;
            existing.invoice_no = safeText(invoice.invoice_no);
          }
        }

        let lq = supabaseAdmin
          .from("packing_list_lines")
          .select("*")
          .eq("packing_list_id", existing.id);
        lq = notDeletedOrNull(lq);

        const { data: lines, error: lerr } = await lq.order("created_at", {
          ascending: true,
        });
        if (lerr) throw new Error(lerr.message);

        return ok({
          reused: true,
          packingListId: existing.id,
          header: existing,
          lines: lines || [],
        });
      }
    }

    // ------------------------------------------------------------
    // 1) shipment 조회
    // ------------------------------------------------------------
    let shQ = supabaseAdmin.from("shipments").select("*").eq("id", shipmentId);
    shQ = notDeletedOrNull(shQ);

    const { data: shipment, error: shErr } = await shQ.maybeSingle();
    if (shErr) throw new Error(shErr.message);
    if (!shipment) return bad("Shipment not found", 404);

    // ------------------------------------------------------------
    // 2) invoice 조회 (PL No 파생용) - 없으면 생성 막음(정책)
    //    ✅ invoice_shipments 우선 + fallback 포함
    // ------------------------------------------------------------
    const invoice = await findInvoiceByShipmentId(shipmentId);
    if (!invoice?.invoice_no) {
      return bad("Invoice must be created first for this shipment.", 409);
    }

    const invoiceId = invoice?.id ?? null;
    const invoiceNo = String(invoice.invoice_no);
    const packingListNo = derivePackingListNoFromInvoiceNo(invoiceNo);
    if (!packingListNo) return bad("Failed to derive packing_list_no", 500);

    // ------------------------------------------------------------
    // 3) shipment_lines 조회 (네 스키마 기준!)
    // ------------------------------------------------------------
    let slQ = supabaseAdmin
      .from("shipment_lines")
      .select(
        [
          "id",
          "shipment_id",
          "po_no",
          "po_header_id",
          "po_line_id",
          "line_no",
          "style_no",
          "description",
          "color",
          "size",
          "order_qty",
          "shipped_qty",
          "cartons",
          "gw",
          "nw",
          "gw_per_ctn",
          "nw_per_ctn",
          "is_deleted",
          "created_at",
        ].join(",")
      )
      .eq("shipment_id", shipmentId);
    slQ = notDeletedOrNull(slQ);

    const { data: sLines, error: slErr } = await slQ.order("created_at", {
      ascending: true,
    });
    if (slErr) throw new Error(slErr.message);

    // ✅ Buyer Style lookup (po_line_id -> po_lines.buyer_style_no)
    const buyerStyleByPoLineId = new Map<string, string>();
    try {
      const poLineIds = Array.from(
        new Set(
          (sLines || [])
            .map((x: any) => x?.po_line_id)
            .filter((v: any) => v && typeof v === "string")
        )
      );

      if (poLineIds.length > 0) {
        const { data: poLines, error: poErr } = await supabaseAdmin
          .from("po_lines")
          .select("id, buyer_style_no")
          .in("id", poLineIds);

        if (poErr) {
          console.warn("[PL create-from-shipment] buyer_style lookup failed:", poErr);
        } else {
          (poLines || []).forEach((p: any) => {
            const bs = (p?.buyer_style_no ?? "").toString().trim();
            if (p?.id && bs) buyerStyleByPoLineId.set(p.id, bs);
          });
        }
      }
    } catch (e) {
      console.warn("[PL create-from-shipment] buyer_style lookup exception:", e);
    }

    // ------------------------------------------------------------
    // 4) header 생성 (Shipment → PL Header 복사)
    //    ✅ 핵심: invoice_id / invoice_no 저장!
    // ------------------------------------------------------------
    const { data: header, error: hErr } = await supabaseAdmin
      .from("packing_list_headers")
      .insert({
        shipment_id: shipmentId,

        // ✅✅✅ 여기 추가 (리스트 Invoice No 표시의 핵심)
        invoice_id: invoiceId ?? null,
        invoice_no: invoiceNo ?? null,

        // ✅ PL No 유지 (입력 안 받음)
        packing_list_no: packingListNo,
        packing_date: new Date().toISOString().slice(0, 10),

        buyer_id: shipment.buyer_id ?? null,
        buyer_name: shipment.buyer_name ?? null,
        buyer_code: shipment.buyer_code ?? null,

        shipper_name: shipment.shipper_name ?? null,
        shipper_address: shipment.shipper_address ?? null,

        consignee_text: shipment.consignee_text ?? null,
        notify_party_text: shipment.notify_party_text ?? null,

        shipping_origin_code: shipment.shipping_origin_code ?? null,
        port_of_loading: shipment.port_of_loading ?? null,
        destination: shipment.destination ?? null,
        final_destination: shipment.final_destination ?? null,

        etd: shipment.etd ?? null,
        eta: shipment.eta ?? null,

        // ✅ Terms/Tracking 없음. Tracking은 memo(Remarks)로 처리
        memo: shipment.memo ?? null,

        status: "DRAFT",

        // totals: 라인 복사 후 계산해서 다시 업데이트
        total_cartons: 0,
        total_gw: 0,
        total_nw: 0,

        created_by: shipment.created_by ?? null,
        created_by_email: shipment.created_by_email ?? null,
      })
      .select("*")
      .single();

    if (hErr) throw new Error(hErr.message);

    // ------------------------------------------------------------
    // 5) PL Lines 생성 (shipment_lines → packing_list_lines)
    // ------------------------------------------------------------
    const linesToInsert =
      (sLines || []).map((r: any) => {
        // ✅ qty는 shipped_qty 우선, 없으면 order_qty
        const qty = n(r.shipped_qty, NaN);
        const qty2 = Number.isFinite(qty) ? qty : n(r.order_qty, 0);

        const cartons = n(r.cartons, 0);
        const gwPer = n(r.gw_per_ctn, 0);
        const nwPer = n(r.nw_per_ctn, 0);

        // ✅ total_gw/total_nw는 shipment_lines에 gw/nw가 있으면 그걸 우선
        const totalGw = Number.isFinite(Number(r.gw)) ? n(r.gw, 0) : cartons * gwPer;
        const totalNw = Number.isFinite(Number(r.nw)) ? n(r.nw, 0) : cartons * nwPer;

        return {
          packing_list_id: header.id,

          po_no: r.po_no ?? shipment.po_no ?? null,
          // ✅ 바이어 스타일만 표시: po_line_id 기반 buyer_style_no 우선
          style_no: (buyerStyleByPoLineId.get(r.po_line_id) ?? r.style_no) ?? null,
          description: r.description ?? null,

          // carton range는 PL에서 직접 입력하는 게 맞음 → 초기 null
          carton_no_from: null,
          carton_no_to: null,

          // shipment_lines에 이미 cartons/gw/nw가 있으면 그대로 복사(완전 자동)
          cartons: r.cartons ?? null,
          qty: qty2 || null,

          // per carton도 복사
          gw_per_carton: r.gw_per_ctn ?? null,
          nw_per_carton: r.nw_per_ctn ?? null,

          // totals도 복사/계산
          total_gw: totalGw,
          total_nw: totalNw,

          is_deleted: false,
        };
      }) || [];

    let insertedLines: any[] = [];
    if (linesToInsert.length > 0) {
      const { data: plLines, error: plLErr } = await supabaseAdmin
        .from("packing_list_lines")
        .insert(linesToInsert)
        .select("*");

      if (plLErr) {
        // 라인 생성 실패 시 header도 같이 소프트삭제(정리)
        await supabaseAdmin
          .from("packing_list_headers")
          .update({ is_deleted: true, status: "DELETED" })
          .eq("id", header.id);

        throw new Error(plLErr.message);
      }

      insertedLines = plLines || [];
    }

    // ------------------------------------------------------------
    // 6) header totals 재계산해서 업데이트
    // ------------------------------------------------------------
    const sumCartons = insertedLines.reduce((acc, r) => acc + n(r.cartons, 0), 0);
    const sumGw = insertedLines.reduce((acc, r) => acc + n(r.total_gw, 0), 0);
    const sumNw = insertedLines.reduce((acc, r) => acc + n(r.total_nw, 0), 0);

    const { data: header2, error: upErr } = await supabaseAdmin
      .from("packing_list_headers")
      .update({
        total_cartons: sumCartons,
        total_gw: sumGw,
        total_nw: sumNw,
        updated_at: new Date().toISOString(),
      })
      .eq("id", header.id)
      .select("*")
      .single();

    if (upErr) throw new Error(upErr.message);

    return ok({
      reused: false,
      packingListId: header.id,
      header: header2,
      lines: insertedLines,
      invoice: {
        invoice_id: invoiceId ?? null,
        invoice_no: invoiceNo,
        invoice_date: invoice.invoice_date ?? null,
      },
      copiedShipmentLines: (sLines || []).length,
      createdPackingLines: insertedLines.length,
    });
  } catch (e: any) {
    console.error(e);
    return bad(e?.message || "Server error", 500);
  }
}
