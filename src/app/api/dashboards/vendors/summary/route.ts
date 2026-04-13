import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
  "Surrogate-Control": "no-store",
};

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data }, { headers: NO_STORE_HEADERS });
}
function bad(message: string, status = 400) {
  return NextResponse.json(
    { success: false, error: message },
    { status, headers: NO_STORE_HEADERS }
  );
}

function safeText(v: any) {
  return (v ?? "").toString().trim();
}
function safeNum(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function pct(numerator: number, denominator: number) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return (numerator / denominator) * 100;
}
function toBool(v: string | null) {
  const s = safeText(v).toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "y";
}

type VendorPerfRow = {
  vendor_id: string | null;
  vendor_name: string | null;
  vendor_code?: string | null;

  po_no?: string | null;
  buyer_id?: string | null;
  buyer_name?: string | null;
  brand?: string | null;

  jm_style_no?: string | null;
  buyer_style_no?: string | null;
  description?: string | null;

  order_date?: string | null;
  requested_ship_date?: string | null;
  vendor_due_date?: string | null;
  vendor_ready_date?: string | null;
  vendor_delivery_status?: string | null;
  vendor_delay_days?: number | null;

  ordered_qty?: number | null;
  shipped_qty?: number | null;
  pending_qty?: number | null;

  buyer_revenue?: number | null;
  unit_price?: number | null;

  vendor_currency?: string | null;
  fx_rate?: number | null;
  vendor_unit_cost_local?: number | null;
  planned_vendor_cost_local?: number | null;
  planned_vendor_cost_usd?: number | null;

  actual_fx_rate?: number | null;
  actual_vendor_unit_cost_local?: number | null;
  actual_vendor_cost_local?: number | null;
  actual_vendor_cost_usd?: number | null;

  planned_margin?: number | null;
  planned_margin_pct?: number | null;
  actual_margin?: number | null;
  actual_margin_pct?: number | null;

  production_mode?: string | null;
  actual_cost_confirmed?: boolean | null;
};

function buildBaseQuery() {
  return supabaseAdmin
    .from("v_vendor_performance")
    .select("*")
    .order("vendor_name", { ascending: true })
    .order("po_no", { ascending: true })
    .order("requested_ship_date", { ascending: true, nullsFirst: false });
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const dateFrom = safeText(url.searchParams.get("date_from"));
    const dateTo = safeText(url.searchParams.get("date_to"));
    const vendorId = safeText(url.searchParams.get("vendor_id"));
    const buyerId = safeText(url.searchParams.get("buyer_id"));
    const brand = safeText(url.searchParams.get("brand"));
    const productionMode = safeText(url.searchParams.get("production_mode"));
    const pendingOnly = toBool(url.searchParams.get("pending_only"));
    const lateOnly = toBool(url.searchParams.get("late_only"));

    let qb: any = buildBaseQuery();

    if (dateFrom) qb = qb.gte("requested_ship_date", dateFrom);
    if (dateTo) qb = qb.lte("requested_ship_date", dateTo);
    if (vendorId) qb = qb.eq("vendor_id", vendorId);
    if (buyerId) qb = qb.eq("buyer_id", buyerId);
    if (brand) qb = qb.ilike("brand", `%${brand}%`);
    if (productionMode) qb = qb.eq("production_mode", productionMode);
    if (pendingOnly) qb = qb.gt("pending_qty", 0);
    if (lateOnly) qb = qb.eq("vendor_delivery_status", "LATE");

    const { data, error } = await qb;
    if (error) return bad(error.message, 500);

    const rows = (Array.isArray(data) ? data : []) as VendorPerfRow[];

    const byVendor = new Map<string, any>();

    for (const r of rows) {
      const vendorIdKey = safeText(r.vendor_id) || "__NO_VENDOR__";
      const vendorName = safeText(r.vendor_name) || "(No Vendor)";
      const vendorCode = safeText((r as any).vendor_code) || null;

      if (!byVendor.has(vendorIdKey)) {
        byVendor.set(vendorIdKey, {
          vendor_id: r.vendor_id ?? null,
          vendor_name: vendorName,
          vendor_code: vendorCode,

          line_count: 0,
          po_count_set: new Set<string>(),
          buyer_count_set: new Set<string>(),

          ordered_qty: 0,
          shipped_qty: 0,
          pending_qty: 0,

          buyer_revenue: 0,
          planned_vendor_cost_usd: 0,
          actual_vendor_cost_usd: 0,

          planned_margin: 0,
          actual_margin: 0,

          completed_delivery_count: 0,
          on_time_count: 0,
          late_count: 0,
          pending_delivery_count: 0,

          delay_sum: 0,
          delay_count: 0,
          worst_delay_days: null as number | null,
        });
      }

      const a = byVendor.get(vendorIdKey);
      a.line_count += 1;

      if (safeText(r.po_no)) a.po_count_set.add(safeText(r.po_no));
      if (safeText(r.buyer_id)) a.buyer_count_set.add(safeText(r.buyer_id));

      a.ordered_qty += safeNum(r.ordered_qty);
      a.shipped_qty += safeNum(r.shipped_qty);
      a.pending_qty += safeNum(r.pending_qty);

      a.buyer_revenue += safeNum(r.buyer_revenue);
      a.planned_vendor_cost_usd += safeNum(r.planned_vendor_cost_usd);
      a.actual_vendor_cost_usd += safeNum(r.actual_vendor_cost_usd);

      a.planned_margin += safeNum(r.planned_margin);
      a.actual_margin += safeNum(r.actual_margin);

      const ds = safeText(r.vendor_delivery_status).toUpperCase();
      if (ds == "PENDING" || !safeText(r.vendor_ready_date)) {
        a.pending_delivery_count += 1;
      } else {
        a.completed_delivery_count += 1;
        if (ds == "ON_TIME") a.on_time_count += 1;
        if (ds == "LATE") a.late_count += 1;
      }

      const dd = r.vendor_delay_days;
      if (dd !== null && dd !== undefined && Number.isFinite(Number(dd))) {
        a.delay_sum += Number(dd);
        a.delay_count += 1;
        if (a.worst_delay_days === null || Number(dd) > a.worst_delay_days) {
          a.worst_delay_days = Number(dd);
        }
      }
    }

    const summaryRows = Array.from(byVendor.values()).map((a) => {
      const plannedMarginPct = pct(a.planned_margin, a.buyer_revenue);
      const actualMarginPct = pct(a.actual_margin, a.buyer_revenue);
      const otdPct = pct(a.on_time_count, a.completed_delivery_count);
      const avgDelayDays = a.delay_count > 0 ? a.delay_sum / a.delay_count : null;

      return {
        vendor_id: a.vendor_id,
        vendor_name: a.vendor_name,
        vendor_code: a.vendor_code,

        line_count: a.line_count,
        po_count: a.po_count_set.size,
        buyer_count: a.buyer_count_set.size,

        ordered_qty: a.ordered_qty,
        shipped_qty: a.shipped_qty,
        pending_qty: a.pending_qty,

        buyer_revenue: a.buyer_revenue,
        planned_vendor_cost_usd: a.planned_vendor_cost_usd,
        actual_vendor_cost_usd: a.actual_vendor_cost_usd,

        planned_margin: a.planned_margin,
        planned_margin_pct: plannedMarginPct,
        actual_margin: a.actual_margin,
        actual_margin_pct: actualMarginPct,

        completed_delivery_count: a.completed_delivery_count,
        on_time_count: a.on_time_count,
        late_count: a.late_count,
        pending_delivery_count: a.pending_delivery_count,

        otd_pct: otdPct,
        avg_delay_days: avgDelayDays,
        worst_delay_days: a.worst_delay_days,
      };
    });

    summaryRows.sort((x, y) => {
      const byRevenue = safeNum(y.buyer_revenue) - safeNum(x.buyer_revenue);
      if (byRevenue !== 0) return byRevenue;
      return safeText(x.vendor_name).localeCompare(safeText(y.vendor_name));
    });

    const totalBuyerRevenue = summaryRows.reduce((s, r) => s + safeNum(r.buyer_revenue), 0);
    const totalPlannedMargin = summaryRows.reduce((s, r) => s + safeNum(r.planned_margin), 0);
    const totalActualMargin = summaryRows.reduce((s, r) => s + safeNum(r.actual_margin), 0);
    const totalCompletedDelivery = summaryRows.reduce((s, r) => s + safeNum(r.completed_delivery_count), 0);
    const totalOnTime = summaryRows.reduce((s, r) => s + safeNum(r.on_time_count), 0);

    const kpis = {
      active_vendors: summaryRows.length,
      total_ordered_qty: summaryRows.reduce((s, r) => s + safeNum(r.ordered_qty), 0),
      total_shipped_qty: summaryRows.reduce((s, r) => s + safeNum(r.shipped_qty), 0),
      total_pending_qty: summaryRows.reduce((s, r) => s + safeNum(r.pending_qty), 0),

      total_buyer_revenue: totalBuyerRevenue,
      total_planned_vendor_cost_usd: summaryRows.reduce((s, r) => s + safeNum(r.planned_vendor_cost_usd), 0),
      total_actual_vendor_cost_usd: summaryRows.reduce((s, r) => s + safeNum(r.actual_vendor_cost_usd), 0),

      total_planned_margin: totalPlannedMargin,
      total_actual_margin: totalActualMargin,

      avg_planned_margin_pct: pct(totalPlannedMargin, totalBuyerRevenue),
      avg_actual_margin_pct: pct(totalActualMargin, totalBuyerRevenue),

      otd_pct: pct(totalOnTime, totalCompletedDelivery),
    };

    return ok({
      filters: {
        date_from: dateFrom || null,
        date_to: dateTo || null,
        vendor_id: vendorId || null,
        buyer_id: buyerId || null,
        brand: brand || null,
        production_mode: productionMode || null,
        pending_only: pendingOnly,
        late_only: lateOnly,
      },
      kpis,
      rows: summaryRows,
      raw_count: rows.length,
    });
  } catch (e: any) {
    return bad(e?.message ?? "Server error", 500);
  }
}
