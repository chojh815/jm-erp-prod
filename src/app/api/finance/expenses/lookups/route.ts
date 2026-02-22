import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  // Expense types
  const { data: types, error: tErr } = await supabaseAdmin
    .from("expense_types")
    .select("code,name,category,default_scope,default_allocation")
    .eq("is_active", true)
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  if (tErr) return NextResponse.json({ ok: false, error: tErr.message }, { status: 500 });

  // Vendors (forwarders etc.) – use companies table; UI can search further in future
  const { data: companies, error: cErr } = await supabaseAdmin
    .from("companies")
    .select("id,company_name,code,company_type")
    .eq("is_deleted", false)
    .order("company_name", { ascending: true })
    .limit(500);

  if (cErr) return NextResponse.json({ ok: false, error: cErr.message }, { status: 500 });

  const { data: sites } = await supabaseAdmin
    .from("company_sites")
    .select("id,site_name,code,currency")
    .order("site_name", { ascending: true })
    .limit(200);

  return NextResponse.json({
    ok: true,
    data: {
      expense_types: types || [],
      companies: companies || [],
      sites: sites || [],
    },
  });
}
