// src/app/api/shipments/list/route.ts
// Shipment List API (multi-PO aware)
//
// Supports query params:
// - shipment_no: shipment number search
// - po_no: PO search (matches aggregated shipment_pos / shipment_lines POs)
// - buyer: buyer search
// - status: exact status filter (ALL means no filter)
// - q: optional generic search across shipment no / buyer / destination / POs
//
// Notes:
// - Always filters soft-deleted rows (is_deleted != true)
// - Uses select("*") for schema drift safety
// - Returns po_nos[] and po_display for list UI

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}
function bad(message: string, status = 400, extra?: any) {
  return NextResponse.json(
    { success: false, error: message, ...(extra ?? {}) },
    { status }
  );
}

function safe(v: any) {
  return (v ?? "").toString().trim();
}

function lc(v: any) {
  return safe(v).toLowerCase();
}

function uniqStrings(values: any[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values || []) {
    const s = safe(raw);
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function sortPo(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function buildPoDisplay(poNos: string[]) {
  if (!poNos.length) return "-";
  if (poNos.length === 1) return poNos[0];
  return `Multiple (${poNos.length})`;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const shipmentNo = safe(searchParams.get("shipment_no"));
    const poNo = safe(searchParams.get("po_no"));
    const buyer = safe(searchParams.get("buyer"));
    const q = safe(searchParams.get("q"));
    const status = safe(searchParams.get("status")).toUpperCase();

    let qb = supabaseAdmin
      .from("shipments")
      .select("*", { count: "exact" })
      .or("is_deleted.is.null,is_deleted.eq.false");

    if (status && status !== "ALL") {
      qb = qb.eq("status", status);
    }

    if (shipmentNo) {
      qb = qb.ilike("shipment_no", `%${shipmentNo}%`);
    }

    if (buyer) {
      qb = qb.or(
        [
          `buyer_name.ilike.%${buyer}%`,
          `buyer_code.ilike.%${buyer}%`,
          `buyer_id.ilike.%${buyer}%`,
        ].join(",")
      );
    }

    qb = qb
      .order("created_at", { ascending: false })
      .order("shipment_no", { ascending: false });

    const { data, error, count } = await qb.limit(500);
    if (error) return bad(error.message, 500);

    const baseItems = (data || []) as any[];
    if (!baseItems.length) {
      return ok({ items: [], total: 0 });
    }

    const shipmentIds = uniqStrings(baseItems.map((x) => x?.id));
    const poMap = new Map<string, string[]>();

    // 1) Preferred source: shipment_pos
    try {
      const { data: spRows, error: spErr } = await supabaseAdmin
        .from("shipment_pos")
        .select("*")
        .in("shipment_id", shipmentIds)
        .or("is_deleted.is.null,is_deleted.eq.false");

      if (!spErr && Array.isArray(spRows)) {
        for (const row of spRows) {
          const shipmentId = safe((row as any)?.shipment_id);
          const po = safe((row as any)?.po_no ?? (row as any)?.po);
          if (!shipmentId || !po) continue;
          const arr = poMap.get(shipmentId) || [];
          arr.push(po);
          poMap.set(shipmentId, arr);
        }
      }
    } catch {
      // ignore and fallback below
    }

    // 2) Fallback / supplement: shipment_lines.po_no
    try {
      const { data: lineRows, error: lineErr } = await supabaseAdmin
        .from("shipment_lines")
        .select("*")
        .in("shipment_id", shipmentIds)
        .or("is_deleted.is.null,is_deleted.eq.false");

      if (!lineErr && Array.isArray(lineRows)) {
        for (const row of lineRows) {
          const shipmentId = safe((row as any)?.shipment_id);
          const po = safe((row as any)?.po_no ?? (row as any)?.po);
          if (!shipmentId || !po) continue;
          const arr = poMap.get(shipmentId) || [];
          arr.push(po);
          poMap.set(shipmentId, arr);
        }
      }
    } catch {
      // ignore
    }

    let items = baseItems.map((row) => {
      const shipmentId = safe(row?.id);
      const poNos = uniqStrings([
        ...(poMap.get(shipmentId) || []),
        row?.po_no,
      ]).sort(sortPo);

      return {
        ...row,
        po_nos: poNos,
        po_display: buildPoDisplay(poNos),
      };
    });

    // Post-filter for PO and generic q because these depend on aggregated po_nos.
    if (poNo) {
      const needle = lc(poNo);
      items = items.filter((row) => {
        const poNos = Array.isArray(row?.po_nos) ? row.po_nos : [];
        return poNos.some((po: any) => lc(po).includes(needle));
      });
    }

    if (q) {
      const needle = lc(q);
      items = items.filter((row) => {
        const hay = [
          row?.shipment_no,
          row?.buyer_name,
          row?.destination,
          row?.final_destination,
          ...(Array.isArray(row?.po_nos) ? row.po_nos : []),
        ]
          .map(lc)
          .join(" | ");
        return hay.includes(needle);
      });
    }

    return ok({ items, total: items.length, base_total: count ?? baseItems.length });
  } catch (e: any) {
    return bad(e?.message || "Server error", 500);
  }
}
