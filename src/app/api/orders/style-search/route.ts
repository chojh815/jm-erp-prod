// src/app/api/orders/style-search/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function okResponse(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}

// GET /api/orders/style-search?mode=jm|buyer&q=keyword
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const mode = (searchParams.get("mode") || "jm") as "jm" | "buyer";
    const keyword = (searchParams.get("q") || "").trim();

    if (!keyword) {
      return errorResponse("q is required", 400);
    }

    if (mode === "jm") {
      // JM Style 검색: dev_products 기준
      const { data, error } = await supabaseAdmin
        .from("dev_products")
        .select(
          `
            id,
            style_no,
            product_type,
            product_category,
            size,
            color_suffix,
            currency,
            dev_date,
            developer,
            remarks,
            weight,
            image_url
          `
        )
        .or(
          [
            `style_no.ilike.%${keyword}%`,
            `product_type.ilike.%${keyword}%`,
            `remarks.ilike.%${keyword}%`,
          ].join(",")
        )
        .order("style_no", { ascending: true })
        .limit(50);

      if (error) return errorResponse(error.message, 500);

      return okResponse({ mode: "jm", items: data ?? [] });
    }

    // mode === "buyer"
    // Buyer Style 검색: po_lines + po_headers(바이어/오더정보) 기준
    const { data, error } = await supabaseAdmin
      .from("po_lines")
      .select(
        `
          id,
          buyer_style_no,
          jm_style_no,
          description,
          color,
          size,
          plating_color,
          hs_code,
          qty,
          uom,
          unit_price,
          amount,
          upc_code,
          currency,
          created_at,
          po_headers!inner (
            id,
            po_no,
            buyer_name,
            order_date,
            requested_ship_date,
            destination
          )
        `
      )
      .or(
        [
          `buyer_style_no.ilike.%${keyword}%`,
          `jm_style_no.ilike.%${keyword}%`,
          `description.ilike.%${keyword}%`,
        ].join(",")
      )
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) return errorResponse(error.message, 500);

    // 중복 buyer_style_no / jm_style_no 가 많을 수 있으니
    // 최신 한 건만 남기고 정리(간단 distinct)
    const seen = new Set<string>();
    const unique =
      data?.filter((row: any) => {
        const key = `${row.buyer_style_no || ""}__${row.jm_style_no || ""}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }) ?? [];

    return okResponse({ mode: "buyer", items: unique });
  } catch (e: any) {
    return errorResponse(e?.message || "unexpected error", 500);
  }
}
