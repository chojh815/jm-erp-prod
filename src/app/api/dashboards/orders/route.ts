// src/app/api/dashboards/orders/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/**
 * Orders Dashboard API
 *
 * ✅ IMPORTANT (Alignment)
 * - Orders / In Production / Ready  : PO(Status) 기반 (po_headers + po_lines.amount)
 * - Shipped                         : Shipment → Invoice 기반 (Overview KPI와 동일 정의)
 *   = 선택 기간 내 Shipments(선적일 기준) 에 연결된 invoice_headers 합계
 *
 * Query
 *  - start=YYYY-MM-DD
 *  - end=YYYY-MM-DD
 *  - buyer_ids=ALL | csv( uuid list OR buyer_name list )
 *  - buyer= (legacy alias)
 *  - site_ids=ALL | csv( uuid list OR origin_code list )
 *  - site= (legacy alias)
 */

function isUuidLike(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    s
  );
}

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

function ym(d: string) {
  return (d || "").slice(0, 7);
}

function safeUpper(v: any) {
  return (v ?? "").toString().trim().toUpperCase();
}

function pickAmountUSD(r: any) {
  const cands = [
    "total_amount_usd",
    "total_usd",
    "grand_total_usd",
    "amount_usd",
    "total_amount",
    "total",
    "grand_total",
    "amount",
  ];
  for (const k of cands) {
    const n = Number(r?.[k]);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

async function detectDateColumn(
  supabase: any,
  table: string,
  candidates: string[]
): Promise<string | null> {
  for (const col of candidates) {
    const { error } = await supabase.from(table).select(col).limit(1);
    if (!error) return col;
    // If it's not a "column not found" error, stop early (permissions etc.)
    const msg = (error.message || "").toLowerCase();
    if (!msg.includes("column") && !msg.includes("does not exist")) return null;
  }
  return null;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const start =
      searchParams.get("start") ??
      new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);

    const end = searchParams.get("end") ?? new Date().toISOString().slice(0, 10);

    // Buyer filters (buyer_ids preferred; buyer legacy alias)
    const buyerIdsRaw = (searchParams.get("buyer_ids") ?? "").trim();
    const buyerLegacyRaw = (searchParams.get("buyer") ?? "").trim();
    const buyerRaw =
      buyerIdsRaw && buyerIdsRaw.toUpperCase() !== "ALL" ? buyerIdsRaw : buyerLegacyRaw;

    const buyerList = buyerRaw
      ? buyerRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    const buyerUuidList = buyerList.filter(isUuidLike);
    const buyerNameList = buyerList.filter((x) => !isUuidLike(x));

    // Site filters (site_ids preferred; site legacy alias)
    const siteIdsRaw = (searchParams.get("site_ids") ?? "").trim();
    const siteLegacyRaw = (searchParams.get("site") ?? "").trim();
    const siteRaw =
      siteIdsRaw && siteIdsRaw.toUpperCase() !== "ALL" ? siteIdsRaw : siteLegacyRaw;

    const siteList = siteRaw
      ? siteRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    const siteUuidList = siteList.filter(isUuidLike);
    const siteCodeList = siteList.filter((x) => !isUuidLike(x));

    const supabase = createClient();

    /**
     * 1) Headers: 기간 + (soft delete 제외) + (buyer/site 필터)
     *    - po_headers: order_date, buyer_id/buyer_name, origin_id/origin_code, status, is_deleted
     */
    let headersQuery = supabase
      .from("po_headers")
      .select("id, po_no, buyer_id, buyer_name, order_date, status, origin_id, origin_code, is_deleted")
      .gte("order_date", start)
      .lte("order_date", end)
      .eq("is_deleted", false);

    if (buyerUuidList.length > 0) {
      headersQuery = headersQuery.in("buyer_id", buyerUuidList);
    } else if (buyerNameList.length > 0) {
      headersQuery = headersQuery.in("buyer_name", buyerNameList);
    }

    if (siteUuidList.length > 0) {
      headersQuery = headersQuery.in("origin_id", siteUuidList);
    } else if (siteCodeList.length > 0) {
      headersQuery = headersQuery.in("origin_code", siteCodeList);
    }

    const { data: headers, error: he } = await headersQuery;

    if (he) {
      return NextResponse.json({ ok: false, message: he.message }, { status: 500 });
    }

    const headerRows = headers ?? [];
    const headerIds = headerRows.map((h: any) => h.id);

    // Buyer list for UI (기간+필터 기준 header에서 추출)
    const buyers = uniq(
      headerRows
        .map((h: any) => (h.buyer_name ?? "").trim())
        .filter(Boolean)
    ).sort((a: string, b: string) => a.localeCompare(b));

    // If no headers, still compute shipped (shipment/invoice) because shipped can exist even if no PO orders in range?
    // But to keep existing behavior consistent, we'll return zeros if no headers AND no shipped.
    // We'll compute shipped independently below.

    /**
     * 2) Lines: po_lines에서 해당 headerIds 라인 금액(USD)을 집계 (amount)
     */
    let lineRows: { id: string; po_header_id: string; amount: number }[] = [];
    if (headerIds.length > 0) {
      const { data: lines, error: le } = await supabase
        .from("po_lines")
        .select("id, po_header_id, amount")
        .in("po_header_id", headerIds);

      if (le) {
        return NextResponse.json({ ok: false, message: le.message }, { status: 500 });
      }

      lineRows = (lines ?? []).map((r: any) => ({
        id: r.id,
        po_header_id: r.po_header_id,
        amount: Number(r.amount) || 0,
      }));
    }

    const headerById = new Map<string, any>();
    for (const h of headerRows) headerById.set(h.id, h);

    // ---- Aggregations (PO-based) ----
    let totalUSD = 0;

    const statusSum: Record<string, number> = {};
    const statusPoSet: Record<string, Set<string>> = {};

    const monthlySum: Record<string, number> = {};

    const buyerSum: Record<string, number> = {};
    const buyerPoSet: Record<string, Set<string>> = {};

    const PRODUCTION_SET = new Set(["IN_PRODUCTION", "PRODUCTION"]);
    const READY_SET = new Set(["READY"]);

    let productionUSD = 0;
    let productionLineCount = 0;

    let readyUSD = 0;
    const readyPoIds = new Set<string>();

    for (const ln of lineRows) {
      const h = headerById.get(ln.po_header_id);
      if (!h) continue;

      const st = safeUpper(h.status || "UNKNOWN");
      const buyerName = (h.buyer_name ?? "UNKNOWN").toString().trim() || "UNKNOWN";
      const d = (h.order_date ?? end).toString();

      totalUSD += ln.amount;

      statusSum[st] = (statusSum[st] ?? 0) + ln.amount;
      statusPoSet[st] = statusPoSet[st] ?? new Set<string>();
      statusPoSet[st].add(h.id);

      const m = ym(d);
      monthlySum[m] = (monthlySum[m] ?? 0) + ln.amount;

      buyerSum[buyerName] = (buyerSum[buyerName] ?? 0) + ln.amount;
      buyerPoSet[buyerName] = buyerPoSet[buyerName] ?? new Set<string>();
      buyerPoSet[buyerName].add(h.id);

      if (PRODUCTION_SET.has(st)) {
        productionUSD += ln.amount;
        productionLineCount += 1;
      }
      if (READY_SET.has(st)) {
        readyUSD += ln.amount;
        readyPoIds.add(h.id);
      }
    }

    // monthly rows with cumulative
    const months = Object.keys(monthlySum).sort((a, b) => a.localeCompare(b));
    let running = 0;
    const monthly = months.map((m) => {
      const amt = monthlySum[m] ?? 0;
      running += amt;
      return { month: m, amount_usd: amt, cumulative_usd: running };
    });

    // status rows
    const status = Object.entries(statusSum)
      .map(([status, amount]) => ({ status, amount_usd: amount }))
      .sort((a, b) => b.amount_usd - a.amount_usd);

    // buyer breakdown top 20
    const buyer_breakdown = Object.entries(buyerSum)
      .map(([buyer, amount]) => ({
        buyer,
        amount_usd: amount,
        pos: buyerPoSet[buyer]?.size ?? 0,
      }))
      .sort((a, b) => b.amount_usd - a.amount_usd)
      .slice(0, 20);

        /**
     * 3) Shipped (Invoice Date 기준, Alignment with Performance/Home rule)
     *    - 선택 기간 내 invoice_headers (invoice_date 기준) 합계
     *    - Shipments count = 해당 invoices에서 shipment_id distinct 개수
     */
    let shippedUSD = 0;
    let shippedShipmentsCount = 0;
    let shippedMeta: {
      invoice_date_col: string | null;
      shipped_invoices: number;
      shipments: number;
    } = {
      invoice_date_col: null,
      shipped_invoices: 0,
      shipments: 0,
    };

    const invoiceDateCol = await detectDateColumn(supabase, "invoice_headers", [
      "invoice_date",
      "date",
      "created_at",
      "updated_at",
    ]);
    shippedMeta.invoice_date_col = invoiceDateCol;

    let invRowsForShip: any[] = [];
    if (invoiceDateCol) {
      let invQ = supabase
        .from("invoice_headers")
        .select("*")
        .gte(invoiceDateCol, start)
        .lte(invoiceDateCol, end);

      const { data: invD, error: invE } = await invQ;
      if (!invE) invRowsForShip = invD ?? [];
    }

    // soft-delete filter (best effort)
    invRowsForShip = invRowsForShip.filter(
      (r: any) => r?.is_deleted === undefined || r?.is_deleted === false
    );

    // buyer filter
    if (buyerUuidList.length > 0) {
      invRowsForShip = invRowsForShip.filter((r: any) =>
        buyerUuidList.includes((r?.buyer_id ?? "").toString())
      );
    } else if (buyerNameList.length > 0) {
      invRowsForShip = invRowsForShip.filter((r: any) =>
        buyerNameList.includes((r?.buyer_name ?? "").toString())
      );
    }

    // site filter (best effort: origin_id/origin_code/ship_from_site_id/ship_from_code)
    if (siteUuidList.length > 0) {
      invRowsForShip = invRowsForShip.filter((r: any) => {
        const sid = (r?.origin_id ?? r?.ship_from_site_id ?? r?.ship_from_id ?? "").toString();
        return siteUuidList.includes(sid);
      });
    } else if (siteCodeList.length > 0) {
      invRowsForShip = invRowsForShip.filter((r: any) => {
        const sc = (r?.origin_code ?? r?.ship_from_code ?? "").toString();
        return siteCodeList.includes(sc);
      });
    }

    shippedUSD = invRowsForShip.reduce((s: number, r: any) => s + pickAmountUSD(r), 0);
    shippedMeta.shipped_invoices = invRowsForShip.length;

    const shipmentIdsForShip = Array.from(
      new Set(invRowsForShip.map((r: any) => r?.shipment_id).filter(Boolean))
    );
    shippedShipmentsCount = shipmentIdsForShip.length;
    shippedMeta.shipments = shippedShipmentsCount;

    // KPI (delta_pct는 아직 null)
    const kpis = [
      {
        key: "orders",
        label: "Orders",
        value_usd: totalUSD,
        delta_pct: null,
        sub_label: "POs",
        sub_value: String(headerIds.length),
      },
      {
        key: "production",
        label: "In Production",
        value_usd: productionUSD,
        delta_pct: null,
        sub_label: "Lines",
        sub_value: String(productionLineCount),
      },
      {
        key: "ready",
        label: "Ready",
        value_usd: readyUSD,
        delta_pct: null,
        sub_label: "POs",
        sub_value: String(readyPoIds.size),
      },
      {
        key: "shipped",
        label: "Shipped",
        value_usd: shippedUSD,
        delta_pct: null,
        sub_label: "Shipments",
        sub_value: String(shippedShipmentsCount),
      },
    ];

    return NextResponse.json({
      ok: true,
      filters_echo: {
        start,
        end,
        buyer_ids:
          buyerIdsRaw?.toUpperCase() === "ALL"
            ? "ALL"
            : buyerIdsRaw || buyerLegacyRaw || "ALL",
        site_ids:
          siteIdsRaw?.toUpperCase() === "ALL"
            ? "ALL"
            : siteIdsRaw || siteLegacyRaw || "ALL",
      },
      meta: {
        date_col_used: "order_date",
        usd_line_col_used: "amount",
        rows_headers: headerRows.length,
        rows_lines: lineRows.length,
        shipped: shippedMeta,
        note: null,
      },
      buyers,
      kpis,
      monthly,
      status,
      buyer_breakdown,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, message: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
