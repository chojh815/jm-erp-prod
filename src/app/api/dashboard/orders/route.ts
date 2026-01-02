// /src/app/api/dashboard/orders/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabaseAdmin";

type OrderRow = {
  id: number;
  buyer_name: string | null;
  currency: string | null;
  amount: number | null;      // USD 금액 사용 (amount_usd 컬럼을 쓰면 아래 주석대로 교체)
  order_date: string;         // 'YYYY-MM-DD'
  status: string | null;
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const start =
    searchParams.get("start") ??
    new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);

  const end =
    searchParams.get("end") ??
    new Date().toISOString().slice(0, 10);

  // 다중 Buyer 지원: "A,B,C" 또는 ""(전체)
  const buyerParam = (searchParams.get("buyer") || "").trim();
  const buyerList = buyerParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean); // ["A","B","C"]

  const supabase = createClient();

  // 기간 내 USD 오더만 로드
  const { data: orders, error } = await supabase
    .from("orders")
    .select("id, buyer_name, currency, amount, order_date, status")
    .gte("order_date", start)
    .lte("order_date", end)
    .ilike("currency", "USD")
    .order("order_date", { ascending: true });

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  // 다중 Buyer 필터 (정확 일치)
  const filtered = (orders ?? []).filter((o: OrderRow) => {
    if (buyerList.length === 0) return true;
    const bn = (o.buyer_name ?? "").trim();
    return buyerList.includes(bn);
  });

  // 집계
  let totalUSD = 0;
  const perStatus: Record<string, number> = {};
  const perBuyer: Record<string, number> = {};
  const perMonth: Record<string, number> = {};

  for (const o of filtered) {
    // amount_usd 컬럼을 쓰신다면: const usdAmt = Number((o as any).amount_usd) || 0;
    const usdAmt = Number(o.amount) || 0;
    totalUSD += usdAmt;

    const st = (o.status ?? "UNKNOWN").toUpperCase();
    perStatus[st] = (perStatus[st] ?? 0) + usdAmt;

    const buyer = o.buyer_name ?? "UNKNOWN";
    perBuyer[buyer] = (perBuyer[buyer] ?? 0) + usdAmt;

    const ym = (o.order_date ?? end).slice(0, 7); // YYYY-MM
    perMonth[ym] = (perMonth[ym] ?? 0) + usdAmt;
  }

  const topBuyers = Object.entries(perBuyer)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([buyer, amount]) => ({ buyer, amount }));

  // 기간 내 USD 오더 전체 기준으로 Buyer 목록(A→Z) 제공
  const uniqueBuyers = Array.from(
    new Set((orders ?? []).map((o) => (o.buyer_name ?? "UNKNOWN").trim()))
  ).sort((a, b) => a.localeCompare(b));

  return NextResponse.json({
    ok: true,
    currency: "USD",
    period: { start, end },
    totals: {
      count: filtered.length,
      amountUSD: totalUSD,
    },
    byStatus: perStatus,   // USD 합계
    topBuyers,
    byMonth: perMonth,     // USD 합계
    buyers: uniqueBuyers,  // 드롭다운/멀티셀렉트용
    appliedBuyer: buyerList.length ? buyerList : null,
    note: "Only orders with currency = USD are included.",
  });
}
