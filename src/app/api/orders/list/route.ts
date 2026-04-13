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

type SortField =
  | "NONE"
  | "REQ_SHIP_DATE"
  | "BRAND"
  | "ORDER_DATE"
  | "PO_NO"
  | "BUYER"
  | "SHIP_MODE"
  | "SUBTOTAL";

type SortDir = "ASC" | "DESC";
type ComputedPoStatus = "OPEN" | "PARTIAL" | "ALLOCATED" | "SHIPPED";

const COMPUTED_STATUS_SET = new Set<ComputedPoStatus>([
  "OPEN",
  "PARTIAL",
  "ALLOCATED",
  "SHIPPED",
]);

const EXCLUDED_SHIPMENT_STATUSES = new Set(["CANCELLED", "CANCELED", "DELETED"]);

/**
 * IMPORTANT:
 * - These statuses count as physically/logically shipped-complete for PO List status.
 * - If your business wants CONFIRMED to still be "allocated" rather than "shipped",
 *   remove CONFIRMED from this set.
 */
const SHIPPED_COMPLETE_SHIPMENT_STATUSES = new Set([
  "SHIPPED",
  "CONFIRMED",
  "CLOSED",
  "DELIVERED",
  "INVOICED",
]);

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
  if (v === null || v === undefined) return fallback;

  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return fallback;
    const cleaned = s.replace(/[$,]/g, "");
    const num = Number(cleaned);
    return Number.isFinite(num) ? num : fallback;
  }

  const num = Number(v);
  return Number.isFinite(num) ? num : fallback;
}

function toCents(v: any) {
  const num = n(v, 0);
  return Math.round(num * 100);
}

function fromCents(cents: number) {
  return cents / 100;
}

function normalizeDateOnly(v: any) {
  const s = asText(v).trim();
  if (!s) return "";
  return s.slice(0, 10);
}

function addOneDay(dateText: string) {
  const s = normalizeDateOnly(dateText);
  if (!s) return "";
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function normStr(v: any) {
  return asText(v).trim().toUpperCase();
}
function normDate(v: any, dir: SortDir) {
  const s = asText(v).trim();
  if (!s) return dir === "ASC" ? "9999-12-31" : "0000-01-01";
  return s.slice(0, 10);
}
function cmp(a: any, b: any) {
  return a < b ? -1 : a > b ? 1 : 0;
}
function cmpWithDir<T>(a: T, b: T, dir: SortDir) {
  const c = cmp(a, b);
  return dir === "ASC" ? c : -c;
}
function getSortValue(it: any, field: SortField, dir: SortDir) {
  switch (field) {
    case "REQ_SHIP_DATE":
      return normDate(it.reqShipDate ?? it.requestedShipDate, dir);
    case "ORDER_DATE":
      return normDate(it.orderDate, dir);
    case "BRAND":
      return normStr(it.mainBuyerBrand ?? it.brand ?? it.buyerBrandName);
    case "BUYER":
      return normStr(it.buyerName);
    case "PO_NO":
      return normStr(it.poNo);
    case "SHIP_MODE":
      return normStr(it.shipMode);
    case "SUBTOTAL":
      return n(it.subtotal, 0);
    case "NONE":
    default:
      return null;
  }
}
function multiSortItems(
  items: any[],
  s1f: SortField,
  s1d: SortDir,
  s2f: SortField,
  s2d: SortDir,
  s3f: SortField,
  s3d: SortDir
) {
  const arr = [...items];
  arr.sort((A, B) => {
    const fields: Array<[SortField, SortDir]> = [
      [s1f, s1d],
      [s2f, s2d],
      [s3f, s3d],
      ["PO_NO", "ASC"],
    ];

    for (const [f, d] of fields) {
      if (f === "NONE") continue;
      const av = getSortValue(A, f, d);
      const bv = getSortValue(B, f, d);

      if (f === "SUBTOTAL") {
        const c = cmpWithDir(Number(av ?? 0), Number(bv ?? 0), d);
        if (c !== 0) return c;
      } else {
        const c = cmpWithDir(String(av ?? ""), String(bv ?? ""), d);
        if (c !== 0) return c;
      }
    }
    return 0;
  });
  return arr;
}

// ---- image helpers ----
function firstNonEmptyString(arr: any[]): string | null {
  for (const v of arr) {
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

function asStringArray(v: any): string[] {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return [];
    if (s.startsWith("[") && s.endsWith("]")) {
      try {
        const j = JSON.parse(s);
        if (Array.isArray(j)) return j.map((x) => String(x).trim()).filter(Boolean);
      } catch {}
    }
    if (s.includes(",")) return s.split(",").map((x) => x.trim()).filter(Boolean);
    return [s];
  }
  try {
    const s = JSON.stringify(v);
    if (s && s.startsWith("[") && s.endsWith("]")) {
      const j = JSON.parse(s);
      if (Array.isArray(j)) return j.map((x) => String(x).trim()).filter(Boolean);
    }
  } catch {}
  return [];
}

function pickLineImages(line: any, preferred: string[] | undefined): string[] {
  const fromJoin = Array.isArray(preferred) ? preferred : [];
  if (fromJoin.length > 0) return fromJoin;

  const main = firstNonEmptyString([line?.main_image_url, line?.mainImageUrl]);
  const single = firstNonEmptyString([line?.image_url, line?.imageUrl]);
  const arr = asStringArray(line?.image_urls ?? line?.imageUrls);

  const out: string[] = [];
  if (main) out.push(main);
  if (single) out.push(single);
  for (const u of arr) out.push(u);

  return uniq(out);
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
  subtotal?: number | null;
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
  image_url?: string | null;
  image_urls?: any | null;
  main_image_url?: string | null;
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
  id?: string | null;
  po_line_id: string | null;
  shipment_id: string | null;
  shipped_qty?: number | null;
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

function classifyPoStatus(args: {
  totalOrderQty: number;
  totalAllocatedQty: number;
  totalShippedQty: number;
}): ComputedPoStatus {
  const orderQty = n(args.totalOrderQty, 0);
  const allocatedQty = n(args.totalAllocatedQty, 0);
  const shippedQty = n(args.totalShippedQty, 0);

  if (orderQty <= 0) return "OPEN";
  if (shippedQty >= orderQty) return "SHIPPED";
  if (allocatedQty >= orderQty) return "ALLOCATED";
  if (allocatedQty > 0 || shippedQty > 0) return "PARTIAL";
  return "OPEN";
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    // ------------------------------------------------------------------
    // DETAIL: lines for selected PO header
    // ------------------------------------------------------------------
    const detailFor = (url.searchParams.get("detailFor") ?? "").trim();
    if (detailFor) {
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

      const linesRes = await supabaseAdmin
        .from("po_lines")
        .select(
          [
            "id",
            "po_header_id",
            "line_no",
            "buyer_style_no",
            "jm_style_no",
            "image_url",
            "image_urls",
            "main_image_url",
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

        images: pickLineImages(r, imagesByLine[r.id]),
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
    // + computed PO status: OPEN / PARTIAL / ALLOCATED / SHIPPED
    // ------------------------------------------------------------------
    const qRaw = (url.searchParams.get("q") ?? url.searchParams.get("keyword") ?? "").trim();
    const statusRaw = (url.searchParams.get("status") ?? "").trim().toUpperCase();
    const dateFrom = normalizeDateOnly(
      url.searchParams.get("dateFrom") ??
        url.searchParams.get("order_date_from") ??
        url.searchParams.get("from") ??
        ""
    );
    const dateTo = normalizeDateOnly(
      url.searchParams.get("dateTo") ??
        url.searchParams.get("order_date_to") ??
        url.searchParams.get("to") ??
        ""
    );
    const dateToExclusive = addOneDay(dateTo);
    const vendorId = (url.searchParams.get("vendor_id") ?? "").trim();
    const pendingOnly = (url.searchParams.get("pending_only") ?? "").trim().toLowerCase() === "true";
    const lateOnly = (url.searchParams.get("late_only") ?? "").trim().toLowerCase() === "true";

    const page = Math.max(1, toInt(url.searchParams.get("page") ?? "1", 1));
    const pageSize = Math.min(200, Math.max(1, toInt(url.searchParams.get("pageSize") ?? "20", 20)));

    const s1Field = (url.searchParams.get("s1Field") ?? "REQ_SHIP_DATE") as SortField;
    const s1Dir = ((url.searchParams.get("s1Dir") ?? "ASC").toUpperCase() === "DESC" ? "DESC" : "ASC") as SortDir;
    const s2Field = (url.searchParams.get("s2Field") ?? "BRAND") as SortField;
    const s2Dir = ((url.searchParams.get("s2Dir") ?? "ASC").toUpperCase() === "DESC" ? "DESC" : "ASC") as SortDir;
    const s3Field = (url.searchParams.get("s3Field") ?? "ORDER_DATE") as SortField;
    const s3Dir = ((url.searchParams.get("s3Dir") ?? "ASC").toUpperCase() === "DESC" ? "DESC" : "ASC") as SortDir;

    const computedStatusFilter = COMPUTED_STATUS_SET.has(statusRaw as ComputedPoStatus)
      ? (statusRaw as ComputedPoStatus)
      : null;
    const legacyHeaderStatusFilter =
      !computedStatusFilter &&
      statusRaw &&
      !["ALL", "ALL STATUS", "ALLSTATUSES"].includes(statusRaw)
        ? statusRaw
        : "";

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
        ].join(",")
      )
      .eq("is_deleted", false)
      .neq("status", "DELETED");

    if (legacyHeaderStatusFilter) {
      q = q.eq("status", legacyHeaderStatusFilter);
    }
    if (dateFrom) q = q.gte("order_date", dateFrom);
    if (dateToExclusive) {
      q = q.lt("order_date", dateToExclusive);
    } else if (dateTo) {
      q = q.lte("order_date", dateTo);
    }

    // NOTE:
    // Search by Buyer Style No / JM Style No cannot be handled reliably here
    // with the current po_headers-only query builder.
    // We load the alive headers first (already filtered by date/status),
    // then apply the keyword filter after po_lines summary is collected below.

    const listRes = await q.order("order_date", { ascending: false, nullsFirst: false });

    if (listRes.error) return bad(listRes.error.message || "Failed to load PO list", 500);

    const headerRows = ((listRes.data ?? []) as unknown as PoHeaderRow[]) || [];
    const headerIds = uniq(headerRows.map((h) => h.id).filter(Boolean));

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

    const lineSummaryByHeader: Record<
      string,
      {
        lineCount: number;
        firstLine: any | null;
        totalAmountCents: number;
        totalOrderQty: number;
        lineIds: string[];
        buyerStyleNos: string[];
        jmStyleNos: string[];
      }
    > = {};
    const lineRowById: Record<string, any> = {};

    const allPoLineIds: string[] = [];
    if (headerIds.length > 0) {
      const sumRes = await supabaseAdmin
        .from("po_lines")
        .select([
          "id",
          "po_header_id",
          "line_no",
          "buyer_style_no",
          "jm_style_no",
          "qty",
          "unit_price",
          "amount",
          "is_deleted",
          "ship_mode",
        ].join(","))
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
            (lineSummaryByHeader[hid] ||= {
              lineCount: 0,
              firstLine: null,
              totalAmountCents: 0,
              totalOrderQty: 0,
              lineIds: [],
              buyerStyleNos: [],
              jmStyleNos: [],
            });

          bucket.lineCount += 1;
          if (!bucket.firstLine) bucket.firstLine = r;

          const lineAmount =
            r.amount !== null && r.amount !== undefined
              ? n(r.amount, 0)
              : n(r.qty, 0) * n(r.unit_price, 0);

          bucket.totalAmountCents += toCents(lineAmount);
          bucket.totalOrderQty += n(r.qty, 0);
          if (r.id) {
            bucket.lineIds.push(r.id);
            allPoLineIds.push(r.id);
            lineRowById[r.id] = r;
          }

          const buyerStyleNo = asText(r.buyer_style_no).trim();
          const jmStyleNo = asText(r.jm_style_no).trim();

          if (buyerStyleNo) bucket.buyerStyleNos.push(buyerStyleNo);
          if (jmStyleNo) bucket.jmStyleNos.push(jmStyleNo);
        }
      }
    }

    let vendorMatchedHeaderIds: Set<string> | null = null;
    let vendorMatchedLineIds: Set<string> | null = null;
    if (vendorId && allPoLineIds.length > 0) {
      const wsRes = await supabaseAdmin
        .from("work_sheet_lines")
        .select(["po_line_id", "vendor_id", "is_deleted"].join(","))
        .in("po_line_id", allPoLineIds)
        .eq("vendor_id", vendorId)
        .eq("is_deleted", false);

      if (wsRes.error) return bad(wsRes.error.message || "Failed to load vendor filter rows", 500);

      vendorMatchedLineIds = new Set(
        ((wsRes.data ?? []) as any[])
          .map((r) => asText(r?.po_line_id).trim())
          .filter(Boolean)
      );

      vendorMatchedHeaderIds = new Set<string>();
      for (const [hid, s] of Object.entries(lineSummaryByHeader)) {
        const lineIds = Array.isArray((s as any)?.lineIds) ? ((s as any).lineIds as string[]) : [];
        if (lineIds.some((id) => vendorMatchedLineIds!.has(asText(id).trim()))) {
          vendorMatchedHeaderIds.add(hid);
        }
      }
    }

    const effectiveLineSummaryByHeader: typeof lineSummaryByHeader = {};

    for (const [hid, bucket] of Object.entries(lineSummaryByHeader)) {
      if (!vendorMatchedLineIds) {
        effectiveLineSummaryByHeader[hid] = bucket;
        continue;
      }

      const matchedLineRows = ((bucket.lineIds ?? []) as string[])
        .map((id) => lineRowById[id])
        .filter((r) => r && vendorMatchedLineIds!.has(asText(r.id).trim()));

      if (matchedLineRows.length === 0) continue;

      let totalAmountCents = 0;
      let totalOrderQty = 0;
      const buyerStyleNos: string[] = [];
      const jmStyleNos: string[] = [];

      for (const r of matchedLineRows) {
        const lineAmount =
          r.amount !== null && r.amount !== undefined
            ? n(r.amount, 0)
            : n(r.qty, 0) * n(r.unit_price, 0);

        totalAmountCents += toCents(lineAmount);
        totalOrderQty += n(r.qty, 0);

        const buyerStyleNo = asText(r.buyer_style_no).trim();
        const jmStyleNo = asText(r.jm_style_no).trim();

        if (buyerStyleNo) buyerStyleNos.push(buyerStyleNo);
        if (jmStyleNo) jmStyleNos.push(jmStyleNo);
      }

      effectiveLineSummaryByHeader[hid] = {
        lineCount: matchedLineRows.length,
        firstLine: matchedLineRows[0] ?? null,
        totalAmountCents,
        totalOrderQty,
        lineIds: matchedLineRows.map((r) => r.id).filter(Boolean),
        buyerStyleNos: uniq(buyerStyleNos),
        jmStyleNos: uniq(jmStyleNos),
      };
    }

    const allocQtyByLineId: Record<string, number> = {};
    const shippedQtyByLineId: Record<string, number> = {};

    if (allPoLineIds.length > 0) {
      const sLineRes = await supabaseAdmin
        .from("shipment_lines")
        .select(["id", "po_line_id", "shipment_id", "shipped_qty", "is_deleted"].join(","))
        .in("po_line_id", uniq(allPoLineIds))
        .eq("is_deleted", false);

      if (!sLineRes.error) {
        const sLines = ((sLineRes.data ?? []) as unknown as ShipmentLineRow[]) || [];
        const shipmentIds = uniq(sLines.map((r) => r.shipment_id).filter(Boolean)) as string[];

        let shipmentById: Record<string, ShipmentRow> = {};
        if (shipmentIds.length > 0) {
          const shipRes = await supabaseAdmin
            .from("shipments")
            .select(["id", "shipment_no", "status", "is_deleted"].join(","))
            .in("id", shipmentIds)
            .eq("is_deleted", false);

          if (!shipRes.error) {
            const ships = ((shipRes.data ?? []) as unknown as ShipmentRow[]) || [];
            for (const sh of ships) {
              shipmentById[sh.id] = sh;
            }
          }
        }

        for (const sl of sLines) {
          const lineId = sl.po_line_id;
          const shipmentId = sl.shipment_id;
          if (!lineId || !shipmentId) continue;

          const sh = shipmentById[shipmentId];
          if (!sh) continue;
          const shStatus = asText(sh.status).trim().toUpperCase();

          if (EXCLUDED_SHIPMENT_STATUSES.has(shStatus)) continue;

          const qty = n(sl.shipped_qty, 0);
          allocQtyByLineId[lineId] = (allocQtyByLineId[lineId] ?? 0) + qty;

          if (SHIPPED_COMPLETE_SHIPMENT_STATUSES.has(shStatus)) {
            shippedQtyByLineId[lineId] = (shippedQtyByLineId[lineId] ?? 0) + qty;
          }
        }
      }
    }

    const itemsAll = headerRows.map((h) => {
      const s = effectiveLineSummaryByHeader[h.id] ?? lineSummaryByHeader[h.id] ?? {
        lineCount: 0,
        firstLine: null,
        totalAmountCents: 0,
        totalOrderQty: 0,
        lineIds: [],
        buyerStyleNos: [],
        jmStyleNos: [],
      };

      const fl = s.firstLine;
      const brandName =
        asText(h.buyer_brand_name) ||
        (h.buyer_brand_id ? asText(brandNameById[h.buyer_brand_id]) : "") ||
        "";

      const lineSubtotalCents = s.lineCount > 0 ? s.totalAmountCents : 0;
      const computedSubtotal = fromCents(lineSubtotalCents);

      let allocatedQty = 0;
      let shippedQty = 0;
      for (const lineId of s.lineIds) {
        allocatedQty += allocQtyByLineId[lineId] ?? 0;
        shippedQty += shippedQtyByLineId[lineId] ?? 0;
      }

      const computedStatus = classifyPoStatus({
        totalOrderQty: s.totalOrderQty,
        totalAllocatedQty: allocatedQty,
        totalShippedQty: shippedQty,
      });

      return {
        id: h.id,
        poNo: h.po_no,
        buyerId: h.buyer_id,
        buyerName: h.buyer_name,

        brand: brandName || null,
        buyerBrandName: brandName || null,

        buyerDeptName: h.buyer_dept_name,
        orderDate: h.order_date,
        reqShipDate: h.requested_ship_date ?? null,

        currency: h.currency,
        subtotal: computedSubtotal,
        amount: computedSubtotal,

        status: computedStatus,
        rawHeaderStatus: h.status ?? null,

        shipMode: h.ship_mode ?? fl?.ship_mode ?? null,
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
        allBuyerStyleNos: uniq((s.buyerStyleNos ?? []).filter(Boolean)),
        allJmStyleNos: uniq((s.jmStyleNos ?? []).filter(Boolean)),
        mainQty: fl?.qty ?? null,
        mainUnitPrice: fl?.unit_price ?? null,
        mainAmount: fl?.amount ?? null,

        totals: {
          orderQty: s.totalOrderQty,
          allocatedQty,
          shippedQty,
          remainingQty: Math.max(0, s.totalOrderQty - allocatedQty),
        },
      };
    });

    let itemsBase = itemsAll;
    if (vendorMatchedHeaderIds !== null) {
      itemsBase = itemsAll.filter((it) => vendorMatchedHeaderIds!.has(asText(it.id).trim()));
    }

    if (pendingOnly) {
      itemsBase = itemsBase.filter(
  (it) => n(it.totals.orderQty, 0) - n(it.totals.shippedQty, 0) > 0
);
    }

    if (lateOnly) {
      const today = new Date().toISOString().slice(0, 10);
      itemsBase = itemsBase.filter((it) => {
        const pendingQty = n(it.totals.orderQty, 0) - n(it.totals.shippedQty, 0);
        const reqShipDate = asText(it.reqShipDate).trim().slice(0, 10);
        return pendingQty > 0 && !!reqShipDate && reqShipDate < today;
      });
    }

    const qNorm = qRaw.trim().toLowerCase();
    const itemsKeywordFiltered = qNorm
      ? itemsBase.filter((it) => {
          const haystacks = [
            asText(it.poNo),
            asText(it.buyerName),
            asText(it.destination),
            asText(it.buyerBrandName),
            asText(it.mainBuyerStyleNo),
            asText(it.mainJmStyleNo),
            ...((it.allBuyerStyleNos as string[]) ?? []),
            ...((it.allJmStyleNos as string[]) ?? []),
          ];

          return haystacks.some((v) => asText(v).toLowerCase().includes(qNorm));
        })
      : itemsBase;

    const itemsFiltered = computedStatusFilter
      ? itemsKeywordFiltered.filter((it) => it.status === computedStatusFilter)
      : itemsKeywordFiltered;

    const itemsSorted = multiSortItems(
      itemsFiltered,
      s1Field,
      s1Dir,
      s2Field,
      s2Dir,
      s3Field,
      s3Dir
    );

    const count = itemsSorted.length;
    const from = (page - 1) * pageSize;
    const to = from + pageSize;
    const items = itemsSorted.slice(from, to);

    const pageTotalsByCurrencyCents: Record<string, number> = {};
    for (const it of items) {
      const cur = asText(it.currency).trim() || "";
      const vCents = toCents((it as any).subtotal);
      pageTotalsByCurrencyCents[cur] = (pageTotalsByCurrencyCents[cur] ?? 0) + vCents;
    }
    const pageSubtotal = fromCents(Object.values(pageTotalsByCurrencyCents).reduce((a, b) => a + (b ?? 0), 0));
    const pageTotalsByCurrency: Record<string, number> = {};
    for (const [cur, cents] of Object.entries(pageTotalsByCurrencyCents)) {
      pageTotalsByCurrency[cur] = fromCents(cents ?? 0);
    }

    const grandTotalsByCurrencyCents: Record<string, number> = {};
    for (const it of itemsFiltered) {
      const cur = asText(it.currency).trim() || "";
      grandTotalsByCurrencyCents[cur] = (grandTotalsByCurrencyCents[cur] ?? 0) + toCents(it.subtotal);
    }
    const grandTotal = fromCents(
      Object.values(grandTotalsByCurrencyCents).reduce((a, b) => a + (b ?? 0), 0)
    );
    const grandTotalsByCurrency: Record<string, number> = {};
    for (const [cur, cents] of Object.entries(grandTotalsByCurrencyCents)) {
      grandTotalsByCurrency[cur] = fromCents(cents ?? 0);
    }

    return ok({
      items,
      page,
      pageSize,
      total: count,
      pageSubtotal,
      pageTotalsByCurrency,
      grandTotal,
      grandTotalsByCurrency,
      appliedVendorId: vendorId || null,
      appliedPendingOnly: pendingOnly,
      appliedLateOnly: lateOnly,
      statusLogic: {
        open: "No non-cancelled shipment allocation exists",
        partial: "Allocated qty > 0 but allocated qty < order qty",
        allocated: "Allocated qty >= order qty but shipped-complete qty < order qty",
        shipped: "Shipped-complete qty >= order qty",
        excludedShipmentStatuses: Array.from(EXCLUDED_SHIPMENT_STATUSES),
        shippedCompleteShipmentStatuses: Array.from(SHIPPED_COMPLETE_SHIPMENT_STATUSES),
      },
    });

  } catch (err: any) {
    return bad(err?.message || "Unknown error", 500);
  }
}
