// src/app/api/costings/search/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Costings / Product Development style search
 *
 * - Case-insensitive
 * - Partial match supported (e.g., "jk26" finds "JK260001", "JK260002", ...)
 *
 * GET /api/costings/search?q=jk26&limit=50
 */
function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function escapeLike(input: string) {
  // Escape % and _ which are wildcards in LIKE/ILIKE.
  // We'll use "ilike" which maps to ILIKE under the hood; escaping still matters.
  return input.replace(/[%_]/g, (m) => `\\${m}`);
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const rawQ = (url.searchParams.get("q") ?? "").trim();
    const limit = clamp(Number(url.searchParams.get("limit") ?? "50") || 50, 1, 200);

    if (!rawQ) {
      return NextResponse.json({ success: true, rows: [] });
    }

    // Support users typing only part of style no (jk26, jk2600, etc.)
    // We'll do a contains match by default.
    const q = escapeLike(rawQ);
    const pattern = `%${q}%`;

    // Primary: Product Development Products (style master for dev)
    // NOTE: "style_no" is confirmed in your DB.
    const { data: rows, error } = await supabaseAdmin
      .from("product_development_products")
      .select("id, style_no, product_type, product_category")
      .ilike("style_no", pattern) // case-insensitive partial match
      .order("style_no", { ascending: true })
      .limit(limit);

    if (error) {
      return NextResponse.json(
        { success: false, message: error.message, hint: error.hint },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, rows: rows ?? [] });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, message: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
