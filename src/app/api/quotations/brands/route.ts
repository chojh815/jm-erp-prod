// src/app/api/quotations/brands/route.ts
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../_supabase";

export const dynamic = "force-dynamic";

function uniqSortedStrings(arr: any[]): string[] {
  const set = new Set<string>();
  for (const v of arr || []) {
    const s = (v ?? "").toString().trim();
    if (s) set.add(s);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

/**
 * GET /api/quotations/brands
 * Optional query:
 * - buyer_id: filter by buyer
 * - q: keyword filter (contains)
 *
 * Returns: string[] (brand names)
 */
export async function GET(req: Request) {
  try {
    const supabase = createSupabaseServerClient();

    const url = new URL(req.url);
    const buyerId = (url.searchParams.get("buyer_id") || "").trim();
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();

    // We try to read brand from quotation_headers first.
    // Many schemas store it as buyer_brand_name or brand_name etc.
    let query = supabase
      .from("quotation_headers")
      .select("buyer_brand_name, brand_name, brand, buyer_brand")
      .limit(5000);

    if (buyerId) query = query.eq("buyer_id", buyerId);

    const { data, error } = await query;
    if (error) throw error;

    const candidates: string[] = [];
    for (const row of data || []) {
      candidates.push(
        (row as any)?.buyer_brand_name,
        (row as any)?.brand_name,
        (row as any)?.brand,
        (row as any)?.buyer_brand
      );
    }

    let brands = uniqSortedStrings(candidates);

    if (q) {
      brands = brands.filter((b) => b.toLowerCase().includes(q));
    }

    return NextResponse.json({ ok: true, brands });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

