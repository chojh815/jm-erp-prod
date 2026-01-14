// src/app/api/orders/[po_no]/cancel-lines/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assertApiPermission } from "@/lib/api-guard";

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}
function bad(message: string, status = 400, extra?: any) {
  return NextResponse.json(
    { success: false, error: message, ...(extra ?? {}) },
    { status }
  );
}

function toInt(v: any): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (!Number.isInteger(n)) return null;
  return n;
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { po_no: string } }
) {
  try {
    const guard = await assertApiPermission("po.edit");
    if (guard) return guard;

    const poNo = String(params?.po_no ?? "").trim();
    if (!poNo) return bad("po_no is required", 400);

    const body = await req.json().catch(() => null);
    const lines = body?.lines;
    const cancel_reason = String(body?.cancel_reason ?? "").trim();
    const cancel_note = String(body?.cancel_note ?? "").trim();
    const cancel_date = String(body?.cancel_date ?? "").trim();
    if (!Array.isArray(lines) || lines.length === 0) {
      return bad("lines[] is required", 400);
    }

    // 1) PO header 찾기
    const { data: header, error: hErr } = await supabaseAdmin
      .from("po_headers")
      .select("id, po_no, status, cancel_date")
      .eq("po_no", poNo)
      .eq("is_deleted", false)
      .maybeSingle();

    if (hErr) return bad("Failed to load po_headers", 500, { detail: hErr.message });
    if (!header?.id) return bad("PO not found", 404);

    const poHeaderId = header.id as string;

    const lineIds: string[] = lines
      .map((x: any) => String(x?.po_line_id ?? "").trim())
      .filter(Boolean);

    if (lineIds.length === 0) return bad("po_line_id is required", 400);

    // 2) 주문 라인 로드 (ordered qty)
    const { data: poLines, error: lErr } = await supabaseAdmin
      .from("po_lines")
      .select("id, qty, qty_cancelled")
      .eq("po_header_id", poHeaderId)
      .in("id", lineIds);

    if (lErr) return bad("Failed to load po_lines", 500, { detail: lErr.message });
    if (!poLines?.length) return bad("No matching po_lines", 404);

    const lineMap = new Map<string, any>(poLines.map((r: any) => [String(r.id), r]));

    // 3) shipped 합산 (shipment_lines: po_line_id, shipped_qty)
    const shippedMap = new Map<string, number>();
    const { data: shipRows, error: sErr } = await supabaseAdmin
      .from("shipment_lines")
      .select("po_line_id, shipped_qty")
      .in("po_line_id", lineIds);

    if (sErr) return bad("Failed to load shipment_lines", 500, { detail: sErr.message });

    for (const r of shipRows ?? []) {
      const id = String((r as any).po_line_id || "");
      const q = Number((r as any).shipped_qty ?? 0);
      if (!id) continue;
      shippedMap.set(id, (shippedMap.get(id) ?? 0) + (Number.isFinite(q) ? q : 0));
    }

    // 4) 라인별 검증 + qty_cancelled 업데이트
    for (const x of lines) {
      const id = String(x?.po_line_id ?? "").trim();
      const n = toInt(x?.qty_cancelled);
      if (!id) return bad("po_line_id missing", 400);
      if (n === null) return bad(`qty_cancelled must be integer for line ${id}`, 400);
      if (n < 0) return bad(`qty_cancelled cannot be negative for line ${id}`, 400);

      const row = lineMap.get(id);
      if (!row) return bad(`Line not found: ${id}`, 404);

      const ordered = Number(row.qty ?? 0) || 0;
      const shipped = shippedMap.get(id) ?? 0;

      const maxCancel = Math.max(0, ordered - shipped);
      if (n > maxCancel) {
        return bad(`Cancel exceeds available qty for line ${id}`, 409, {
          ordered,
          shipped,
          maxCancel,
          requested: n,
        });
      }

      const { error: uErr } = await supabaseAdmin
        .from("po_lines")
        .update({ qty_cancelled: n })
        .eq("id", id);

      if (uErr) return bad(`Failed to update line ${id}`, 500, { detail: uErr.message });
    }

    // 5) 전체 라인 재계산해서 po_headers.status 자동 업데이트
    const { data: allLines, error: alErr } = await supabaseAdmin
      .from("po_lines")
      .select("id, qty, qty_cancelled")
      .eq("po_header_id", poHeaderId);

    if (alErr) return bad("Failed to reload po_lines", 500, { detail: alErr.message });

    const allIds = (allLines ?? []).map((r: any) => String(r.id)).filter(Boolean);

    const shippedAllMap = new Map<string, number>();
    if (allIds.length > 0) {
      const { data: shipAll, error: saErr } = await supabaseAdmin
        .from("shipment_lines")
        .select("po_line_id, shipped_qty")
        .in("po_line_id", allIds);

      if (saErr) return bad("Failed to reload shipment_lines", 500, { detail: saErr.message });

      for (const r of shipAll ?? []) {
        const id = String((r as any).po_line_id || "");
        const q = Number((r as any).shipped_qty ?? 0);
        if (!id) continue;
        shippedAllMap.set(id, (shippedAllMap.get(id) ?? 0) + (Number.isFinite(q) ? q : 0));
      }
    }

    let sumShipped = 0;
    let allRemainingZero = true;

    for (const r of allLines ?? []) {
      const id = String((r as any).id || "");
      const ordered = Number((r as any).qty ?? 0) || 0;
      const cancelled = Number((r as any).qty_cancelled ?? 0) || 0;
      const shipped = shippedAllMap.get(id) ?? 0;
      sumShipped += shipped;

      const remaining = ordered - shipped - cancelled;
      if (remaining !== 0) allRemainingZero = false;
    }

    let newStatus: string | null = null;
    if (allRemainingZero) {
      newStatus = sumShipped > 0 ? "SHIPPED" : "CANCELLED";
    } else if (sumShipped > 0) {
      newStatus = "PARTIALLY_SHIPPED";
    }

    if (newStatus && newStatus !== String(header.status ?? "")) {
      const patch: any = { status: newStatus, updated_at: new Date().toISOString() };

      // If client provided cancel meta, store it (do not overwrite existing unless empty)
      if (cancel_reason && !header.cancel_reason) patch.cancel_reason = cancel_reason;
      if (cancel_note && !header.cancel_note) patch.cancel_note = cancel_note;
      if (cancel_date && !header.cancel_date) patch.cancel_date = cancel_date;


      if (newStatus === "CANCELLED") {
        // cancel_date가 비어있으면 오늘로
        if (!header.cancel_date) {
          patch.cancel_date = new Date().toISOString().slice(0, 10);
        }
      }

      const { error: phErr } = await supabaseAdmin
        .from("po_headers")
        .update(patch)
        .eq("id", poHeaderId);

      if (phErr) return bad("Failed to update po_headers.status", 500, { detail: phErr.message });
    }

    return ok({ po_no: poNo, po_header_id: poHeaderId, status: newStatus ?? header.status });
  } catch (err: any) {
    console.error("cancel-lines fatal:", err);
    return bad(err?.message || "Unknown error", 500);
  }
}
