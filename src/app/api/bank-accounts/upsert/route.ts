import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanText(v: any) {
  const t = (v ?? "").toString().trim();
  return t === "" ? null : t;
}
function cleanBool(v: any, def = false) {
  if (v === true || v === false) return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return def;
}
function cleanNum(v: any, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const id = cleanText(body.id);
    const site_code = cleanText(body.site_code); // null = ANY
    const account_name = cleanText(body.account_name);
    if (!account_name) {
      return NextResponse.json(
        { success: false, error: "account_name is required" },
        { status: 400 }
      );
    }

    const payload: any = {
      site_code,
      account_name,
      bank_name: cleanText(body.bank_name),
      account_no_masked: cleanText(body.account_no_masked),
      currency: cleanText(body.currency),
      account_holder_name: cleanText(body.account_holder_name),
      swift_code: cleanText(body.swift_code),
      opening_balance: cleanNum(body.opening_balance, 0),
      is_active: cleanBool(body.is_active, true),
      is_default_for_site: cleanBool(body.is_default_for_site, false),
      sort_order: cleanNum(body.sort_order, 0),
      updated_at: new Date().toISOString(),
    };

    // Insert or Update
    let saved: any = null;

    if (id) {
      const { data, error } = await supabaseAdmin
        .from("bank_accounts")
        .update(payload)
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;
      saved = data;
    } else {
      const { data, error } = await supabaseAdmin
        .from("bank_accounts")
        .insert({ ...payload })
        .select("*")
        .single();
      if (error) throw error;
      saved = data;
    }

    // Enforce "default" uniqueness per (site_code, currency) when site_code is not null
    // (If site_code is null (ANY), allow multiple defaults - it's a global fallback.)
    if (saved?.is_default_for_site && saved?.site_code) {
      // Turn off other defaults in same site+currency
      let q = supabaseAdmin
        .from("bank_accounts")
        .update({ is_default_for_site: false, updated_at: new Date().toISOString() })
        .neq("id", saved.id)
        .eq("site_code", saved.site_code);

      if (saved.currency) q = q.eq("currency", saved.currency);
      const { error: e2 } = await q;
      if (e2) throw e2;
    }

    return NextResponse.json({ success: true, row: saved });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
