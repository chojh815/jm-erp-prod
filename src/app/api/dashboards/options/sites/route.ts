import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../_supabase";

export const dynamic = "force-dynamic";

/**
 * GET /api/dashboards/options/sites
 * Returns: { items: [{ id, code, name }] }
 *
 * Fix:
 * - company_sites has NO "code" column in your schema (error 42703).
 * - Therefore: do NOT .order("code") or reference it in select.
 * - Fetch with select("*") then derive code/name and sort in-memory.
 */
export async function GET() {
  try {
    const supabase = createSupabaseServerClient();

    const { data, error } = await supabase.from("company_sites").select("*");
    if (error) throw error;

    const items = (data || [])
      .filter((r: any) => r?.is_deleted !== true)
      .map((r: any) => {
        const code =
          r.shipping_origin_code ??
          r.site_code ??
          r.origin_code ??
          r.id;

        const name =
          r.name ??
          r.site_name ??
          r.city ??
          r.address_line1 ??
          r.address ??
          code;

        return { id: r.id, code: code ?? null, name: name ?? null };
      })
      .sort((a: any, b: any) => {
        const ac = String(a.code ?? "");
        const bc = String(b.code ?? "");
        if (ac !== bc) return ac.localeCompare(bc);
        return String(a.name ?? "").localeCompare(String(b.name ?? ""));
      });

    return NextResponse.json({ items });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || String(e), hint: e?.hint, details: e?.details, code: e?.code },
      { status: 500 }
    );
  }
}
