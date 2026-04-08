import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ProfitRow = {
  invoice_id: string | null;
  invoice_no: string | null;
  invoice_date: string | null;
  buyer_id: string | null;
  buyer_name: string | null;
  buyer_code: string | null;
  brand_name: string | null;
  po_no: string | null;
  jm_style: string | null;
  buyer_style: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  site_id: string | null;
  site_name: string | null;
  currency: string | null;
  fx_rate_to_usd: number | null;
  revenue_local: number | null;
  revenue_usd: number | null;
  planned_cogs_usd: number | null;
  actual_cogs_usd: number | null;
  other_expenses_usd: number | null;
  factory_overhead_usd: number | null;
  profit_usd: number | null;
  margin_pct: number | null;
  net_profit_usd: number | null;
  net_margin_pct: number | null;
  actual_coverage: number | null;

  effective_cogs_usd?: number | null;
  margin_mode?: "ACTUAL" | "PLANNED_FALLBACK" | "NO_COST";
  has_actual_cost?: boolean;
  using_planned_fallback?: boolean;
};

function num(v: any): number {
  const n = typeof v === "number" ? v : v == null ? NaN : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(v: number | null): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.round(v * 100) / 100;
}

function pct(numer: number, denom: number): number | null {
  return Number.isFinite(numer) && Number.isFinite(denom) && denom !== 0
    ? (numer / denom) * 100
    : null;
}

function monthKey(iso: string | null): string {
  return iso ? iso.slice(0, 7) : "Unknown";
}

function withEffectiveCost(row: ProfitRow): ProfitRow {
  const revenue = num(row.revenue_usd);
  const planned = num(row.planned_cogs_usd);
  const actual = num(row.actual_cogs_usd);
  const otherExp = num(row.other_expenses_usd);
  const factoryOH = num(row.factory_overhead_usd);

  const hasActual = actual > 0;
  const usePlanned = !hasActual && planned > 0;

  const effectiveCogs = hasActual ? actual : usePlanned ? planned : 0;
  const marginMode: ProfitRow["margin_mode"] = hasActual
    ? "ACTUAL"
    : usePlanned
    ? "PLANNED_FALLBACK"
    : "NO_COST";

  const profitUsd = revenue - effectiveCogs;
  const marginPct = marginMode === "NO_COST" ? null : pct(profitUsd, revenue);

  const netProfitUsd = revenue - effectiveCogs - otherExp - factoryOH;
  const netMarginPct = marginMode === "NO_COST" ? null : pct(netProfitUsd, revenue);

  return {
    ...row,
    effective_cogs_usd: round2(effectiveCogs),
    margin_mode: marginMode,
    has_actual_cost: hasActual,
    using_planned_fallback: usePlanned,
    profit_usd: round2(profitUsd),
    margin_pct: round2(marginPct),
    net_profit_usd: round2(netProfitUsd),
    net_margin_pct: round2(netMarginPct),
  };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const start = searchParams.get("start") || "";
    const end = searchParams.get("end") || "";
    const preset = searchParams.get("preset") || "LAST_12_MONTHS";
    const buyerIds = (searchParams.get("buyer_ids") || "ALL").split(",").filter(Boolean);
    const vendorIds = (searchParams.get("vendor_ids") || "ALL").split(",").filter(Boolean);
    const siteIds = (searchParams.get("site_ids") || "ALL").split(",").filter(Boolean);
    const q = (searchParams.get("q") || "").trim();
    const limit = Math.min(Math.max(Number(searchParams.get("limit") || "500"), 50), 5000);

    const { data, error } = await supabaseAdmin.rpc("profitability_fact", {
      p_start: start || null,
      p_end: end || null,
      p_preset: preset || null,
      p_buyer_ids: buyerIds.length && buyerIds[0] !== "ALL" ? buyerIds : null,
      p_vendor_ids: vendorIds.length && vendorIds[0] !== "ALL" ? vendorIds : null,
      p_site_ids: siteIds.length && siteIds[0] !== "ALL" ? siteIds : null,
      p_q: q || null,
      p_limit: limit,
    });

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: error.message,
          hint: "Check public.profitability_fact definition and refresh schema cache if needed.",
        },
        { status: 500 }
      );
    }

    const rawRows: ProfitRow[] = (data || []).map((r: any) => ({
      invoice_id: r.invoice_id ?? null,
      invoice_no: r.invoice_no ?? null,
      invoice_date: r.invoice_date ?? null,
      buyer_id: r.buyer_id ?? null,
      buyer_name: r.buyer_name ?? null,
      buyer_code: r.buyer_code ?? null,
      brand_name: r.brand_name ?? null,
      po_no: r.po_no ?? null,
      jm_style: r.jm_style ?? r.jm_style_no ?? null,
      buyer_style: r.buyer_style ?? r.buyer_style_no ?? null,
      vendor_id: r.vendor_id ?? null,
      vendor_name: r.vendor_name ?? null,
      site_id: r.site_id ?? null,
      site_name: r.site_name ?? null,
      currency: r.currency ?? null,
      fx_rate_to_usd: r.fx_rate_to_usd == null ? null : Number(r.fx_rate_to_usd),
      revenue_local: r.revenue_local == null ? null : round2(Number(r.revenue_local)),
      revenue_usd: r.revenue_usd == null ? null : round2(Number(r.revenue_usd)),
      planned_cogs_usd: r.planned_cogs_usd == null ? null : round2(Number(r.planned_cogs_usd)),
      actual_cogs_usd: r.actual_cogs_usd == null ? null : round2(Number(r.actual_cogs_usd)),
      other_expenses_usd: r.other_expenses_usd == null ? null : round2(Number(r.other_expenses_usd)),
      factory_overhead_usd: r.factory_overhead_usd == null ? null : round2(Number(r.factory_overhead_usd)),
      profit_usd: r.profit_usd == null ? null : round2(Number(r.profit_usd)),
      margin_pct: r.margin_pct == null ? null : round2(Number(r.margin_pct)),
      net_profit_usd: r.net_profit_usd == null ? null : round2(Number(r.net_profit_usd)),
      net_margin_pct: r.net_margin_pct == null ? null : round2(Number(r.net_margin_pct)),
      actual_coverage: r.actual_coverage == null ? null : round2(Number(r.actual_coverage)),
    }));

    const rows: ProfitRow[] = rawRows.map(withEffectiveCost);

    const revenueUsd = round2(rows.reduce((a, r) => a + num(r.revenue_usd), 0));
    const plannedCogsUsd = round2(rows.reduce((a, r) => a + num(r.planned_cogs_usd), 0));
    const actualCogsUsd = round2(rows.reduce((a, r) => a + num(r.actual_cogs_usd), 0));
    const effectiveCogsUsd = round2(rows.reduce((a, r) => a + num(r.effective_cogs_usd), 0));
    const otherExpensesUsd = round2(rows.reduce((a, r) => a + num(r.other_expenses_usd), 0));
    const factoryOverheadUsd = round2(rows.reduce((a, r) => a + num(r.factory_overhead_usd), 0));

    const profitUsd = round2(num(revenueUsd) - num(effectiveCogsUsd));
    const marginPct = round2(pct(num(profitUsd), num(revenueUsd)));
    const netProfitUsd = round2(
      num(revenueUsd) - num(effectiveCogsUsd) - num(otherExpensesUsd) - num(factoryOverheadUsd)
    );
    const netMarginPct = round2(pct(num(netProfitUsd), num(revenueUsd)));

    const coveragePct = round2(
      pct(
        rows.reduce((a, r) => a + (num(r.actual_coverage) > 0 ? num(r.revenue_usd) : 0), 0),
        num(revenueUsd)
      )
    );

    const plannedFallbackRevenueUsd = round2(
      rows.reduce((a, r) => a + (r.using_planned_fallback ? num(r.revenue_usd) : 0), 0)
    );

    const byMonth = new Map<string, any>();
    for (const r of rows) {
      const m = monthKey(r.invoice_date);
      const cur =
        byMonth.get(m) || {
          month: m,
          revenue_usd: 0,
          actual_cogs_usd: 0,
          planned_cogs_usd: 0,
          effective_cogs_usd: 0,
          other_expenses_usd: 0,
          factory_overhead_usd: 0,
          net_profit_usd: 0,
          net_margin_pct: null,
        };
      cur.revenue_usd += num(r.revenue_usd);
      cur.actual_cogs_usd += num(r.actual_cogs_usd);
      cur.planned_cogs_usd += num(r.planned_cogs_usd);
      cur.effective_cogs_usd += num(r.effective_cogs_usd);
      cur.other_expenses_usd += num(r.other_expenses_usd);
      cur.factory_overhead_usd += num(r.factory_overhead_usd);
      cur.net_profit_usd =
        cur.revenue_usd - cur.effective_cogs_usd - cur.other_expenses_usd - cur.factory_overhead_usd;
      cur.net_margin_pct = pct(cur.net_profit_usd, cur.revenue_usd);
      byMonth.set(m, cur);
    }

    const monthly = Array.from(byMonth.values())
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((m) => ({
        ...m,
        revenue_usd: round2(m.revenue_usd),
        actual_cogs_usd: round2(m.actual_cogs_usd),
        planned_cogs_usd: round2(m.planned_cogs_usd),
        effective_cogs_usd: round2(m.effective_cogs_usd),
        other_expenses_usd: round2(m.other_expenses_usd),
        factory_overhead_usd: round2(m.factory_overhead_usd),
        net_profit_usd: round2(m.net_profit_usd),
        net_margin_pct: round2(m.net_margin_pct),
      }));

    const rank = (keyFn: any, nameFn: any) => {
      const map = new Map<string, any>();
      for (const r of rows) {
        const key = keyFn(r) || "UNKNOWN";
        const name = nameFn(r) || "UNKNOWN";
        const cur =
          map.get(key) || {
            key,
            name,
            revenue_usd: 0,
            net_profit_usd: 0,
            net_margin_pct: null,
          };
        cur.revenue_usd += num(r.revenue_usd);
        cur.net_profit_usd += num(r.net_profit_usd);
        cur.net_margin_pct = pct(cur.net_profit_usd, cur.revenue_usd);
        map.set(key, cur);
      }
      return Array.from(map.values())
        .map((x) => ({
          ...x,
          revenue_usd: round2(x.revenue_usd),
          net_profit_usd: round2(x.net_profit_usd),
          net_margin_pct: round2(x.net_margin_pct),
        }))
        .sort((a, b) => num(b.net_profit_usd) - num(a.net_profit_usd))
        .slice(0, 10);
    };

    const topBuyers = rank((r: ProfitRow) => r.buyer_id || r.buyer_name, (r: ProfitRow) => r.buyer_name);
    const topVendors = rank((r: ProfitRow) => r.vendor_id || r.vendor_name, (r: ProfitRow) => r.vendor_name);
    const topBrands = rank((r: ProfitRow) => r.brand_name, (r: ProfitRow) => r.brand_name);

    const buyerOptionsMap = new Map<string, { id: string; name: string }>();
    const vendorOptionsMap = new Map<string, { id: string; name: string }>();
    const siteOptionsMap = new Map<string, { id: string; name: string }>();

    for (const r of rows) {
      if (r.buyer_id || r.buyer_name) {
        buyerOptionsMap.set(r.buyer_id || r.buyer_name || "UNKNOWN", {
          id: r.buyer_id || r.buyer_name || "UNKNOWN",
          name: r.buyer_name || "UNKNOWN",
        });
      }
      if (r.vendor_id || r.vendor_name) {
        vendorOptionsMap.set(r.vendor_id || r.vendor_name || "UNKNOWN", {
          id: r.vendor_id || r.vendor_name || "UNKNOWN",
          name: r.vendor_name || "UNKNOWN",
        });
      }
      if (r.site_id || r.site_name) {
        siteOptionsMap.set(r.site_id || r.site_name || "UNKNOWN", {
          id: r.site_id || r.site_name || "UNKNOWN",
          name: r.site_name || "UNKNOWN",
        });
      }
    }

    return NextResponse.json(
      {
        ok: true,
        filters_echo: {
          preset,
          start,
          end,
          buyer_ids: buyerIds.length ? (buyerIds[0] === "ALL" ? "ALL" : buyerIds.join(",")) : "ALL",
          vendor_ids: vendorIds.length ? (vendorIds[0] === "ALL" ? "ALL" : vendorIds.join(",")) : "ALL",
          site_ids: siteIds.length ? (siteIds[0] === "ALL" ? "ALL" : siteIds.join(",")) : "ALL",
          q: q || "",
          limit,
        },
        kpis: {
          revenue_usd: revenueUsd,
          planned_cogs_usd: plannedCogsUsd,
          actual_cogs_usd: actualCogsUsd,
          effective_cogs_usd: effectiveCogsUsd,
          other_expenses_usd: otherExpensesUsd,
          factory_overhead_usd: factoryOverheadUsd,
          profit_usd: profitUsd,
          margin_pct: marginPct,
          net_profit_usd: netProfitUsd,
          net_margin_pct: netMarginPct,
          actual_coverage_pct: coveragePct,
          planned_fallback_revenue_usd: plannedFallbackRevenueUsd,
          row_count: rows.length,
        },
        monthly,
        topBuyers,
        topVendors,
        topBrands,
        options: {
          buyers: Array.from(buyerOptionsMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
          vendors: Array.from(vendorOptionsMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
          sites: Array.from(siteOptionsMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
        },
        rows,
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
      }
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
