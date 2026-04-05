// src/app/dashboards/performance/page.tsx
"use client";

import React from "react";
import useSWR from "swr";
import AppShell from "@/components/layout/AppShell";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  BarChart,
  Bar,
} from "recharts";

type Dimension = "buyer" | "brand";
type CompareMode = "RANGE" | "YTD";
type TopMetric = "combined" | "orders" | "shipping";
type ViewMode = "BY_ENTITY" | "COMBINED";

type MonthlyRow = {
  dimension: Dimension;
  buyer_id: string | null;
  buyer_name: string | null;
  brand_name: string | null;
  month_start: string; // YYYY-MM-DD
  year: number;
  month: number;
  order_usd: number;
  ship_usd: number;
  order_yoy_pct: number | null;
  order_mom_pct: number | null;
  ship_yoy_pct: number | null;
  ship_mom_pct: number | null;
};

type YearlyRow = {
  dimension: Dimension;
  buyer_id: string | null;
  buyer_name: string | null;
  brand_name: string | null;
  year: number;
  order_usd: number;
  ship_usd: number;
  order_yoy_pct: number | null;
  ship_yoy_pct: number | null;
};

type OptionsResp = {
  ok: boolean;
  buyers: { id: string; name: string }[];
  brands: string[];
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function fmtUsd(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);
}
function fmtUsdPlain(n: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n || 0);
}
function fmtPct(n: number | null) {
  if (n === null || n === undefined) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function pctFrom(curr: number, base: number) {
  if (!Number.isFinite(base) || base === 0) return null;
  return Math.round(((curr - base) / base) * 10000) / 100;
}

function PctBadge({ v }: { v: number | null }) {
  if (v === null || v === undefined) return <span className="text-muted-foreground">—</span>;
  const cls =
    v > 0
      ? "bg-emerald-100 text-emerald-900 border-emerald-200"
      : v < 0
      ? "bg-rose-100 text-rose-900 border-rose-200"
      : "bg-slate-100 text-slate-900 border-slate-200";
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`}>
      {fmtPct(v)}
    </span>
  );
}

function monthLabel(s: string) {
  return s ? s.slice(0, 7) : "—";
}

function parseYearMonth(dateStr: string) {
  // YYYY-MM-DD
  const y = Number(dateStr.slice(0, 4));
  const m = Number(dateStr.slice(5, 7));
  return { y, m };
}

function ytdRange(endMonthStart: string) {
  // endMonthStart is YYYY-MM-01
  const { y, m } = parseYearMonth(endMonthStart);
  const start = `${String(y).padStart(4, "0")}-01-01`;
  const end = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`;
  const prevStart = `${String(y - 1).padStart(4, "0")}-01-01`;
  const prevEnd = `${String(y - 1).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`;
  return { start, end, prevStart, prevEnd, year: y, month: m };
}

function chip(text: string, onX?: () => void) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs bg-white">
      <span className="truncate max-w-[220px]">{text}</span>
      {onX ? (
        <button
          type="button"
          onClick={onX}
          className="text-muted-foreground hover:text-foreground"
          aria-label="remove"
        >
          ×
        </button>
      ) : null}
    </span>
  );
}

export default function PerformanceDashboardPage() {
  const [dimension, setDimension] = React.useState<Dimension>("buyer");
  const [compareMode, setCompareMode] = React.useState<CompareMode>("RANGE");
  const [topMetric, setTopMetric] = React.useState<TopMetric>("combined");
  const [viewMode, setViewMode] = React.useState<ViewMode>("BY_ENTITY");

  const [start, setStart] = React.useState<string>(() => {
    const d = new Date();
    d.setUTCMonth(d.getUTCMonth() - 11);
    d.setUTCDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [end, setEnd] = React.useState<string>(() => {
    const d = new Date();
    d.setUTCDate(1);
    return d.toISOString().slice(0, 10);
  });

  // Multi-select filters
  const [allBuyers, setAllBuyers] = React.useState(true);
  const [allBrands, setAllBrands] = React.useState(true);
  const [buyerIds, setBuyerIds] = React.useState<string[]>([]);
  const [brandNames, setBrandNames] = React.useState<string[]>([]);

  // Options (buyers/brands) are derived from v_perf_monthly so it always matches actual data.
  const optQs = new URLSearchParams({ start, end }).toString();
  const { data: optData } = useSWR<OptionsResp>(`/api/dashboards/performance/options?${optQs}`, fetcher);

  // When toggling ALL on, clear selections (to avoid confusion)
  React.useEffect(() => {
    if (allBuyers) setBuyerIds([]);
  }, [allBuyers]);
  React.useEffect(() => {
    if (allBrands) setBrandNames([]);
  }, [allBrands]);

  const qsObj: Record<string, string> = { dimension, start, end };
  if (!allBuyers && buyerIds.length) qsObj.buyer_ids = buyerIds.join(",");
  if (!allBrands && brandNames.length) qsObj.brand_names = brandNames.join(",");

  const qs = new URLSearchParams(qsObj).toString();
  const { data, isLoading, mutate } = useSWR(`/api/dashboards/performance?${qs}`, fetcher);

  const monthly: MonthlyRow[] = (data?.monthly || []) as MonthlyRow[];
  const yearly: YearlyRow[] = (data?.yearly || []) as YearlyRow[];

  // Grouping helpers
  const monthlyGrouped = React.useMemo(() => {
    const m = new Map<string, MonthlyRow[]>();
    for (const r of monthly) {
      const k = dimension === "buyer" ? (r.buyer_name || "—") : (r.brand_name || "—");
      const list = m.get(k) || [];
      list.push(r);
      m.set(k, list);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [monthly, dimension]);

  const yearlyGrouped = React.useMemo(() => {
    const m = new Map<string, YearlyRow[]>();
    for (const r of yearly) {
      const k = dimension === "buyer" ? (r.buyer_name || "—") : (r.brand_name || "—");
      const list = m.get(k) || [];
      list.push(r);
      m.set(k, list);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [yearly, dimension]);


  const combinedMonthly = React.useMemo(() => {
    const m = new Map<string, {
      month_start: string;
      year: number;
      month: number;
      order_usd: number;
      ship_usd: number;
      order_yoy_pct: number | null;
      order_mom_pct: number | null;
      ship_yoy_pct: number | null;
      ship_mom_pct: number | null;
    }>();

    for (const r of monthly) {
      const prev = m.get(r.month_start) || {
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
      m.set(r.month_start, prev);
    }

    const arr = Array.from(m.values()).sort((a, b) => a.month_start.localeCompare(b.month_start));
    const byMonth = new Map(arr.map((x) => [x.month_start, x] as const));

    return arr.map((row, idx) => {
      const prev = idx > 0 ? arr[idx - 1] : null;
      const prevYearKey = `${row.year - 1}-${String(row.month).padStart(2, "0")}-01`;
      const prevYear = byMonth.get(prevYearKey);
      return {
        ...row,
        order_mom_pct: prev ? pctFrom(row.order_usd, prev.order_usd) : null,
        ship_mom_pct: prev ? pctFrom(row.ship_usd, prev.ship_usd) : null,
        order_yoy_pct: prevYear ? pctFrom(row.order_usd, prevYear.order_usd) : null,
        ship_yoy_pct: prevYear ? pctFrom(row.ship_usd, prevYear.ship_usd) : null,
      };
    });
  }, [monthly]);

  const combinedYearly = React.useMemo(() => {
    const m = new Map<number, {
      year: number;
      order_usd: number;
      ship_usd: number;
      order_yoy_pct: number | null;
      ship_yoy_pct: number | null;
    }>();

    for (const r of yearly) {
      const prev = m.get(r.year) || {
        year: r.year,
        order_usd: 0,
        ship_usd: 0,
        order_yoy_pct: null,
        ship_yoy_pct: null,
      };
      prev.order_usd += Number(r.order_usd || 0);
      prev.ship_usd += Number(r.ship_usd || 0);
      m.set(r.year, prev);
    }

    const arr = Array.from(m.values()).sort((a, b) => a.year - b.year);
    return arr.map((row, idx) => {
      const prev = idx > 0 ? arr[idx - 1] : null;
      return {
        ...row,
        order_yoy_pct: prev ? pctFrom(row.order_usd, prev.order_usd) : null,
        ship_yoy_pct: prev ? pctFrom(row.ship_usd, prev.ship_usd) : null,
      };
    });
  }, [yearly]);

  // Compare: YTD vs Prior YTD (computed client-side for flexibility)
  const compare = React.useMemo(() => {
    if (compareMode !== "YTD") return null;
    const { start: ytdStart, end: ytdEnd, prevStart, prevEnd, year } = ytdRange(end);

    function inRange(ms: string, s: string, e: string) {
      return ms >= s && ms <= e;
    }

    // aggregate by dimension member
    const cur = new Map<string, { name: string; order: number; ship: number }>();
    const prv = new Map<string, { name: string; order: number; ship: number }>();

    for (const r of (data?.monthly_raw || []) as any[]) {
      const name = dimension === "buyer" ? (r.buyer_name || "—") : (r.brand_name || "—");
      const key = name;

      if (inRange(r.month_start, ytdStart, ytdEnd)) {
        const p = cur.get(key) || { name, order: 0, ship: 0 };
        p.order += Number(r.order_usd || 0);
        p.ship += Number(r.ship_usd || 0);
        cur.set(key, p);
      }
      if (inRange(r.month_start, prevStart, prevEnd)) {
        const p = prv.get(key) || { name, order: 0, ship: 0 };
        p.order += Number(r.order_usd || 0);
        p.ship += Number(r.ship_usd || 0);
        prv.set(key, p);
      }
    }

    const rows = Array.from(new Set([...cur.keys(), ...prv.keys()])).map((k) => {
      const c = cur.get(k) || { name: k, order: 0, ship: 0 };
      const p = prv.get(k) || { name: k, order: 0, ship: 0 };
      const order_yoy = p.order === 0 ? null : Math.round(((c.order - p.order) / p.order) * 10000) / 100;
      const ship_yoy = p.ship === 0 ? null : Math.round(((c.ship - p.ship) / p.ship) * 10000) / 100;
      return {
        name: k,
        year,
        order_cur: c.order,
        order_prev: p.order,
        order_yoy,
        ship_cur: c.ship,
        ship_prev: p.ship,
        ship_yoy,
      };
    });

    rows.sort((a, b) => (b.order_cur + b.ship_cur) - (a.order_cur + a.ship_cur));
    const top = rows.slice(0, 12);

    const total = top.reduce(
      (acc, r) => {
        acc.order_cur += r.order_cur;
        acc.order_prev += r.order_prev;
        acc.ship_cur += r.ship_cur;
        acc.ship_prev += r.ship_prev;
        return acc;
      },
      { order_cur: 0, order_prev: 0, ship_cur: 0, ship_prev: 0 }
    );

    const total_order_yoy = total.order_prev === 0 ? null : Math.round(((total.order_cur - total.order_prev) / total.order_prev) * 10000) / 100;
    const total_ship_yoy = total.ship_prev === 0 ? null : Math.round(((total.ship_cur - total.ship_prev) / total.ship_prev) * 10000) / 100;

    return { ytdStart, ytdEnd, prevStart, prevEnd, top, total: { ...total, total_order_yoy, total_ship_yoy } };
  }, [compareMode, end, dimension, data]);


  const compareCombined = React.useMemo(() => {
    if (compareMode !== "YTD") return null;
    const { start: ytdStart, end: ytdEnd, prevStart, prevEnd, year } = ytdRange(end);

    function inRange(ms: string, s: string, e: string) {
      return ms >= s && ms <= e;
    }

    let orderCur = 0;
    let orderPrev = 0;
    let shipCur = 0;
    let shipPrev = 0;

    for (const r of (data?.monthly_raw || []) as any[]) {
      if (inRange(r.month_start, ytdStart, ytdEnd)) {
        orderCur += Number(r.order_usd || 0);
        shipCur += Number(r.ship_usd || 0);
      }
      if (inRange(r.month_start, prevStart, prevEnd)) {
        orderPrev += Number(r.order_usd || 0);
        shipPrev += Number(r.ship_usd || 0);
      }
    }

    return {
      year,
      ytdStart,
      ytdEnd,
      prevStart,
      prevEnd,
      order_cur: orderCur,
      order_prev: orderPrev,
      order_yoy: pctFrom(orderCur, orderPrev),
      ship_cur: shipCur,
      ship_prev: shipPrev,
      ship_yoy: pctFrom(shipCur, shipPrev),
    };
  }, [compareMode, end, data]);

  const kpis = React.useMemo(() => {
    const latest = combinedMonthly.length ? combinedMonthly[combinedMonthly.length - 1] : null;
    const orderTotal = combinedMonthly.reduce((s, r) => s + Number(r.order_usd || 0), 0);
    const shipTotal = combinedMonthly.reduce((s, r) => s + Number(r.ship_usd || 0), 0);

    if (compareMode === "YTD" && compareCombined) {
      return {
        orderTotal,
        shipTotal,
        orderTrendLabel: `Orders YTD YoY`,
        orderTrendValue: compareCombined.order_yoy,
        shipTrendLabel: `Shipping YTD YoY`,
        shipTrendValue: compareCombined.ship_yoy,
        latestLabel: `${compareCombined.ytdEnd.slice(0, 7)} YTD`,
      };
    }

    return {
      orderTotal,
      shipTotal,
      orderTrendLabel: latest ? `Orders YoY (${monthLabel(latest.month_start)})` : "Orders YoY",
      orderTrendValue: latest?.order_yoy_pct ?? null,
      shipTrendLabel: latest ? `Shipping YoY (${monthLabel(latest.month_start)})` : "Shipping YoY",
      shipTrendValue: latest?.ship_yoy_pct ?? null,
      latestLabel: latest ? monthLabel(latest.month_start) : "—",
    };
  }, [combinedMonthly, compareMode, compareCombined]);

  // Charts: trend total within current query range
  const trend = React.useMemo(() => {
    const m = new Map<string, { month: string; order_usd: number; ship_usd: number }>();
    for (const r of monthly) {
      const k = r.month_start;
      const prev = m.get(k) || { month: monthLabel(k), order_usd: 0, ship_usd: 0 };
      prev.order_usd += Number(r.order_usd || 0);
      prev.ship_usd += Number(r.ship_usd || 0);
      m.set(k, prev);
    }
    return Array.from(m.values()).sort((a, b) => a.month.localeCompare(b.month));
  }, [monthly]);

  // Top N by chosen metric
  const top10 = React.useMemo(() => {
    const m = new Map<string, { name: string; order_usd: number; ship_usd: number; score: number }>();
    for (const r of monthly) {
      const name = dimension === "buyer" ? (r.buyer_name || "—") : (r.brand_name || "—");
      const prev = m.get(name) || { name, order_usd: 0, ship_usd: 0, score: 0 };
      prev.order_usd += Number(r.order_usd || 0);
      prev.ship_usd += Number(r.ship_usd || 0);
      m.set(name, prev);
    }
    const arr = Array.from(m.values()).map((x) => {
      const score =
        topMetric === "orders" ? x.order_usd : topMetric === "shipping" ? x.ship_usd : (x.order_usd + x.ship_usd);
      return { ...x, score };
    });
    arr.sort((a, b) => (b.score - a.score) || a.name.localeCompare(b.name));
    return arr.slice(0, 10);
  }, [monthly, dimension, topMetric]);

  function exportExcel() {
    const isCombined = viewMode === "COMBINED";

    const sheetMonthly: any[] = isCombined
      ? combinedMonthly.map((r) => ({
          ViewMode: viewMode,
          Dimension: dimension,
          Name: "Combined Total",
          Month: monthLabel(r.month_start),
          Orders_USD: Number(r.order_usd || 0),
          Orders_YoY_Pct: r.order_yoy_pct ?? null,
          Orders_MoM_Pct: r.order_mom_pct ?? null,
          Shipping_USD: Number(r.ship_usd || 0),
          Shipping_YoY_Pct: r.ship_yoy_pct ?? null,
          Shipping_MoM_Pct: r.ship_mom_pct ?? null,
        }))
      : monthlyGrouped.flatMap(([name, list]) =>
          list
            .slice()
            .sort((a, b) => a.month_start.localeCompare(b.month_start))
            .map((r) => ({
              ViewMode: viewMode,
              Dimension: dimension,
              Name: name,
              Month: monthLabel(r.month_start),
              Orders_USD: Number(r.order_usd || 0),
              Orders_YoY_Pct: r.order_yoy_pct ?? null,
              Orders_MoM_Pct: r.order_mom_pct ?? null,
              Shipping_USD: Number(r.ship_usd || 0),
              Shipping_YoY_Pct: r.ship_yoy_pct ?? null,
              Shipping_MoM_Pct: r.ship_mom_pct ?? null,
            }))
        );

    const sheetYearly: any[] = isCombined
      ? combinedYearly.map((r) => ({
          ViewMode: viewMode,
          Dimension: dimension,
          Name: "Combined Total",
          Year: r.year,
          Orders_USD: Number(r.order_usd || 0),
          Orders_YoY_Pct: r.order_yoy_pct ?? null,
          Shipping_USD: Number(r.ship_usd || 0),
          Shipping_YoY_Pct: r.ship_yoy_pct ?? null,
        }))
      : yearlyGrouped.flatMap(([name, list]) =>
          (list as YearlyRow[])
            .slice()
            .sort((a, b) => a.year - b.year)
            .map((r) => ({
              ViewMode: viewMode,
              Dimension: dimension,
              Name: name,
              Year: r.year,
              Orders_USD: Number(r.order_usd || 0),
              Orders_YoY_Pct: r.order_yoy_pct ?? null,
              Shipping_USD: Number(r.ship_usd || 0),
              Shipping_YoY_Pct: r.ship_yoy_pct ?? null,
            }))
        );

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetMonthly), "Monthly");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetYearly), "Yearly");

    if (!isCombined) {
      const sheetTop10 = top10.map((r, idx) => ({
        Rank: idx + 1,
        Dimension: dimension,
        Name: r.name,
        Metric: topMetric,
        Orders_USD: Number(r.order_usd || 0),
        Shipping_USD: Number(r.ship_usd || 0),
        Combined_USD: Number((r.order_usd || 0) + (r.ship_usd || 0)),
        Score: Number(r.score || 0),
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetTop10), "Top10");
    }

    if (compareMode === "YTD") {
      if (isCombined && compareCombined) {
        const ytdSheet = [{
          ViewMode: viewMode,
          Dimension: dimension,
          Name: "Combined Total",
          YTD_Start: compareCombined.ytdStart,
          YTD_End: compareCombined.ytdEnd,
          Orders_Cur: compareCombined.order_cur,
          Orders_Prev: compareCombined.order_prev,
          Orders_YoY_Pct: compareCombined.order_yoy,
          Shipping_Cur: compareCombined.ship_cur,
          Shipping_Prev: compareCombined.ship_prev,
          Shipping_YoY_Pct: compareCombined.ship_yoy,
        }];
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ytdSheet), "YTD_vs_PriorYTD");
      } else if (compare) {
        const sheetYtd = compare.top.map((r) => ({
          Dimension: dimension,
          Name: r.name,
          YTD_Start: compare.ytdStart,
          YTD_End: compare.ytdEnd,
          Orders_Cur: r.order_cur,
          Orders_Prev: r.order_prev,
          Orders_YoY_Pct: r.order_yoy,
          Shipping_Cur: r.ship_cur,
          Shipping_Prev: r.ship_prev,
          Shipping_YoY_Pct: r.ship_yoy,
        }));
        sheetYtd.unshift({
          Dimension: dimension,
          Name: "TOTAL (TOP 12)",
          YTD_Start: compare.ytdStart,
          YTD_End: compare.ytdEnd,
          Orders_Cur: compare.total.order_cur,
          Orders_Prev: compare.total.order_prev,
          Orders_YoY_Pct: compare.total.total_order_yoy,
          Shipping_Cur: compare.total.ship_cur,
          Shipping_Prev: compare.total.ship_prev,
          Shipping_YoY_Pct: compare.total.total_ship_yoy,
        });
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetYtd), "YTD_vs_PriorYTD");
      }
    }

    XLSX.writeFile(wb, `performance_${dimension}_${viewMode.toLowerCase()}_${start}_to_${end}.xlsx`);
  }

  function exportPdf() {
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    const isCombined = viewMode === "COMBINED";

    doc.setFontSize(14);
    doc.text(
      `Performance (${dimension === "buyer" ? "Buyer" : "Brand"})${isCombined ? " - Combined Total" : ""}`,
      40,
      40
    );

    const scopeParts: string[] = [];
    scopeParts.push(`View: ${isCombined ? "Combined Total" : "By Entity"}`);
    scopeParts.push(compareMode === "YTD" ? "Mode: YTD" : "Mode: Range");
    scopeParts.push(`Range: ${start.slice(0, 7)} ~ ${end.slice(0, 7)}`);
    if (!allBuyers && buyerIds.length) scopeParts.push(`Buyers: ${buyerIds.length}`);
    if (!allBrands && brandNames.length) scopeParts.push(`Brands: ${brandNames.length}`);
    doc.setFontSize(9);
    doc.text(scopeParts.join(" | "), 40, 56);

    let y = 72;

    if (isCombined) {
      autoTable(doc, {
        startY: y,
        head: [["KPI", "Value", "Trend"]],
        body: [
          ["Orders Total", fmtUsd(kpis.orderTotal), `${kpis.orderTrendLabel}: ${fmtPct(kpis.orderTrendValue)}`],
          ["Shipping Total", fmtUsd(kpis.shipTotal), `${kpis.shipTrendLabel}: ${fmtPct(kpis.shipTrendValue)}`],
        ],
        styles: { fontSize: 9, cellPadding: 4 },
        headStyles: { fontStyle: "bold" },
        margin: { left: 40, right: 40 },
        theme: "grid",
      });

      // @ts-ignore
      y = doc.lastAutoTable.finalY + 18;

      if (compareMode === "YTD" && compareCombined) {
        autoTable(doc, {
          startY: y,
          head: [["Section", "Orders (YTD)", "Orders (Prior)", "YoY", "Shipping (YTD)", "Shipping (Prior)", "YoY"]],
          body: [[
            "Combined Total",
            fmtUsdPlain(compareCombined.order_cur),
            fmtUsdPlain(compareCombined.order_prev),
            fmtPct(compareCombined.order_yoy),
            fmtUsdPlain(compareCombined.ship_cur),
            fmtUsdPlain(compareCombined.ship_prev),
            fmtPct(compareCombined.ship_yoy),
          ]],
          styles: { fontSize: 8, cellPadding: 3 },
          headStyles: { fontStyle: "bold" },
          margin: { left: 40, right: 40 },
          theme: "grid",
        });
        // @ts-ignore
        y = doc.lastAutoTable.finalY + 18;
      }

      autoTable(doc, {
        startY: y,
        head: [["Month", "Orders", "YoY", "MoM", "Shipping", "YoY", "MoM"]],
        body: combinedMonthly.map((r) => [
          monthLabel(r.month_start),
          fmtUsdPlain(Number(r.order_usd || 0)),
          fmtPct(r.order_yoy_pct),
          fmtPct(r.order_mom_pct),
          fmtUsdPlain(Number(r.ship_usd || 0)),
          fmtPct(r.ship_yoy_pct),
          fmtPct(r.ship_mom_pct),
        ]),
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fontStyle: "bold" },
        margin: { left: 40, right: 40 },
        theme: "grid",
      });

      doc.save(`performance_${dimension}_${viewMode.toLowerCase()}_${start}_to_${end}.pdf`);
      return;
    }

    const rank = new Map<string, number>();
    top10.forEach((x, i) => rank.set(x.name, i));

    const topMonthlyGroups = monthlyGrouped
      .filter(([name]) => rank.has(name))
      .slice()
      .sort((a, b) => rank.get(a[0])! - rank.get(b[0])!);

    autoTable(doc, {
      startY: y,
      head: [[dimension === "buyer" ? "Buyer" : "Brand", "Orders", "Shipping", "Combined"]],
      body: top10.map((r) => [
        r.name,
        fmtUsdPlain(Number(r.order_usd || 0)),
        fmtUsdPlain(Number(r.ship_usd || 0)),
        fmtUsdPlain(Number((r.order_usd || 0) + (r.ship_usd || 0))),
      ]),
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fontStyle: "bold" },
      margin: { left: 40, right: 40 },
      theme: "grid",
    });

    // @ts-ignore
    y = doc.lastAutoTable.finalY + 22;
    if (y > 520) {
      doc.addPage();
      y = 40;
    }

    for (const [name, list] of topMonthlyGroups) {
      doc.setFontSize(11);
      doc.text(name, 40, y);
      y += 10;

      const body = list
        .slice()
        .sort((a, b) => a.month_start.localeCompare(b.month_start))
        .map((r) => [
          monthLabel(r.month_start),
          fmtUsdPlain(Number(r.order_usd || 0)),
          fmtPct(r.order_yoy_pct),
          fmtPct(r.order_mom_pct),
          fmtUsdPlain(Number(r.ship_usd || 0)),
          fmtPct(r.ship_yoy_pct),
          fmtPct(r.ship_mom_pct),
        ]);

      autoTable(doc, {
        startY: y,
        head: [["Month", "Orders", "YoY", "MoM", "Shipping", "YoY", "MoM"]],
        body,
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fontStyle: "bold" },
        margin: { left: 40, right: 40 },
        theme: "grid",
      });

      // @ts-ignore
      y = doc.lastAutoTable.finalY + 18;
      if (y > 520) {
        doc.addPage();
        y = 40;
      }
    }

    doc.save(`performance_${dimension}_${viewMode.toLowerCase()}_${start}_to_${end}.pdf`);
  }

  function toggleInList(list: string[], v: string) {
    if (list.includes(v)) return list.filter((x) => x !== v);
    return [...list, v];
  }

  return (
    <AppShell title="Performance (Buyer / Brand)">
      <div className="space-y-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Filters</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-12">
              <div className="space-y-2 md:col-span-2">
                <Label>Dimension</Label>
                <Select value={dimension} onValueChange={(v) => setDimension(v as Dimension)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="buyer">Buyer</SelectItem>
                    <SelectItem value="brand">Brand</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label>View Mode</Label>
                <Select value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BY_ENTITY">By {dimension === "buyer" ? "Buyer" : "Brand"}</SelectItem>
                    <SelectItem value="COMBINED">Combined Total</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2 md:col-span-3">
                <Label>Compare Mode</Label>
                <Select value={compareMode} onValueChange={(v) => setCompareMode(v as CompareMode)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="RANGE">Range (YoY/MoM in table)</SelectItem>
                    <SelectItem value="YTD">YTD vs Prior YTD</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label>Start (month)</Label>
                <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
              </div>

              <div className="space-y-2 md:col-span-3">
                <Label>End (month)</Label>
                <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
              </div>

              <div className="md:col-span-12 grid gap-3 md:grid-cols-12 items-end">
                {/* Buyers multi-select */}
                <div className="md:col-span-6">
                  <div className="flex items-center justify-between">
                    <Label>Buyers</Label>
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => setAllBuyers((v) => !v)}
                    >
                      {allBuyers ? "All Buyers: ON" : "All Buyers: OFF"}
                    </button>
                  </div>

                  {!allBuyers ? (
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      <div className="flex flex-wrap gap-2">
                        {buyerIds.length ? buyerIds.map((id) => {
                          const nm = optData?.buyers?.find((b) => b.id === id)?.name || id;
                          return chip(nm, () => setBuyerIds((xs) => xs.filter((x) => x !== id)));
                        }) : <span className="text-xs text-muted-foreground">No buyers selected</span>}
                      </div>
                      <div className="border rounded-md p-2 max-h-[140px] overflow-auto bg-white">
                        {(optData?.buyers || []).map((b) => (
                          <label key={b.id} className="flex items-center gap-2 text-sm py-1">
                            <input
                              type="checkbox"
                              checked={buyerIds.includes(b.id)}
                              onChange={() => setBuyerIds((xs) => toggleInList(xs, b.id))}
                            />
                            <span className="truncate">{b.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 text-xs text-muted-foreground">All buyers included</div>
                  )}
                </div>

                {/* Brands multi-select */}
                <div className="md:col-span-6">
                  <div className="flex items-center justify-between">
                    <Label>Brands</Label>
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => setAllBrands((v) => !v)}
                    >
                      {allBrands ? "All Brands: ON" : "All Brands: OFF"}
                    </button>
                  </div>

                  {!allBrands ? (
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      <div className="flex flex-wrap gap-2">
                        {brandNames.length ? brandNames.map((bn) =>
                          chip(bn, () => setBrandNames((xs) => xs.filter((x) => x !== bn)))
                        ) : <span className="text-xs text-muted-foreground">No brands selected</span>}
                      </div>
                      <div className="border rounded-md p-2 max-h-[140px] overflow-auto bg-white">
                        {(optData?.brands || []).map((bn) => (
                          <label key={bn} className="flex items-center gap-2 text-sm py-1">
                            <input
                              type="checkbox"
                              checked={brandNames.includes(bn)}
                              onChange={() => setBrandNames((xs) => toggleInList(xs, bn))}
                            />
                            <span className="truncate">{bn}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 text-xs text-muted-foreground">All brands included</div>
                  )}
                </div>

                <div className="md:col-span-12 flex flex-wrap items-center gap-2">
                  <Button onClick={() => mutate()} disabled={isLoading}>
                    Apply
                  </Button>
                  <Button variant="outline" onClick={exportExcel} disabled={isLoading}>
                    Export Excel
                  </Button>
                  <Button variant="outline" onClick={exportPdf} disabled={isLoading}>
                    Export PDF
                  </Button>

                  {viewMode === "BY_ENTITY" ? (
                    <div className="ml-auto flex items-center gap-2">
                      <Label className="text-xs">Top10 metric</Label>
                      <Select value={topMetric} onValueChange={(v) => setTopMetric(v as TopMetric)}>
                        <SelectTrigger className="h-9 w-[180px]">
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="combined">Combined</SelectItem>
                          <SelectItem value="orders">Orders</SelectItem>
                          <SelectItem value="shipping">Shipping</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>


        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Orders Total</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tabular-nums">{fmtUsd(kpis.orderTotal)}</div>
              <div className="mt-1 text-xs text-muted-foreground">{viewMode === "COMBINED" ? "Combined scope" : "Filtered scope"}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Shipping Total</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tabular-nums">{fmtUsd(kpis.shipTotal)}</div>
              <div className="mt-1 text-xs text-muted-foreground">{kpis.latestLabel}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{kpis.orderTrendLabel}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold"><PctBadge v={kpis.orderTrendValue} /></div>
              <div className="mt-1 text-xs text-muted-foreground">Combined KPI card</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{kpis.shipTrendLabel}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold"><PctBadge v={kpis.shipTrendValue} /></div>
              <div className="mt-1 text-xs text-muted-foreground">Combined KPI card</div>
            </CardContent>
          </Card>
        </div>

        {compareMode === "YTD" ? (
          viewMode === "COMBINED" ? (
            compareCombined ? (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    YTD vs Prior YTD — Combined Total ({compareCombined.ytdStart.slice(0, 4)} through {compareCombined.ytdEnd.slice(0, 7)})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="mb-3 text-sm text-muted-foreground">
                    Current: {compareCombined.ytdStart.slice(0, 7)} ~ {compareCombined.ytdEnd.slice(0, 7)} | Prior: {compareCombined.prevStart.slice(0, 7)} ~ {compareCombined.prevEnd.slice(0, 7)}
                  </div>

                  <div className="overflow-auto">
                    <table className="min-w-[980px] w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2 pr-4">Section</th>
                          <th className="text-right py-2 px-2">Orders (YTD)</th>
                          <th className="text-right py-2 px-2">Orders (Prior)</th>
                          <th className="text-center py-2 px-2">YoY</th>
                          <th className="text-right py-2 px-2">Shipping (YTD)</th>
                          <th className="text-right py-2 px-2">Shipping (Prior)</th>
                          <th className="text-center py-2 px-2">YoY</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b bg-slate-50 font-medium">
                          <td className="py-2 pr-4">Combined Total</td>
                          <td className="py-2 px-2 text-right tabular-nums">{fmtUsd(compareCombined.order_cur)}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{fmtUsd(compareCombined.order_prev)}</td>
                          <td className="py-2 px-2 text-center"><PctBadge v={compareCombined.order_yoy} /></td>
                          <td className="py-2 px-2 text-right tabular-nums">{fmtUsd(compareCombined.ship_cur)}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{fmtUsd(compareCombined.ship_prev)}</td>
                          <td className="py-2 px-2 text-center"><PctBadge v={compareCombined.ship_yoy} /></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            ) : null
          ) : compare ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  YTD vs Prior YTD (Top 12) — {compare.ytdStart.slice(0, 4)} YTD (through {compare.ytdEnd.slice(0, 7)})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="mb-3 text-sm text-muted-foreground">
                  Current: {compare.ytdStart.slice(0, 7)} ~ {compare.ytdEnd.slice(0, 7)} | Prior: {compare.prevStart.slice(0, 7)} ~ {compare.prevEnd.slice(0, 7)}
                </div>

                <div className="overflow-auto">
                  <table className="min-w-[980px] w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 pr-4">{dimension === "buyer" ? "Buyer" : "Brand"}</th>
                        <th className="text-right py-2 px-2">Orders (YTD)</th>
                        <th className="text-right py-2 px-2">Orders (Prior)</th>
                        <th className="text-center py-2 px-2">YoY</th>
                        <th className="text-right py-2 px-2">Shipping (YTD)</th>
                        <th className="text-right py-2 px-2">Shipping (Prior)</th>
                        <th className="text-center py-2 px-2">YoY</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b bg-slate-50 font-medium">
                        <td className="py-2 pr-4">TOTAL (TOP 12)</td>
                        <td className="py-2 px-2 text-right tabular-nums">{fmtUsd(compare.total.order_cur)}</td>
                        <td className="py-2 px-2 text-right tabular-nums">{fmtUsd(compare.total.order_prev)}</td>
                        <td className="py-2 px-2 text-center"><PctBadge v={compare.total.total_order_yoy} /></td>
                        <td className="py-2 px-2 text-right tabular-nums">{fmtUsd(compare.total.ship_cur)}</td>
                        <td className="py-2 px-2 text-right tabular-nums">{fmtUsd(compare.total.ship_prev)}</td>
                        <td className="py-2 px-2 text-center"><PctBadge v={compare.total.total_ship_yoy} /></td>
                      </tr>
                      {compare.top.map((r) => (
                        <tr key={r.name} className="border-b last:border-b-0">
                          <td className="py-2 pr-4">{r.name}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{fmtUsd(r.order_cur)}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{fmtUsd(r.order_prev)}</td>
                          <td className="py-2 px-2 text-center"><PctBadge v={r.order_yoy} /></td>
                          <td className="py-2 px-2 text-right tabular-nums">{fmtUsd(r.ship_cur)}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{fmtUsd(r.ship_prev)}</td>
                          <td className="py-2 px-2 text-center"><PctBadge v={r.ship_yoy} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ) : null
        ) : null}

        <Tabs defaultValue="monthly">
          <TabsList>
            <TabsTrigger value="monthly">Monthly Table</TabsTrigger>
            <TabsTrigger value="yearly">Yearly Table</TabsTrigger>
            <TabsTrigger value="charts">Charts</TabsTrigger>
            <TabsTrigger value="raw">Raw</TabsTrigger>
          </TabsList>

          <TabsContent value="monthly" className="space-y-4">
            {isLoading ? (
              <Card>
                <CardContent className="py-8 text-sm text-muted-foreground">Loading…</CardContent>
              </Card>
            ) : viewMode === "COMBINED" ? (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Combined Total</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-auto">
                    <table className="min-w-[980px] w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2 pr-4">Month</th>
                          <th className="text-right py-2 px-2">Orders</th>
                          <th className="text-center py-2 px-2">YoY</th>
                          <th className="text-center py-2 px-2">MoM</th>
                          <th className="text-right py-2 px-2">Shipping</th>
                          <th className="text-center py-2 px-2">YoY</th>
                          <th className="text-center py-2 px-2">MoM</th>
                        </tr>
                      </thead>
                      <tbody>
                        {combinedMonthly.map((r) => (
                          <tr key={r.month_start} className="border-b last:border-b-0">
                            <td className="py-2 pr-4">{monthLabel(r.month_start)}</td>
                            <td className="py-2 px-2 text-right tabular-nums">{fmtUsd(Number(r.order_usd || 0))}</td>
                            <td className="py-2 px-2 text-center"><PctBadge v={r.order_yoy_pct} /></td>
                            <td className="py-2 px-2 text-center"><PctBadge v={r.order_mom_pct} /></td>
                            <td className="py-2 px-2 text-right tabular-nums">{fmtUsd(Number(r.ship_usd || 0))}</td>
                            <td className="py-2 px-2 text-center"><PctBadge v={r.ship_yoy_pct} /></td>
                            <td className="py-2 px-2 text-center"><PctBadge v={r.ship_mom_pct} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            ) : (
              monthlyGrouped.map(([name, list]) => (
                <Card key={name}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{name}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-auto">
                      <table className="min-w-[980px] w-full text-sm">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-2 pr-4">Month</th>
                            <th className="text-right py-2 px-2">Orders</th>
                            <th className="text-center py-2 px-2">YoY</th>
                            <th className="text-center py-2 px-2">MoM</th>
                            <th className="text-right py-2 px-2">Shipping</th>
                            <th className="text-center py-2 px-2">YoY</th>
                            <th className="text-center py-2 px-2">MoM</th>
                          </tr>
                        </thead>
                        <tbody>
                          {list
                            .slice()
                            .sort((a, b) => a.month_start.localeCompare(b.month_start))
                            .map((r) => (
                              <tr key={r.month_start} className="border-b last:border-b-0">
                                <td className="py-2 pr-4">{monthLabel(r.month_start)}</td>
                                <td className="py-2 px-2 text-right tabular-nums">{fmtUsd(Number(r.order_usd || 0))}</td>
                                <td className="py-2 px-2 text-center"><PctBadge v={r.order_yoy_pct} /></td>
                                <td className="py-2 px-2 text-center"><PctBadge v={r.order_mom_pct} /></td>
                                <td className="py-2 px-2 text-right tabular-nums">{fmtUsd(Number(r.ship_usd || 0))}</td>
                                <td className="py-2 px-2 text-center"><PctBadge v={r.ship_yoy_pct} /></td>
                                <td className="py-2 px-2 text-center"><PctBadge v={r.ship_mom_pct} /></td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          <TabsContent value="yearly" className="space-y-4">
            {isLoading ? (
              <Card>
                <CardContent className="py-8 text-sm text-muted-foreground">Loading…</CardContent>
              </Card>
            ) : viewMode === "COMBINED" ? (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Combined Total</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-auto">
                    <table className="min-w-[760px] w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2 pr-4">Year</th>
                          <th className="text-right py-2 px-2">Orders</th>
                          <th className="text-center py-2 px-2">YoY</th>
                          <th className="text-right py-2 px-2">Shipping</th>
                          <th className="text-center py-2 px-2">YoY</th>
                        </tr>
                      </thead>
                      <tbody>
                        {combinedYearly.map((r) => (
                          <tr key={r.year} className="border-b last:border-b-0">
                            <td className="py-2 pr-4">{r.year}</td>
                            <td className="py-2 px-2 text-right tabular-nums">{fmtUsd(Number(r.order_usd || 0))}</td>
                            <td className="py-2 px-2 text-center"><PctBadge v={r.order_yoy_pct} /></td>
                            <td className="py-2 px-2 text-right tabular-nums">{fmtUsd(Number(r.ship_usd || 0))}</td>
                            <td className="py-2 px-2 text-center"><PctBadge v={r.ship_yoy_pct} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            ) : (
              yearlyGrouped.map(([name, list]) => (
                <Card key={name}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{name}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-auto">
                      <table className="min-w-[760px] w-full text-sm">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-2 pr-4">Year</th>
                            <th className="text-right py-2 px-2">Orders</th>
                            <th className="text-center py-2 px-2">YoY</th>
                            <th className="text-right py-2 px-2">Shipping</th>
                            <th className="text-center py-2 px-2">YoY</th>
                          </tr>
                        </thead>
                        <tbody>
                          {list
                            .slice()
                            .sort((a, b) => a.year - b.year)
                            .map((r) => (
                              <tr key={r.year} className="border-b last:border-b-0">
                                <td className="py-2 pr-4">{r.year}</td>
                                <td className="py-2 px-2 text-right tabular-nums">{fmtUsd(Number(r.order_usd || 0))}</td>
                                <td className="py-2 px-2 text-center"><PctBadge v={r.order_yoy_pct} /></td>
                                <td className="py-2 px-2 text-right tabular-nums">{fmtUsd(Number(r.ship_usd || 0))}</td>
                                <td className="py-2 px-2 text-center"><PctBadge v={r.ship_yoy_pct} /></td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          <TabsContent value="charts" className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Monthly Trend (Total)</CardTitle>
              </CardHeader>
              <CardContent className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trend}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                    <Tooltip formatter={(v: any) => fmtUsd(Number(v))} />
                    <Legend />
                    <Line type="monotone" dataKey="order_usd" name="Orders" stroke="#2563eb" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="ship_usd" name="Shipping" stroke="#16a34a" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {viewMode === "BY_ENTITY" ? (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    Top 10 ({dimension === "buyer" ? "Buyers" : "Brands"}) — Orders vs Shipping ({topMetric})
                  </CardTitle>
                </CardHeader>
                <CardContent className="h-[360px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={top10} layout="vertical" margin={{ left: 20, right: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                      <YAxis type="category" dataKey="name" width={160} />
                      <Tooltip formatter={(v: any) => fmtUsd(Number(v))} />
                      <Legend />
                      <Bar dataKey="order_usd" name="Orders" fill="#2563eb" />
                      <Bar dataKey="ship_usd" name="Shipping" fill="#16a34a" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            ) : null}
          </TabsContent>

          <TabsContent value="raw" className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">API Response (monthly_raw / yearly_raw)</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <div>
                  <div className="text-xs font-medium mb-2">monthly_raw</div>
                  <pre className="text-xs whitespace-pre-wrap break-words bg-slate-50 border rounded-md p-3 max-h-[420px] overflow-auto">
                    {JSON.stringify(data?.monthly_raw || [], null, 2)}
                  </pre>
                </div>
                <div>
                  <div className="text-xs font-medium mb-2">yearly_raw</div>
                  <pre className="text-xs whitespace-pre-wrap break-words bg-slate-50 border rounded-md p-3 max-h-[420px] overflow-auto">
                    {JSON.stringify(data?.yearly_raw || [], null, 2)}
                  </pre>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Separator />

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <div>
              Options (Buyers/Brands) are loaded from <code>/api/dashboards/performance/options</code> (derived from <code>v_perf_monthly</code>).
            </div>
            <div>
              YTD vs Prior YTD is computed client-side using <code>monthly_raw</code> so it always matches selected end-month.
            </div>
            <div>
              PDF/Excel export supports both By Entity and Combined Total modes.
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
