"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";

import AppShell from "@/components/layout/AppShell";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

import { Badge } from "@/components/ui/badge";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  BarChart,
  Bar,
} from "recharts";

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

type OptionItem = { id: string; name: string };

type ApiResp = {
  ok: boolean;
  error?: string;
  hint?: string;
  filters_echo?: any;
  kpis?: {
    revenue_usd: number;
    planned_cogs_usd: number;
    actual_cogs_usd: number;
    other_expenses_usd: number;
    factory_overhead_usd: number;
    profit_usd: number;
    margin_pct: number | null;
    net_profit_usd: number;
    net_margin_pct: number | null;
    actual_coverage_pct: number | null;
    row_count: number;
  };
  monthly?: Array<{
    month: string;
    revenue_usd: number;
    actual_cogs_usd: number;
    other_expenses_usd: number;
    factory_overhead_usd: number;
    net_profit_usd: number;
    net_margin_pct: number | null;
  }>;
  topBuyers?: Array<{
    key: string;
    name: string;
    revenue_usd: number;
    net_profit_usd: number;
    net_margin_pct: number | null;
  }>;
  topVendors?: Array<{
    key: string;
    name: string;
    revenue_usd: number;
    net_profit_usd: number;
    net_margin_pct: number | null;
  }>;
  topBrands?: Array<{
    key: string;
    name: string;
    revenue_usd: number;
    net_profit_usd: number;
    net_margin_pct: number | null;
  }>;
  options?: { buyers: OptionItem[]; vendors: OptionItem[]; sites: OptionItem[] };
  rows?: any[];
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function fmtMoney(n: any): string {
  const v = typeof n === "number" ? n : n == null ? 0 : Number(n);
  if (!Number.isFinite(v)) return "0.00";
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(n: any): string {
  const v = typeof n === "number" ? n : n == null ? NaN : Number(n);
  if (!Number.isFinite(v)) return "-";
  return `${v.toFixed(2)}%`;
}

function todayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function start12MonthsISO(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 11);
  d.setDate(1);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function buildQuery(params: Record<string, string>) {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== "") sp.set(k, v);
  });
  return sp.toString();
}

function splitIds(v: string): string[] {
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

export default function ProfitabilityClient() {
  // Filters
  const [preset, setPreset] = useState<string>("LAST_12_MONTHS");
  const [start, setStart] = useState<string>(start12MonthsISO());
  const [end, setEnd] = useState<string>(todayISO());

  // Multi ids stored as comma string for simplicity
  const [buyerIds, setBuyerIds] = useState<string>("ALL");
  const [vendorIds, setVendorIds] = useState<string>("ALL");
  const [siteIds, setSiteIds] = useState<string>("ALL");

  const [q, setQ] = useState<string>("");
  const [limit, setLimit] = useState<number>(1000);

  const [appliedKey, setAppliedKey] = useState<string>(() =>
    buildQuery({
      preset,
      start,
      end,
      buyer_ids: buyerIds,
      vendor_ids: vendorIds,
      site_ids: siteIds,
      q,
      limit: String(limit),
    })
  );

  const url = useMemo(() => `/api/dashboards/profitability?${appliedKey}`, [appliedKey]);
  const { data, isLoading, mutate } = useSWR<ApiResp>(url, fetcher);

  useEffect(() => {
    // keep dates aligned when preset changes
    if (preset === "LAST_12_MONTHS") {
      setStart(start12MonthsISO());
      setEnd(todayISO());
    }
    if (preset === "THIS_MONTH") {
      const d = new Date();
      d.setDate(1);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = "01";
      setStart(`${yyyy}-${mm}-${dd}`);
      setEnd(todayISO());
    }
  }, [preset]);

  const options = data?.options || { buyers: [], vendors: [], sites: [] };
  const rows = (data?.rows || []) as any[];

  const apply = () => {
    setAppliedKey(
      buildQuery({
        preset,
        start,
        end,
        buyer_ids: buyerIds,
        vendor_ids: vendorIds,
        site_ids: siteIds,
        q,
        limit: String(limit),
      })
    );
  };

  const resetFilters = () => {
    setPreset("LAST_12_MONTHS");
    setStart(start12MonthsISO());
    setEnd(todayISO());
    setBuyerIds("ALL");
    setVendorIds("ALL");
    setSiteIds("ALL");
    setQ("");
    setLimit(1000);
    setAppliedKey(
      buildQuery({
        preset: "LAST_12_MONTHS",
        start: start12MonthsISO(),
        end: todayISO(),
        buyer_ids: "ALL",
        vendor_ids: "ALL",
        site_ids: "ALL",
        q: "",
        limit: "1000",
      })
    );
  };

  const exportExcel = () => {
    const exportRows = rows.map((r) => ({
      "Invoice No": r.invoice_no || "",
      "Invoice Date": r.invoice_date || "",
      Buyer: r.buyer_name || "",
      Brand: r.brand_name || "",
      "PO No": r.po_no || "",
      "JM Style": r.buyer_style || "",
      "Buyer Style": r.buyer_style || "",
      Vendor: r.vendor_name || "",
      Site: r.site_name || "",
      Currency: r.currency || "",
      "FX to USD": r.fx_rate_to_usd ?? "",
      "Revenue (USD)": r.revenue_usd ?? 0,
      "Planned COGS (USD)": r.planned_cogs_usd ?? 0,
      "Actual COGS (USD)": r.actual_cogs_usd ?? 0,
      "Other Expenses (USD)": r.other_expenses_usd ?? 0,
      "Factory Overhead (USD)": r.factory_overhead_usd ?? 0,
      "Profit (USD)": r.profit_usd ?? 0,
      "Margin %": r.margin_pct ?? "",
      "Net Profit (USD)": r.net_profit_usd ?? 0,
      "Net Margin %": r.net_margin_pct ?? "",
      "Actual Coverage": r.actual_coverage ?? "",
    }));

    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Profitability");
    XLSX.writeFile(wb, `profitability_${start}_${end}.xlsx`);
  };

  const exportPDF = () => {
    // Keep PDF in landscape to avoid header wrapping (more horizontal space)
    const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
    const title = "Profitability Dashboard";
    doc.setFontSize(14);
    doc.text(title, 40, 40);
    doc.setFontSize(10);
    doc.text(`Period: ${start} ~ ${end}`, 40, 58);

    const k = data?.kpis;
    if (k) {
      doc.text(`Revenue(USD): ${fmtMoney(k.revenue_usd)}`, 40, 78);
      doc.text(`Actual COGS(USD): ${fmtMoney(k.actual_cogs_usd)}`, 220, 78);
      doc.text(`Profit(USD): ${fmtMoney(k.profit_usd)}`, 420, 78);
      doc.text(`Margin: ${fmtPct(k.margin_pct)}`, 40, 94);
      doc.text(`Coverage: ${fmtPct(k.actual_coverage_pct)}`, 220, 94);
      doc.text(`Rows: ${k.row_count}`, 420, 94);

      doc.text(`Other Exp(USD): ${fmtMoney(k.other_expenses_usd)}`, 40, 110);
      doc.text(`Factory OH(USD): ${fmtMoney(k.factory_overhead_usd)}`, 220, 110);
      doc.text(`Net Profit(USD): ${fmtMoney(k.net_profit_usd)}`, 420, 110);
      doc.text(`Net Margin: ${fmtPct(k.net_margin_pct)}`, 40, 126);
    }

    const body = rows.slice(0, 2000).map((r) => [
      r.invoice_no || "",
      r.invoice_date || "",
      r.buyer_name || "",
      r.po_no || "",
      r.buyer_style || "",
      fmtMoney(r.revenue_usd),
      fmtMoney(r.actual_cogs_usd),
      fmtMoney(r.other_expenses_usd),
      fmtMoney(r.factory_overhead_usd),
      fmtMoney(r.profit_usd),
      fmtPct(r.margin_pct),
      fmtMoney(r.net_profit_usd),
      fmtPct(r.net_margin_pct),
      r.vendor_name || "",
    ]);

    autoTable(doc, {
      startY: 115,
      head: [[
        "Invoice",
        "Date",
        "Buyer",
        "PO",
        "Style",
        "Revenue(USD)",
        "Actual COGS(USD)",
        "Other Exp(USD)",
        "Factory OH(USD)",
        "Profit(USD)",
        "Margin",
        "Net Profit(USD)",
        "Net Margin",
        "Vendor",
      ]],
      body,
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [240, 240, 240], textColor: [20, 20, 20] },
      margin: { left: 40, right: 40 },
    });

    doc.save(`profitability_${start}_${end}.pdf`);
  };

  const toggleId = (cur: string, id: string) => {
    if (cur === "ALL") return id;
    const arr = splitIds(cur);
    const has = arr.includes(id);
    const next = has ? arr.filter((x) => x !== id) : [...arr, id];
    return next.length ? next.join(",") : "ALL";
  };

  const chipList = (cur: string, opts: OptionItem[]) => {
    if (cur === "ALL") return [];
    const ids = new Set(splitIds(cur));
    return opts.filter((o) => ids.has(o.id));
  };

  const k = data?.kpis;

  return (
    <AppShell>
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <div className="text-xl font-semibold">Profitability</div>
            <div className="text-sm text-muted-foreground">
              Revenue (Invoice) vs COGS (Planned / Actual) — USD normalized
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={resetFilters} disabled={isLoading}>
              Reset
            </Button>
            <Button onClick={apply} disabled={isLoading}>
              Apply
            </Button>
            <Button variant="outline" onClick={() => mutate()} disabled={isLoading}>
              Refresh
            </Button>
          </div>
        </div>

        {/* Filters */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Filters</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
              <div className="space-y-1">
                <Label>Preset</Label>
                <Select value={preset} onValueChange={setPreset}>
                  <SelectTrigger><SelectValue placeholder="Preset" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LAST_12_MONTHS">Last 12 Months</SelectItem>
                    <SelectItem value="THIS_MONTH">This Month</SelectItem>
                    <SelectItem value="CUSTOM">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label>Start</Label>
                <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
              </div>

              <div className="space-y-1">
                <Label>End</Label>
                <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
              </div>

              <div className="space-y-1">
                <Label>Search</Label>
                <Input
                  placeholder="Invoice / PO / Style / Buyer"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <Label>Limit</Label>
                <Input
                  type="number"
                  value={limit}
                  min={50}
                  max={5000}
                  onChange={(e) => setLimit(Number(e.target.value || "0"))}
                />
              </div>

              <div className="space-y-1">
                <Label>Exports</Label>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={exportExcel} disabled={!rows.length}>
                    Excel
                  </Button>
                  <Button variant="outline" onClick={exportPDF} disabled={!rows.length}>
                    PDF
                  </Button>
                </div>
              </div>
            </div>

            <Separator />

            {/* Multi filters (simple clickable chips list) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Buyers</Label>
                  <Button size="sm" variant="ghost" onClick={() => setBuyerIds("ALL")}>
                    All
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {chipList(buyerIds, options.buyers).map((o) => (
                    <Badge key={o.id} variant="secondary" className="cursor-pointer" onClick={() => setBuyerIds(toggleId(buyerIds, o.id))}>
                      {o.name} ✕
                    </Badge>
                  ))}
                  {buyerIds === "ALL" && (
                    <span className="text-sm text-muted-foreground">All Buyers</span>
                  )}
                </div>
                <div className="max-h-28 overflow-auto border rounded-md p-2">
                  <div className="flex flex-wrap gap-1">
                    {options.buyers.slice(0, 200).map((o) => {
                      const active = buyerIds !== "ALL" && splitIds(buyerIds).includes(o.id);
                      return (
                        <Badge
                          key={o.id}
                          variant={active ? "default" : "outline"}
                          className="cursor-pointer"
                          onClick={() => setBuyerIds(toggleId(buyerIds, o.id))}
                        >
                          {o.name}
                        </Badge>
                      );
                    })}
                  </div>
                  {options.buyers.length > 200 && (
                    <div className="text-xs text-muted-foreground mt-2">
                      Showing first 200 buyers in selector (type Search to narrow).
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Vendors</Label>
                  <Button size="sm" variant="ghost" onClick={() => setVendorIds("ALL")}>
                    All
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {chipList(vendorIds, options.vendors).map((o) => (
                    <Badge key={o.id} variant="secondary" className="cursor-pointer" onClick={() => setVendorIds(toggleId(vendorIds, o.id))}>
                      {o.name} ✕
                    </Badge>
                  ))}
                  {vendorIds === "ALL" && (
                    <span className="text-sm text-muted-foreground">All Vendors</span>
                  )}
                </div>
                <div className="max-h-28 overflow-auto border rounded-md p-2">
                  <div className="flex flex-wrap gap-1">
                    {options.vendors.slice(0, 200).map((o) => {
                      const active = vendorIds !== "ALL" && splitIds(vendorIds).includes(o.id);
                      return (
                        <Badge
                          key={o.id}
                          variant={active ? "default" : "outline"}
                          className="cursor-pointer"
                          onClick={() => setVendorIds(toggleId(vendorIds, o.id))}
                        >
                          {o.name}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Sites</Label>
                  <Button size="sm" variant="ghost" onClick={() => setSiteIds("ALL")}>
                    All
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {chipList(siteIds, options.sites).map((o) => (
                    <Badge key={o.id} variant="secondary" className="cursor-pointer" onClick={() => setSiteIds(toggleId(siteIds, o.id))}>
                      {o.name} ✕
                    </Badge>
                  ))}
                  {siteIds === "ALL" && (
                    <span className="text-sm text-muted-foreground">All Sites</span>
                  )}
                </div>
                <div className="max-h-28 overflow-auto border rounded-md p-2">
                  <div className="flex flex-wrap gap-1">
                    {options.sites.slice(0, 200).map((o) => {
                      const active = siteIds !== "ALL" && splitIds(siteIds).includes(o.id);
                      return (
                        <Badge
                          key={o.id}
                          variant={active ? "default" : "outline"}
                          className="cursor-pointer"
                          onClick={() => setSiteIds(toggleId(siteIds, o.id))}
                        >
                          {o.name}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {data?.ok === false && (
              <div className="text-sm text-red-600">
                {data.error || "Unknown error"}{" "}
                {data.hint ? <span className="text-muted-foreground">({data.hint})</span> : null}
              </div>
            )}
          </CardContent>
        </Card>

        {/* KPIs */}
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Revenue (USD)</CardTitle></CardHeader>
            <CardContent className="text-2xl font-semibold">{fmtMoney(k?.revenue_usd)}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Planned COGS (USD)</CardTitle></CardHeader>
            <CardContent className="text-2xl font-semibold">{fmtMoney(k?.planned_cogs_usd)}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Actual COGS (USD)</CardTitle></CardHeader>
            <CardContent className="text-2xl font-semibold">{fmtMoney(k?.actual_cogs_usd)}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Profit (USD)</CardTitle></CardHeader>
            <CardContent className="text-2xl font-semibold">{fmtMoney(k?.profit_usd)}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Margin %</CardTitle></CardHeader>
            <CardContent className="text-2xl font-semibold">{fmtPct(k?.margin_pct)}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Other Expenses (USD)</CardTitle></CardHeader>
            <CardContent className="text-2xl font-semibold">{fmtMoney(k?.other_expenses_usd)}</CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Factory Overhead (USD)</CardTitle></CardHeader>
            <CardContent className="text-2xl font-semibold">{fmtMoney(k?.factory_overhead_usd)}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Net Profit (USD)</CardTitle></CardHeader>
            <CardContent className="text-2xl font-semibold">{fmtMoney(k?.net_profit_usd)}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Net Margin %</CardTitle></CardHeader>
            <CardContent className="text-2xl font-semibold">{fmtPct(k?.net_margin_pct)}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Actual Coverage</CardTitle></CardHeader>
            <CardContent className="text-2xl font-semibold">{fmtPct(k?.actual_coverage_pct)}</CardContent>
          </Card>
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Monthly Net Profit / Net Margin</CardTitle>
            </CardHeader>
            <CardContent style={{ height: 320 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data?.monthly || []}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis yAxisId="left" tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                  <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `${v}%`} />
                  <Tooltip
                    formatter={(value: any, name: any) => {
                      if (name === "net_profit_usd") return [fmtMoney(value), "Net Profit (USD)"];
                      if (name === "net_margin_pct") return [fmtPct(value), "Net Margin %"];
                      if (name === "revenue_usd") return [fmtMoney(value), "Revenue (USD)"];
                      return [value, name];
                    }}
                  />
                  <Legend />
                  <Line yAxisId="left" type="monotone" dataKey="net_profit_usd" dot={false} />
                  <Line yAxisId="right" type="monotone" dataKey="net_margin_pct" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Ranking (Overhead Included) — Top 10</CardTitle>
            </CardHeader>
            <CardContent style={{ height: 320 }}>
              <Tabs defaultValue="buyer" className="w-full">
                <TabsList className="mb-2">
                  <TabsTrigger value="buyer">Buyer</TabsTrigger>
                  <TabsTrigger value="vendor">Vendor</TabsTrigger>
                  <TabsTrigger value="brand">Brand</TabsTrigger>
                </TabsList>

                {(["buyer", "vendor", "brand"] as const).map((tab) => {
                  const chartData =
                    tab === "buyer" ? data?.topBuyers || [] : tab === "vendor" ? data?.topVendors || [] : data?.topBrands || [];
                  return (
                    <TabsContent key={tab} value={tab} className="m-0">
                      <ResponsiveContainer width="100%" height={250}>
                        <BarChart data={chartData}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="name" hide />
                          <YAxis tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                          <Tooltip
                            formatter={(value: any, name: any) => {
                              if (name === "net_profit_usd") return [fmtMoney(value), "Net Profit (USD)"];
                              if (name === "revenue_usd") return [fmtMoney(value), "Revenue (USD)"];
                              if (name === "net_margin_pct") return [fmtPct(value), "Net Margin %"];
                              return [value, name];
                            }}
                            labelFormatter={(_, p: any) => p?.[0]?.payload?.name || ""}
                          />
                          <Legend />
                          <Bar dataKey="net_profit_usd" name="Net Profit (USD)" />
                        </BarChart>
                      </ResponsiveContainer>

                      <div className="mt-2 max-h-14 overflow-auto text-xs text-muted-foreground">
                        {(chartData || []).map((r: any, idx: number) => (
                          <div key={r.key || r.name || idx} className="flex items-center justify-between gap-2">
                            <div className="truncate">{idx + 1}. {r.name}</div>
                            <div className="shrink-0">{fmtMoney(r.net_profit_usd)} ({fmtPct(r.net_margin_pct)})</div>
                          </div>
                        ))}
                      </div>
                    </TabsContent>
                  );
                })}
              </Tabs>
            </CardContent>
          </Card>
        </div>

        {/* Table */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-base">Details</CardTitle>
              <div className="text-sm text-muted-foreground">
                Rows: {k?.row_count ?? 0}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-auto border rounded-md">
              <table className="min-w-[1200px] w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-2">Invoice</th>
                    <th className="text-left p-2">Date</th>
                    <th className="text-left p-2">Buyer</th>
                    <th className="text-left p-2">PO</th>
                    <th className="text-left p-2">Style</th>
                    <th className="text-right p-2">Revenue(USD)</th>
                    <th className="text-right p-2">Planned COGS</th>
                    <th className="text-right p-2">Actual COGS</th>
                    <th className="text-right p-2">Profit</th>
                    <th className="text-right p-2">Margin</th>
                    <th className="text-right p-2">Other Exp</th>
                    <th className="text-right p-2">Factory OH</th>
                    <th className="text-right p-2">Net Profit</th>
                    <th className="text-right p-2">Net Margin</th>
                    <th className="text-left p-2">Vendor</th>
                    <th className="text-left p-2">Site</th>
                    <th className="text-center p-2">Actual</th>
                  </tr>
                </thead>
                <tbody>
                  {(rows || []).slice(0, 5000).map((r, idx) => (
                    <tr key={idx} className="border-t">
                      <td className="p-2">{r.invoice_no || ""}</td>
                      <td className="p-2">{r.invoice_date || ""}</td>
                      <td className="p-2">{r.buyer_name || ""}</td>
                      <td className="p-2">{r.po_no || ""}</td>
                      <td className="p-2">
                        {/* UI: Buyer Style (main) + JM Style (sub). Keep sensible fallbacks. */}
                        <div className="font-medium">{r.buyer_style || r.jm_style || ""}</div>
                        <div className="text-xs text-muted-foreground">
                          {r.buyer_style ? (r.jm_style || "") : ""}
                        </div>
                      </td>
                      <td className="p-2 text-right tabular-nums">{fmtMoney(r.revenue_usd)}</td>
                      <td className="p-2 text-right tabular-nums">{fmtMoney(r.planned_cogs_usd)}</td>
                      <td className="p-2 text-right tabular-nums">{fmtMoney(r.actual_cogs_usd)}</td>
                      <td className="p-2 text-right tabular-nums">{fmtMoney(r.profit_usd)}</td>
                      <td className="p-2 text-right tabular-nums">{fmtPct(r.margin_pct)}</td>
                      <td className="p-2 text-right tabular-nums">{fmtMoney(r.other_expenses_usd)}</td>
                      <td className="p-2 text-right tabular-nums">{fmtMoney(r.factory_overhead_usd)}</td>
                      <td className="p-2 text-right tabular-nums">{fmtMoney(r.net_profit_usd)}</td>
                      <td className="p-2 text-right tabular-nums">{fmtPct(r.net_margin_pct)}</td>
                      <td className="p-2">{r.vendor_name || ""}</td>
                      <td className="p-2">{r.site_name || ""}</td>
                      <td className="p-2 text-center">
                        {Number(r.actual_coverage || 0) > 0 ? (
                          <Badge>Y</Badge>
                        ) : (
                          <Badge variant="outline">N</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!rows.length && !isLoading && (
                    <tr>
                      <td colSpan={17} className="p-4 text-center text-muted-foreground">
                        No data
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="text-xs text-muted-foreground mt-2">
              * 상세 테이블은 최대 5,000줄 표시. Export는 전체 rows 기준입니다.
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}