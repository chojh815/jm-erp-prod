import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function num(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const buyerId = String(searchParams.get("buyer_id") || "").trim();

    if (!buyerId) {
      return NextResponse.json({ rows: [] });
    }

    const { data, error } = await supabaseAdmin
      .from("invoice_headers")
      .select(
        "id, invoice_no, invoice_date, total_amount, paid_amount, balance_amount, status, buyer_id, is_deleted"
      )
      .eq("buyer_id", buyerId)
      .eq("is_deleted", false)
      .order("invoice_date", { ascending: false })
      .order("invoice_no", { ascending: false });

    if (error) {
      return NextResponse.json(
        { error: error.message || "Failed to load unpaid invoices" },
        { status: 500 }
      );
    }

    const rows = (data || [])
      .filter((r: any) => {
        const st = String(r?.status || "").toUpperCase();
        return st !== "DELETED" && st !== "CANCELLED";
      })
      .map((r: any) => {
        const total = num(r.total_amount);
        const paid = num(r.paid_amount);
        const balanceRaw =
          r.balance_amount == null ? total - paid : num(r.balance_amount);
        const balance = Math.max(0, Math.round(balanceRaw * 100) / 100);

        return {
          invoice_id: r.id,
          invoice_no: r.invoice_no || "",
          invoice_date: r.invoice_date || "",
          total_amount: total,
          paid_amount: paid,
          balance_amount: balance,
          status: r.status || "",
        };
      })
      .filter((r: any) => r.balance_amount > 0.0001);

    return NextResponse.json({ rows });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Unexpected server error" },
      { status: 500 }
    );
  }
}
