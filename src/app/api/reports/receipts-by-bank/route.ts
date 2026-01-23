import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const bankAccountId = searchParams.get("bank_account_id");
  const currency = searchParams.get("currency");

  let q = supabaseAdmin
    .from("receipt_headers")
    .select(`
      id,
      deposit_date,
      total_received,
      method,
      reference_no,
      bank_account:bank_accounts(
        id,
        account_name,
        currency
      ),
      buyer:companies(
        company_name
      )
    `)
    .gte("deposit_date", from)
    .lte("deposit_date", to);

  if (bankAccountId) q = q.eq("bank_account_id", bankAccountId);
  if (currency) q = q.eq("bank_accounts.currency", currency);

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data || []).map((r: any) => ({
    deposit_date: r.deposit_date,
    bank_account: r.bank_account?.account_name,
    currency: r.bank_account?.currency,
    buyer_name: r.buyer?.company_name,
    method: r.method,
    reference_no: r.reference_no,
    amount: Number(r.total_received),
    receipt_id: r.id,
  }));

  const total = rows.reduce((s: number, r: any) => s + r.amount, 0);

  return NextResponse.json({
    summary: { total_amount: Number(total.toFixed(2)) },
    rows,
  });
}
