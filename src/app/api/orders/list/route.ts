// src/app/api/orders/list/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * IMPORTANT
 * - This endpoint must NEVER be cached.
 * - Otherwise "deleted" POs can still appear in Search modal,
 *   while detail API correctly returns 404 (not found).
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonNoStore(body: any, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}

function ok(data: any = {}) {
  return jsonNoStore({ success: true, ...data }, 200);
}
function bad(message: string, status = 400) {
  return jsonNoStore({ success: false, error: message }, status);
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
function n(v: any, fallback = 0) {
  const num = Number(v);
  return Number.isFinite(num) ? num : fallback;
}

/** ---- row types (casting only) ---- */
type PoHeaderRow = {
  id: string;

  po_no?: string | null;
  buyer_id?: string | null;
  buyer_name?: string | null;

  buyer_brand_name?: string | null;
  buyer_brand_id?: string | null;
  buyer_dept_name?: string | null;

  order_date?: string | null;
  requested_ship_date?: string | null;

  currency?: string | null;
  subtotal?: number | null; // header subtotal (legacy/optional)
  status?: string | null;

  ship_mode?: string | null;
  destination?: string | null;
  origin_code?: string | null;
  shipping_origin_code?: string | null;

  payment_term?: string | null;
  payment_term_id?: string | null;

  is_deleted?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type PoLineRow = {
  id: string;
  po_header_id: string;
  line_no: number | null;
  buyer_style_no: string | null;
  jm_style_no: string | null;
  description: string | null;
  color: string | null;
  size: string | null;
  plating_color: string | null;
  hs_code: string | null;
  qty: number | null;
  uom: string | null;
  unit_price: number | null;
  amount: number | null;
  upc: string | null;
  remark: string | null;
  delivery_date: string | null;
  ship_mode: string | null;
  is_deleted: boolean | null;
  created_at: string | null;
  updated_at: string | null;
};

type PoLineImageRow = {
  po_line_id: string;
  image_url: string | null;
  sort_order: number | null;
  created_at: string | null;
  is_deleted: boolean | null;
};

type ShipmentLineRow = {
  po_line_id: string | null;
  shipment_id: string | null;
  is_deleted: boolean | null;
};

type ShipmentRow = {
  id: string;
  shipment_no: string | null;
  status: string | null;
  is_deleted: boolean | null;
};

type BuyerBrandRow = {
  id: string;
  name: string | null;
};

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    // ------------------------------------------------------------------
    // DETAIL: lines for selected PO header
    // ------------------------------------------------------------------
    const detailFor = (url.searchParams.get("detailFor") ?? "").trim();
    if (detailFor) {
      // 0) header (STRICT: must exist and not deleted)
      const hdrRes = await supabaseAdmin
        .from("po_headers")
        .select(["id", "buyer_brand_name", "requested_ship_date", "is_deleted", "status"].join(","))
        .eq("id", detailFor)
        .eq("is_deleted", false)
        .neq("status", "DELETED")
        .maybeSingle();

      if (hdrRes.error) return bad(hdrRes.error.message || "Failed to load PO header", 500);

      const hdr = hdrRes.data as PoHeaderRow | null;
      if (!hdr?.id) return bad("PO header not found (or deleted)", 404);

      const headerBrand = asText(hdr.buyer_brand_name);
      const headerReqShip = hdr.requested_ship_date ?? null;

      // 1) lines (STRICT: not deleted)
      const linesRes = await supabaseAdmin
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
            "delivery_date",
            "ship_mode",
            "is_deleted",
            "created_at",
            "updated_at",
          ].join(",")
        )
        .eq("po_header_id", detailFor)
        .eq("is_deleted", false)
        .order("line_no", { ascending: true, nullsFirst: true });

      if (linesRes.error) return bad(linesRes.error.message || "Failed to load PO lines", 500);

      const lineRows = ((linesRes.data ?? []) as unknown as PoLineRow[]) || [];
      const lineIds = uniq(lineRows.map((r) => r.id).filter(Boolean));

      // 2) images from po_line_images (best-effort)
      const imagesByLine: Record<string, string[]> = {};
      if (lineIds.length > 0) {
        const imgRes = await supabaseAdmin
          .from("po_line_images")
          .select(["po_line_id", "image_url", "sort_order", "created_at", "is_deleted"].join(","))
          .in("po_line_id", lineIds)
          .eq("is_deleted", false);

        if (!imgRes.error) {
          const imgs = ((imgRes.data ?? []) as unknown as PoLineImageRow[]) || [];
          const grouped: Record<string, PoLineImageRow[]> = {};

          for (const r of imgs) {
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
            imagesByLine[lid] = grouped[lid].map((x) => x.image_url).filter(Boolean) as string[];
          }
        }
      }

      // 3) shipment info (best-effort)
      const shipmentByLine: Record<string, { shipmentNo?: string | null; status?: string | null }> =
        {};

      if (lineIds.length > 0) {
        const sLineRes = await supabaseAdmin
          .from("shipment_lines")
          .select(["po_line_id", "shipment_id", "is_deleted"].join(","))
          .in("po_line_id", lineIds)
          .eq("is_deleted", false);

        if (!sLineRes.error) {
          const sLines = ((sLineRes.data ?? []) as unknown as ShipmentLineRow[]) || [];
          const shipmentIds = uniq(sLines.map((r) => r.shipment_id).filter(Boolean)) as string[];

          let shipmentsMap: Record<string, ShipmentRow> = {};
          if (shipmentIds.length > 0) {
            const shipRes = await supabaseAdmin
              .from("shipments")
              .select(["id", "shipment_no", "status", "is_deleted"].join(","))
              .in("id", shipmentIds)
              .eq("is_deleted", false);

            if (!shipRes.error) {
              const ships = ((shipRes.data ?? []) as unknown as ShipmentRow[]) || [];
              for (const s of ships) shipmentsMap[s.id] = s;
            }
          }

          for (const sl of sLines) {
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

      const mapped = lineRows.map((r) => ({
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
        header: {
          id: detailFor,
          brand: headerBrand || null,
          requestedShipDate: headerReqShip,
        },
        lines: mapped,
      });
    }

    // ------------------------------------------------------------------
    // LIST: headers list (STRICT: only alive rows)
    // Subtotal = SUM(po_lines.amount) by header (fallback qty*unit_price)
    // ------------------------------------------------------------------
    const qRaw = (url.searchParams.get("q") ?? url.searchParams.get("keyword") ?? "").trim();
    const statusRaw = (url.searchParams.get("status") ?? "").trim();
    const dateFrom = (url.searchParams.get("dateFrom") ?? "").trim();
    const dateTo = (url.searchParams.get("dateTo") ?? "").trim();

    const page = Math.max(1, toInt(url.searchParams.get("page") ?? "1", 1));
    const pageSize = Math.min(200, Math.max(1, toInt(url.searchParams.get("pageSize") ?? "20", 20)));

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
        { count: "exact" } as any
      )
      .eq("is_deleted", false)
      .neq("status", "DELETED");

    if (statusRaw && !["ALL", "ALL STATUS", "ALLSTATUSES"].includes(statusRaw.toUpperCase())) {
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

    const listRes = await q.order("order_date", { ascending: false, nullsFirst: false }).range(from, to);

    if (listRes.error) return bad(listRes.error.message || "Failed to load PO list", 500);

    const headerRows = ((listRes.data ?? []) as unknown as PoHeaderRow[]) || [];
    const count = (listRes as any).count ?? headerRows.length;

    const headerIds = uniq(headerRows.map((h) => h.id).filter(Boolean));

    // Optional: brand name fallback from buyer_brands (best-effort)
    const brandIdList = uniq(headerRows.map((h) => h.buyer_brand_id).filter((v) => !!v)) as string[];
    const brandNameById: Record<string, string> = {};
    if (brandIdList.length > 0) {
      const brandRes = await supabaseAdmin
        .from("buyer_brands")
        .select(["id", "name"].join(","))
        .in("id", brandIdList);

      if (!brandRes.error) {
        const brands = ((brandRes.data ?? []) as unknown as BuyerBrandRow[]) || [];
        for (const b of brands) if (b?.id) brandNameById[b.id] = b?.name ?? "";
      }
    }

    // Line summary + TOTAL AMOUNT per header (best-effort)
    const lineSummaryByHeader: Record<string, { lineCount: number; firstLine: any | null; totalAmount: number }> = {};

    if (headerIds.length > 0) {
      const sumRes = await supabaseAdmin
        .from("po_lines")
        .select(["id", "po_header_id", "line_no", "buyer_style_no", "jm_style_no", "qty", "unit_price", "amount", "is_deleted"].join(","))
        .in("po_header_id", headerIds)
        .eq("is_deleted", false)
        .order("po_header_id", { ascending: true })
        .order("line_no", { ascending: true, nullsFirst: true });

      if (!sumRes.error) {
        const lines = (sumRes.data as any[]) ?? [];
        for (const r of lines) {
          const hid = r.po_header_id;
          if (!hid) continue;

          const bucket =
            (lineSummaryByHeader[hid] ||= { lineCount: 0, firstLine: null, totalAmount: 0 });

          bucket.lineCount += 1;
          if (!bucket.firstLine) bucket.firstLine = r;

          // amount 합계: amount 우선, 없으면 qty*unit_price
          const lineAmount =
            r.amount !== null && r.amount !== undefined
              ? n(r.amount, 0)
              : n(r.qty, 0) * n(r.unit_price, 0);

          bucket.totalAmount += lineAmount;
        }
      }
    }

    const items = headerRows.map((h) => {
      const s = lineSummaryByHeader[h.id] ?? { lineCount: 0, firstLine: null, totalAmount: 0 };
      const fl = s.firstLine;

      const brandName =
        asText(h.buyer_brand_name) ||
        (h.buyer_brand_id ? asText(brandNameById[h.buyer_brand_id]) : "") ||
        "";

      // ✅ 핵심: subtotal은 라인 합계(SUM)로 내려줌
      // 라인이 1개라도 있으면 totalAmount를 신뢰 (합계가 0이어도 정상)
      const headerSubtotal = h.subtotal !== null && h.subtotal !== undefined ? n(h.subtotal, 0) : 0;
      const computedSubtotal = s.lineCount > 0 ? n(s.totalAmount, 0) : headerSubtotal;

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

        // ✅ PO List 화면의 "Subtotal" 컬럼은 이 값을 쓰면 됨
        subtotal: computedSubtotal,

        // ✅ Search modal/기타에서도 혼선 방지 위해 동일 값
        amount: computedSubtotal,

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

    return ok({ items, page, pageSize, total: count });
  } catch (err: any) {
    return bad(err?.message || "Unknown error", 500);
  }
}
