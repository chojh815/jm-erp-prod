import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safe(v: any) {
  return (v ?? "").toString().trim();
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
    const invoiceId = params.id;
    const body = await req.json().catch(() => ({}));

    const receipt_date = safe(body.receipt_date) || safe(body.date) || new Date().toISOString().slice(0, 10);
    const amount = Number(body.amount ?? 0);
    const method = safe(body.method) || "WIRE";
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

    const ins = {
      invoice_id: invoiceId,
      receipt_date,
      amount,
      method,
      reference_no,
      note,
      bank_account_id,
      bank_account_label,
      is_deleted: false,
    };

    const { data, error } = await supabaseAdmin
      .from("receipt_headers")
      .insert(ins)
      .select("*")
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, row: data });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
