import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}
function bad(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim();
    const status = (searchParams.get("status") || "ALL").trim();

    // 최신 revision만 + soft delete 제외
    let query = supabaseAdmin
      .from("invoice_headers")
      .select(
        "id, invoice_no, buyer_name, buyer_code, currency, total_amount, status, etd, eta, created_at"
      )
      .eq("is_deleted", false)
      .eq("is_latest", true)
      .order("created_at", { ascending: false })
      .limit(200);

    if (status && status !== "ALL") {
      query = query.eq("status", status);
    }

    if (q) {
      // invoice_no / buyer_name / buyer_code
      const like = `%${q}%`;
      query = query.or(
        `invoice_no.ilike.${like},buyer_name.ilike.${like},buyer_code.ilike.${like}`
      );
    }

    const { data, error } = await query;
    if (error) return bad(error.message, 500);

    return ok({ rows: data || [] });
  } catch (e: any) {
    return bad(e?.message || "Unknown error", 500);
  }
}
