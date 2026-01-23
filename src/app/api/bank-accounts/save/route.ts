// src/app/api/bank-accounts/save/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: NextRequest) {
  const body = await req.json();

  const {
    id,
    site_code,
    account_name,
    bank_name,
    account_no_masked,
    account_holder_name,
    swift_code,
    currency,
    is_default_for_site,
    is_active,
  } = body;

  // 1. default 계좌면 기존 default 해제
  if (is_default_for_site && site_code) {
    await supabaseAdmin
      .from("bank_accounts")
      .update({ is_default_for_site: false })
      .eq("site_code", site_code);
  }

  // 2. upsert
  const { error } = await supabaseAdmin
    .from("bank_accounts")
    .upsert({
      id,
      site_code,
      account_name,
      bank_name,
      account_no_masked,
      account_holder_name,
      swift_code,
      currency,
      is_default_for_site,
      is_active,
    });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
