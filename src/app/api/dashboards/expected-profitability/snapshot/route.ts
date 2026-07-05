import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createExpectedMarginSnapshot } from "@/lib/expectedMarginSnapshot";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    let poHeaderId = String(body?.po_header_id ?? "").trim();
    const poNo = String(body?.po_no ?? "").trim();
    if (!poHeaderId && poNo) {
      const { data, error } = await supabaseAdmin
        .from("po_headers")
        .select("id")
        .eq("po_no", poNo)
        .eq("is_deleted", false)
        .maybeSingle();
      if (error) throw error;
      poHeaderId = String(data?.id ?? "");
    }
    if (!poHeaderId) {
      return NextResponse.json({ success: false, error: "PO not found" }, { status: 404 });
    }
    const result = await createExpectedMarginSnapshot({
      poHeaderId,
      userId: body?.user_id ?? null,
      userEmail: body?.user_email ?? null,
    });
    return NextResponse.json({ success: true, result });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e?.message ?? "Failed to create Expected snapshot" },
      { status: 500 }
    );
  }
}
