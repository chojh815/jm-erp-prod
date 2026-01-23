import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const {
      buyer_id,
      bank_account_id,
      bank_account_label,
      deposit_date,
      currency,
      method,
      reference_no,
      note,

      total_amount,                // Gross
      bank_fee_amount = 0,
      claim_deduction_amount = 0,
    } = body;

    const total = Number(total_amount || 0);
    const bankFee = Number(bank_fee_amount || 0);
    const claimDeduction = Number(claim_deduction_amount || 0);

    const netReceived =
      total - bankFee - claimDeduction;

    if (netReceived < 0) {
      return NextResponse.json(
        { error: "Net received amount cannot be negative" },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("receipt_deposits")
      .insert({
        buyer_id,
        bank_account_id,
        bank_account_label,
        deposit_date,
        currency,
        method,
        reference_no,
        note,

        total_amount: total,
        bank_fee_amount: bankFee,
        claim_deduction_amount: claimDeduction,
        net_received_amount: netReceived,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    console.error("[RECEIPT_DEPOSIT_POST]", err);
    return NextResponse.json(
      { error: err.message ?? "Internal Server Error" },
      { status: 500 }
    );
  }
}
