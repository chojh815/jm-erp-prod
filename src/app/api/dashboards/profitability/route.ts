import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

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

  actual_coverage: number | null; // 1 if actual exists else 0 (per row)
};

function num(v: any): number {
  const n = typeof v === "number" ? v : v == null ? NaN : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pct(numer: number, denom: number): number | null {
  if (!Number.isFinite(numer) || !Number.isFinite(denom) || denom === 0) return null;
  return (numer / denom) * 100;
}

function monthKey(iso: string | null): string {
  if (!iso) return "Unknown";
  // Expect YYYY-MM-DD...
  return iso.slice(0, 7);
}

function safeText(v: any): string {
  return v == null ? "" : String(v);
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const start = searchParams.get("start") || ""; // YYYY-MM-DD
    const end = searchParams.get("end") || ""; // YYYY-MM-DD
    const preset = searchParams.get("preset") || "LAST_12_MONTHS";

    const buyerIds = (searchParams.get("buyer_ids") || "ALL").split(",").filter(Boolean);
    const vendorIds = (searchParams.get("vendor_ids") || "ALL").split(",").filter(Boolean);
    const siteIds = (searchParams.get("site_ids") || "ALL").split(",").filter(Boolean);

    const q = (searchParams.get("q") || "").trim(); // invoice/po/style search
    const limit = Math.min(Math.max(Number(searchParams.get("limit") || "500"), 50), 5000);

    // RPC params (kept simple for PostgREST)
    const rpcParams: any = {
      p_start: start || null,
      p_end: end || null,
      p_preset: preset || null,
      p_buyer_ids: buyerIds.length && buyerIds[0] !== "ALL" ? buyerIds : null,
      p_vendor_ids: vendorIds.length && vendorIds[0] !== "ALL" ? vendorIds : null,
      p_site_ids: siteIds.length && siteIds[0] !== "ALL" ? siteIds : null,
      p_q: q || null,
      p_limit: limit,
    };

    const { data, error } = await supabaseAdmin.rpc("profitability_fact", rpcParams);

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: error.message,
          hint:
            "You need to create the SQL function profitability_fact first (see supabase/sql/profitability_fact.sql in the ZIP).",
          rpcParams,
        },
        { status: 500 }
      );
    }

    const rows: ProfitRow[] = (data || []).map((r: any) => ({
      invoice_id: r.invoice_id ?? null,
      invoice_no: r.invoice_no ?? null,
      invoice_date: r.invoice_date ?? null,

      buyer_id: r.buyer_id ?? null,
      buyer_name: r.buyer_name ?? null,
      buyer_code: r.buyer_code ?? null,
      brand_name: r.brand_name ?? null,

      po_no: r.po_no ?? null,
      jm_style: (r.jm_style ?? r.jm_style_no ?? r.jm_style_number ?? r.jm_style_num ?? null),
      buyer_style: (r.buyer_style ?? r.buyer_style_no ?? r.buyer_style_number ?? r.buyer_style_num ?? null),

      vendor_id: r.vendor_id ?? null,
      vendor_name: r.vendor_name ?? null,

      site_id: r.site_id ?? null,
      site_name: r.site_name ?? null,

      currency: r.currency ?? null,
      fx_rate_to_usd: r.fx_rate_to_usd == null ? null : Number(r.fx_rate_to_usd),

      revenue_local: r.revenue_local == null ? null : Number(r.revenue_local),
      revenue_usd: r.revenue_usd == null ? null : Number(r.revenue_usd),

      planned_cogs_usd: r.planned_cogs_usd == null ? null : Number(r.planned_cogs_usd),
      actual_cogs_usd: r.actual_cogs_usd == null ? null : Number(r.actual_cogs_usd),

      other_expenses_usd: r.other_expenses_usd == null ? null : Number(r.other_expenses_usd),
      factory_overhead_usd: r.factory_overhead_usd == null ? null : Number(r.factory_overhead_usd),

      profit_usd: r.profit_usd == null ? null : Number(r.profit_usd),
      margin_pct: r.margin_pct == null ? null : Number(r.margin_pct),

      net_profit_usd: r.net_profit_usd == null ? null : Number(r.net_profit_usd),
      net_margin_pct: r.net_margin_pct == null ? null : Number(r.net_margin_pct),

      actual_coverage: r.actual_coverage == null ? null : Number(r.actual_coverage),
    }));

    // KPIs
    const revenueUsd = rows.reduce((a, r) => a + num(r.revenue_usd), 0);
    const plannedCogsUsd = rows.reduce((a, r) => a + num(r.planned_cogs_usd), 0);
    const actualCogsUsd = rows.reduce((a, r) => a + num(r.actual_cogs_usd), 0);

    const otherExpensesUsd = rows.reduce((a, r) => a + num(r.other_expenses_usd), 0);
    const factoryOverheadUsd = rows.reduce((a, r) => a + num(r.factory_overhead_usd), 0);

    const profitUsd = revenueUsd - actualCogsUsd;
    const marginPct = pct(profitUsd, revenueUsd);

    const netProfitUsd = revenueUsd - actualCogsUsd - otherExpensesUsd - factoryOverheadUsd;
    const netMarginPct = pct(netProfitUsd, revenueUsd);

    const coverageNumer = rows.reduce((a, r) => a + (num(r.actual_coverage) > 0 ? num(r.revenue_usd) : 0), 0);
    const coveragePct = pct(coverageNumer, revenueUsd);

    // Monthly series (Profit + Margin)
    const byMonth = new Map<
      string,
      { month: string; revenue_usd: number; actual_cogs_usd: number; other_expenses_usd: number; factory_overhead_usd: number; net_profit_usd: number; net_margin_pct: number | null }
    >();
    for (const r of rows) {
      const m = monthKey(r.invoice_date);
      const cur = byMonth.get(m) || { month: m, revenue_usd: 0, actual_cogs_usd: 0, other_expenses_usd: 0, factory_overhead_usd: 0, net_profit_usd: 0, net_margin_pct: null };
      cur.revenue_usd += num(r.revenue_usd);
      cur.actual_cogs_usd += num(r.actual_cogs_usd);
      cur.other_expenses_usd += num(r.other_expenses_usd);
      cur.factory_overhead_usd += num(r.factory_overhead_usd);
      cur.net_profit_usd = cur.revenue_usd - cur.actual_cogs_usd - cur.other_expenses_usd - cur.factory_overhead_usd;
      cur.net_margin_pct = pct(cur.net_profit_usd, cur.revenue_usd);
      byMonth.set(m, cur);
    }
    const monthly = Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month));

    // Rankings (Top 10) — net profit (overhead included)
    const byBuyer = new Map<string, { key: string; name: string; revenue_usd: number; net_profit_usd: number; net_margin_pct: number | null }>();
    const byVendor = new Map<string, { key: string; name: string; revenue_usd: number; net_profit_usd: number; net_margin_pct: number | null }>();
    const byBrand = new Map<string, { key: string; name: string; revenue_usd: number; net_profit_usd: number; net_margin_pct: number | null }>();
    for (const r of rows) {
      {
        const key = r.buyer_id || r.buyer_name || "UNKNOWN";
        const name = r.buyer_name || "UNKNOWN";
        const cur = byBuyer.get(key) || { key, name, revenue_usd: 0, net_profit_usd: 0, net_margin_pct: null };
        cur.revenue_usd += num(r.revenue_usd);
        cur.net_profit_usd += num(r.net_profit_usd);
        cur.net_margin_pct = pct(cur.net_profit_usd, cur.revenue_usd);
        byBuyer.set(key, cur);
      }
      {
        const key = r.vendor_id || r.vendor_name || "UNKNOWN";
        const name = r.vendor_name || "UNKNOWN";
        const cur = byVendor.get(key) || { key, name, revenue_usd: 0, net_profit_usd: 0, net_margin_pct: null };
        cur.revenue_usd += num(r.revenue_usd);
        cur.net_profit_usd += num(r.net_profit_usd);
        cur.net_margin_pct = pct(cur.net_profit_usd, cur.revenue_usd);
        byVendor.set(key, cur);
      }
      {
        const key = r.brand_name || "UNKNOWN";
        const name = r.brand_name || "UNKNOWN";
        const cur = byBrand.get(key) || { key, name, revenue_usd: 0, net_profit_usd: 0, net_margin_pct: null };
        cur.revenue_usd += num(r.revenue_usd);
        cur.net_profit_usd += num(r.net_profit_usd);
        cur.net_margin_pct = pct(cur.net_profit_usd, cur.revenue_usd);
        byBrand.set(key, cur);
      }
    }
    const topBuyers = Array.from(byBuyer.values())
      .sort((a, b) => b.net_profit_usd - a.net_profit_usd)
      .slice(0, 10);

    const topVendors = Array.from(byVendor.values())
      .sort((a, b) => b.net_profit_usd - a.net_profit_usd)
      .slice(0, 10);

    const topBrands = Array.from(byBrand.values())
      .sort((a, b) => b.net_profit_usd - a.net_profit_usd)
      .slice(0, 10);

    // Options derived from result set (so UI doesn't depend on extra endpoints)
    const buyerOptionsMap = new Map<string, { id: string; name: string }>();
    const vendorOptionsMap = new Map<string, { id: string; name: string }>();
    const siteOptionsMap = new Map<string, { id: string; name: string }>();

    for (const r of rows) {
      if (r.buyer_id || r.buyer_name) buyerOptionsMap.set(r.buyer_id || r.buyer_name || "UNKNOWN", { id: r.buyer_id || r.buyer_name || "UNKNOWN", name: r.buyer_name || "UNKNOWN" });
      if (r.vendor_id || r.vendor_name) vendorOptionsMap.set(r.vendor_id || r.vendor_name || "UNKNOWN", { id: r.vendor_id || r.vendor_name || "UNKNOWN", name: r.vendor_name || "UNKNOWN" });
      if (r.site_id || r.site_name) siteOptionsMap.set(r.site_id || r.site_name || "UNKNOWN", { id: r.site_id || r.site_name || "UNKNOWN", name: r.site_name || "UNKNOWN" });
    }

    const buyerOptions = Array.from(buyerOptionsMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    const vendorOptions = Array.from(vendorOptionsMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    const siteOptions = Array.from(siteOptionsMap.values()).sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({
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
        other_expenses_usd: otherExpensesUsd,
        factory_overhead_usd: factoryOverheadUsd,
        profit_usd: profitUsd,
        margin_pct: marginPct,
        net_profit_usd: netProfitUsd,
        net_margin_pct: netMarginPct,
        actual_coverage_pct: coveragePct,
        row_count: rows.length,
      },
      monthly,
      topBuyers,
      topVendors,
      topBrands,
      options: { buyers: buyerOptions, vendors: vendorOptions, sites: siteOptions },
      rows,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}