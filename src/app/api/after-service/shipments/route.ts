import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/**
 * After Service helper API: search shipments by po_no (best-effort across schemas)
 * Query:
 *  - po_no (required)
 *  - q (optional text filter)
 *
 * Returns rows: { id, shipment_no, shipment_date }
 */
export async function GET(req: NextRequest) {
  const supabase = createClient();
  const url = new URL(req.url);
  const poNo = (url.searchParams.get("po_no") || "").trim();
  const q = (url.searchParams.get("q") || "").trim();

  if (!poNo) return NextResponse.json({ ok: false, error: "po_no is required" }, { status: 400 });

  async function tryTable(table: string, columns: string[]) {
    const sel = columns.join(",");
    let query = supabase.from(table).select(sel).eq("po_no", poNo);
    // tolerate soft delete if present
    query = query.eq("is_deleted", false as any).throwOnError?.() ?? query;
    if (q) {
      query = query.ilike("shipment_no" as any, `%${q}%`) as any;
    }
    return query;
  }

  // Try common tables in order: shipment_headers, shipments
  const candidates: Array<{ table: string; cols: string[] }> = [
    { table: "shipment_headers", cols: ["id", "shipment_no", "shipment_date", "created_at"] },
    { table: "shipments", cols: ["id", "shipment_no", "shipment_date", "created_at"] },
  ];

  for (const c of candidates) {
    try {
      const { data, error } = await supabase
        .from(c.table)
        .select(c.cols.join(","))
        .eq("po_no", poNo);

      if (error) continue;

      const rows = (data || []).map((r: any) => ({
        id: r.id,
        shipment_no: r.shipment_no || r.id,
        shipment_date: r.shipment_date || null,
        created_at: r.created_at || null,
      }));

      return NextResponse.json({ ok: true, rows });
    } catch {
      // try next table
    }
  }

  return NextResponse.json({ ok: true, rows: [] });
}
