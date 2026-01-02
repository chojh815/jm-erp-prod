// src/app/api/invoices/[id]/confirm/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function bad(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}
function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const id = params?.id;
    if (!id) return bad("Invoice id is required", 400);

    const body = await req.json().catch(() => ({}));
    const confirmedBy = body?.confirmed_by ?? null;
    const confirmedByEmail = body?.confirmed_by_email ?? null;

    const { data: cur, error: curErr } = await supabaseAdmin
      .from("invoice_headers")
      .select("id,status,is_deleted")
      .eq("id", id)
      .maybeSingle();

    if (curErr) return bad(curErr.message, 500);
    if (!cur) return bad("Invoice not found", 404);
    if (cur.is_deleted) return bad("Invoice is deleted", 404);

    if ((cur.status ?? "").toUpperCase() === "CONFIRMED") {
      return ok({ id, already_confirmed: true });
    }

    const { error: updErr } = await supabaseAdmin
      .from("invoice_headers")
      .update({
        status: "CONFIRMED",
        confirmed_at: new Date().toISOString(),
        confirmed_by: confirmedBy,
        confirmed_by_email: confirmedByEmail,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (updErr) return bad(updErr.message, 500);

    return ok({ id });
  } catch (e: any) {
    console.error("[POST /api/invoices/[id]/confirm]", e);
    return bad(e?.message ?? "Server error", 500);
  }
}
