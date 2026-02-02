import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const buyer_id = url.searchParams.get("buyer_id");
    if (!buyer_id) return NextResponse.json({ success: true, brands: [] });

    const supabase = createRouteHandlerClient({ cookies });

    // B1: 해당 buyer로 저장된 quotation_headers의 buyer_brand_name snapshot만 DISTINCT
    // is_deleted 컬럼이 없을 수도 있어 fail-soft로 처리
    let data: any[] | null = null;
    let error: any = null;

    const r1 = await supabase
      .from("quotation_headers")
      .select("buyer_brand_name")
      .eq("buyer_id", buyer_id)
      .eq("is_deleted", false);

    data = r1.data ?? null;
    error = r1.error ?? null;

    if (error) {
      const r2 = await supabase
        .from("quotation_headers")
        .select("buyer_brand_name")
        .eq("buyer_id", buyer_id);
      data = r2.data ?? null;
      error = r2.error ?? null;
    }

    if (error) throw error;

    const set = new Set<string>();
    for (const r of data ?? []) {
      const v = (r as any)?.buyer_brand_name;
      if (typeof v === "string") {
        const t = v.trim();
        if (t) set.add(t);
      }
    }

    return NextResponse.json({ success: true, brands: Array.from(set).sort((a, b) => a.localeCompare(b)) });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
