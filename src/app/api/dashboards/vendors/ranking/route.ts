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
  return NextResponse.json({ success: false, error: message }, { status, headers: NO_STORE_HEADERS });
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
  brand?: string | null;
  requested_ship_date?: string | null;
  pending_qty?: number | null;
  ordered_qty?: number | null;
  buyer_revenue?: number | null;
  planned_vendor_cost_usd?: number | null;
  planned_margin?: number | null;
  completed_delivery_count?: number | null;
  on_time_count?: number | null;
  late_count?: number | null;
  pending_delivery_count?: number | null;
  avg_delay_days?: number | null;
  worst_delay_days?: number | null;
  vendor_delay_days?: number | null;
  vendor_ready_date?: string | null;
  vendor_delivery_status?: string | null;
};

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const dateFrom = safeText(url.searchParams.get("date_from"));
    const dateTo = safeText(url.searchParams.get("date_to"));
    const buyerId = safeText(url.searchParams.get("buyer_id"));
    const brand = safeText(url.searchParams.get("brand"));
    const productionMode = safeText(url.searchParams.get("production_mode"));
    const pendingOnly = toBool(url.searchParams.get("pending_only"));
    const lateOnly = toBool(url.searchParams.get("late_only"));

    let qb: any = supabaseAdmin
      .from("v_vendor_performance")
      .select("*")
      .order("vendor_name", { ascending: true });

    if (dateFrom) qb = qb.gte("requested_ship_date", dateFrom);
    if (dateTo) qb = qb.lte("requested_ship_date", dateTo);
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
      const vendorIdKey = safeText(r.vendor_id);
      const vendorName = safeText(r.vendor_name);

      if (!vendorIdKey || !vendorName || vendorName.toLowerCase() === "(no vendor)") continue;

      if (!byVendor.has(vendorIdKey)) {
        byVendor.set(vendorIdKey, {
          vendor_id: r.vendor_id,
          vendor_name: vendorName,
          vendor_code: safeText((r as any).vendor_code) || null,
          po_count_set: new Set<string>(),
          buyer_revenue: 0,
          planned_vendor_cost_usd: 0,
          planned_margin: 0,
          ordered_qty: 0,
          pending_qty: 0,
          completed_delivery_count: 0,
          on_time_count: 0,
          late_count: 0,
          pending_delivery_count: 0,
          delay_sum: 0,
          delay_count: 0,
        });
      }

      const a = byVendor.get(vendorIdKey);
      if (safeText(r.po_no)) a.po_count_set.add(safeText(r.po_no));

      a.buyer_revenue += safeNum(r.buyer_revenue);
      a.planned_vendor_cost_usd += safeNum(r.planned_vendor_cost_usd);
      a.planned_margin += safeNum(r.planned_margin);
      a.ordered_qty += safeNum(r.ordered_qty);
      a.pending_qty += safeNum(r.pending_qty);

      a.completed_delivery_count += safeNum(r.completed_delivery_count);
      a.on_time_count += safeNum(r.on_time_count);
      a.late_count += safeNum(r.late_count);
      a.pending_delivery_count += safeNum(r.pending_delivery_count);

      const dd = r.vendor_delay_days;
      if (dd !== null && dd !== undefined && Number.isFinite(Number(dd))) {
        a.delay_sum += Number(dd);
        a.delay_count += 1;
      }
    }

    const vendors = Array.from(byVendor.values()).map((a) => {
      const pendingRevenue =
        a.ordered_qty > 0 ? (a.buyer_revenue * a.pending_qty) / a.ordered_qty : 0;
      const pendingPlannedCost =
        a.ordered_qty > 0 ? (a.planned_vendor_cost_usd * a.pending_qty) / a.ordered_qty : 0;

      return {
        vendor_id: a.vendor_id,
        vendor_name: a.vendor_name,
        vendor_code: a.vendor_code,
        po_count: a.po_count_set.size,
        buyer_revenue: a.buyer_revenue,
        planned_vendor_cost_usd: a.planned_vendor_cost_usd,
        planned_margin: a.planned_margin,
        planned_margin_pct: pct(a.planned_margin, a.buyer_revenue),
        ordered_qty: a.ordered_qty,
        pending_qty: a.pending_qty,
        pending_revenue: pendingRevenue,
        pending_planned_cost_usd: pendingPlannedCost,
        pending_planned_margin: pendingRevenue - pendingPlannedCost,
        completed_delivery_count: a.completed_delivery_count,
        on_time_count: a.on_time_count,
        late_count: a.late_count,
        pending_delivery_count: a.pending_delivery_count,
        otd_pct: pct(a.on_time_count, a.completed_delivery_count),
        late_rate_pct: pct(a.late_count, a.completed_delivery_count),
        avg_delay_days: a.delay_count > 0 ? a.delay_sum / a.delay_count : null,
      };
    });

    const sortDesc = (key: string) => [...vendors].sort((x, y) => safeNum(y[key]) - safeNum(x[key]));
    const sortAsc = (key: string) => [...vendors].sort((x, y) => safeNum(x[key]) - safeNum(y[key]));

    return ok({
      filters: {
        date_from: dateFrom || null,
        date_to: dateTo || null,
        buyer_id: buyerId || null,
        brand: brand || null,
        production_mode: productionMode || null,
        pending_only: pendingOnly,
        late_only: lateOnly,
      },
      highlights: {
        top_revenue_vendor: sortDesc("buyer_revenue")[0] ?? null,
        top_margin_vendor: sortDesc("planned_margin_pct")[0] ?? null,
        highest_pending_vendor: sortDesc("pending_revenue")[0] ?? null,
        worst_otd_vendor: sortAsc("otd_pct")[0] ?? null,
      },
      rankings: {
        by_revenue: sortDesc("buyer_revenue").slice(0, 10),
        by_margin_pct: sortDesc("planned_margin_pct").slice(0, 10),
        by_pending_revenue: sortDesc("pending_revenue").slice(0, 10),
        by_otd_asc: sortAsc("otd_pct").slice(0, 10),
      },
      count: vendors.length,
    });
  } catch (e: any) {
    return bad(e?.message ?? "Server error", 500);
  }
}
