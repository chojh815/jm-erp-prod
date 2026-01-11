// src/app/api/invoices/list/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function ok(data: any) {
  return NextResponse.json({ success: true, ...data });
}
function bad(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}
function safeTrim(v: any) {
  return (v ?? "").toString().trim();
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const keyword = safeTrim(searchParams.get("keyword"));
    const buyerId = safeTrim(searchParams.get("buyer_id"));
    const status = safeTrim(searchParams.get("status")) || "ALL";

    // pagination(선택)
    const limit = Math.min(Number(searchParams.get("limit") || 200), 1000);

    let q = supabaseAdmin
      .from("invoice_headers")
      .select(
        "id, invoice_no, buyer_id, buyer_name, buyer_code, currency, total_amount, status, etd, eta, shipment_id, created_at, is_deleted"
      )
      .or("is_deleted.is.null,is_deleted.eq.false")
      .order("created_at", { ascending: false })
      .limit(limit);

    // ✅ status=ALL이면 필터 적용 금지
    if (status && status.toUpperCase() !== "ALL") {
      q = q.eq("status", status.toUpperCase());
    }

    // ✅ buyer_id=ALL/빈값이면 필터 적용 금지
    if (buyerId && buyerId.toUpperCase() !== "ALL") {
      q = q.eq("buyer_id", buyerId);
    }

    // ✅ keyword 검색 (invoice_no / buyer_name / buyer_code)
    if (keyword) {
      const like = `%${keyword}%`;
      q = q.or(
        `invoice_no.ilike.${like},buyer_name.ilike.${like},buyer_code.ilike.${like}`
      );
    }

    const { data, error } = await q;
    if (error) return bad(error.message, 500);

    return ok({ rows: data || [] });
  } catch (e: any) {
    return bad(e?.message || "Unknown error", 500);
  }
}
