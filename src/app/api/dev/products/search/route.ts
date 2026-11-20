import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isGarmentSubcategory } from "@/lib/garmentSubcategories";

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
    const subcategory = url.searchParams.get("subcategory");
    if (subcategory !== null && !isGarmentSubcategory(subcategory)) {
      return bad("Invalid garment subcategory.");
    }
    if (!keyword && !subcategory) return ok({ items: [], hasMore: false });

    let query = supabaseAdmin
      .from("product_development_headers")
      .select("id, style_no, product_type, product_category, product_subcategory, dev_date")
      .eq("is_deleted", false);
    if (keyword) query = query.ilike("style_no", `%${keyword}%`);
    if (subcategory) {
      query = query.eq("product_category", "G").eq("product_subcategory", subcategory);
    }

    const { data, error } = await query
      .order("updated_at", { ascending: false })
      .order("style_no")
      .limit(51);

    if (error) return bad("Failed to search products.", 500, { detail: error.message });

    const items = (data ?? []).slice(0, 50).map((r: any) => ({
      id: r.id,
      styleNo: r.style_no,
      style_no: r.style_no,
      productType: r.product_type ?? null,
      productCategory: r.product_category ?? null,
      productSubcategory: r.product_subcategory ?? null,
      devDate: r.dev_date ?? null,
      dev_date: r.dev_date ?? null,
    }));

    return ok({ items, hasMore: (data?.length ?? 0) > 50 });
  } catch (e: any) {
    return bad("Unexpected error.", 500, { detail: e?.message });
  }
}
