import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/**
 * After Service helper API: list invoices for a shipment (best-effort)
 * Query:
 *  - shipment_id (required)
 *
 * Returns rows: { id, invoice_no, invoice_date }
 */
export async function GET(req: NextRequest) {
  const supabase = createClient();
  const url = new URL(req.url);
  const shipmentId = (url.searchParams.get("shipment_id") || "").trim();

  if (!shipmentId) return NextResponse.json({ ok: false, error: "shipment_id is required" }, { status: 400 });

  // Try invoice_headers first
  try {
    const { data, error } = await supabase
      .from("invoice_headers")
      .select("id, invoice_no, invoice_date, created_at")
      .eq("shipment_id", shipmentId);

    if (!error) {
      const rows = (data || []).map((r: any) => ({
        id: r.id,
        invoice_no: r.invoice_no || r.id,
        invoice_date: r.invoice_date || null,
        created_at: r.created_at || null,
      }));
      return NextResponse.json({ ok: true, rows });
    }
  } catch {
    // ignore
  }

  // Fallback invoices table
  try {
    const { data, error } = await supabase
      .from("invoices")
      .select("id, invoice_no, invoice_date, created_at")
      .eq("shipment_id", shipmentId);

    if (!error) {
      const rows = (data || []).map((r: any) => ({
        id: r.id,
        invoice_no: r.invoice_no || r.id,
        invoice_date: r.invoice_date || null,
        created_at: r.created_at || null,
      }));
      return NextResponse.json({ ok: true, rows });
    }
  } catch {
    // ignore
  }

  return NextResponse.json({ ok: true, rows: [] });
}
