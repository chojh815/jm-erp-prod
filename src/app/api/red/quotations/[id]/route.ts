import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../_supabase";

export const dynamic = "force-dynamic";

/**
 * PUT /api/red/quotations/[id]
 * PATCH fields on red_quotations
 */
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createSupabaseServerClient();
    const id = params?.id;
    const body = await req.json().catch(() => ({}));

    const patch: any = {};
    for (const k of ["buyer_name", "style_no", "ship_from_code", "title", "thumbnail_url", "thumbnail_path"]) {
      if (k in body) patch[k] = body[k] === "" ? null : body[k];
    }

    const { data, error } = await supabase
      .from("red_quotations")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Update failed" }, { status: 500 });
  }
}

/**
 * DELETE /api/red/quotations/[id]
 *
 * IMPORTANT:
 * - Your DB currently does NOT have is_deleted / deleted_at columns on red_quotations
 *   (you saw: "Could not find the 'is_deleted' column ...").
 * - So this endpoint performs a HARD DELETE (row delete) to avoid schema errors.
 *
 * If later you want SOFT DELETE, add columns first, then switch this back to update().
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createSupabaseServerClient();
    const id = params?.id;

    const { error } = await supabase.from("red_quotations").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Delete failed" }, { status: 500 });
  }
}
