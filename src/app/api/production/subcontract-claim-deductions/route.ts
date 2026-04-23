import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function safeTrim(value: any) {
  return (value ?? "").toString().trim();
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const vendorId = safeTrim(searchParams.get("vendor_id"));
    const limit = Math.min(Math.max(Number(searchParams.get("limit") || "100"), 1), 500);

    let query = supabaseAdmin
      .from("receipt_headers")
      .select("id, deposit_date, reference_no, note, responsible_vendor_id, responsible_vendor_name, subcontract_deduction_amount")
      .eq("receipt_type", "CREDIT")
      .gt("subcontract_deduction_amount", 0)
      .order("deposit_date", { ascending: false })
      .limit(limit);

    if (vendorId) query = query.eq("responsible_vendor_id", vendorId);

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ success: true, rows: data || [] });
  } catch (e: any) {
    const message = String(e?.message || "");
    if (
      message.includes("responsible_vendor_id") ||
      message.includes("subcontract_deduction_amount")
    ) {
      return NextResponse.json({ success: true, rows: [] });
    }
    return NextResponse.json({ success: false, error: message || "Failed to load claim deductions" }, { status: 500 });
  }
}
