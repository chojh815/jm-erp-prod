// src/app/api/shipments/[id]/split/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}
function bad(message: string, status = 400, extra?: any) {
  return NextResponse.json({ success: false, error: message, ...(extra ?? {}) }, { status });
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isUuid(v: string) {
  return UUID_RE.test(v);
}
function num(v: any, fallback = 0): number {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function safe(v: any) {
  return (v ?? "").toString().trim();
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const shipmentId = String(id || "").trim();
    if (!isUuid(shipmentId)) return bad("Invalid shipment id", 400);

    const body = await req.json().catch(() => ({}));
    const shipmentLineId = String(body?.shipment_line_id || "").trim();
    const splitQty = Math.max(0, num(body?.split_qty, 0));
    const newShipMode = safe(body?.new_ship_mode || body?.ship_mode || "");
    const carrier = safe(body?.carrier || "");
    const trackingNo = safe(body?.tracking_no || "");

    if (!isUuid(shipmentLineId)) return bad("Invalid shipment_line_id", 400);
    if (!splitQty || splitQty <= 0) return bad("split_qty must be > 0", 400);
    if (!newShipMode) return bad("new_ship_mode is required", 400);

    // Load source shipment
    const { data: srcShipment, error: shErr } = await supabaseAdmin
      .from("shipments")
      .select("*")
      .eq("id", shipmentId)
      .eq("is_deleted", false)
      .maybeSingle();
    if (shErr) throw new Error(shErr.message);
    if (!srcShipment) return bad("Shipment not found", 404);

    // Load source line
    const { data: srcLine, error: lnErr } = await supabaseAdmin
      .from("shipment_lines")
      .select("*")
      .eq("id", shipmentLineId)
      .eq("shipment_id", shipmentId)
      .eq("is_deleted", false)
      .maybeSingle();
    if (lnErr) throw new Error(lnErr.message);
    if (!srcLine) return bad("Shipment line not found", 404);

    const currentQty = num(srcLine.shipped_qty ?? srcLine.qty, 0);
    if (splitQty > currentQty) return bad("split_qty exceeds current shipped qty", 409);

    // Create new shipment header by copying src, overriding ship_mode and courier details
    const newShipmentInsert: any = { ...srcShipment };
    delete newShipmentInsert.id;
    delete newShipmentInsert.created_at;
    delete newShipmentInsert.updated_at;

    newShipmentInsert.ship_mode = newShipMode;
    if (newShipMode.toUpperCase() === "COURIER") {
      // best-effort: only set if columns exist in table; if not, update will fail -> we catch with retry
      newShipmentInsert.carrier = carrier || null;
      newShipmentInsert.tracking_no = trackingNo || null;
    } else {
      // clear courier fields
      newShipmentInsert.carrier = null;
      newShipmentInsert.tracking_no = null;
    }

    newShipmentInsert.status = srcShipment.status ?? "DRAFT";
    newShipmentInsert.is_deleted = false;
    newShipmentInsert.updated_at = new Date().toISOString();

    const { data: newShipment, error: insErr } = await supabaseAdmin
      .from("shipments")
      .insert(newShipmentInsert)
      .select("*")
      .single();
    if (insErr) throw new Error(insErr.message);

    // Insert new shipment line
    const newLineInsert: any = { ...srcLine };
    delete newLineInsert.id;
    delete newLineInsert.created_at;
    delete newLineInsert.updated_at;

    newLineInsert.shipment_id = newShipment.id;
    newLineInsert.shipped_qty = splitQty;
    newLineInsert.is_deleted = false;
    newLineInsert.updated_at = new Date().toISOString();

    const { error: newLineErr } = await supabaseAdmin.from("shipment_lines").insert(newLineInsert);
    if (newLineErr) throw new Error(newLineErr.message);

    // Update source line qty
    const remaining = Math.max(0, currentQty - splitQty);
    const srcUpdate: any = {
      shipped_qty: remaining,
      updated_at: new Date().toISOString(),
    };
    // if remaining becomes 0, soft-delete it to reduce clutter (safe)
    if (remaining === 0) srcUpdate.is_deleted = true;

    const { error: upErr } = await supabaseAdmin
      .from("shipment_lines")
      .update(srcUpdate)
      .eq("id", shipmentLineId)
      .eq("shipment_id", shipmentId);
    if (upErr) throw new Error(upErr.message);

    return ok({ new_shipment_id: newShipment.id });
  } catch (e: any) {
    console.error(e);
    return bad(e?.message || "Server error", 500);
  }
}
