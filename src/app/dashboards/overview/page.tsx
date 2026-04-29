"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

type DatePreset = "MTD" | "LAST_30" | "LAST_90" | "LAST_12_MONTHS" | "YTD" | "CUSTOM";

type BuyerOption = { id: string; code: string; name: string };
type SiteOption = { id: string; code: string; name: string };

type Kpi = {
  key:
    | "orders"
    | "production"
    | "ready"
    | "shipped"
    | "invoiced"
    | "collected"
    | "ar"
    | "at_risk"
    | "sample_requests"
    | "sample_waiting_feedback"
    | "sample_overdue";
  label: string;
  value_usd: number;
  delta_pct: number | null; // vs previous period
  sub_label?: string | null;
  sub_value?: string | null;
};

type TrendPoint = {
  date: string; // YYYY-MM-DD
  orders_usd: number;
  shipped_usd: number;
  invoiced_usd: number;
  collected_usd: number;
};

type StatusDistItem = {
  status: string;
  amount_usd: number;
  count: number;
};

type AtRiskRow = {
  po_no: string;
  buyer_name: string | null;
  brand: string | null;
  req_ship_date: string | null;
  delay_days: number | null;
  amount_usd: number | null;
  stage: string | null;
};

type NextShipRow = {
  req_ship_date: string;
  po_no: string;
  buyer_name: string | null;
  brand: string | null;
  amount_usd: number | null;
  ship_mode: string | null;
};

type CashWatchRow = {
  invoice_id: string | null;
  buyer_name: string | null;
  invoice_no: string | null;
  invoice_date: string | null;
  overdue_days: number | null;
  balance_usd: number | null;
};

type SampleListRow = {
  id?: string | null;
  request_no: string | null;
  request_title: string | null;
  buyer_name: string | null;
  request_date: string | null;
  target_ship_date: string | null;
  alert_status: string | null;
  progress_status: string | null;
  result_status: string | null;
  days_open?: number | null;
};

type OverviewResponse = {
  filters_echo: {
    preset: DatePreset;
    start?: string | null;
    end?: string | null;
    buyer_ids: string[] | "ALL";
    site_ids: string[] | "ALL";
  };
  kpis: Kpi[];
  trend: TrendPoint[];
  status_dist: StatusDistItem[];
  status_distribution?: StatusDistItem[];
  statusDist?: StatusDistItem[];
  lists: {
    at_risk: AtRiskRow[];
    next_ship: NextShipRow[];
    cash_watch: CashWatchRow[];
    sample_overdue?: SampleListRow[];
    sample_waiting_feedback?: SampleListRow[];
  };
};

function fmtMoneyUSD(n: number | null | undefined) {
  const v = typeof n === "number" ? n : 0;
  return v.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}
function fmtPct(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}
function fmtCount(n: number | null | undefined) {
  const v = typeof n === "number" ? n : 0;
  return Math.round(v).toLocaleString();
}
function isoToday() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function buildQuery(params: Record<string, string | string[] | undefined | null>) {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) {
      if (v.length === 0) return;
      sp.set(k, v.join(","));
    } else {
      if (v === "") return;
      sp.set(k, v);
    }
  });
  const s = sp.toString();
  return s ? `?${s}` : "";
}

async function fetchJSON<T>(url: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(url, { signal, cache: "no-store" });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`HTTP ${r.status}: ${text}`);
  }
  return (await r.json()) as T;
}

export default function OverviewDashboardPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const actionTabFromUrl = sp.get("action_tab") || "at_risk";

  // ---- Filters (URL-synced)
  const [preset, setPreset] = React.useState<DatePreset>(
    (sp.get("preset") as DatePreset) || "MTD"
  );
  const [start, setStart] = React.useState<string>(sp.get("start") || "");
  const [end, setEnd] = React.useState<string>(sp.get("end") || "");
  const [buyerIds, setBuyerIds] = React.useState<string[]>(
    sp.get("buyerIds") ? sp.get("buyerIds")!.split(",").filter(Boolean) : []
  );
  const [allBuyers, setAllBuyers] = React.useState<boolean>(
    (sp.get("buyerIds") || "") === "ALL" || buyerIds.length === 0
  );

  const [siteIds, setSiteIds] = React.useState<string[]>(
    sp.get("siteIds") ? sp.get("siteIds")!.split(",").filter(Boolean) : []
  );
  const [allSites, setAllSites] = React.useState<boolean>(
    (sp.get("siteIds") || "") === "ALL" || siteIds.length === 0
  );

  // Options (optional: wire to companies/sites)
  const [buyerOptions, setBuyerOptions] = React.useState<BuyerOption[]>([]);
  const [siteOptions, setSiteOptions] = React.useState<SiteOption[]>([]);
  const [optLoading, setOptLoading] = React.useState(false);

  // Data
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [data, setData] = React.useState<OverviewResponse | null>(null);
  const [actionTab, setActionTab] = React.useState<string>(actionTabFromUrl);

  React.useEffect(() => {
    setActionTab(actionTabFromUrl);
  }, [actionTabFromUrl]);

  function syncUrl(next: {
    preset?: DatePreset;
    start?: string;
    end?: string;
    buyerIds?: string[] | "ALL";
    siteIds?: string[] | "ALL";
  }) {
    const q = buildQuery({
      preset: next.preset ?? preset,
      start: next.start ?? start,
      end: next.end ?? end,
      buyerIds:
        next.buyerIds === "ALL"
          ? "ALL"
          : Array.isArray(next.buyerIds)
          ? next.buyerIds.join(",")
          : allBuyers
          ? "ALL"
          : buyerIds.join(","),
      siteIds:
        next.siteIds === "ALL"
          ? "ALL"
          : Array.isArray(next.siteIds)
          ? next.siteIds.join(",")
          : allSites
          ? "ALL"
          : siteIds.join(","),
    });
    router.replace(`/dashboards/overview${q}`);
  }

  // Load options (buyers/sites) - safe no-op if you don't want to implement yet
  React.useEffect(() => {
    let dead = false;
    const ac = new AbortController();
    (async () => {
      try {
        setOptLoading(true);
        // You can implement these endpoints later; until then, ignore 404.
        const [buyersRes, sitesRes] = await Promise.allSettled([
          fetchJSON<{ items: BuyerOption[] }>("/api/dashboards/options/buyers", ac.signal),
          fetchJSON<{ items: SiteOption[] }>("/api/dashboards/options/sites", ac.signal),
        ]);
        if (dead) return;

        if (buyersRes.status === "fulfilled") setBuyerOptions(buyersRes.value.items || []);
        if (sitesRes.status === "fulfilled") setSiteOptions(sitesRes.value.items || []);
      } catch {
        // ignore
      } finally {
        if (!dead) setOptLoading(false);
      }
    })();
    return () => {
      dead = true;
      ac.abort();
    };
  }, []);

  // Fetch overview data
  React.useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);

    const buyerParam = allBuyers ? "ALL" : buyerIds.join(",");
    const siteParam = allSites ? "ALL" : siteIds.join(",");

    const q = buildQuery({
      preset,
      start: preset === "CUSTOM" ? start : "",
      end: preset === "CUSTOM" ? end : "",
      buyerIds: buyerParam || "ALL",
      siteIds: siteParam || "ALL",
    });

    fetchJSON<OverviewResponse>(`/api/dashboards/overview${q}`, ac.signal)
      .then((raw) => {
  // Normalize API shape differences so UI stays stable
  const kpis = Array.isArray(raw?.kpis) ? raw.kpis : [];
  const kpiMap = new Map<string, number>();
  kpis.forEach((k: any) => {
    if (k?.key) kpiMap.set(String(k.key), Number(k.value_usd ?? 0));
  });

  // API trend shapes seen:
  //  A) TrendPoint[] (already)
  //  B) { points: [{ ym, orders_usd, ... }] }
  //  C) [{ preset, start, end, points: [...] }]  (wrapper array)
  let points: any[] = [];
  const trendAny: any = (raw as any)?.trend;
  if (Array.isArray(trendAny)) {
    const t0: any = trendAny[0];
    if (t0 && Array.isArray(t0.points)) {
      points = t0.points;
    } else {
      points = trendAny;
    }
  } else if (trendAny && Array.isArray(trendAny.points)) {
    points = trendAny.points;
  }

  // Monthly cumulative wants the totals "as of end" (sum of points)
  const sum = points.reduce(
    (acc: any, p: any) => {
      acc.orders_usd += Number(p?.orders_usd ?? 0);
      acc.shipped_usd += Number(p?.shipped_usd ?? 0);
      acc.invoiced_usd += Number(p?.invoiced_usd ?? 0);
      acc.collected_usd += Number(p?.collected_usd ?? 0);
      return acc;
    },
    { orders_usd: 0, shipped_usd: 0, invoiced_usd: 0, collected_usd: 0 }
  );

  const asOf = String(raw?.filters_echo?.end ?? "").trim() || "—";

  const trend = [
    {
      date: asOf,
      orders_usd: Number(sum.orders_usd || kpiMap.get("orders") || 0),
      shipped_usd: Number(sum.shipped_usd || kpiMap.get("shipped") || 0),
      invoiced_usd: Number(sum.invoiced_usd || kpiMap.get("invoiced") || 0),
      collected_usd: Number(sum.collected_usd || kpiMap.get("collected") || 0),
    },
  ];

  const status_dist =
    raw?.status_dist ?? raw?.status_distribution ?? raw?.statusDist ?? [];

  const lists = {
    at_risk: raw?.lists?.at_risk ?? [],
    next_ship: raw?.lists?.next_ship ?? [],
    cash_watch: raw?.lists?.cash_watch ?? [],
    sample_overdue: (raw as any)?.lists?.sample_overdue ?? [],
    sample_waiting_feedback: (raw as any)?.lists?.sample_waiting_feedback ?? [],
  };

  setData({ ...raw, trend, status_dist, lists });
})
      .catch((e: any) => {
  // ✅ Abort는 정상 동작 → UI에 표시하지 않음
  if (e?.name === "AbortError") return;

  const msg = String(e?.message ?? e ?? "");
  if (msg.includes("signal is aborted")) return;

  setError(msg);
})
      .finally(() => {
        setLoading(false);
      });

    return () => ac.abort();
  }, [preset, start, end, allBuyers, buyerIds, allSites, siteIds]);

  // UI helpers
  const effectiveBuyerIds = allBuyers ? [] : buyerIds;
  const effectiveSiteIds = allSites ? [] : siteIds;

  function toggleBuyer(id: string) {
    setBuyerIds((prev) => {
      const has = prev.includes(id);
      const next = has ? prev.filter((x) => x !== id) : [...prev, id];
      return next;
    });
  }
  function toggleSite(id: string) {
    setSiteIds((prev) => {
      const has = prev.includes(id);
      const next = has ? prev.filter((x) => x !== id) : [...prev, id];
      return next;
    });
  }

  const kpiMap = React.useMemo(() => {
    const m = new Map<string, Kpi>();
    (data?.kpis || []).forEach((k) => m.set(k.key, k));
    return m;
  }, [data]);

  // Drilldown navigation
  function go(path: string) {
    router.push(path);
  }

  function goSample(filters: Record<string, string | null | undefined>) {
    const sp = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v && String(v).trim()) sp.set(k, String(v));
    });
    const q = sp.toString();
    router.push(`/sample-requests${q ? `?${q}` : ""}`);
  }

  function firstRowDrilldown(filters: Record<string, string | null | undefined>, rows: SampleListRow[] | undefined) {
    const first = (rows || []).find((r) => r?.id || r?.request_no);
    goSample({
      ...filters,
      selected_id: first?.id || undefined,
      request_no: first?.request_no || undefined,
    });
  }


  function normalizeBuyerKey(v: string | null | undefined) {
    return String(v || "").trim().toLowerCase();
  }

  function resolveBuyerId(name?: string | null) {
    const nk = normalizeBuyerKey(name);
    const hit = buyerOptions.find(
      (b) => (nk && normalizeBuyerKey(b.name) === nk) || (nk && normalizeBuyerKey(b.code) === nk)
    );
    return hit?.id || null;
  }

  function openInvoice(invoiceId: string | null | undefined, invoiceNo?: string | null) {
    const target = String(invoiceId || "").trim();
    if (!target) {
      alert(`Invoice id is missing for ${invoiceNo || "this invoice"}.`);
      return;
    }
    router.push(`/invoices/${encodeURIComponent(target)}`);
  }

  function openBuyerAging(name?: string | null) {
    const buyerId = resolveBuyerId(name);
    if (!buyerId) return;
    const q = buildQuery({
      preset,
      start: preset === "CUSTOM" ? start : "",
      end: preset === "CUSTOM" ? end : "",
      buyerIds: buyerId,
      siteIds: allSites ? "ALL" : siteIds.join(",") || "ALL",
    });
    router.push(`/dashboards/ar-aging${q}`);
  }

  const headerRight = (
    <div className="flex items-center gap-2">
      <Button
        variant="secondary"
        onClick={() => {
          // Refresh by nudging end date in custom, otherwise just re-sync URL
          if (preset === "CUSTOM") {
            syncUrl({ preset, start, end });
          } else {
            syncUrl({ preset });
          }
        }}
        disabled={loading}
      >
        Refresh
      </Button>
    </div>
  );

  return (
    <AppShell title="Overview">
      <div className="space-y-4">
        {/* ✅ Header Right Slot (moved from AppShell prop) */}
<div className="flex items-center justify-end gap-2">
  {headerRight}
</div>

{/* Filters */}
        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Filters</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label>Date Range</Label>
                <Select
                  value={preset}
                  onValueChange={(v) => {
                    const next = v as DatePreset;
                    setPreset(next);
                    if (next !== "CUSTOM") {
                      setStart("");
                      setEnd("");
                    } else {
                      // sensible defaults
                      const t = isoToday();
                      setEnd((e) => e || t);
                      setStart((s) => s || t);
                    }
                    syncUrl({ preset: next });
                  }}
                >
                  <SelectTrigger className="rounded-xl">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MTD">This Month (MTD)</SelectItem>
                    <SelectItem value="LAST_30">Last 30 Days</SelectItem>
                  <SelectItem value="LAST_90">Last 90 Days</SelectItem>
                  <SelectItem value="LAST_12_MONTHS">Last 12 Months</SelectItem>
                  <SelectItem value="YTD">Year to Date (YTD)</SelectItem>
                    <SelectItem value="CUSTOM">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label>Start</Label>
                <Input
                  className="rounded-xl"
                  type="date"
                  value={start}
                  onChange={(e) => {
                    setStart(e.target.value);
                  }}
                  disabled={preset !== "CUSTOM"}
                />
              </div>

              <div className="space-y-1">
                <Label>End</Label>
                <Input
                  className="rounded-xl"
                  type="date"
                  value={end}
                  onChange={(e) => {
                    setEnd(e.target.value);
                  }}
                  disabled={preset !== "CUSTOM"}
                />
              </div>

              <div className="space-y-1">
                <Label>Currency</Label>
                <div className="h-10 flex items-center px-3 rounded-xl border text-sm text-muted-foreground">
                  USD (fixed)
                </div>
              </div>
            </div>

            <Separator />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Buyer */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Buyers</Label>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant={allBuyers ? "default" : "outline"}
                      className="rounded-xl"
                      onClick={() => {
                        setAllBuyers(true);
                        setBuyerIds([]);
                        syncUrl({ buyerIds: "ALL" });
                      }}
                    >
                      All Buyers
                    </Button>
                    <Button
                      size="sm"
                      variant={!allBuyers ? "default" : "outline"}
                      className="rounded-xl"
                      onClick={() => {
                        setAllBuyers(false);
                        syncUrl({ buyerIds: buyerIds.length ? buyerIds : [] });
                      }}
                    >
                      Select
                    </Button>
                  </div>
                </div>

                {!allBuyers && (
                  <div className="flex flex-wrap gap-2">
                    {(buyerOptions.length ? buyerOptions : []).map((b) => {
                      const active = effectiveBuyerIds.includes(b.id);
                      return (
                        <Button
                          key={b.id}
                          size="sm"
                          variant={active ? "default" : "outline"}
                          className="rounded-full"
                          onClick={() => {
                            toggleBuyer(b.id);
                          }}
                        >
                          {b.code || b.name}
                        </Button>
                      );
                    })}
                    {!buyerOptions.length && (
                      <div className="text-sm text-muted-foreground">
                        (Optional) Implement buyer options API to show chips.
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Site */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Ship From (Sites)</Label>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant={allSites ? "default" : "outline"}
                      className="rounded-xl"
                      onClick={() => {
                        setAllSites(true);
                        setSiteIds([]);
                        syncUrl({ siteIds: "ALL" });
                      }}
                    >
                      All Sites
                    </Button>
                    <Button
                      size="sm"
                      variant={!allSites ? "default" : "outline"}
                      className="rounded-xl"
                      onClick={() => {
                        setAllSites(false);
                        syncUrl({ siteIds: siteIds.length ? siteIds : [] });
                      }}
                    >
                      Select
                    </Button>
                  </div>
                </div>

                {!allSites && (
                  <div className="flex flex-wrap gap-2">
                    {(siteOptions.length ? siteOptions : []).map((s) => {
                      const active = effectiveSiteIds.includes(s.id);
                      return (
                        <Button
                          key={s.id}
                          size="sm"
                          variant={active ? "default" : "outline"}
                          className="rounded-full"
                          onClick={() => toggleSite(s.id)}
                        >
                          {s.code || s.name}
                        </Button>
                      );
                    })}
                    {!siteOptions.length && (
                      <div className="text-sm text-muted-foreground">
                        (Optional) Implement site options API to show chips.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                className="rounded-xl"
                onClick={() => {
                  if (preset === "CUSTOM") {
                    syncUrl({
                      preset,
                      start,
                      end,
                      buyerIds: allBuyers ? "ALL" : buyerIds,
                      siteIds: allSites ? "ALL" : siteIds,
                    });
                  } else {
                    syncUrl({
                      preset,
                      buyerIds: allBuyers ? "ALL" : buyerIds,
                      siteIds: allSites ? "ALL" : siteIds,
                    });
                  }
                }}
                disabled={loading}
              >
                Apply
              </Button>
              {optLoading && (
                <span className="text-sm text-muted-foreground">Loading options…</span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Error */}
        {error && (
          <Card className="border-destructive/40 rounded-2xl">
            <CardContent className="py-3 text-sm text-destructive">
              {error}
            </CardContent>
          </Card>
        )}

        {/* KPI Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <KpiCard
            title="Sample Requests"
            kpi={kpiMap.get("sample_requests")}
            onClick={() => firstRowDrilldown({}, [
              ...((data?.lists.sample_overdue || []) as SampleListRow[]),
              ...((data?.lists.sample_waiting_feedback || []) as SampleListRow[]),
            ])}
          />
          <KpiCard
            title="Sample Waiting Feedback"
            kpi={kpiMap.get("sample_waiting_feedback")}
            onClick={() => firstRowDrilldown({ alert_status: "WAITING_FEEDBACK" }, (data?.lists.sample_waiting_feedback || []) as SampleListRow[])}
          />
          <KpiCard
            title="Sample Overdue"
            kpi={kpiMap.get("sample_overdue")}
            onClick={() => firstRowDrilldown({ alert_status: "OVERDUE" }, (data?.lists.sample_overdue || []) as SampleListRow[])}
          />
          <KpiCard
            title="Orders (MTD)"
            kpi={kpiMap.get("orders")}
            onClick={() => go("/po/list")}
          />
          <KpiCard
            title="Pending Orders"
            kpi={kpiMap.get("pending")}
            onClick={() => go("/po/list?status=OPEN")}
          />
          <KpiCard
            title="In Production"
            kpi={kpiMap.get("production")}
            onClick={() => go("/production/status")}
          />
          <KpiCard
            title="Ready to Ship"
            kpi={kpiMap.get("ready")}
            onClick={() => go("/shipments/list")}
          />
          <KpiCard
            title="Shipped (MTD)"
            kpi={kpiMap.get("shipped")}
            onClick={() => go("/shipments/list")}
          />
          <KpiCard
            title="Invoiced (MTD)"
            kpi={kpiMap.get("invoiced")}
            onClick={() => go("/invoices")}
          />
          <KpiCard
            title="Collected (MTD)"
            kpi={kpiMap.get("collected")}
            onClick={() => go("/receipts")}
          />
          <KpiCard
            title="AR Outstanding"
            kpi={kpiMap.get("ar")}
            onClick={() => go("/dashboards/receivables")}
          />
          <KpiCard
            title="At Risk"
            kpi={kpiMap.get("at_risk")}
            onClick={() => {
              setActionTab("at_risk");
              const el = document.getElementById("action-list");
              if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          />
        </div>

        {/* Charts row (placeholder widgets - wire to your chart lib as needed) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Card className="rounded-2xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Monthly Cumulative</CardTitle>
            </CardHeader>
            <CardContent>
              <CumulativeMiniTable trend={data?.trend || []} loading={loading} />
              <div className="text-xs text-muted-foreground mt-2">
                (Wire to Recharts/Chart.js later if you want a real chart. This table
                is stable and avoids client chart deps.)
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Status Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              <StatusDistMiniTable items={data?.status_dist || []} loading={loading} />
            </CardContent>
          </Card>
        </div>

        {/* Action List */}
        <Card id="action-list" className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Action List</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs value={actionTab} onValueChange={setActionTab}>
              <TabsList className="rounded-xl">
                <TabsTrigger value="at_risk">At Risk</TabsTrigger>
                <TabsTrigger value="today_ship">Today Ship Plan</TabsTrigger>
                <TabsTrigger value="next_ship">Next 7 Days Ship Plan</TabsTrigger>
                <TabsTrigger value="cash_watch">Cash Watch (AR Top)</TabsTrigger>
                <TabsTrigger value="sample_overdue">Sample Overdue</TabsTrigger>
                <TabsTrigger value="sample_waiting_feedback">Sample Waiting Feedback</TabsTrigger>
              </TabsList>

              <TabsContent value="at_risk" className="mt-3">
                <AtRiskTable rows={data?.lists.at_risk || []} />
              </TabsContent>
              <TabsContent value="today_ship" className="mt-3">
                <NextShipTable rows={data?.lists.next_ship || []} />
              </TabsContent>
              <TabsContent value="next_ship" className="mt-3">
                <NextShipTable rows={data?.lists.next_ship || []} />
              </TabsContent>
              <TabsContent value="cash_watch" className="mt-3">
                <CashWatchTable rows={data?.lists.cash_watch || []} onOpenInvoice={openInvoice} onOpenBuyer={openBuyerAging} />
              </TabsContent>
              <TabsContent value="sample_overdue" className="mt-3">
                <SampleListTable
                  rows={(data?.lists.sample_overdue || []) as SampleListRow[]}
                  onOpenAll={() => goSample({ alert_status: "OVERDUE" })}
                  onOpenRow={(row) => goSample({ alert_status: "OVERDUE", selected_id: row.id || undefined, request_no: row.request_no || undefined })}
                />
              </TabsContent>
              <TabsContent value="sample_waiting_feedback" className="mt-3">
                <SampleListTable
                  rows={(data?.lists.sample_waiting_feedback || []) as SampleListRow[]}
                  onOpenAll={() => goSample({ alert_status: "WAITING_FEEDBACK" })}
                  onOpenRow={(row) => goSample({ alert_status: "WAITING_FEEDBACK", selected_id: row.id || undefined, request_no: row.request_no || undefined })}
                />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function SampleListTable({
  rows,
  onOpenAll,
  onOpenRow,
}: {
  rows: SampleListRow[];
  onOpenAll: () => void;
  onOpenRow?: (row: SampleListRow) => void;
}) {
  if (!rows?.length) {
    return <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">No sample requests found.</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <Button variant="outline" size="sm" onClick={onOpenAll}>Open filtered Sample Requests</Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="p-2 text-left">Request No</th>
              <th className="p-2 text-left">Title</th>
              <th className="p-2 text-left">Buyer</th>
              <th className="p-2 text-left">Request Date</th>
              <th className="p-2 text-left">Target Ship</th>
              <th className="p-2 text-left">Alert</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr
                key={`${r.id || r.request_no || idx}`}
                className={`border-b last:border-0 ${onOpenRow ? "cursor-pointer hover:bg-muted/40" : ""}`}
                onClick={() => onOpenRow?.(r)}
              >
                <td className="p-2">{r.request_no || "—"}</td>
                <td className="p-2">{r.request_title || "—"}</td>
                <td className="p-2">{r.buyer_name || "—"}</td>
                <td className="p-2">{r.request_date || "—"}</td>
                <td className="p-2">{r.target_ship_date || "—"}</td>
                <td className="p-2">
                  <Badge variant="secondary" className="rounded-full">{r.alert_status || "—"}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KpiCard({
  title,
  kpi,
  onClick,
}: {
  title: string;
  kpi?: Kpi;
  onClick: () => void;
}) {
  const isSampleCount = !!kpi?.key && String(kpi.key).startsWith("sample_");

  return (
    <Card className="rounded-2xl hover:shadow-sm transition cursor-pointer" onClick={onClick}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <div className="text-2xl font-semibold">
          {isSampleCount ? fmtCount(kpi?.value_usd ?? 0) : fmtMoneyUSD(kpi?.value_usd ?? 0)}
        </div>
        <div className="flex items-center justify-between text-sm">
          <Badge variant="secondary" className="rounded-full">
            {fmtPct(kpi?.delta_pct ?? null)}
          </Badge>
          <span className="text-muted-foreground">
            {kpi?.sub_label ? `${kpi.sub_label}: ` : ""}
            {kpi?.sub_value || ""}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function CumulativeMiniTable({
  trend,
  loading,
}: {
  trend: TrendPoint[];
  loading: boolean;
}) {
  const last = trend.slice(-1)[0];
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-muted-foreground">
            <th className="text-left py-2 pr-3">As of</th>
            <th className="text-right py-2 px-3">Orders</th>
            <th className="text-right py-2 px-3">Shipped</th>
            <th className="text-right py-2 px-3">Invoiced</th>
            <th className="text-right py-2 pl-3">Collected</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t">
            <td className="py-2 pr-3">{loading ? "…" : last?.date || "—"}</td>
            <td className="py-2 px-3 text-right">{fmtMoneyUSD(last?.orders_usd ?? 0)}</td>
            <td className="py-2 px-3 text-right">{fmtMoneyUSD(last?.shipped_usd ?? 0)}</td>
            <td className="py-2 px-3 text-right">{fmtMoneyUSD(last?.invoiced_usd ?? 0)}</td>
            <td className="py-2 pl-3 text-right">{fmtMoneyUSD(last?.collected_usd ?? 0)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function StatusDistMiniTable({
  items,
  loading,
}: {
  items: StatusDistItem[];
  loading: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-muted-foreground">
            <th className="text-left py-2 pr-3">Status</th>
            <th className="text-right py-2 px-3">Amount</th>
            <th className="text-right py-2 pl-3">Count</th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr className="border-t">
              <td className="py-2 pr-3" colSpan={3}>
                Loading…
              </td>
            </tr>
          )}
          {!loading && (items?.length ? items : []).map((it) => (
            <tr key={it.status} className="border-t">
              <td className="py-2 pr-3">{it.status}</td>
              <td className="py-2 px-3 text-right">{fmtMoneyUSD(it.amount_usd)}</td>
              <td className="py-2 pl-3 text-right">{it.count}</td>
            </tr>
          ))}
          {!loading && (!items || items.length === 0) && (
            <tr className="border-t">
              <td className="py-2 pr-3" colSpan={3}>
                No data (wire SQL/views).
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function AtRiskTable({ rows }: { rows: AtRiskRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-muted-foreground">
            <th className="text-left py-2 pr-3">Req Ship</th>
            <th className="text-right py-2 px-3">Delay</th>
            <th className="text-left py-2 px-3">PO</th>
            <th className="text-left py-2 px-3">Buyer / Brand</th>
            <th className="text-right py-2 px-3">Amount</th>
            <th className="text-left py-2 pl-3">Stage</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.po_no}-${i}`} className="border-t">
              <td className="py-2 pr-3">{r.req_ship_date || "—"}</td>
              <td className="py-2 px-3 text-right">{r.delay_days ?? "—"}</td>
              <td className="py-2 px-3">{r.po_no}</td>
              <td className="py-2 px-3">
                {r.buyer_name || "—"} {r.brand ? ` / ${r.brand}` : ""}
              </td>
              <td className="py-2 px-3 text-right">{fmtMoneyUSD(r.amount_usd)}</td>
              <td className="py-2 pl-3">{r.stage || "—"}</td>
            </tr>
          ))}
          {!rows.length && (
            <tr className="border-t">
              <td className="py-2 pr-3" colSpan={6}>
                No at-risk items.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function NextShipTable({ rows }: { rows: NextShipRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-muted-foreground">
            <th className="text-left py-2 pr-3">Date</th>
            <th className="text-left py-2 px-3">PO</th>
            <th className="text-left py-2 px-3">Buyer / Brand</th>
            <th className="text-right py-2 px-3">Amount</th>
            <th className="text-left py-2 pl-3">Ship Mode</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.po_no}-${i}`} className="border-t">
              <td className="py-2 pr-3">{r.req_ship_date}</td>
              <td className="py-2 px-3">{r.po_no}</td>
              <td className="py-2 px-3">
                {r.buyer_name || "—"} {r.brand ? ` / ${r.brand}` : ""}
              </td>
              <td className="py-2 px-3 text-right">{fmtMoneyUSD(r.amount_usd)}</td>
              <td className="py-2 pl-3">{r.ship_mode || "—"}</td>
            </tr>
          ))}
          {!rows.length && (
            <tr className="border-t">
              <td className="py-2 pr-3" colSpan={5}>
                No upcoming shipments.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function CashWatchTable({
  rows,
  onOpenInvoice,
  onOpenBuyer,
}: {
  rows: CashWatchRow[];
  onOpenInvoice?: (invoiceId?: string | null, invoiceNo?: string | null) => void;
  onOpenBuyer?: (buyerName?: string | null) => void;
}) {
  const tone = (days?: number | null) => {
    if ((days ?? 0) > 90) return "text-red-700 bg-red-50";
    if ((days ?? 0) > 60) return "text-orange-700 bg-orange-50";
    if ((days ?? 0) > 30) return "text-amber-700 bg-amber-50";
    if ((days ?? 0) > 0) return "text-yellow-700 bg-yellow-50";
    return "";
  };

  const badge = (days?: number | null) => {
    if ((days ?? 0) > 90) return "bg-red-100 text-red-700 border-red-200";
    if ((days ?? 0) > 60) return "bg-orange-100 text-orange-700 border-orange-200";
    if ((days ?? 0) > 30) return "bg-amber-100 text-amber-700 border-amber-200";
    if ((days ?? 0) > 0) return "bg-yellow-100 text-yellow-700 border-yellow-200";
    return "bg-blue-100 text-blue-700 border-blue-200";
  };

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-muted-foreground">
            <th className="text-left py-2 pr-3">Buyer</th>
            <th className="text-left py-2 px-3">Invoice</th>
            <th className="text-left py-2 px-3">Inv Date</th>
            <th className="text-right py-2 px-3">Overdue</th>
            <th className="text-right py-2 pl-3">Balance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.invoice_no}-${i}`} className={`border-t ${tone(r.overdue_days)}`}>
              <td className="py-2 pr-3">
                <button
                  type="button"
                  className="text-blue-600 hover:underline"
                  onClick={() => onOpenBuyer?.(r.buyer_name)}
                >
                  {r.buyer_name || "—"}
                </button>
              </td>
              <td className="py-2 px-3">
                {r.invoice_no ? (
                  <button
                    type="button"
                    className="font-medium text-blue-600 hover:underline"
                    onClick={() => onOpenInvoice?.(r.invoice_id, r.invoice_no)}
                  >
                    {r.invoice_no}
                  </button>
                ) : (
                  "—"
                )}
              </td>
              <td className="py-2 px-3">{r.invoice_date || "—"}</td>
              <td className="py-2 px-3 text-right">
                <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-medium ${badge(r.overdue_days)}`}>
                  {r.overdue_days ?? 0}
                </span>
              </td>
              <td className="py-2 pl-3 text-right font-medium">{fmtMoneyUSD(r.balance_usd)}</td>
            </tr>
          ))}
          {!rows.length && (
            <tr className="border-t">
              <td className="py-2 pr-3" colSpan={5}>
                No AR balance data.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
