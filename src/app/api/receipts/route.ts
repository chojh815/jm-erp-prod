import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReceiptType = "RECEIPT" | "REFUND" | "CREDIT";

function toNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function sumApplied(lines: { applied_amount: number }[]) {
  return lines.reduce((s, l) => s + toNum(l.applied_amount), 0);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { header, lines } = body ?? {};

    if (!header || !Array.isArray(lines) || lines.length === 0) {
      return NextResponse.json({ error: "Invalid payload (header/lines missing)" }, { status: 400 });
    }

    const receipt_type: ReceiptType = (header.receipt_type || "RECEIPT") as ReceiptType;
    if (!["RECEIPT", "REFUND", "CREDIT"].includes(receipt_type)) {
      return NextResponse.json({ error: "Invalid receipt_type" }, { status: 400 });
    }

    const totalApplied = sumApplied(lines);
    const totalReceived = toNum(header.total_received);

    if (receipt_type === "RECEIPT" && totalReceived <= 0) {
      return NextResponse.json({ error: "RECEIPT total_received must be > 0" }, { status: 400 });
    }
    if ((receipt_type === "REFUND" || receipt_type === "CREDIT") && totalReceived >= 0) {
      return NextResponse.json({ error: `${receipt_type} total_received must be < 0` }, { status: 400 });
    }

    if (Number(totalApplied.toFixed(2)) !== Number(totalReceived.toFixed(2))) {
      return NextResponse.json({ error: "Applied amount does not match total_received" }, { status: 400 });
    }

    for (const l of lines) {
      const a = toNum(l.applied_amount);
      if (receipt_type === "RECEIPT" && a <= 0) {
        return NextResponse.json({ error: "Applied amount must be > 0 for RECEIPT" }, { status: 400 });
      }
      if ((receipt_type === "REFUND" || receipt_type === "CREDIT") && a >= 0) {
        return NextResponse.json({ error: "Applied amount must be < 0 for REFUND/CREDIT" }, { status: 400 });
      }
    }

    if (!header.buyer_id) return NextResponse.json({ error: "buyer_id is required" }, { status: 400 });
    if (!header.deposit_date) return NextResponse.json({ error: "deposit_date is required (YYYY-MM-DD)" }, { status: 400 });

    if ((receipt_type === "RECEIPT" || receipt_type === "REFUND") && !header.bank_account_id) {
      return NextResponse.json({ error: "bank_account_id is required for RECEIPT/REFUND" }, { status: 400 });
    }

    const invoiceIds = lines.map((l: any) => l.invoice_id);

    const { data: invoices, error: invErr } = await supabaseAdmin
      .from("invoice_headers")
      .select("id, buyer_id, total_amount, status")
      .in("id", invoiceIds)
      .eq("is_deleted", false);

    if (invErr) throw invErr;
    if (!invoices || invoices.length !== invoiceIds.length) {
      return NextResponse.json({ error: "Some invoices not found" }, { status: 400 });
    }

    for (const inv of invoices) {
      if (inv.buyer_id !== header.buyer_id) {
        return NextResponse.json({ error: "Invoice buyer mismatch", invoice_id: inv.id }, { status: 400 });
      }
      if (receipt_type === "RECEIPT" && inv.status === "PAID") {
        return NextResponse.json({ error: "Invoice already paid", invoice_id: inv.id }, { status: 400 });
      }
    }

    const { data: existingLines, error: exErr } = await supabaseAdmin
      .from("receipt_lines")
      .select("invoice_id, applied_amount")
      .in("invoice_id", invoiceIds);

    if (exErr) throw exErr;

    const appliedMap = new Map<string, number>();
    for (const l of existingLines || []) {
      appliedMap.set(l.invoice_id, (appliedMap.get(l.invoice_id) || 0) + toNum(l.applied_amount));
    }

    for (const line of lines) {
      const inv = invoices.find((i: any) => i.id === line.invoice_id)!;
      const already = appliedMap.get(inv.id) || 0;
      const balance = toNum(inv.total_amount) - already;
      const a = toNum(line.applied_amount);

      if (receipt_type === "RECEIPT") {
        if (a > balance) {
          return NextResponse.json({ error: "Applied exceeds invoice balance", invoice_id: inv.id }, { status: 400 });
        }
      } else {
        if (already <= 0) {
          return NextResponse.json({ error: "No applied amount to reverse for this invoice", invoice_id: inv.id }, { status: 400 });
        }
        if (Math.abs(a) > already) {
          return NextResponse.json({ error: "Refund/Credit exceeds already-applied amount", invoice_id: inv.id }, { status: 400 });
        }
      }
    }

    const { data: headerRow, error: hErr } = await supabaseAdmin
      .from("receipt_headers")
      .insert({
        buyer_id: header.buyer_id,
        bank_account_id: header.bank_account_id ?? null,
        bank_account_label: header.bank_account_label ?? null,
        deposit_date: header.deposit_date,
        total_received: totalReceived,
        method: header.method ?? null,
        reference_no: header.reference_no ?? null,
        note: header.note ?? null,
        receipt_type,
      })
      .select()
      .single();

    if (hErr) throw hErr;

    const lineRows = lines.map((l: any) => ({
      receipt_header_id: headerRow.id,
      invoice_id: l.invoice_id,
      applied_amount: toNum(l.applied_amount),
      note: l.note ?? null,
    }));

    const { error: lErr } = await supabaseAdmin.from("receipt_lines").insert(lineRows);
    if (lErr) throw lErr;

    return NextResponse.json({ success: true, receipt_id: headerRow.id });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e.message || "Receipt save failed" }, { status: 500 });
  }
}
