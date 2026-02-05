import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

function isUndefinedColumnError(e: any) {
  return e?.code === "42703" || /column .* does not exist/i.test(e?.message || "");
}

export async function GET() {
  const supabase = createSupabaseServerClient();

  // Try with full columns first; if some columns don't exist, fall back safely.
  const baseSelect =
    "id,style_no,buyer_name,buyer_code,buyer_brand_name,stage,status,updated_at,created_at,offer_usd,target_margin_pct,fx_cny_per_usd,is_deleted,quotation_id,quotation_line_id";

  // 1) Full query with is_deleted filter (preferred)
  let data: any[] | null = null;
  let error: any = null;

  let q = supabase
    .from("costing_headers")
    .select(baseSelect)
    .eq("is_deleted", false)
    .order("updated_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(300);

  ({ data, error } = await q);

  if (error && isUndefinedColumnError(error)) {
    // 2) If is_deleted column missing, try without it (but you should add is_deleted)
    const sel2 =
      "id,style_no,buyer_name,buyer_code,buyer_brand_name,stage,status,updated_at,created_at,offer_usd,target_margin_pct,fx_cny_per_usd,quotation_id,quotation_line_id";
    const q2 = supabase
      .from("costing_headers")
      .select(sel2)
      .order("updated_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(300);

    const r2 = await q2;
    data = (r2.data ?? []) as any[];
    error = r2.error;
  }

  if (error) {
    return NextResponse.json({ success: false, message: error.message || "Failed to load list", error }, { status: 500 });
  }

  return NextResponse.json({ success: true, rows: data ?? [] });
}
