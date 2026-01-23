import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safe(v: any) {
  return (v ?? "").toString().trim();
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const site_code = safe(url.searchParams.get("site_code"));
    const currency = safe(url.searchParams.get("currency"));

    if (!site_code) {
      return NextResponse.json({ success: false, error: "site_code is required" }, { status: 400 });
    }

    let q = supabaseAdmin
      .from("bank_accounts")
      .select("id, site_code, account_name, bank_name, account_no_masked, currency, is_default_for_site, sort_order, is_active")
      .eq("is_active", true)
      .eq("site_code", site_code);

    if (currency) q = q.eq("currency", currency);

    const { data, error } = await q
      .order("is_default_for_site", { ascending: false })
      .order("sort_order", { ascending: true })
      .order("updated_at", { ascending: false })
      .limit(1);

    if (error) throw error;

    return NextResponse.json({ success: true, row: (data && data[0]) ? data[0] : null });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
