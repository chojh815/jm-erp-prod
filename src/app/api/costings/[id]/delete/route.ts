import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabaseServer";

export async function POST(_: Request, ctx: { params: { id: string } }) {
  const id = ctx?.params?.id;
  if (!id) return NextResponse.json({ success: false, message: "Missing id" }, { status: 400 });

  const supabase = createSupabaseServerClient();

  // get user (best-effort)
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  const deleted_by = user?.id ?? null;
  const deleted_by_email = user?.email ?? null;

  // Load linkage flags (quotation_id / quotation_line_id)
  const { data: header, error: hErr } = await supabase
    .from("costing_headers")
    .select("id,quotation_id,quotation_line_id,is_deleted")
    .eq("id", id)
    .maybeSingle();

  if (hErr) {
    return NextResponse.json({ success: false, message: hErr.message || "Failed to load costing" }, { status: 500 });
  }
  if (!header) {
    return NextResponse.json({ success: false, message: "Not found" }, { status: 404 });
  }

  const linked = Boolean((header as any).quotation_id || (header as any).quotation_line_id);
  if (linked) {
    return NextResponse.json(
      { success: false, message: "This costing is linked to a Quotation. Deletion is disabled." },
      { status: 409 }
    );
  }

  if ((header as any).is_deleted) {
    return NextResponse.json({ success: true });
  }

  const { error: uErr } = await supabase
    .from("costing_headers")
    .update({
      is_deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by,
      deleted_by_email,
    })
    .eq("id", id);

  if (uErr) {
    return NextResponse.json({ success: false, message: uErr.message || "Delete failed" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
