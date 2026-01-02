// src/app/api/orders/list/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * PO List + Line Details API (A안: 폴더 구조 유지)
 *
 * ✅ Fixes
 * - po_headers.req_ship_date ❌ (your DB doesn't have it) → use requested_ship_date ✅
 * - po_lines.images ❌ (your DB doesn't have it) → build images[] from po_line_images ✅
 *
 * ✅ Also adds
 * - Line details include delivery_date, ship_mode from po_lines ✅
 * - Line details include brand (from po_headers.buyer_brand_name) ✅
 * - Line details include shipment info (best-effort) ✅
 *
 * ✅ NEW (중요)
 * - Soft delete / DELETED 상태는 리스트/라인에서 확실히 제외:
 *   (is_deleted=false OR is_deleted IS NULL) AND (status != 'DELETED' OR status IS NULL)
 *
 * Query:
 * - list:   /api/orders/list?q=...&status=...&dateFrom=...&dateTo=...&page=1&pageSize=20
 * - detail: /api/orders/list?detailFor=<po_header_id>
 */
function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}
function bad(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}
function toInt(v: any, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function asText(v: any) {
  if (v === null || v === undefined) return "";
  return String(v);
}
function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

// ✅ (is_deleted=false OR is_deleted IS NULL)
const NOT_DELETED_OR_NULL = "is_deleted.is.null,is_deleted.eq.false";
// ✅ (status != 'DELETED' OR status IS NULL)
const NOT_STATUS_DELETED_OR_NULL = "status.is.null,status.neq.DELETED";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    // ------------------------------------------------------------------
    // DETAIL: lines for selected PO header
    // ------------------------------------------------------------------
    const detailFor = (url.searchParams.get("detailFor") ?? "").trim();
    if (detailFor) {
      // 0) header (for Brand + Requested Ship Date)
      const { data: hdr, error: hdrErr } = await supabaseAdmin
        .from("po_headers")
        .select(["id", "buyer_brand_name", "requested_ship_date", "is_deleted", "status"].join(","))
        .eq("id", detailFor)
        // ✅ header도 soft delete/DELETED면 detail도 막는게 안전
        .or(NOT_DELETED_OR_NULL)
        .or(NOT_STATUS_DELETED_OR_NULL)
        .maybeSingle();

      if (hdrErr) {
        return bad(hdrErr.message || "Failed to load PO header", 500);
      }
      if (!hdr?.id) {
        return bad("PO header not found (or deleted)", 404);
      }

      const headerBrand = asText(hdr?.buyer_brand_name);
      const headerReqShip = hdr?.requested_ship_date ?? null;

      // 1) lines (NO images column)
      const { data: lines, error } = await supabaseAdmin
        .from("po_lines")
        .select(
          [
            "id",
            "po_header_id",
            "line_no",
            "buyer_style_no",
            "jm_style_no",
            "description",
            "color",
            "size",
            "plating_color",
            "hs_code",
            "qty",
            "uom",
            "unit_price",
            "amount",
            "upc",
            "remark",
            // ✅ your DB line columns
            "delivery_date",
            "ship_mode",
            "is_deleted",
            "created_at",
            "updated_at",
          ].join(",")
        )
        .eq("po_header_id", detailFor)
        // ✅ 라인도 is_deleted=false OR null
        .or(NOT_DELETED_OR_NULL)
        .order("line_no", { ascending: true, nullsFirst: true });

      if (error) return bad(error.message || "Failed to load PO lines", 500);

      const lineRows = lines ?? [];
      const lineIds = uniq(lineRows.map((r: any) => r.id).filter(Boolean));

      // 2) images from po_line_images
      const imagesByLine: Record<string, string[]> = {};
      if (lineIds.length > 0) {
        const { data: imgs, error: imgErr } = await supabaseAdmin
          .from("po_line_images")
          .select(["po_line_id", "image_url", "sort_order", "created_at", "is_deleted"].join(","))
          .in("po_line_id", lineIds)
          .or(NOT_DELETED_OR_NULL);

        if (!imgErr) {
          const grouped: Record<string, any[]> = {};
          for (const r of imgs ?? []) {
            const lid = r.po_line_id;
            if (!lid) continue;
            (grouped[lid] ||= []).push(r);
          }
          for (const lid of Object.keys(grouped)) {
            grouped[lid].sort((a, b) => {
              const ao = a.sort_order ?? 0;
              const bo = b.sort_order ?? 0;
              if (ao !== bo) return ao - bo;
              const at = a.created_at ? Date.parse(a.created_at) : 0;
              const bt = b.created_at ? Date.parse(b.created_at) : 0;
              return at - bt;
            });
            imagesByLine[lid] = grouped[lid].map((x) => x.image_url).filter(Boolean);
          }
        }
      }

      // 3) shipment info (best-effort)
      const shipmentByLine: Record<string, { shipmentNo?: string | null; status?: string | null }> = {};
      if (lineIds.length > 0) {
        const { data: sLines, error: sLineErr } = await supabaseAdmin
          .from("shipment_lines")
          .select(["po_line_id", "shipment_id", "is_deleted"].join(","))
          .in("po_line_id", lineIds)
          .or(NOT_DELETED_OR_NULL);

        if (!sLineErr && (sLines?.length ?? 0) > 0) {
          const shipmentIds = uniq(sLines!.map((r: any) => r.shipment_id).filter(Boolean));

          let shipmentsMap: Record<string, any> = {};
          if (shipmentIds.length > 0) {
            const { data: ships, error: shipErr } = await supabaseAdmin
              .from("shipments")
              .select(["id", "shipment_no", "status", "is_deleted"].join(","))
              .in("id", shipmentIds)
              .or(NOT_DELETED_OR_NULL);

            if (!shipErr) {
              for (const s of ships ?? []) shipmentsMap[s.id] = s;
            }
          }

          for (const sl of sLines ?? []) {
            const lid = sl.po_line_id;
            const sid = sl.shipment_id;
            if (!lid || !sid) continue;
            const sh = shipmentsMap[sid];
            shipmentByLine[lid] = {
              shipmentNo: sh?.shipment_no ?? null,
              status: sh?.status ?? null,
            };
          }
        }
      }

      const mapped = lineRows.map((r: any) => ({
        id: r.id,
        poHeaderId: r.po_header_id,
        lineNo: r.line_no,
        buyerStyleNo: r.buyer_style_no,
        jmStyleNo: r.jm_style_no,
        description: r.description,
        color: r.color,
        size: r.size,
        platingColor: r.plating_color,
        hsCode: r.hs_code,
        qty: r.qty,
        uom: r.uom,
        unitPrice: r.unit_price,
        amount: r.amount,
        upc: r.upc,
        remark: r.remark,

        brand: headerBrand || null,
        requestedShipDate: headerReqShip,
        deliveryDate: r.delivery_date ?? null,
        shipMode: r.ship_mode ?? null,
        shipmentNo: shipmentByLine[r.id]?.shipmentNo ?? null,
        shipmentStatus: shipmentByLine[r.id]?.status ?? null,

        images: imagesByLine[r.id] ?? [],
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));

      return ok({
        header: { id: detailFor, brand: headerBrand || null, requestedShipDate: headerReqShip },
        lines: mapped,
      });
    }

    // ------------------------------------------------------------------
    // LIST: headers list
    // ------------------------------------------------------------------
    const qRaw =
      (url.searchParams.get("q") ??
        url.searchParams.get("keyword") ??
        "").trim();

    const statusRaw = (url.searchParams.get("status") ?? "").trim();
    const dateFrom = (url.searchParams.get("dateFrom") ?? "").trim();
    const dateTo = (url.searchParams.get("dateTo") ?? "").trim();

    const page = Math.max(1, toInt(url.searchParams.get("page") ?? "1", 1));
    const pageSize = Math.min(
      200,
      Math.max(1, toInt(url.searchParams.get("pageSize") ?? "20", 20))
    );

    let q = supabaseAdmin
      .from("po_headers")
      .select(
        [
          "id",
          "po_no",
          "buyer_id",
          "buyer_name",
          "buyer_brand_name",
          "buyer_brand_id",
          "buyer_dept_name",
          "order_date",
          "requested_ship_date",
          "currency",
          "subtotal",
          "status",
          "ship_mode",
          "destination",
          "origin_code",
          "shipping_origin_code",
          "payment_term",
          "payment_term_id",
          "is_deleted",
          "created_at",
          "updated_at",
        ].join(","),
        { count: "exact" }
      )
      // ✅ 핵심: deleted/DELETED는 확실히 제외(= NULL도 정상 노출)
      .or(NOT_DELETED_OR_NULL)
      .or(NOT_STATUS_DELETED_OR_NULL);

    if (
      statusRaw &&
      !["ALL", "ALL STATUS", "ALLSTATUSES"].includes(statusRaw.toUpperCase())
    ) {
      q = q.eq("status", statusRaw);
    }
    if (dateFrom) q = q.gte("order_date", dateFrom);
    if (dateTo) q = q.lte("order_date", dateTo);

    if (qRaw) {
      const kw = qRaw.replace(/%/g, "\\%").replace(/,/g, "");
      const like = `%${kw}%`;
      q = q.or(
        [
          `po_no.ilike.${like}`,
          `buyer_name.ilike.${like}`,
          `destination.ilike.${like}`,
          `buyer_brand_name.ilike.${like}`,
        ].join(",")
      );
    }

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const { data: headers, error, count } = await q
      .order("order_date", { ascending: false, nullsFirst: false })
      .range(from, to);

    if (error) return bad(error.message || "Failed to load PO list", 500);

    const headerRows = headers ?? [];
    const headerIds = uniq(headerRows.map((h: any) => h.id).filter(Boolean));

    // Optional: brand name fallback from buyer_brands
    const brandIdList = uniq(
      headerRows.map((h: any) => h.buyer_brand_id).filter((v: any) => !!v)
    );

    const brandNameById: Record<string, string> = {};
    if (brandIdList.length > 0) {
      const { data: brands, error: brandErr } = await supabaseAdmin
        .from("buyer_brands")
        .select(["id", "name"].join(","))
        .in("id", brandIdList);

      if (!brandErr) {
        for (const b of brands ?? []) {
          if (b?.id) brandNameById[b.id] = b?.name ?? "";
        }
      }
    }

    // First-line summary
    const lineSummaryByHeader: Record<string, { lineCount: number; firstLine: any | null }> = {};
    if (headerIds.length > 0) {
      const { data: lines, error: lineErr } = await supabaseAdmin
        .from("po_lines")
        .select(
          ["id", "po_header_id", "line_no", "buyer_style_no", "jm_style_no", "qty", "unit_price", "amount", "is_deleted"].join(",")
        )
        .in("po_header_id", headerIds)
        // ✅ 라인도 soft delete 제외 (NULL 포함)
        .or(NOT_DELETED_OR_NULL)
        .order("po_header_id", { ascending: true })
        .order("line_no", { ascending: true, nullsFirst: true });

      if (!lineErr) {
        for (const r of lines ?? []) {
          const hid = r.po_header_id;
          if (!hid) continue;
          (lineSummaryByHeader[hid] ||= { lineCount: 0, firstLine: null });
          lineSummaryByHeader[hid].lineCount += 1;
          if (!lineSummaryByHeader[hid].firstLine) lineSummaryByHeader[hid].firstLine = r;
        }
      }
    }

    const items = headerRows.map((h: any) => {
      const s = lineSummaryByHeader[h.id] ?? { lineCount: 0, firstLine: null };
      const fl = s.firstLine;

      const brandName =
        asText(h.buyer_brand_name) ||
        (h.buyer_brand_id ? asText(brandNameById[h.buyer_brand_id]) : "") ||
        "";

      return {
        id: h.id,
        poNo: h.po_no,
        buyerId: h.buyer_id,
        buyerName: h.buyer_name,

        brand: brandName || null,
        buyerBrandName: brandName || null,

        buyerDeptName: h.buyer_dept_name,
        orderDate: h.order_date,
        requestedShipDate: h.requested_ship_date ?? null,
        currency: h.currency,
        subtotal: h.subtotal,
        status: h.status,

        shipMode: h.ship_mode,
        destination: h.destination,
        originCode: h.origin_code,
        shippingOriginCode: h.shipping_origin_code,
        paymentTerm: h.payment_term,
        paymentTermId: h.payment_term_id,
        createdAt: h.created_at,
        updatedAt: h.updated_at,

        lineCount: s.lineCount,
        mainBuyerStyleNo: fl?.buyer_style_no ?? null,
        mainJmStyleNo: fl?.jm_style_no ?? null,
        mainQty: fl?.qty ?? null,
        mainUnitPrice: fl?.unit_price ?? null,
        mainAmount: fl?.amount ?? null,
      };
    });

    return ok({ items, page, pageSize, total: count ?? items.length });
  } catch (err: any) {
    return bad(err?.message || "Unknown error", 500);
  }
}
