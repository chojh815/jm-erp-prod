// src/app/api/packing-lists/list/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function bad(message: string, status = 500) {
  return NextResponse.json({ success: false, error: message }, { status });
}
function ok(data: any = {}) {
  return NextResponse.json(
    { success: true, ...data },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}

// ILIKE 안전 처리: % _ 가 들어와도 검색이 깨지지 않게
function escapeIlike(v: string) {
  return v.replace(/[%_]/g, (m) => `\\${m}`);
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;

    const keywordRaw = (sp.get("keyword") ?? "").trim();
    const buyerRaw = (sp.get("buyer") ?? "").trim();
    const status = (sp.get("status") ?? "").trim();

    const keyword = escapeIlike(keywordRaw);
    const buyer = escapeIlike(buyerRaw);

    let q = supabaseAdmin
      .from("packing_list_headers")
      .select(
        "id, packing_list_no, invoice_no, buyer_id, buyer_name, buyer_code, shipping_origin_code, final_destination, status, etd, eta, created_at, is_deleted"
      )
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .limit(200);

    if (keywordRaw) {
      // escape 사용 시 ilike에는 %...% 유지 + escape 문자 적용
      q = q.or(
        `packing_list_no.ilike.%${keyword}%,invoice_no.ilike.%${keyword}%,buyer_name.ilike.%${keyword}%`
      );
    }
    if (buyerRaw) q = q.ilike("buyer_name", `%${buyer}%`);
    if (status) q = q.eq("status", status);

    const { data, error } = await q;
    if (error) return bad(error.message, 500);

    return ok({
      packingLists: data ?? [],
      items: data ?? [],
    });
  } catch (err: any) {
    console.error("[api/packing-lists/list] error:", err);
    return bad(err?.message ?? "Failed to load packing lists", 500);
  }
}
