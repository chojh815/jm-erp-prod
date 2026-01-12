import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}
function bad(message: string, status = 400, extra: any = {}) {
  return NextResponse.json({ success: false, error: message, ...extra }, { status });
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isUuid(v: string) {
  return UUID_RE.test(v);
}

/**
 * POST /api/shipments/:id/cancel
 * - Soft-cancel: shipments.status -> "CANCELLED"
 * - Also soft-delete shipment_lines (is_deleted=true) so it won't be picked up by downstream flows.
 * Notes:
 * - We keep the shipment row for audit/history, but hide it from "active" lists by setting is_deleted=true.
 * - If you prefer to keep it visible, change is_deleted to false below and filter by status in list UI.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = (params?.id ?? "").toString().trim();
    if (!id) return bad("Missing shipment id", 400);
    if (!isUuid(id)) return bad("Invalid shipment id", 400, { id });

    // 1) Load shipment (guard)
    const { data: ship, error: shipErr } = await supabaseAdmin
      .from("shipments")
      .select("id, status, is_deleted")
      .eq("id", id)
      .maybeSingle();

    if (shipErr) return bad(shipErr.message ?? "Failed to load shipment", 500);
    if (!ship) return bad("Shipment not found", 404);

    // 2) Idempotent handling
    const status = (ship.status ?? "").toString().toUpperCase();
    if (status === "CANCELLED" || status === "CANCELED" || ship.is_deleted) {
      return ok({ id, alreadyCancelled: true });
    }

    // 3) (Optional) Prevent cancel if invoice already linked
    // Some deployments store invoice link as invoice_headers.shipment_id.
    // If your schema differs, you can remove this block safely.
    const { data: inv, error: invErr } = await supabaseAdmin
      .from("invoice_headers")
      .select("id")
      .eq("shipment_id", id)
      .limit(1);

    if (invErr) {
      // don't hard-fail if table/column doesn't exist in your schema
      // (Supabase error code 42P01 = undefined table, 42703 = undefined column)
      const code = (invErr as any)?.code;
      if (code !== "42P01" && code !== "42703") {
        return bad(invErr.message ?? "Failed to check linked invoice", 500);
      }
    } else if (inv && inv.length > 0) {
      return bad("Cannot cancel: invoice already linked to this shipment.", 409, {
        invoice_id: inv[0].id,
      });
    }

    // 4) Cancel shipment + soft delete lines
    const { error: upErr } = await supabaseAdmin
      .from("shipments")
      .update({ status: "CANCELLED", is_deleted: true })
      .eq("id", id);

    if (upErr) return bad(upErr.message ?? "Failed to cancel shipment", 500);

    const { error: lineErr } = await supabaseAdmin
      .from("shipment_lines")
      .update({ is_deleted: true })
      .eq("shipment_id", id);

    if (lineErr) {
      // shipment cancel already done; return with warning
      return ok({ id, warning: lineErr.message ?? "Failed to soft-delete shipment lines" });
    }

    return ok({ id });
  } catch (e: any) {
    return bad(e?.message ?? "Unexpected error", 500);
  }
}
