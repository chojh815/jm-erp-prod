"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

type Preset = "MTD" | "LAST_30" | "LAST_90" | "LAST_12_MONTHS" | "YTD" | "CUSTOM";

type InitialState = {
  preset: Preset;

  // KPI cards range
  kpiStart: string;
  kpiEnd: string;

  // Trend range
  trendStart: string;
  trendEnd: string;

  buyerIds: string[];
  siteIds: string[];
};

type Props = {
  initial: InitialState;
  initialData: any;
  initialError: string | null;
};

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(iso: string, deltaDays: number) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + deltaDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function monthStart(iso: string) {
  const d = new Date(iso + "T00:00:00");
  const ms = new Date(d.getFullYear(), d.getMonth(), 1);
  const y = ms.getFullYear();
  const m = String(ms.getMonth() + 1).padStart(2, "0");
  const day = String(ms.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function monthsAgoStart(iso: string, monthsAgo: number) {
  const d = new Date(iso + "T00:00:00");
  const ms = new Date(d.getFullYear(), d.getMonth() - monthsAgo, 1);
  const y = ms.getFullYear();
  const m = String(ms.getMonth() + 1).padStart(2, "0");
  const day = String(ms.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtUSD(n: any) {
  const v = Number(n || 0);
  try {
    return v.toLocaleString(undefined, { style: "currency", currency: "USD" });
  } catch {
    return `US$${v.toFixed(2)}`;
  }
}

// Heuristic KPI extraction (DB payload is flexible)
function pickKpi(payload: any, key: string) {
  if (!payload) return { value_usd: 0, count: 0 };
  const kpis = payload.kpis ?? payload;

  // Common shape: { orders: { value_usd, count, ... } }
  if (kpis?.[key]) return kpis[key];

  // Alternative: nested under .kpis
  if (kpis?.kpis?.[key]) return kpis.kpis[key];

  // Or array row
  if (Array.isArray(kpis) && kpis[0]?.kpis?.[key]) return kpis[0].kpis[key];

  return { value_usd: 0, count: 0 };
}

function pickTrendPoints(payload: any): any[] {
  if (!payload) return [];
  const t = payload.trend ?? payload.points ?? payload;
  if (Array.isArray(t)) return t;
  if (Array.isArray(t?.points)) return t.points;
  if (Array.isArray(payload?.trend?.points)) return payload.trend.points;
  return [];
}

export default function OverviewClient({ initial, initialData, initialError }: Props) {
  const [preset, setPreset] = React.useState<Preset>(initial.preset);

  const [kpiStart, setKpiStart] = React.useState(initial.kpiStart);
  const [kpiEnd, setKpiEnd] = React.useState(initial.kpiEnd);

  const [trendStart, setTrendStart] = React.useState(initial.trendStart);
  const [trendEnd, setTrendEnd] = React.useState(initial.trendEnd);

  const [buyerIds, setBuyerIds] = React.useState<string[]>(initial.buyerIds);
  const [siteIds, setSiteIds] = React.useState<string[]>(initial.siteIds);

  const [allBuyers, setAllBuyers] = React.useState(true);
  const [allSites, setAllSites] = React.useState(true);

  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(initialError);
  const [data, setData] = React.useState<any>(initialData);

  const abortRef = React.useRef<AbortController | null>(null);

  function applyPreset(p: Preset) {
  const end = todayISO();

  if (p === "MTD") {
    setKpiStart(monthStart(end));
    setKpiEnd(end);
    setTrendStart(monthsAgoStart(end, 11));
    setTrendEnd(end);
  } else if (p === "LAST_30") {
    setKpiStart(addDays(end, -29));
    setKpiEnd(end);
    setTrendStart(monthsAgoStart(end, 11));
    setTrendEnd(end);
  } else if (p === "LAST_90") {
    setKpiStart(addDays(end, -89));
    setKpiEnd(end);
    setTrendStart(monthsAgoStart(end, 11));
    setTrendEnd(end);
  } else if (p === "LAST_12_MONTHS") {
    const start = monthsAgoStart(end, 11);
    setKpiStart(start);
    setKpiEnd(end);
    setTrendStart(start);
    setTrendEnd(end);
  } else if (p === "YTD") {
    const y = new Date(end + "T00:00:00").getFullYear();
    const start = `${y}-01-01`;
    setKpiStart(start);
    setKpiEnd(end);
    setTrendStart(monthsAgoStart(end, 11));
    setTrendEnd(end);
  }
  // CUSTOM: dates come from inputs, do not override here.
}  }

  function onChangePreset(p: Preset) {
    setPreset(p);
    if (p !== "CUSTOM") applyPreset(p);
  }

  function onManualDateChange() {
    if (preset !== "CUSTOM") setPreset("CUSTOM");
  }

  async function fetchOverview() {
    const buyers = allBuyers ? [] : buyerIds;
    const sites = allSites ? [] : siteIds;

    setLoading(true);
    setError(null);

    if (abortRef.current) abortRef.current.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    const qs = new URLSearchParams();
    qs.set("kpi_start", kpiStart);
    qs.set("kpi_end", kpiEnd);
    qs.set("trend_start", trendStart);
    qs.set("trend_end", trendEnd);
    if (buyers.length) qs.set("buyers", buyers.join(","));
    if (sites.length) qs.set("sites", sites.join(","));

    try {
      const res = await fetch(`/api/dashboards/overview?${qs.toString()}`, {
        method: "GET",
        cache: "no-store",
        signal: ac.signal,
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);

      setData(json);
    } catch (e: any) {
      const msg = e?.name === "AbortError" ? null : (e?.message || String(e));
      if (msg) setError(msg);
    } finally {
      setLoading(false);
    }
  }

  const kOrders = pickKpi(data, "orders");
  const kInProd = pickKpi(data, "in_production");
  const kReady = pickKpi(data, "ready_to_ship");
  const kShipped = pickKpi(data, "shipped");
  const kInvoiced = pickKpi(data, "invoiced");
  const kCollected = pickKpi(data, "collected");
  const kAR = pickKpi(data, "ar_outstanding");
  const kRisk = pickKpi(data, "at_risk");

  const points = pickTrendPoints(data);

  return (
    <div className="space-y-6">
      <Card className="rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-xl">Order Overview (USD only)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {(["MTD","LAST_30","LAST_90","LAST_12_MONTHS","YTD","CUSTOM"] as Preset[]).map((p) => (
              <Button
                key={p}
                variant={preset === p ? "default" : "outline"}
                onClick={() => onChangePreset(p)}
                className="rounded-xl"
              >
                {p.replaceAll("_", " ")}
              </Button>
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2">
              <Label>KPI Start</Label>
              <Input
                type="date"
                value={kpiStart}
                onChange={(e) => {
                  setKpiStart(e.target.value);
                  onManualDateChange();
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>KPI End</Label>
              <Input
                type="date"
                value={kpiEnd}
                onChange={(e) => {
                  setKpiEnd(e.target.value);
                  onManualDateChange();
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>Trend Start</Label>
              <Input
                type="date"
                value={trendStart}
                onChange={(e) => {
                  setTrendStart(e.target.value);
                  onManualDateChange();
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>Trend End</Label>
              <Input
                type="date"
                value={trendEnd}
                onChange={(e) => {
                  setTrendEnd(e.target.value);
                  onManualDateChange();
                }}
              />
            </div>
          </div>

          <Separator />

          <div className="grid gap-4 md:grid-cols-3 items-end">
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={allBuyers}
                  onChange={(e) => setAllBuyers(e.target.checked)}
                />
                All Buyers
              </Label>
              <Input
                placeholder="Buyer IDs (comma-separated UUIDs)"
                disabled={allBuyers}
                value={buyerIds.join(",")}
                onChange={(e) =>
                  setBuyerIds(
                    e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean)
                  )
                }
              />
              <div className="text-xs text-muted-foreground">
                (Later you can replace this with a real multi-select from companies)
              </div>
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={allSites}
                  onChange={(e) => setAllSites(e.target.checked)}
                />
                All Sites
              </Label>
              <Input
                placeholder="Site IDs (comma-separated UUIDs)"
                disabled={allSites}
                value={siteIds.join(",")}
                onChange={(e) =>
                  setSiteIds(
                    e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean)
                  )
                }
              />
              <div className="text-xs text-muted-foreground">
                (Later: multi-select from company_sites)
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <Button
                className="rounded-xl"
                onClick={() => fetchOverview()}
                disabled={loading}
              >
                {loading ? "Loading..." : "Apply / Refresh"}
              </Button>
            </div>
          </div>

          {error ? (
            <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-4">
        <KpiCard title="Orders (MTD)" value={fmtUSD(kOrders?.value_usd)} sub={`POs: ${kOrders?.count ?? 0}`} />
        <KpiCard title="In Production" value={fmtUSD(kInProd?.value_usd)} sub={`Lines: ${kInProd?.count ?? 0}`} />
        <KpiCard title="Ready to Ship" value={fmtUSD(kReady?.value_usd)} sub={`POs: ${kReady?.count ?? 0}`} />
        <KpiCard title="Shipped (MTD)" value={fmtUSD(kShipped?.value_usd)} sub={`Shipments: ${kShipped?.count ?? 0}`} />
        <KpiCard title="Invoiced (MTD)" value={fmtUSD(kInvoiced?.value_usd)} sub={`Invoices: ${kInvoiced?.count ?? 0}`} />
        <KpiCard title="Collected (MTD)" value={fmtUSD(kCollected?.value_usd)} sub={`Receipts: ${kCollected?.count ?? 0}`} />
        <KpiCard title="AR Outstanding" value={fmtUSD(kAR?.value_usd)} sub={`Invoices: ${kAR?.count ?? 0}`} />
        <KpiCard title="At Risk" value={fmtUSD(kRisk?.value_usd)} sub={`POs: ${kRisk?.count ?? 0}`} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle>Monthly Cumulative</CardTitle>
          </CardHeader>
          <CardContent>
            {points?.length ? (
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="py-2 pr-4">As of</th>
                      <th className="py-2 pr-4">Orders</th>
                      <th className="py-2 pr-4">Shipped</th>
                      <th className="py-2 pr-4">Invoiced</th>
                      <th className="py-2 pr-4">Collected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {points.map((p: any, idx: number) => (
                      <tr key={idx} className="border-t">
                        <td className="py-2 pr-4">{p.ym ?? p.month ?? "-"}</td>
                        <td className="py-2 pr-4">{fmtUSD(p.orders_usd ?? p.orders ?? 0)}</td>
                        <td className="py-2 pr-4">{fmtUSD(p.shipped_usd ?? p.shipped ?? 0)}</td>
                        <td className="py-2 pr-4">{fmtUSD(p.invoiced_usd ?? p.invoiced ?? 0)}</td>
                        <td className="py-2 pr-4">{fmtUSD(p.collected_usd ?? p.collected ?? 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                No trend points (check RPC output shape).
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle>Debug Payload (optional)</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-[420px] overflow-auto rounded-xl bg-muted p-3 text-xs">
{JSON.stringify(data ?? {}, null, 2)}
            </pre>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function KpiCard({ title, value, sub }: { title: string; value: string; sub: string }) {
  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-semibold">{value}</div>
        <div className="mt-2 text-sm text-muted-foreground">{sub}</div>
      </CardContent>
    </Card>
  );
}
