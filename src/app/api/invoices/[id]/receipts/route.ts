import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { recalcInvoicesFromReceipts } from "@/lib/receipts/recalc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safe(v: any) {
  return (v ?? "").toString().trim();
}
function toNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

async function resolveBankAccountLabel(bank_account_id?: string | null) {
  const id = safe(bank_account_id);
  if (!id) return null;
  const { data } = await supabaseAdmin
    .from("bank_accounts")
    .select("account_name, bank_name, account_no_masked, currency")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const parts = [
    safe(data.account_name),
    safe(data.bank_name),
    safe(data.currency) ? `(${safe(data.currency)})` : "",
    safe(data.account_no_masked) ? `••••${safe(data.account_no_masked)}` : "",
  ].filter(Boolean);
  return parts.join(" ");
}

async function syncInvoiceStatuses(invoiceIds: string[]) {
  const ids = Array.from(new Set((invoiceIds || []).map((x) => safe(x)).filter(Boolean)));
  if (!ids.length) return;

  const { data: invoices, error } = await supabaseAdmin
    .from("invoice_headers")
    .select("id, total_amount, paid_amount, balance_amount, status")
    .in("id", ids);

  if (error || !invoices?.length) return;

  for (const inv of invoices) {
    const total = round2(toNum(inv.total_amount));
    const paid = round2(toNum(inv.paid_amount));
    const balance = round2(toNum(inv.balance_amount));
    const tol = 0.01;

    const nextStatus =
      balance <= tol || (total > 0 && paid >= total - tol)
        ? "PAID"
        : paid > tol
        ? "PARTIALLY_PAID"
        : "UNPAID";

    if (safe(inv.status).toUpperCase() === nextStatus) continue;

    await supabaseAdmin
      .from("invoice_headers")
      .update({ status: nextStatus, updated_at: new Date().toISOString() })
      .eq("id", inv.id);
  }
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const invoiceId = params.id;
    const { data, error } = await supabaseAdmin
      .from("receipt_headers")
      .select("*")
      .eq("invoice_id", invoiceId)
      .eq("is_deleted", false)
      .order("receipt_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) throw error;

    return NextResponse.json({ success: true, rows: data ?? [] });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const invoiceId = safe(params.id);
    const body = await req.json().catch(() => ({}));

    const { data: invoice, error: invErr } = await supabaseAdmin
      .from("invoice_headers")
      .select("id, invoice_no, buyer_id, buyer_name, buyer_code, currency")
      .eq("id", invoiceId)
      .eq("is_deleted", false)
      .maybeSingle();

    if (invErr) throw invErr;
    if (!invoice) {
      return NextResponse.json({ success: false, error: "Invoice not found" }, { status: 404 });
    }

    const receipt_date = safe(body.receipt_date) || safe(body.date) || new Date().toISOString().slice(0, 10);
    const amount = round2(toNum(body.received_amount ?? body.amount ?? body.total_received));
    const method = safe(body.payment_method ?? body.method) || "WIRE";
    const reference_no = safe(body.reference_no || body.reference) || null;
    const note = safe(body.note) || null;

    const bank_account_id = safe(body.bank_account_id) || null;
    let bank_account_label = safe(body.bank_account_label) || null;
    if (!bank_account_label && bank_account_id) {
      bank_account_label = await resolveBankAccountLabel(bank_account_id);
    }

    if (!amount || !Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ success: false, error: "amount must be > 0" }, { status: 400 });
    }

    const headerPayload = {
      invoice_id: invoiceId,
      invoice_no: invoice.invoice_no ?? null,
      buyer_id: invoice.buyer_id ?? null,
      buyer_name: invoice.buyer_name ?? null,
      buyer_code: invoice.buyer_code ?? null,
      currency: invoice.currency ?? "USD",
      receipt_date,
      deposit_date: receipt_date,
      payment_method: method,
      method,
      reference_no,
      note,
      bank_account_id,
      bank_account_label,
      received_amount: amount,
      total_received: amount,
      bank_fee_amount: 0,
      buyer_bank_fee_amount: 0,
      buyer_wire_fee_writeoff_amount: 0,
      claim_deduction_amount: 0,
      net_received_amount: amount,
      is_deleted: false,
    };

    const { data: header, error: headerErr } = await supabaseAdmin
      .from("receipt_headers")
      .insert(headerPayload)
      .select("*")
      .single();

    if (headerErr || !header?.id) throw headerErr || new Error("Failed to create receipt header");

    const { error: lineErr } = await supabaseAdmin
      .from("receipt_lines")
      .insert({
        receipt_header_id: header.id,
        invoice_id: invoiceId,
        applied_amount: amount,
        writeoff_amount: 0,
        is_deleted: false,
      });

    if (lineErr) throw lineErr;

    await recalcInvoicesFromReceipts(supabaseAdmin as any, [invoiceId]);
    await syncInvoiceStatuses([invoiceId]);

    return NextResponse.json({ success: true, row: header });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
