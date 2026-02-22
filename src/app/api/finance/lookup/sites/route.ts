import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

// Sites lookup for Expenses UI
// company_sites schema in JM ERP uses: site_name, origin_code, country, currency, is_deleted
// Query params: q, limit
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim();
    const limit = Math.min(
      Math.max(parseInt(searchParams.get("limit") || "200", 10) || 200, 1),
      500
    );

    let query = supabaseAdmin
      .from("company_sites")
      .select("id, site_name, origin_code, country, currency, is_deleted")
      .eq("is_deleted", false)
      .limit(limit);

    if (q) {
      // NOTE: Do NOT reference non-existent columns in .or(), or PostgREST will 500.
      // Keep this aligned with actual schema.
      query = query.or(
        [
          `site_name.ilike.%${q}%`,
          `origin_code.ilike.%${q}%`,
          `country.ilike.%${q}%`,
        ].join(",")
      );
    }

    const { data, error } = await query.order("site_name", { ascending: true });
    if (error) throw error;

    const items = (data || []).map((r: any) => ({
      id: r.id,
      name: r.site_name ?? null,
      code: r.origin_code ?? null,
      country: r.country ?? null,
      currency: r.currency ?? null,
    }));

    return NextResponse.json({ ok: true, items });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}
