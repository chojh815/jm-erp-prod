import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/app/api/_supabase";

export const dynamic = "force-dynamic";
const BUCKET = "red-quotation-images";

export async function DELETE(_: Request, { params }: { params: { id: string; imageId: string } }) {
  try {
    const supabase = createSupabaseServerClient();
    const quotationId = params.id;
    const imageId = params.imageId;

    // Fetch row
    const { data: row, error: rErr } = await supabase
      .from("red_quotation_images")
      .select("id, quotation_id, path")
      .eq("id", imageId)
      .maybeSingle();

    if (rErr) throw rErr;
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (row.quotation_id !== quotationId) return NextResponse.json({ error: "Mismatched quotation" }, { status: 400 });

    if (row.path) {
      const { error: dErr } = await supabase.storage.from(BUCKET).remove([row.path]);
      if (dErr) throw dErr;
    }

    const { error: delErr } = await supabase
      .from("red_quotation_images")
      .delete()
      .eq("id", imageId);

    if (delErr) throw delErr;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "DELETE image failed" }, { status: 500 });
  }
}
