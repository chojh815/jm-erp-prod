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
function toBool(v: string | null) {
  const s = safeText(v).toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "y";
}
function safeNum(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
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
    const unassignedOnly = toBool(url.searchParams.get("unassigned_only"));
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 500), 1), 5000);

    let qb: any = supabaseAdmin
      .from("v_vendor_performance")
      .select("*")
      .order("vendor_name", { ascending: true })
      .order("po_no", { ascending: true })
      .order("requested_ship_date", { ascending: true, nullsFirst: false })
      .limit(limit);

    if (dateFrom) qb = qb.gte("requested_ship_date", dateFrom);
    if (dateTo) qb = qb.lte("requested_ship_date", dateTo);
    if (vendorId) qb = qb.eq("vendor_id", vendorId);
    if (buyerId) qb = qb.eq("buyer_id", buyerId);
    if (brand) qb = qb.ilike("brand", `%${brand}%`);
    if (productionMode) qb = qb.eq("production_mode", productionMode);
    if (pendingOnly) qb = qb.gt("pending_qty", 0);
    if (lateOnly) qb = qb.eq("vendor_delivery_status", "LATE");
    if (unassignedOnly) {
      qb = qb.or("vendor_id.is.null,vendor_name.eq.(No Vendor)");
    }

    const { data, error } = await qb;
    if (error) return bad(error.message, 500);

    const rows = (Array.isArray(data) ? data : []).map((r: any) => {
      const orderedQty = safeNum(r.ordered_qty);
      const shippedQty = safeNum(r.shipped_qty);
      const pendingQty = safeNum(r.pending_qty);
      const buyerRevenue = safeNum(r.buyer_revenue);
      const plannedCost = safeNum(r.planned_vendor_cost_usd);
      const actualCost = safeNum(r.actual_vendor_cost_usd);

      const pendingRevenue =
        orderedQty > 0 ? (buyerRevenue * pendingQty) / orderedQty : 0;
      const pendingPlannedCost =
        orderedQty > 0 ? (plannedCost * pendingQty) / orderedQty : 0;

      return {
        ...r,
        ordered_qty: orderedQty,
        shipped_qty: shippedQty,
        pending_qty: pendingQty,
        buyer_revenue: buyerRevenue,
        planned_vendor_cost_usd: plannedCost,
        actual_vendor_cost_usd: actualCost,
        pending_revenue: pendingRevenue,
        pending_planned_cost_usd: pendingPlannedCost,
        pending_planned_margin: pendingRevenue - pendingPlannedCost,
      };
    });

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
        unassigned_only: unassignedOnly,
        limit,
      },
      count: rows.length,
      rows,
    });
  } catch (e: any) {
    return bad(e?.message ?? "Server error", 500);
  }
}
