import type { SupabaseClient } from "@supabase/supabase-js";

export type DashboardPreset =
  | "MTD"
  | "LAST_30_DAYS"
  | "LAST_90_DAYS"
  | "LAST_12_MONTHS"
  | "CUSTOM";

export type DashboardOverviewParams = {
  // KPI section range (cards)
  kpiStart: string; // YYYY-MM-DD
  kpiEnd: string;   // YYYY-MM-DD

  // Trend section range (monthly points)
  trendStart: string; // YYYY-MM-DD
  trendEnd: string;   // YYYY-MM-DD

  buyerIds?: string[]; // uuid[]
  siteIds?: string[];  // uuid[]
};

export type DashboardOverviewPayload = {
  meta: {
    kpi_start: string;
    kpi_end: string;
    trend_start: string;
    trend_end: string;
    buyer_ids: string[];
    site_ids: string[];
  };

  // Raw RPC outputs (kept flexible so DB can evolve without breaking UI)
  kpis: any;
  trend: any;

  // Optional extras (if you later add RPCs)
  status_dist?: any;
  lists?: {
    at_risk?: any;
    next_ship?: any;
    cash_watch?: any;
  };
};

function safeArray(v: any): any[] {
  return Array.isArray(v) ? v : [];
}

function normalizeRpcRow(res: any): any {
  // Some RPCs return: [{ preset, start, end, kpis }] or [{ kpis }] etc.
  const rows = safeArray(res?.data);
  if (!rows.length) return null;
  if (rows.length === 1) return rows[0];
  return rows;
}

export async function getDashboardOverviewData(
  supabase: SupabaseClient,
  params: DashboardOverviewParams
): Promise<DashboardOverviewPayload> {
  const buyer_ids = (params.buyerIds || []).filter(Boolean);
  const site_ids = (params.siteIds || []).filter(Boolean);

  // IMPORTANT: adjust arg names here if your RPC signature differs.
  const rpcArgs = {
    start_date: params.kpiStart,
    end_date: params.kpiEnd,
    buyer_ids: buyer_ids.length ? buyer_ids : null,
    site_ids: site_ids.length ? site_ids : null,
  };

  const rpcTrendArgs = {
    start_date: params.trendStart,
    end_date: params.trendEnd,
    buyer_ids: buyer_ids.length ? buyer_ids : null,
    site_ids: site_ids.length ? site_ids : null,
  };

  const [kpisRes, trendRes] = await Promise.all([
    supabase.rpc("dashboard_overview_kpis_between", rpcArgs as any),
    supabase.rpc("dashboard_overview_trend_between", rpcTrendArgs as any),
  ]);

  if (kpisRes.error) {
    throw new Error(kpisRes.error.message || "Failed to load KPIs");
  }
  if (trendRes.error) {
    throw new Error(trendRes.error.message || "Failed to load Trend");
  }

  const kpisRow = normalizeRpcRow(kpisRes);
  const trendRow = normalizeRpcRow(trendRes);

  // Try to pick the likely JSON fields if present
  const kpis = (kpisRow && (kpisRow.kpis ?? kpisRow)) ?? kpisRes.data;
  const trend = (trendRow && (trendRow.points ?? trendRow)) ?? trendRes.data;

  return {
    meta: {
      kpi_start: params.kpiStart,
      kpi_end: params.kpiEnd,
      trend_start: params.trendStart,
      trend_end: params.trendEnd,
      buyer_ids,
      site_ids,
    },
    kpis,
    trend,
  };
}
