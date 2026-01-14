// src/app/api/orders/[id]/cancel-lines/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assertApiPermission } from "@/lib/api-guard";

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}
function bad(message: string, status = 400, extra?: any) {
  return NextResponse.json({ success: false, error: message, ...(extra ?? {}) }, { status });
}

function toInt(v: any, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function isNonNegInt(v: any) {
  if (v === null || v === undefined || v === "") return false;
  const n = Number(v);
  return Number.isFinite(n) && Math.trunc(n) === n && n >= 0;
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id?: string; po_no?: string } }
) {
  try {
    const guard = await assertApiPermission("po.edit");
    if (guard) return guard;

    const poNo = String((params as any)?.id ?? (params as any)?.po_no ?? "").trim();
    if (!poNo) return bad("id/po_no is required", 400);

    const body = await req.json().catch(() => null);
    const reqLines = body?.lines;
    const cancel_reason = String(body?.cancel_reason ?? "").trim();
    const cancel_note = String(body?.cancel_note ?? "").trim();
    const cancel_date = String(body?.cancel_date ?? "").trim();

    if (!Array.isArray(reqLines) || reqLines.length === 0) {
      return bad("lines[] is required", 400);
    }

    // 1) header
    const { data: header, error: hErr } = await supabaseAdmin
      .from("po_headers")
      .select("id, po_no, status, cancel_date, cancel_reason, cancel_note, cancelled_at, cancelled_by")
      .eq("po_no", poNo)
      .eq("is_deleted", false)
      .maybeSingle();

    if (hErr) return bad("Failed to load po_headers", 500, { detail: hErr.message });
    if (!header?.id) return bad("PO not found", 404);

    const poHeaderId = header.id as string;

    // 2) normalize request lines
    const lineIds: string[] = reqLines
      .map((x: any) => String(x?.po_line_id ?? x?.id ?? "").trim())
      .filter(Boolean);

    if (lineIds.length === 0) return bad("lines[].po_line_id is required", 400);

    // client wants to set absolute cancelled qty per line (0..remaining)
    const desiredCancelMap = new Map<string, number>();
    for (const x of reqLines) {
      const id = String(x?.po_line_id ?? x?.id ?? "").trim();
      if (!id) continue;
      const v = x?.qty_cancelled ?? x?.cancel_qty ?? x?.qtyCancelled;
      if (!isNonNegInt(v)) return bad("qty_cancelled must be a non-negative integer", 400, { po_line_id: id });
      desiredCancelMap.set(id, toInt(v, 0));
    }

    // 3) load po_lines
    const { data: poLines, error: plErr } = await supabaseAdmin
      .from("po_lines")
      .select("id, qty, qty_cancelled")
      .eq("po_header_id", poHeaderId)
      .in("id", lineIds)
      .eq("is_deleted", false);

    if (plErr) return bad("Failed to load po_lines", 500, { detail: plErr.message });
    if (!poLines || poLines.length === 0) return bad("No matching po_lines", 404);

    // 4) shipped qty map (shipment_lines)
    const { data: shippedRows, error: shErr } = await supabaseAdmin
      .from("shipment_lines")
      .select("po_line_id, shipped_qty")
      .eq("po_header_id", poHeaderId)
      .in("po_line_id", lineIds)
      .eq("is_deleted", false);

    if (shErr) return bad("Failed to load shipment_lines", 500, { detail: shErr.message });

    const shippedMap = new Map<string, number>();
    for (const r of shippedRows ?? []) {
      const id = String((r as any).po_line_id ?? "");
      const q = Number((r as any).shipped_qty ?? 0) || 0;
      shippedMap.set(id, (shippedMap.get(id) ?? 0) + q);
    }

    // 5) validate & update lines
    const updates: { id: string; qty_cancelled: number }[] = [];

    for (const r of poLines as any[]) {
      const id = String(r.id);
      const ordered = Number(r.qty ?? 0) || 0;
      const shipped = shippedMap.get(id) ?? 0;

      // server-side safety: if shipped exists, do not allow CANCELLED workflow via this endpoint
      if (shipped > 0) {
        return bad("Cannot cancel lines that have shipped_qty > 0", 409, { po_line_id: id, shipped_qty: shipped });
      }

      const desired = desiredCancelMap.get(id) ?? (Number(r.qty_cancelled ?? 0) || 0);
      const maxCancelable = Math.max(0, ordered - shipped);

      if (!Number.isFinite(desired) || Math.trunc(desired) !== desired || desired < 0) {
        return bad("qty_cancelled must be a non-negative integer", 400, { po_line_id: id });
      }
      if (desired > maxCancelable) {
        return bad("qty_cancelled exceeds cancellable qty", 409, {
          po_line_id: id,
          qty: ordered,
          shipped_qty: shipped,
          max_cancelled: maxCancelable,
          requested_cancelled: desired,
        });
      }

      updates.push({ id, qty_cancelled: desired });
    }

    // apply updates
    for (const u of updates) {
      const { error } = await supabaseAdmin
        .from("po_lines")
        .update({ qty_cancelled: u.qty_cancelled, updated_at: new Date().toISOString() })
        .eq("id", u.id);
      if (error) return bad("Failed to update po_lines", 500, { detail: error.message, po_line_id: u.id });
    }

    // 6) recompute status using po_lines + shipped(=0 here)
    let allRemainingZero = true;
    for (const r of poLines as any[]) {
      const ordered = Number(r.qty ?? 0) || 0;
      const cancelled = updates.find((u) => u.id === String(r.id))?.qty_cancelled ?? (Number(r.qty_cancelled ?? 0) || 0);
      const remaining = ordered - cancelled; // shipped is 0 here
      if (remaining !== 0) allRemainingZero = false;
    }

    let newStatus: string | null = null;
    if (allRemainingZero) newStatus = "CANCELLED";

    if (newStatus && newStatus !== String((header as any).status ?? "")) {
      const patch: any = { status: newStatus, updated_at: new Date().toISOString() };

      // store cancel meta if provided and existing empty
      if (cancel_reason && !(header as any).cancel_reason) patch.cancel_reason = cancel_reason;
      if (cancel_note && !(header as any).cancel_note) patch.cancel_note = cancel_note;
      if (cancel_date && !(header as any).cancel_date) patch.cancel_date = cancel_date;

      if (newStatus === "CANCELLED") {
        if (!(header as any).cancel_date) patch.cancel_date = new Date().toISOString().slice(0, 10);
        if (!(header as any).cancelled_at) patch.cancelled_at = new Date().toISOString();
      }

      const { error: phErr } = await supabaseAdmin.from("po_headers").update(patch).eq("id", poHeaderId);
      if (phErr) return bad("Failed to update po_headers", 500, { detail: phErr.message });
    }

    return ok({ po_no: poNo, po_header_id: poHeaderId, status: newStatus ?? (header as any).status, updated_lines: updates.length });
  } catch (e: any) {
    return bad("Unexpected error", 500, { detail: e?.message ?? String(e) });
  }
}
