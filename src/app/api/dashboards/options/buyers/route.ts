import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../_supabase";

export const dynamic = "force-dynamic";

/**
 * GET /api/dashboards/options/buyers
 * Returns: { items: [{ id, code, name }] }
 *
 * Conservative:
 * - Reads from "companies" and tries to filter to BUYER rows.
 * - If your schema uses different discriminator columns, it still works (falls back to all rows).
 */
export async function GET() {
  try {
    const supabase = createSupabaseServerClient();

    // Try common discriminator columns. If none exist, the filter will be ignored by select("*") path below.
    // We'll first attempt a filtered query; if it errors (missing column), we fallback to plain select("*").
    let data: any[] | null = null;

    const attempt = await supabase
      .from("companies")
      .select("*")
      .in("company_type", ["BUYER", "Buyer", "buyer"])
      .limit(500);

    if (!attempt.error) {
      data = attempt.data as any[];
    } else {
      const fallback = await supabase.from("companies").select("*").limit(500);
      if (fallback.error) throw fallback.error;
      data = fallback.data as any[];
    }

    const items = (data || [])
      .filter((r: any) => r?.is_deleted !== true)
      .map((r: any) => {
        const code =
          r.code ??
          r.company_code ??
          r.buyer_code ??
          r.short_code ??
          r.id;

        const name =
          r.name ??
          r.company_name ??
          r.buyer_name ??
          r.display_name ??
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
