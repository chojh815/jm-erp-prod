import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim();
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "20", 10) || 20, 1), 50);

    // Use select('*') to avoid schema drift issues.
    let query = supabaseAdmin
      .from("shipments")
      .select("*")
      .order("created_at", { ascending: false, nullsFirst: false })
      .limit(limit);

    if (q) {
      query = query.or(
        [
          `shipment_no.ilike.%${q}%`,
          `invoice_no.ilike.%${q}%`,
          `po_no.ilike.%${q}%`,
        ].join(",")
      );
    }

    const { data, error } = await query;
    if (error) throw error;

    const items = (data || []).map((r: any) => ({
      id: r.id,
      shipment_no: r.shipment_no ?? r.no ?? r.code ?? null,
      invoice_no: r.invoice_no ?? r.invoice_number ?? null,
      ship_date: r.ship_date ?? r.etd ?? r.shipped_at ?? null,
      buyer_id: r.buyer_id ?? null,
      site_id: r.site_id ?? r.shipping_origin_site_id ?? null,
      po_no: r.po_no ?? null,
      buyer_name: r.buyer_name ?? null,
      buyer_code: r.buyer_code ?? null,
      site_code: r.site_code ?? null,
    }));

    return NextResponse.json({ ok: true, items });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
