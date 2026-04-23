import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function ok(data: any = {}) {
  return NextResponse.json({ ok: true, ...data });
}

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const id = String(params?.id || "").trim();
    if (!id) return bad("Cash transaction id is required", 400);

    const { error } = await supabaseAdmin
      .from("cash_transactions")
      .update({ is_deleted: true })
      .eq("id", id)
      .eq("is_deleted", false);

    if (error) throw error;
    return ok();
  } catch (e: any) {
    return bad(e?.message || "Failed to delete cash transaction", 500);
  }
}
