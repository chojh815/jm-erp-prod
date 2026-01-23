import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function s(v: any) {
  return (v ?? "").toString().trim();
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const q = s(url.searchParams.get("q"));
    const siteCode = s(url.searchParams.get("site_code"));
    const activeOnly = url.searchParams.get("active_only") !== "0"; // default true
    const includeAny = url.searchParams.get("include_any") !== "0"; // default true

    let query = supabaseAdmin
      .from("bank_accounts")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("account_name", { ascending: true });

    if (activeOnly) query = query.eq("is_active", true);

    // site_code filter:
    // - if site_code is provided: return that site_code plus (optional) ANY (null site_code)
    // - if site_code is not provided: return all sites
    if (siteCode) {
      if (includeAny) {
        query = query.or(`site_code.eq.${siteCode},site_code.is.null`);
      } else {
        query = query.eq("site_code", siteCode);
      }
    }

    const { data, error } = await query;
    if (error) throw error;

    const rows = (data ?? []).filter((r: any) => {
      if (!q) return true;
      const hay = `${s(r.account_name)} ${s(r.bank_name)} ${s(r.currency)} ${s(r.site_code)} ${s(r.account_no_masked)} ${s(r.swift_code)} ${s(r.account_holder_name)}`.toLowerCase();
      return hay.includes(q.toLowerCase());
    });

    return NextResponse.json({ success: true, rows });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
