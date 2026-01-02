import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}
function bad(message: string, status = 400, meta?: any) {
  return NextResponse.json(
    { success: false, error: message, ...(meta ? { meta } : {}) },
    { status }
  );
}

function safeText(v: any): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/**
 * PUT /api/invoices/lines/:id
 * - material_content, hs_code만 업데이트
 * - Invoice CONFIRMED면 409 잠금
 */
export async function PUT(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const lineId = params?.id;
    if (!lineId) return bad("Line id is required", 400);

    const body = await req.json().catch(() => ({}));
    const material_content = safeText(body?.material_content);
    const hs_code = safeText(body?.hs_code);

    // 1) 라인 확인
    const { data: line, error: lineErr } = await supabaseAdmin
      .from("invoice_lines")
      .select("id, invoice_id, invoice_header_id, is_deleted")
      .eq("id", lineId)
      .maybeSingle();

    if (lineErr) return bad(lineErr.message, 500);
    if (!line || line.is_deleted) return bad("Invoice line not found", 404);

    const headerId = (line.invoice_id ?? line.invoice_header_id) as string | null;
    if (!headerId) return bad("Invoice header id not found on line", 500);

    // 2) 헤더 상태 확인 (CONFIRMED 잠금)
    const { data: header, error: headErr } = await supabaseAdmin
      .from("invoice_headers")
      .select("id, status, is_deleted")
      .eq("id", headerId)
      .maybeSingle();

    if (headErr) return bad(headErr.message, 500);
    if (!header || header.is_deleted) return bad("Invoice header not found", 404);

    const status = String(header.status ?? "").toUpperCase();
    const locked = status === "CONFIRMED";

    const meta = {
      locked,
      lock_reason: locked ? "Invoice is CONFIRMED. Create a Revision to edit." : null,
    };

    if (locked) return bad("Invoice is locked (CONFIRMED).", 409, meta);

    // 3) 업데이트
    const { data: updated, error: upErr } = await supabaseAdmin
      .from("invoice_lines")
      .update({
        material_content,
        hs_code,
        updated_at: new Date().toISOString(),
      })
      .eq("id", lineId)
      .select(
        "id, po_no, style_no, description, material_content, hs_code, qty, unit_price, amount"
      )
      .maybeSingle();

    if (upErr) return bad(upErr.message, 500);

    return ok({ line: updated, meta });
  } catch (e: any) {
    console.error("PUT /api/invoices/lines/[id] error:", e);
    return bad(e?.message ?? "Server error", 500);
  }
}
