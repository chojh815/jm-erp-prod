// src/app/api/packing-lists/list/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

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

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const keyword = (url.searchParams.get("keyword") ?? "").trim();
    const buyer = (url.searchParams.get("buyer") ?? "").trim();
    const status = (url.searchParams.get("status") ?? "").trim();

    let q = supabaseAdmin
      .from("packing_list_headers")
      .select(
        "id, packing_list_no, invoice_no, buyer_id, buyer_name, buyer_code, shipping_origin_code, final_destination, status, etd, eta, created_at, is_deleted"
      )
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .limit(200);

    if (keyword) {
      q = q.or(
        `packing_list_no.ilike.%${keyword}%,invoice_no.ilike.%${keyword}%,buyer_name.ilike.%${keyword}%`
      );
    }
    if (buyer) q = q.ilike("buyer_name", `%${buyer}%`);
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
