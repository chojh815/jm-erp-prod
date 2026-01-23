// src/app/api/reports/bank-balance-monthly/route.ts
// Monthly Bank Balance (Receipts-only)
// - NO refunds table
// - Uses receipt_deposits (gross=total_amount, deductions=bank_fee_amount + claim_deduction_amount, net=net_received_amount)
// - Net is primary; if null, fallback to gross - deductions
//
// Query params (optional):
//   year=2026
//   bank_account_id=<uuid>
//   buyer_id=<uuid>
//
// Response:
//   { success:true, items:[{ month:"2026-01", gross:0, bank_fee:0, claim_deduction:0, net:0, count:0 }] }

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function num(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function round2(n: number) {
  return Math.round(n * 100) / 100;
}
function yyyymm(d: string) {
  // d expected like "2026-01-24" or ISO
  const s = String(d || "");
  // take first 7 chars safely if ISO/date-like
  if (s.length >= 7) return s.slice(0, 7);
  return s;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const yearStr = searchParams.get("year") || "";
    const bankAccountId = searchParams.get("bank_account_id");
    const buyerId = searchParams.get("buyer_id");

    const year = yearStr && /^\d{4}$/.test(yearStr) ? Number(yearStr) : null;

    let q = supabaseAdmin
      .from("receipt_deposits")
      .select(
        "id, deposit_date, total_amount, bank_fee_amount, claim_deduction_amount, net_received_amount, bank_account_id, buyer_id"
      )
      .eq("is_deleted", false);

    if (bankAccountId) q = q.eq("bank_account_id", bankAccountId);
    if (buyerId) q = q.eq("buyer_id", buyerId);

    if (year) {
      const start = `${year}-01-01`;
      const end = `${year + 1}-01-01`;
      q = q.gte("deposit_date", start).lt("deposit_date", end);
    }

    const { data, error } = await q;
    if (error) throw error;

    const map = new Map<
      string,
      { gross: number; bank_fee: number; claim_deduction: number; net: number; count: number }
    >();

    for (const r of data || []) {
      const month = yyyymm(r.deposit_date);
      if (!month) continue;

      const gross = num(r.total_amount);
      const bankFee = num(r.bank_fee_amount);
      const claim = num(r.claim_deduction_amount);
      const net =
        r.net_received_amount === null || r.net_received_amount === undefined
          ? gross - bankFee - claim
          : num(r.net_received_amount);

      const cur = map.get(month) || { gross: 0, bank_fee: 0, claim_deduction: 0, net: 0, count: 0 };
      cur.gross = round2(cur.gross + gross);
      cur.bank_fee = round2(cur.bank_fee + bankFee);
      cur.claim_deduction = round2(cur.claim_deduction + claim);
      cur.net = round2(cur.net + net);
      cur.count += 1;
      map.set(month, cur);
    }

    const items = Array.from(map.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([month, v]) => ({ month, ...v }));

    return NextResponse.json({ success: true, items });
  } catch (err: any) {
    console.error("[BANK_BALANCE_MONTHLY_GET]", err);
    return NextResponse.json(
      { success: false, error: err?.message ?? "Internal Server Error" },
      { status: 500 }
    );
  }
}
