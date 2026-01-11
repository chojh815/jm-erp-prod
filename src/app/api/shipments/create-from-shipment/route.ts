// src/app/api/shipments/create-from-po/route.ts
//
// A-Plan: Create shipments grouped by line-level ship_mode (SEA/AIR/COURIER).
// Input (POST JSON):
// {
//   "po_ids": ["uuid", ...],
//   "lines": [
//     { "po_line_id": "uuid", "shipped_qty": 1200, "ship_mode": "SEA", "carrier": "...?", "tracking_no": "...?" }
//   ]
// }
//
// Output:
// { success: true, shipments: [{ id, ship_mode, shipment_no }...] }

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}
function bad(message: string, status = 400, extra?: any) {
  return NextResponse.json({ success: false, error: message, ...(extra ?? {}) }, { status });
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isUuid(v: any) {
  return typeof v === "string" && UUID_RE.test(v);
}
function num(v: any, fallback = 0): number {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function safe(v: any) {
  return (v ?? "").toString().trim();
}
function nowStamp() {
  // YYYYMMDD-HHMMSS
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, "0");
  return (
    d.getFullYear().toString() +
    p(d.getMonth() + 1) +
    p(d.getDate()) +
    "-" +
    p(d.getHours()) +
    p(d.getMinutes()) +
    p(d.getSeconds())
  );
}
function makeShipmentNo(mode: string) {
  // Unique enough for ops; if you later want strict sequence, replace here.
  return `SHP-${nowStamp()}-${mode}`;
}

type ShipMode = "SEA" | "AIR" | "COURIER";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return bad("Invalid JSON body", 400);

    const po_ids = Array.isArray(body.po_ids) ? body.po_ids : [];
    const lines = Array.isArray(body.lines) ? body.lines : [];

    if (!po_ids.length || !po_ids.every(isUuid)) {
      return bad("po_ids is required (uuid[]).");
    }
    if (!lines.length) {
      return bad("lines is required.");
    }

    const normalized = lines
      .map((l: any) => ({
        po_line_id: safe(l.po_line_id),
        shipped_qty: num(l.shipped_qty, 0),
        ship_mode: safe(l.ship_mode).toUpperCase() as ShipMode,
        carrier: safe(l.carrier) || null,
        tracking_no: safe(l.tracking_no) || null,
      }))
      .filter((l: any) => isUuid(l.po_line_id) && l.shipped_qty > 0 && ["SEA", "AIR", "COURIER"].includes(l.ship_mode));

    if (!normalized.length) {
      return bad("No valid lines. Each line needs po_line_id(uuid), shipped_qty>0, ship_mode(SEA/AIR/COURIER).");
    }

    // Load PO headers (for buyer/currency/terms/destination/origin)
    const { data: poHeaders, error: poHeaderErr } = await supabaseAdmin
      .from("po_headers")
      .select("*")
      .in("id", po_ids)
      .eq("is_deleted", false);

    if (poHeaderErr) return bad(`Failed to load PO headers: ${poHeaderErr.message}`, 500);
    if (!poHeaders || !poHeaders.length) return bad("No PO headers found for given po_ids.", 404);

    // Load PO lines needed
    const poLineIds = Array.from(new Set(normalized.map((l: any) => l.po_line_id)));
    const { data: poLines, error: poLinesErr } = await supabaseAdmin
      .from("po_lines")
      .select("*")
      .in("id", poLineIds)
      .eq("is_deleted", false);

    if (poLinesErr) return bad(`Failed to load PO lines: ${poLinesErr.message}`, 500);
    if (!poLines || !poLines.length) return bad("No PO lines found for given lines[].po_line_id.", 404);

    const poLineById = new Map<string, any>();
    for (const pl of poLines) poLineById.set(pl.id, pl);

    // Validate shipped_qty <= order_qty per po_line, considering already shipped in other shipments.
    // Sum already shipped_qty across shipment_lines for these po_line_ids (excluding deleted).
    const { data: shippedAgg, error: shippedAggErr } = await supabaseAdmin
      .from("shipment_lines")
      .select("po_line_id, shipped_qty, is_deleted")
      .in("po_line_id", poLineIds)
      .eq("is_deleted", false);

    if (shippedAggErr) return bad(`Failed to validate shipped qty: ${shippedAggErr.message}`, 500);

    const alreadyShipped = new Map<string, number>();
    for (const r of shippedAgg ?? []) {
      const id = r.po_line_id;
      const qty = num(r.shipped_qty, 0);
      alreadyShipped.set(id, (alreadyShipped.get(id) ?? 0) + qty);
    }

    const wantShipped = new Map<string, number>();
    for (const l of normalized) {
      wantShipped.set(l.po_line_id, (wantShipped.get(l.po_line_id) ?? 0) + l.shipped_qty);
    }

    const violations: any[] = [];
    for (const [poLineId, want] of wantShipped.entries()) {
      const pl = poLineById.get(poLineId);
      const orderQty = num(pl?.qty, 0);
      const already = alreadyShipped.get(poLineId) ?? 0;
      if (want + already > orderQty + 1e-9) {
        violations.push({ po_line_id: poLineId, order_qty: orderQty, already_shipped: already, requested_now: want });
      }
    }
    if (violations.length) {
      return bad("Shipped quantity exceeds remaining order quantity for one or more lines.", 409, { violations });
    }

    // Group by ship_mode
    const groups = new Map<ShipMode, typeof normalized>();
    for (const l of normalized) {
      const arr = groups.get(l.ship_mode) ?? [];
      arr.push(l);
      groups.set(l.ship_mode, arr);
    }

    // We'll derive header fields from the first PO header (must be consistent: buyer/currency).
    // If multiple POs selected with different buyer/currency, we block.
    const first = poHeaders[0] as any;
    const buyerKey = safe(first?.buyer_id || first?.buyer_name || first?.buyer);
    const currencyKey = safe(first?.currency);

    const mismatched = (poHeaders as any[]).filter((h) => {
      const b = safe(h?.buyer_id || h?.buyer_name || h?.buyer);
      const c = safe(h?.currency);
      return (buyerKey && b && b !== buyerKey) || (currencyKey && c && c !== currencyKey);
    });
    if (mismatched.length) {
      return bad("Selected POs have different buyer/currency. Please create shipments separately.", 409);
    }

    const createdShipments: any[] = [];

    // Create one shipment per group and insert shipment_lines.
    for (const [mode, ls] of groups.entries()) {
      // header insert - keep minimal & tolerant to schema differences
      const insertHeader: any = {
        ship_mode: mode,
        carrier: ls.find((x) => x.carrier)?.carrier ?? null,
        tracking_no: ls.find((x) => x.tracking_no)?.tracking_no ?? null,
        status: "DRAFT",
      };

      // Optional fields if present in your schema (harmless if column missing? Supabase will error).
      // To be safe, we try insert with a minimal set first, then retry without optional fields if needed.
      const shipmentNo = makeShipmentNo(mode);
      insertHeader.shipment_no = shipmentNo;

      // Copy a few common header fields from PO (best-effort)
      const pick = (keys: string[]) => {
        for (const k of keys) {
          const v = (first as any)?.[k];
          if (v !== null && v !== undefined && safe(v) !== "") return v;
        }
        return null;
      };
      insertHeader.buyer_id = pick(["buyer_id"]);
      insertHeader.buyer_name = pick(["buyer_name", "buyer"]);
      insertHeader.currency = pick(["currency"]);
      insertHeader.incoterm = pick(["incoterm"]);
      insertHeader.payment_term = pick(["payment_term", "terms"]);
      insertHeader.destination = pick(["destination", "final_destination"]);
      insertHeader.shipping_origin = pick(["shipping_origin", "origin"]);
      insertHeader.ship_date = pick(["ship_date", "requested_ship_date"]);
      insertHeader.order_date = pick(["order_date"]);

      // Try header insert with best-effort fields; retry minimal if schema mismatch.
      let headerRow: any = null;
      {
        let res = await supabaseAdmin.from("shipments").insert(insertHeader).select("*").maybeSingle();
        if (res.error) {
          // Retry with minimal columns (most schemas at least have ship_mode/status/shipment_no)
          const minimal: any = { ship_mode: mode, status: "DRAFT", shipment_no: shipmentNo };
          const res2 = await supabaseAdmin.from("shipments").insert(minimal).select("*").maybeSingle();
          if (res2.error) return bad(`Failed to create shipment header: ${res2.error.message}`, 500, { mode });
          headerRow = res2.data;
        } else {
          headerRow = res.data;
        }
      }

      const shipmentId = headerRow?.id;
      if (!shipmentId) return bad("Shipment header created but id missing.", 500);

      // Insert lines
      const lineInserts: any[] = [];
      for (const l of ls) {
        const pl = poLineById.get(l.po_line_id);
        if (!pl) continue;

        const shippedQty = l.shipped_qty;
        const unitPrice = num(pl?.unit_price, 0);
        const amount = unitPrice ? shippedQty * unitPrice : num(pl?.amount, 0);

        // Find PO header for this line (po_header_id on po_lines)
        const poHeaderId = pl?.po_header_id;
        const poHeader = (poHeaders as any[]).find((h) => h.id === poHeaderId) ?? first;

        lineInserts.push({
          shipment_id: shipmentId,
          po_line_id: pl.id,
          po_header_id: poHeaderId ?? null,
          po_no: poHeader?.po_no ?? null,

          line_no: pl?.line_no ?? null,
          style_no: pl?.buyer_style_no ?? pl?.buyer_style_code ?? pl?.jm_style_no ?? pl?.jm_style_code ?? null,
          description: pl?.description ?? null,
          color: pl?.color ?? null,
          size: pl?.size ?? null,

          order_qty: num(pl?.qty, 0),
          shipped_qty: shippedQty,
          unit_price: unitPrice,
          amount: amount,

          cartons: null,
          gw: null,
          nw: null,
          gw_per_ctn: null,
          nw_per_ctn: null,

          is_deleted: false,
        });
      }

      if (!lineInserts.length) return bad("No line inserts prepared.", 500);

      const { error: insLinesErr } = await supabaseAdmin.from("shipment_lines").insert(lineInserts);
      if (insLinesErr) return bad(`Failed to insert shipment lines: ${insLinesErr.message}`, 500, { mode });

      createdShipments.push({ id: shipmentId, ship_mode: mode, shipment_no: headerRow?.shipment_no ?? shipmentNo });
    }

    return ok({ shipments: createdShipments });
  } catch (e: any) {
    return bad(e?.message || "Server error", 500);
  }
}
