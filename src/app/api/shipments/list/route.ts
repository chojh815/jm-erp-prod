// src/app/api/shipments/list/route.ts
// Shipment List API (search + status filter)
//
// Query:
// - q: search keyword across shipment_no / po_no / buyer_name / destination
// - status: optional exact match (e.g. DRAFT / CONFIRMED / CLOSED)
//
// Notes:
// - Always filters is_deleted != true (soft delete).
// - Uses select("*") for schema drift safety.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}
function bad(message: string, status = 400, extra?: any) {
  return NextResponse.json({ success: false, error: message, ...(extra ?? {}) }, { status });
}

function safe(v: any) {
  return (v ?? "").toString().trim();
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const q = safe(searchParams.get("q"));
    const status = safe(searchParams.get("status")).toUpperCase();

    let qb = supabaseAdmin
      .from("shipments")
      .select("*", { count: "exact" })
      .or("is_deleted.is.null,is_deleted.eq.false");

    if (q) {
      const like = `%${q}%`;
      // supabase .or uses comma-separated filters
      qb = qb.or(
        [
          `shipment_no.ilike.${like}`,
          `po_no.ilike.${like}`,
          `buyer_name.ilike.${like}`,
          `destination.ilike.${like}`,
        ].join(",")
      );
    }

    if (status && status !== "ALL") {
      qb = qb.eq("status", status);
    }

    // 최신 순
    qb = qb.order("created_at", { ascending: false }).order("shipment_no", { ascending: false });

    const { data, error, count } = await qb.limit(500);

    if (error) return bad(error.message, 500);

    const items = (data || []) as any[];
    return ok({ items, total: count ?? items.length });
  } catch (e: any) {
    return bad(e?.message || "Server error", 500);
  }
}
