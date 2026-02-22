import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim();
    const poHeaderId = (searchParams.get("po_header_id") || "").trim();
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "50", 10) || 50, 1), 200);

    let query = supabaseAdmin
      .from("po_lines")
      .select(
        [
          "id",
          "po_header_id",
          "line_no",
          "style_no",
          "jm_style_no",
          "buyer_style_no",
          "description",
          "color",
          "size",
          "qty",
          // join for PO No / Site / Buyer info
          "po_headers:po_header_id(po_no,site_id,buyer_name,buyer_code)",
        ].join(",")
      )
      .eq("is_deleted", false)
      .order("line_no", { ascending: true, nullsFirst: false })
      .limit(limit);

    if (poHeaderId) query = query.eq("po_header_id", poHeaderId);

    if (q) {
      query = query.or(
        [
          `buyer_style_no.ilike.%${q}%`,
          `jm_style_no.ilike.%${q}%`,
          `style_no.ilike.%${q}%`,
          `description.ilike.%${q}%`,
          // search by PO No too
          `po_headers.po_no.ilike.%${q}%`,
        ].join(",")
      );
    }

    const { data, error } = await query;
    if (error) throw error;

    const items = (data || []).map((r: any) => {
      const ph = r.po_headers ?? null;
      return {
        id: r.id,
        po_header_id: r.po_header_id ?? null,
        po_no: ph?.po_no ?? null,
        line_no: r.line_no ?? null,
        jm_style_no: r.jm_style_no ?? r.style_no ?? null,
        buyer_style_no: r.buyer_style_no ?? null,
        buyer_name: ph?.buyer_name ?? null,
        buyer_code: ph?.buyer_code ?? null,
        site_id: ph?.site_id ?? null,
        site_code: null,
      };
    });

    return NextResponse.json({ ok: true, items });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
