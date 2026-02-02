import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * DELETE /api/quotations/lines/:line_id/attachments/:attach_id
 * Soft delete DB + best-effort remove from storage
 */
export async function DELETE(
  _req: Request,
  { params }: { params: { line_id: string; attach_id: string } }
) {
  try {
    const attachId = params.attach_id;

    const { data: row, error: selErr } = await supabaseAdmin
      .from("quotation_line_attachments")
      .select("*")
      .eq("id", attachId)
      .single();
    if (selErr) throw selErr;

    try {
      if (row?.file_path) {
        await supabaseAdmin.storage.from("quotation-attachments").remove([row.file_path]);
      }
    } catch {}

    const { error: upErr } = await supabaseAdmin
      .from("quotation_line_attachments")
      .update({ is_deleted: true, deleted_at: new Date().toISOString() })
      .eq("id", attachId);

    if (upErr) throw upErr;

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || String(e) }, { status: 500 });
  }
}
