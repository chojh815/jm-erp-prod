import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function upper(v: any) {
  return (v ?? "").toString().trim().toUpperCase();
}

/**
 * GET /api/quotations/bootstrap
 *
 * Goal: Buyer dropdown should show BUYERS only (not vendors/factories/internal sites).
 *
 * Filtering strategy (robust across your varying schemas):
 * 1) Prefer explicit type columns:
 *    - company_type, type, company_category, category, role (any of these)
 *    Include if contains BUYER/CUSTOMER/CLIENT
 *    Exclude if contains VENDOR/FACTORY/SUPPLIER
 * 2) Fallback heuristic:
 *    - if buyer_brand or buyer_dept is present => treat as buyer
 * 3) Exclude internal JM sites by code prefix 'JMI' (optional but recommended)
 *
 * If your schema has a definitive buyer flag/enum, tell me and I'll harden this.
 */
export async function GET() {
  try {
    const sb = supabaseAdmin;

    const { data, error } = await sb
      .from("companies")
      .select("*")
      .order("code", { ascending: true });

    if (error) throw new Error(error.message);

    const buyers =
      (data ?? [])
        .filter((r: any) => {
          const t =
            upper(r.company_type) ||
            upper(r.type) ||
            upper(r.company_category) ||
            upper(r.category) ||
            upper(r.role);

          const isExplicitBuyer = t.includes("BUYER") || t.includes("CUSTOMER") || t.includes("CLIENT");
          const isExplicitNonBuyer = t.includes("VENDOR") || t.includes("FACTORY") || t.includes("SUPPLIER");

          const hasBuyerHints = !!(r.buyer_brand || r.buyer_dept);

          const code = (r.code ?? "").toString().trim();
          const isInternal = upper(code).startsWith("JMI");

          // If explicit non-buyer => exclude
          if (isExplicitNonBuyer) return false;

          // If explicit buyer => include (unless internal)
          if (isExplicitBuyer) return !isInternal;

          // Otherwise fallback: include only rows that look like buyers
          if (hasBuyerHints) return !isInternal;

          return false;
        })
        .map((r: any) => ({
          id: r.id,
          code: (r.code ?? "").toString(),
          name: (r.company_name ?? r.name ?? r.company_name_en ?? r.company_name_kr ?? "").toString(),
          buyer_brand: (r.buyer_brand ?? null) as string | null,
        }))
        .filter((b: any) => b.id && b.code && b.name);

    return NextResponse.json({ success: true, buyers });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || String(e) }, { status: 500 });
  }
}
