import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}
function bad(message: string, status = 400, extra: any = {}) {
  return NextResponse.json({ success: false, error: message, ...extra }, { status });
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const keywordRaw = (url.searchParams.get("keyword") || "").toString().trim();
    const keyword = keywordRaw.toUpperCase();
    if (!keyword) return ok({ items: [], hasMore: false });

    const { data, error } = await supabaseAdmin
      .from("product_development_headers")
      .select("id, style_no, product_type, product_category, dev_date, updated_at")
      .eq("is_deleted", false)
      .ilike("style_no", `%${keyword}%`)
      .order("updated_at", { ascending: false })
      .limit(50);

    if (error) return bad("Failed to search products.", 500, { detail: error.message });

    const items = (data ?? []).map((r: any) => ({
      id: r.id,
      styleNo: r.style_no,
      style_no: r.style_no,
      productType: r.product_type ?? null,
      productCategory: r.product_category ?? null,
      devDate: r.dev_date ?? null,
      dev_date: r.dev_date ?? null,
    }));

    return ok({ items, hasMore: false });
  } catch (e: any) {
    return bad("Unexpected error.", 500, { detail: e?.message });
  }
}
