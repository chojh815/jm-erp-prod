import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}
function bad(message: string, status = 400, extra?: any) {
  return NextResponse.json(
    { success: false, error: message, ...(extra ?? {}) },
    { status }
  );
}
function s(v: any) {
  return (v ?? "").toString().trim();
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = s(params?.id);
    if (!id) return bad("Missing shipment id", 400);

    const { data: shipment, error } = await supabaseAdmin
      .from("shipments")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) return bad(error.message, 500);
    if (!shipment) return bad("Shipment not found", 404);
    if (shipment?.is_deleted) return bad("Shipment is deleted", 409);

    const current = s(shipment?.status).toUpperCase();
    if (["CANCELLED", "CANCELED", "DELETED"].includes(current)) {
      return bad("Cancelled/deleted shipment cannot be marked as shipped", 409);
    }
    if (current === "SHIPPED") {
      return ok({ shipment: shipment, already_done: true });
    }

    const { data: updated, error: upErr } = await supabaseAdmin
      .from("shipments")
      .update({ status: "SHIPPED" })
      .eq("id", id)
      .select("*")
      .single();

    if (upErr) return bad(upErr.message, 500);

    return ok({ shipment: updated, status_changed_to: "SHIPPED" });
  } catch (e: any) {
    console.error("POST /api/shipments/[id]/ship error:", e);
    return bad(e?.message || "Mark as shipped failed", 500);
  }
}
