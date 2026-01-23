import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // companies table in JM_ERP_V2 has NO `is_deleted` column (confirmed).
  // Use supabaseAdmin to avoid RLS issues in the browser client.
  const { data, error } = await supabaseAdmin
    .from("companies")
    .select("id, company_name, code, company_type")
    .eq("company_type", "buyer")
    .order("company_name", { ascending: true });

  if (error) {
    return NextResponse.json(
      { success: false, error: error.message, data: [] },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, data: data ?? [] });
}
