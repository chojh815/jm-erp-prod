import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReceiptType = "RECEIPT" | "REFUND" | "CREDIT";
function toNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { buyer_id, lines, receipt_type } = body ?? {};
    const rt: ReceiptType = (receipt_type || "RECEIPT") as ReceiptType;

    if (!buyer_id || !Array.isArray(lines) || lines.length === 0) {
      return NextResponse.json({ valid: false, error: "Invalid payload" }, { status: 400 });
    }
    if (!["RECEIPT", "REFUND", "CREDIT"].includes(rt)) {
      return NextResponse.json({ valid: false, error: "Invalid receipt_type" }, { status: 400 });
    }

    const invoiceIds = lines.map((l: any) => l.invoice_id);

    const { data: invoices, error: invErr } = await supabaseAdmin
      .from("invoice_headers")
      .select("id, buyer_id, total_amount, status")
      .in("id", invoiceIds)
      .eq("is_deleted", false);

    if (invErr) throw invErr;
    if (!invoices || invoices.length !== invoiceIds.length) {
      return NextResponse.json({ valid: false, error: "Invoice not found" }, { status: 400 });
    }

    const { data: receiptLines, error: rlErr } = await supabaseAdmin
      .from("receipt_lines")
      .select("invoice_id, applied_amount")
      .in("invoice_id", invoiceIds);

    if (rlErr) throw rlErr;

    const appliedMap = new Map<string, number>();
    for (const r of receiptLines || []) {
      appliedMap.set(r.invoice_id, (appliedMap.get(r.invoice_id) || 0) + toNum(r.applied_amount));
    }

    let totalApplied = 0;

    for (const line of lines) {
      const inv = invoices.find((i: any) => i.id === line.invoice_id);
      if (!inv) return NextResponse.json({ valid: false, error: "Invoice not found", invoice_id: line.invoice_id }, { status: 400 });

      if (inv.buyer_id !== buyer_id) {
        return NextResponse.json({ valid: false, error: "Invoice buyer mismatch", invoice_id: inv.id }, { status: 400 });
      }

      const a = toNum(line.applied_amount);
      if (rt === "RECEIPT" && a <= 0) {
        return NextResponse.json({ valid: false, error: "Applied amount must be > 0 for RECEIPT", invoice_id: inv.id }, { status: 400 });
      }
      if ((rt === "REFUND" || rt === "CREDIT") && a >= 0) {
        return NextResponse.json({ valid: false, error: "Applied amount must be < 0 for REFUND/CREDIT", invoice_id: inv.id }, { status: 400 });
      }

      const already = appliedMap.get(inv.id) || 0;
      const balance = toNum(inv.total_amount) - already;

      if (rt === "RECEIPT") {
        if (inv.status === "PAID") {
          return NextResponse.json({ valid: false, error: "Invoice already paid", invoice_id: inv.id }, { status: 400 });
        }
        if (a > balance) {
          return NextResponse.json({ valid: false, error: "Applied exceeds invoice balance", invoice_id: inv.id }, { status: 400 });
        }
      } else {
        if (already <= 0) {
          return NextResponse.json({ valid: false, error: "No applied amount to reverse", invoice_id: inv.id }, { status: 400 });
        }
        if (Math.abs(a) > already) {
          return NextResponse.json({ valid: false, error: "Refund/Credit exceeds already-applied", invoice_id: inv.id }, { status: 400 });
        }
      }

      totalApplied += a;
    }

    return NextResponse.json({ valid: true, summary: { invoice_count: lines.length, total_applied: Number(totalApplied.toFixed(2)) } });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ valid: false, error: e.message || "Validation failed" }, { status: 500 });
  }
}
