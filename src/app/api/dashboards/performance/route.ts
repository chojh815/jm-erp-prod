// src/app/api/dashboards/performance/route.ts
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/app/api/_supabase";

export const dynamic = "force-dynamic";

type Dimension = "buyer" | "brand";

function asDateOnly(s: string | null | undefined) {
  if (!s) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function parseCsv(s: string | null): string[] | null {
  if (!s) return null;
  const arr = s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  return arr.length ? arr : null;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function pct(curr: number, base: number | null) {
  if (base === null || base === 0) return null;
  return round2(((curr - base) / base) * 100);
}

export async function GET(req: Request) {
  try {
    const supabase = createSupabaseServerClient();

    const url = new URL(req.url);
    const dimension = (url.searchParams.get("dimension") || "buyer") as Dimension;

    const start = asDateOnly(url.searchParams.get("start")) || null;
    const end = asDateOnly(url.searchParams.get("end")) || null;

    const buyerIds = parseCsv(url.searchParams.get("buyer_ids"));
    const brandNames = parseCsv(url.searchParams.get("brand_names"));

    // 1) Monthly raw (buyer+brand grain)
    let q = supabase
      .from("v_perf_monthly")
      .select(
        "buyer_id,buyer_name,brand_name,month_start,year,month,order_usd,ship_usd,order_yoy_pct,order_mom_pct,ship_yoy_pct,ship_mom_pct"
      );

    if (start) q = q.gte("month_start", start);
    if (end) q = q.lte("month_start", end);

    if (buyerIds?.length) q = q.in("buyer_id", buyerIds);
    if (brandNames?.length) q = q.in("brand_name", brandNames);

    q = q.order("month_start", { ascending: true });

    const { data: monthlyRaw, error: me } = await q;
    if (me) throw me;

    // 2) Yearly raw (buyer+brand grain)
    let yq = supabase
      .from("v_perf_yearly")
      .select("buyer_id,buyer_name,brand_name,year,order_usd,ship_usd,order_yoy_pct,ship_yoy_pct")
      .order("year", { ascending: true });

    if (buyerIds?.length) yq = yq.in("buyer_id", buyerIds);
    if (brandNames?.length) yq = yq.in("brand_name", brandNames);

    const { data: yearlyRaw, error: ye } = await yq;
    if (ye) throw ye;

    const monthly = (monthlyRaw || []) as any[];
    const yearly = (yearlyRaw || []) as any[];

    // 3) Dimension aggregation helpers
    // Monthly dimension rows
    const dimMonthlyMap = new Map<string, any>();
    for (const r of monthly) {
      const key =
        dimension === "buyer"
          ? `${r.buyer_id}__${r.month_start}`
          : `${r.brand_name || "—"}__${r.month_start}`;

      const prev = dimMonthlyMap.get(key) || {
        dimension,
        buyer_id: dimension === "buyer" ? r.buyer_id : null,
        buyer_name: dimension === "buyer" ? r.buyer_name : null,
        brand_name: dimension === "brand" ? r.brand_name : "ALL",
        month_start: r.month_start,
        year: r.year,
        month: r.month,
        order_usd: 0,
        ship_usd: 0,
        order_yoy_pct: null,
        order_mom_pct: null,
        ship_yoy_pct: null,
        ship_mom_pct: null,
      };

      prev.order_usd += Number(r.order_usd || 0);
      prev.ship_usd += Number(r.ship_usd || 0);
      dimMonthlyMap.set(key, prev);
    }

    const dimMonthly = Array.from(dimMonthlyMap.values()).sort((a, b) =>
      String(a.month_start).localeCompare(String(b.month_start))
    );

    // Compute YoY/MoM for aggregated monthly dimension rows
    const monthBuckets = new Map<string, any[]>();
    for (const r of dimMonthly) {
      const id = dimension === "buyer" ? r.buyer_id : r.brand_name || "—";
      const list = monthBuckets.get(id) || [];
      list.push(r);
      monthBuckets.set(id, list);
    }

    for (const [_, list] of monthBuckets) {
      const byMonth = new Map<string, any>();
      for (const r of list) byMonth.set(r.month_start, r);

      for (let i = 0; i < list.length; i++) {
        const r = list[i];
        const prev = i > 0 ? list[i - 1] : null;

        const dt = new Date(r.month_start + "T00:00:00Z");
        const dtY = new Date(Date.UTC(dt.getUTCFullYear() - 1, dt.getUTCMonth(), 1));
        const keyY = dtY.toISOString().slice(0, 10);
        const lastYear = byMonth.get(keyY) || null;

        r.order_mom_pct = pct(r.order_usd, prev ? prev.order_usd : null);
        r.ship_mom_pct = pct(r.ship_usd, prev ? prev.ship_usd : null);

        r.order_yoy_pct = pct(r.order_usd, lastYear ? lastYear.order_usd : null);
        r.ship_yoy_pct = pct(r.ship_usd, lastYear ? lastYear.ship_usd : null);
      }
    }

    // Yearly dimension rows
    const dimYearlyMap = new Map<string, any>();
    for (const r of yearly) {
      const key =
        dimension === "buyer"
          ? `${r.buyer_id}__${r.year}`
          : `${r.brand_name || "—"}__${r.year}`;

      const prev = dimYearlyMap.get(key) || {
        dimension,
        buyer_id: dimension === "buyer" ? r.buyer_id : null,
        buyer_name: dimension === "buyer" ? r.buyer_name : null,
        brand_name: dimension === "brand" ? r.brand_name : "ALL",
        year: r.year,
        order_usd: 0,
        ship_usd: 0,
        order_yoy_pct: null,
        ship_yoy_pct: null,
      };

      prev.order_usd += Number(r.order_usd || 0);
      prev.ship_usd += Number(r.ship_usd || 0);
      dimYearlyMap.set(key, prev);
    }

    const dimYearly = Array.from(dimYearlyMap.values()).sort((a, b) => a.year - b.year);

    // Compute YoY for yearly aggregated rows
    const yearBuckets = new Map<string, any[]>();
    for (const r of dimYearly) {
      const id = dimension === "buyer" ? r.buyer_id : r.brand_name || "—";
      const list = yearBuckets.get(id) || [];
      list.push(r);
      yearBuckets.set(id, list);
    }

    for (const [_, list] of yearBuckets) {
      list.sort((a, b) => a.year - b.year);
      for (let i = 0; i < list.length; i++) {
        const r = list[i];
        const prev = i > 0 ? list[i - 1] : null;
        r.order_yoy_pct = pct(r.order_usd, prev ? prev.order_usd : null);
        r.ship_yoy_pct = pct(r.ship_usd, prev ? prev.ship_usd : null);
      }
    }

    return NextResponse.json({
      ok: true,
      filters_echo: {
        dimension,
        start,
        end,
        buyer_ids: buyerIds?.length ? buyerIds : "ALL",
        brand_names: brandNames?.length ? brandNames : "ALL",
      },
      monthly_raw: monthlyRaw || [],
      yearly_raw: yearlyRaw || [],
      monthly: dimMonthly,
      yearly: dimYearly,
    });
  } catch (e: any) {
    console.error("[dashboard/performance] error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}
