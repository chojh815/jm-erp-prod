/**
 * src/app/api/shipments/from-po/route.ts
 *
 * ✅ Legacy endpoint: create ONE Shipment from selected PO(s) (no split-by-mode).
 * - Accepts po_ids[] (preferred) or po_id / po_no / po_nos for backward compatibility.
 * - Loads PO headers + lines, validates same buyer (best-effort),
 *   creates shipment header, then creates shipment_lines.
 *
 * Why this file?
 * - You said you accidentally pasted the create-from-po route into from-po.
 * - This restores a "simple" from-po creator without A-plan split logic.
 */

import { NextResponse } from "next/server";
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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isUuid(v: any) {
  return typeof v === "string" && UUID_RE.test(v);
}
function s(v: any) {
  return (v ?? "").toString().trim();
}
function num(v: any, fallback = 0): number {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Insert with schema-cache safe retry:
 * If error looks like "Could not find the '<col>' column ... in the schema cache",
 * drop that column and retry once.
 */
async function insertWithSchemaRetry(table: string, row: any) {
  const first = await supabaseAdmin.from(table).insert(row).select("*").maybeSingle();
  if (!first.error) return first;

  const msg = (first.error as any)?.message ?? "";
  const m = msg.match(/Could not find the '([^']+)' column/i);
  if (!m) return first;

  const col = m[1];
  const cloned = { ...(row ?? {}) };
  if (col in cloned) delete cloned[col];

  const second = await supabaseAdmin.from(table).insert(cloned).select("*").maybeSingle();
  return second;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));

    // ---- Parse PO identifiers (backward compatible) ----
    let poIds: string[] = [];

    const bPoIds = Array.isArray(body?.po_ids) ? body.po_ids : null;
    const bPoNos = Array.isArray(body?.po_nos) ? body.po_nos : null;

    if (bPoIds && bPoIds.length) {
      poIds = bPoIds.map((x: any) => s(x)).filter(isUuid);
    } else if (isUuid(body?.po_id)) {
      poIds = [s(body.po_id)];
    } else if (s(body?.po_no)) {
      // Resolve po_no -> id
      const poNo = s(body.po_no);
      const { data: hdr, error } = await supabaseAdmin
        .from("po_headers")
        .select("*")
        .eq("po_no", poNo)
        .eq("is_deleted", false)
        .maybeSingle();
      if (error) return bad(error.message, 500);
      if (!hdr?.id) return bad("PO not found.", 404);
      poIds = [hdr.id];
    } else if (bPoNos && bPoNos.length) {
      // Resolve multiple po_nos -> ids
      const poNos = bPoNos.map((x: any) => s(x)).filter(Boolean);
      if (!poNos.length) return bad("po_ids is required.", 400);

      const { data: hdrs, error } = await supabaseAdmin
        .from("po_headers")
        .select("*")
        .in("po_no", poNos)
        .eq("is_deleted", false);
      if (error) return bad(error.message, 500);

      poIds = (hdrs ?? []).map((h: any) => h.id).filter(isUuid);
    }

    if (!poIds.length) return bad("po_ids is required.", 400);

    // ---- Load PO headers ----
    const { data: headers, error: hdrErr } = await supabaseAdmin
      .from("po_headers")
      .select("*")
      .in("id", poIds)
      .eq("is_deleted", false);

    if (hdrErr) return bad(hdrErr.message, 500);
    if (!headers?.length) return bad("PO not found.", 404);

    // Best-effort: require same buyer for safety
    const buyerId = headers[0]?.buyer_id ?? headers[0]?.buyer_company_id ?? null;
    const buyerName = headers[0]?.buyer_name ?? headers[0]?.buyer_company_name ?? null;

    for (const h of headers) {
      const b = h?.buyer_id ?? h?.buyer_company_id ?? null;
      if (buyerId && b && buyerId !== b) {
        return bad("Only POs from the same buyer can be grouped into one shipment.", 400);
      }
    }

    // ---- Load PO lines ----
    const { data: lines, error: lineErr } = await supabaseAdmin
      .from("po_lines")
      .select("*")
      .in("po_header_id", poIds)
      .eq("is_deleted", false);

    if (lineErr) return bad(lineErr.message, 500);
    const poLines = lines ?? [];
    if (!poLines.length) return bad("No PO lines found.", 400);

    // ---- Create shipment header (safe columns only) ----
    const shipDate =
      headers[0]?.requested_ship_date ??
      headers[0]?.ship_date ??
      headers[0]?.req_ship_date ??
      null;

    const currency = headers[0]?.currency ?? headers[0]?.po_currency ?? null;
    const incoterm = headers[0]?.incoterm ?? headers[0]?.inco_term ?? null;

    const finalDestination =
      headers[0]?.final_destination ??
      headers[0]?.destination ??
      null;

    const shippingOrigin =
      headers[0]?.shipping_origin ??
      headers[0]?.ship_from ??
      null;

    // shipment_no: let DB trigger generate if exists; else fallback timestamp
    const now = new Date();
    const fallbackNo = `SHP-${now.getFullYear().toString().slice(2)}${String(
      now.getMonth() + 1
    ).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(
      now.getHours()
    ).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(
      now.getSeconds()
    ).padStart(2, "0")}`;

    const headerRow: any = {
      buyer_id: buyerId,
      buyer_name: buyerName,
      ship_date: shipDate,
      currency,
      incoterm,
      final_destination: finalDestination,
      shipping_origin: shippingOrigin,
      status: "DRAFT",
      is_deleted: false,
      shipment_no: fallbackNo,
    };

    const inserted = await insertWithSchemaRetry("shipments", headerRow);
    if (inserted.error || !inserted.data?.id) {
      return bad(inserted.error?.message ?? "Failed to create shipment header.", 500);
    }
    const shipment = inserted.data;
    const shipmentId = shipment.id;

    // ---- Create shipment lines ----
    const toLineRow = (pl: any) => {
      const orderQty = num(pl?.order_qty ?? pl?.qty ?? pl?.quantity ?? 0, 0);
      const unitPrice = num(pl?.unit_price ?? pl?.price ?? 0, 0);
      const amount = num(pl?.amount ?? orderQty * unitPrice, 0);

      return {
        shipment_id: shipmentId,
        po_header_id: pl?.po_header_id ?? null,
        po_line_id: pl?.id ?? null,

        po_no: pl?.po_no ?? pl?.po_number ?? null,
        line_no: pl?.line_no ?? pl?.line ?? null,

        style_no: pl?.style_no ?? pl?.style ?? null,
        description: pl?.description ?? pl?.style_desc ?? null,
        color: pl?.color ?? null,
        size: pl?.size ?? null,

        order_qty: orderQty,
        shipped_qty: orderQty, // 기본: full ship
        unit_price: unitPrice,
        amount,

        cartons: num(pl?.cartons ?? 0, 0),
        gw_per_ctn: num(pl?.gw_per_ctn ?? pl?.gw_per_carton ?? 0, 0),
        nw_per_ctn: num(pl?.nw_per_ctn ?? pl?.nw_per_carton ?? 0, 0),
        cbm_per_ctn: num(pl?.cbm_per_ctn ?? pl?.cbm_per_carton ?? 0, 0),

        is_deleted: false,
      };
    };

    const rows = poLines.map(toLineRow);

    // Insert lines in chunks to avoid payload limits
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { error: insErr } = await supabaseAdmin.from("shipment_lines").insert(chunk);
      if (insErr) return bad(insErr.message, 500);
    }

    return ok({
      shipment_id: shipmentId,
      shipment_no: shipment?.shipment_no ?? shipment?.shipment_number ?? null,
      url: `/shipments/${shipmentId}`,
    });
  } catch (e: any) {
    return bad(e?.message ?? "Unexpected error.", 500);
  }
}
