"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from "recharts";

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import html2canvas from "html2canvas";
import * as XLSX from "xlsx";

const BUYER_BAR_COLORS = ["#2563EB","#F97316","#22C55E","#A855F7","#EF4444","#14B8A6","#EAB308","#6366F1","#F43F5E","#84CC16"];

/* ---------------- fetcher ---------------- */
const fetcher = (url: string) => fetch(url).then((r) => r.json());

/* ---------------- Types ---------------- */
type ApiKpi = {
  key: string;
  label: string;
  value_usd: number;
  delta_pct: number | null;
  sub_label?: string | null;
  sub_value?: string | number | null;
};

type ApiMonthlyRow = {
  month: string; // YYYY-MM
  amount_usd: number;
  cumulative_usd: number;
};

type ApiStatusRow = {
  status: string;
  amount_usd: number;
};

type ApiBuyerBreakdownRow = {
  buyer: string;
  amount_usd: number;
  pos?: number;
};

type ApiData = {
  ok: boolean;
  message?: string;
  filters_echo?: {
    start: string;
    end: string;
    buyer_ids?: string; // "ALL" or csv
    site_ids?: string;  // "ALL" or csv
  };
  meta?: {
    date_col_used?: string | null;
    usd_line_col_used?: string | null;
    rows_headers?: number | null;
    rows_lines?: number | null;
    note?: string | null;
  };
  buyers?: string[];
  kpis?: ApiKpi[];
  monthly?: ApiMonthlyRow[];
  status?: ApiStatusRow[];
  buyer_breakdown?: ApiBuyerBreakdownRow[];
};

/* ---------------- Theme & constants ---------------- */
const THEME = {
  secondary: "#2563eb",
  textDark: "#111827",
  muted: "#6b7280",
  accent: "#f59e0b",
};

const STATUS_COLORS: Record<string, string> = {
  OPEN: "#2563eb",
  DRAFT: "#94a3b8",
  CONFIRMED: "#0ea5e9",
  APPROVED: "#22d3ee",
  IN_PRODUCTION: "#a78bfa",
  PRODUCTION: "#a78bfa",
  READY: "#16a34a",
  SHIPPED: "#15803d",
  INVOICED: "#f59e0b",
  PAID: "#22c55e",
  PENDING: "#eab308",
  HOLD: "#f97316",
  CANCELLED: "#ef4444",
  DELETED: "#6b7280",
  UNKNOWN: "#6b7280",
};

/* ---------------- Utils ---------------- */
function safeNum(v: any): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;

  if (typeof v === "string") {
    const s0 = v.trim();
    if (!s0) return 0;

    // Accept: "5,525.14", "$5,525.14", "USD 5,525.14", etc.
    const s1 = s0.replace(/,/g, "").replace(/\$/g, "");
    // Keep digits, dot, minus only
    const s2 = s1.replace(/[^0-9.\-]/g, "");
    if (!s2 || s2 === "-" || s2 === "." || s2 === "-.") return 0;

    const n = Number(s2);
    return Number.isFinite(n) ? n : 0;
  }

  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmt2(v: any) {
  const n = safeNum(v);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function numberShorten(v: number) {
  if (!Number.isFinite(v)) return "0";
  const n = Number(v);
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

/* ---------------- ChartGuard (Recharts size fix) ---------------- */
function ChartGuard({
  minHeight,
  className,
  children,
}: {
  minHeight: number;
  className?: string;
  children: () => React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) setReady(true);
    };

    update();

    const ro = new ResizeObserver(update);
    ro.observe(el);

    const t = window.setTimeout(update, 0);

    return () => {
      window.clearTimeout(t);
      ro.disconnect();
    };
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      style={{ minHeight, height: minHeight, width: "100%" }}
    >
      {ready ? children() : null}
    </div>
  );
}

/* ---------------- Component ---------------- */
export default function OrdersDashboardClient() {
  const today = new Date().toISOString().slice(0, 10);
  const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);

  // Draft (입력용)
  const [draftStart, setDraftStart] = useState(yearStart);
  const [draftEnd, setDraftEnd] = useState(today);

  const [draftAllBuyers, setDraftAllBuyers] = useState(true);
  const [draftBuyers, setDraftBuyers] = useState<string[]>([]);
  const [buyerPick, setBuyerPick] = useState<string>("");

  // Applied (실제 API 반영용)  ✅ Apply 버튼으로만 바뀜
  const [start, setStart] = useState(yearStart);
  const [end, setEnd] = useState(today);
  const [allBuyers, setAllBuyers] = useState(true);
  const [buyers, setBuyers] = useState<string[]>([]);

  // API URL (applied 상태로만)
  const q = useMemo(() => {
    const params = new URLSearchParams({ start, end });
    if (!allBuyers && buyers.length > 0) params.set("buyer_ids", buyers.join(","));
    return `/api/dashboards/orders?${params.toString()}`;
  }, [start, end, allBuyers, buyers]);

  const { data, mutate, isValidating } = useSWR<ApiData>(q, fetcher);

  const filtersEcho = data?.filters_echo;

  const buyerOptions = useMemo(() => {
    return (data?.buyers ?? []).filter(Boolean);
  }, [data?.buyers]);

  // Normalize charts data
  const monthRows = useMemo(() => {
    const rows = (data?.monthly ?? []).map((r) => ({
      month: r.month,
      amount: safeNum(r.amount_usd),
      cumulative: safeNum(r.cumulative_usd),
    }));
    rows.sort((a, b) => a.month.localeCompare(b.month));
    return rows;
  }, [data?.monthly]);

  // ✅ A안(정석): Excel export 등에서 쓰는 monthlySeries alias
  const monthlySeries = monthRows;

  const statusRows = useMemo(() => {
    const rows = (data?.status ?? []).map((r) => {
      const s = (r.status ?? "UNKNOWN").toString().toUpperCase();
      return { status: s, amount: safeNum(r.amount_usd), color: STATUS_COLORS[s] ?? "#94a3b8" };
    });
    rows.sort((a, b) => b.amount - a.amount);
    return rows;
  }, [data?.status]);

  // ✅ A안(정석): Excel export 등에서 쓰는 statusSeries alias
  const statusSeries = statusRows;

  const buyerBreakdownRows = useMemo(() => {
    const rows = (data?.buyer_breakdown ?? []).map((r) => ({
      buyer: (r.buyer ?? "UNKNOWN").toString(),
      amount: safeNum(r.amount_usd),
      pos: r.pos ?? 0,
    }));
    rows.sort((a, b) => b.amount - a.amount);
    return rows;
  }, [data?.buyer_breakdown]);

  // ✅ A안(정석): buyerSeries는 Buyer Breakdown 차트/Export에서 공용으로 쓰는 시리즈
  // - Runtime 에러 방지: JSX에서 buyerSeries.map(...) 사용
  // - 구조: [{ buyer: string, amount: number, pos?: number }]
  const buyerSeries = buyerBreakdownRows;

  const kpis = useMemo(() => {
    const arr = data?.kpis ?? [];
    // ✅ 요청: KPI 정의는 그대로, 라벨만 정리 → Orders=전체
    return arr.map((k) => (k.key === "orders" ? { ...k, label: "Orders (Total)" } : k));
  }, [data?.kpis]);

  // refs for PDF
  const refMonthly = useRef<HTMLDivElement>(null);
  const refPie = useRef<HTMLDivElement>(null);
  const refBar = useRef<HTMLDivElement>(null);
  const refBuyer = useRef<HTMLDivElement>(null);
  const refCapture = useRef<HTMLDivElement>(null);

  /* ---------------- Actions ---------------- */
  const addBuyer = () => {
    const b = (buyerPick ?? "").trim();
    if (!b) return;
    setDraftBuyers((prev) => (prev.includes(b) ? prev : [...prev, b]));
  };

  const removeBuyer = (b: string) => {
    setDraftBuyers((prev) => prev.filter((x) => x !== b));
  };

  const applyFilters = async () => {
    setStart(draftStart);
    setEnd(draftEnd);
    setAllBuyers(draftAllBuyers);
    setBuyers(draftAllBuyers ? [] : draftBuyers);
    // SWR은 key가 바뀌면 자동 fetch. 동일하면 mutate.
    await mutate();
  };

  const refresh = async () => {
    await mutate();
  };

  /* ---------------- CSV ---------------- */
  const handleCSV = () => {
    const headers = ["Month", "Amount (USD)", "Cumulative (USD)"];
    const csv = [headers.join(",")].concat(
      monthRows.map((r) => `${r.month},${r.amount},${r.cumulative}`)
    );
    const blob = new Blob([csv.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `orders_${start}_${end}.csv`;
    a.click();
  };


const handleExcel = () => {
  const wb = XLSX.utils.book_new();

  const wsKpi = XLSX.utils.json_to_sheet([
    { Metric: "Orders (Total)", ValueUSD: kpis?.orders?.value_usd ?? 0, Count: kpis?.orders?.sub_value ?? "" },
    { Metric: "In Production", ValueUSD: kpis?.production?.value_usd ?? 0, Count: kpis?.production?.sub_value ?? "" },
    { Metric: "Ready", ValueUSD: kpis?.ready?.value_usd ?? 0, Count: kpis?.ready?.sub_value ?? "" },
    { Metric: "Shipped", ValueUSD: kpis?.shipped?.value_usd ?? 0, Count: kpis?.shipped?.sub_value ?? "" },
  ]);
  XLSX.utils.book_append_sheet(wb, wsKpi, "KPI");

  const wsMonthly = XLSX.utils.json_to_sheet(
    (monthlySeries || []).map((r) => ({ Month: r.month, MonthlyUSD: r.amount, CumulativeUSD: r.cum }))
  );
  XLSX.utils.book_append_sheet(wb, wsMonthly, "Monthly");

  const wsStatus = XLSX.utils.json_to_sheet(
    (statusSeries || []).map((r) => ({ Status: r.status, AmountUSD: r.amount }))
  );
  XLSX.utils.book_append_sheet(wb, wsStatus, "Status");

  const wsBuyers = XLSX.utils.json_to_sheet(
    (buyerSeries || []).map((r) => ({ Buyer: r.buyer, AmountUSD: r.amount }))
  );
  XLSX.utils.book_append_sheet(wb, wsBuyers, "Buyers");

    // ✅ A안(정석): filters 변수가 없을 수 있으니 data.filters_echo 기반으로 파일명 구성
  const _start = (data as any)?.filters_echo?.start ?? "";
  const _end = (data as any)?.filters_echo?.end ?? "";
  const _fname = _start && _end ? `orders_dashboard_${_start}_${_end}.xlsx` : "orders_dashboard.xlsx";
  XLSX.writeFile(wb, _fname);
};

  /* ---------------- PDF ---------------- */
  const toImage = async (el: HTMLElement | null, scale = 2) => {
    if (!el) return null;
    const canvas = await html2canvas(el, {
      scale,
      backgroundColor: "#ffffff",
      useCORS: true,
    });
    return canvas.toDataURL("image/png");
  };

  const handlePDF = async () => {
  try {
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const pageW = 210;
    const pageH = 297;
    const margin = 12;

    const fmtUSD = (v: number) =>
      "$" +
      (Number.isFinite(v) ? v : 0).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

    const safeText = (s: any) => (s == null ? "" : String(s));

    // Header (minimal)
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("Orders Dashboard", pageW / 2, margin + 2, { align: "center" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    const headerRightX = pageW - margin;
    const headerY0 = margin + 0;
    doc.text(`Period: ${safeText(start)} ~ ${safeText(end)}`, headerRightX, headerY0 + 8, { align: "right" });
    doc.text(`Buyers: ${allBuyers ? "ALL" : (buyers.length ? buyers.join(", ") : "-")}`, headerRightX, headerY0 + 14, { align: "right" });

    let y = margin + 22;

    // --- helpers: canvas charts -> addImage ---
    const makeCanvas = (w: number, h: number) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      if (!ctx) throw new Error("Canvas not supported");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "#e5e7eb";
      ctx.lineWidth = 1;
      return { c, ctx };
    };

    const drawAxes = (ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) => {
      ctx.strokeStyle = "#cbd5e1";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0, y1);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    };

    const drawLineChart = (rows: any[]) => {
      const W = 980, H = 260;
      const { c, ctx } = makeCanvas(W, H);

      const padL = 70, padR = 20, padT = 20, padB = 45;
      const x0 = padL, y0 = padT, x1 = W - padR, y1 = H - padB;

      drawAxes(ctx, x0, y0, x1, y1);

      const monthly = rows.map(r => safeNum(r?.amount_usd));
      const cumulative = rows.map(r => Number(r?.cumulative_usd || 0));
      const maxY = Math.max(1, ...monthly, ...cumulative);

      // grid + y ticks
      ctx.font = "12px Arial";
      ctx.fillStyle = "#475569";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (let i = 0; i <= 4; i++) {
        const yy = y1 - (i / 4) * (y1 - y0);
        const val = (maxY * i) / 4;
        ctx.strokeStyle = "#eef2f7";
        ctx.beginPath();
        ctx.moveTo(x0, yy);
        ctx.lineTo(x1, yy);
        ctx.stroke();
        ctx.fillText(fmtUSD(val).replace("$", ""), x0 - 8, yy);
      }

      const n = Math.max(1, rows.length);
      const xFor = (i: number) => x0 + (i / Math.max(1, n - 1)) * (x1 - x0);
      const yFor = (v: number) => y1 - (v / maxY) * (y1 - y0);

      const drawLine = (vals: number[], color: string) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        vals.forEach((v, i) => {
          const xx = xFor(i);
          const yy = yFor(v);
          if (i === 0) ctx.moveTo(xx, yy);
          else ctx.lineTo(xx, yy);
        });
        ctx.stroke();
      };

      // series
      drawLine(cumulative, "#2563eb"); // blue
      drawLine(monthly, "#f97316"); // orange

      // x labels
      ctx.fillStyle = "#475569";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      rows.forEach((r, i) => {
        const label = safeText(r?.month || "");
        const xx = xFor(i);
        if (n <= 8 || i === 0 || i === n - 1 || i % 2 === 0) {
          ctx.save();
          ctx.translate(xx, y1 + 6);
          ctx.rotate(-0.35);
          ctx.fillText(label, 0, 0);
          ctx.restore();
        }
      });

      // legend
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#111827";
      ctx.fillText("Cumulative", x0 + 60, 12);
      ctx.fillText("Monthly", x0 + 200, 12);
      ctx.fillStyle = "#2563eb"; ctx.fillRect(x0 + 10, 6, 40, 6);
      ctx.fillStyle = "#f97316"; ctx.fillRect(x0 + 150, 6, 40, 6);

     return c.toDataURL("image/png");
    };

    const drawDonut = (rows: any[]) => {
      const W = 420, H = 260;
      const { c, ctx } = makeCanvas(W, H);
      const total = rows.reduce((a, b) => a + safeNum(b?.amount_usd), 0) || 1;

      const cx = 140, cy = 135;
      const rOuter = 90, rInner = 50;

      const palette = ["#2563eb", "#f97316", "#16a34a", "#ef4444", "#a855f7", "#06b6d4", "#f59e0b", "#64748b"];

      let angle = -Math.PI / 2;
      rows.forEach((r, i) => {
        const v = safeNum(r?.amount_usd);
        const frac = v / total;
        const a2 = angle + frac * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, rOuter, angle, a2);
        ctx.closePath();
        ctx.fillStyle = palette[i % palette.length];
        ctx.fill();
        angle = a2;
      });

      // hole
      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath();
      ctx.arc(cx, cy, rInner, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";

      // legend
      ctx.font = "12px Arial";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      rows.slice(0, 6).forEach((r, i) => {
        const name = safeText(r?.status || "-");
        const v = safeNum(r?.amount_usd);
        ctx.fillStyle = palette[i % palette.length];
        ctx.fillRect(260, 60 + i * 22, 10, 10);
        ctx.fillStyle = "#111827";
        ctx.fillText(`${name}: ${fmtUSD(v)}`, 275, 65 + i * 22);
      });

      return c.toDataURL("image/png");
    };

    const drawBarByStatus = (rows: any[]) => {
      const W = 520, H = 260;
      const { c, ctx } = makeCanvas(W, H);

      const padL = 55, padR = 20, padT = 20, padB = 55;
      const x0 = padL, y0 = padT, x1 = W - padR, y1 = H - padB;
      drawAxes(ctx, x0, y0, x1, y1);

      const vals = rows.map(r => safeNum(r?.amount_usd));
      const labels = rows.map(r => safeText(r?.status || "-"));
      const maxY = Math.max(1, ...vals);

      ctx.font = "12px Arial";
      ctx.fillStyle = "#475569";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (let i = 0; i <= 4; i++) {
        const yy = y1 - (i / 4) * (y1 - y0);
        const val = (maxY * i) / 4;
        ctx.strokeStyle = "#eef2f7";
        ctx.beginPath();
        ctx.moveTo(x0, yy);
        ctx.lineTo(x1, yy);
        ctx.stroke();
        ctx.fillText(fmtUSD(val).replace("$", ""), x0 - 8, yy);
      }

      const n = Math.max(1, vals.length);
      const bw = (x1 - x0) / (n * 1.5);
      vals.forEach((v, i) => {
        const h = (v / maxY) * (y1 - y0);
        const xx = x0 + (i + 0.5) * ((x1 - x0) / n) - bw / 2;
        const yy = y1 - h;
        ctx.fillStyle = "#2563eb";
        ctx.fillRect(xx, yy, bw, h);

        ctx.save();
        ctx.translate(xx + bw / 2, y1 + 8);
        ctx.rotate(-0.35);
        ctx.fillStyle = "#475569";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(labels[i], 0, 0);
        ctx.restore();
      });

      return c.toDataURL("image/png");
    };

    const drawBuyerBars = (rows: any[]) => {
      const W = 980, H = 240;
      const { c, ctx } = makeCanvas(W, H);

      const padL = 70, padR = 20, padT = 20, padB = 65;
      const x0 = padL, y0 = padT, x1 = W - padR, y1 = H - padB;
      drawAxes(ctx, x0, y0, x1, y1);

      const vals = rows.map(r => safeNum(r?.amount_usd));
      const labels = rows.map(r => safeText(r?.buyer_name || r?.buyer || "-"));
      const maxY = Math.max(1, ...vals);

      // y ticks
      ctx.font = "12px Arial";
      ctx.fillStyle = "#475569";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (let i = 0; i <= 4; i++) {
        const yy = y1 - (i / 4) * (y1 - y0);
        const val = (maxY * i) / 4;
        ctx.strokeStyle = "#eef2f7";
        ctx.beginPath();
        ctx.moveTo(x0, yy);
        ctx.lineTo(x1, yy);
        ctx.stroke();
        ctx.fillText(fmtUSD(val).replace("$", ""), x0 - 8, yy);
      }

      const palette = ["#2563eb", "#f97316", "#16a34a", "#ef4444", "#a855f7", "#06b6d4", "#f59e0b", "#64748b"];
      const n = Math.max(1, vals.length);
      const bw = (x1 - x0) / (n * 1.6);

      vals.forEach((v, i) => {
        const h = (v / maxY) * (y1 - y0);
        const xx = x0 + (i + 0.5) * ((x1 - x0) / n) - bw / 2;
        const yy = y1 - h;
        ctx.fillStyle = palette[i % palette.length];
        ctx.fillRect(xx, yy, bw, h);

        ctx.save();
        ctx.translate(xx + bw / 2, y1 + 10);
        ctx.rotate(-0.35);
        ctx.fillStyle = "#475569";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(labels[i], 0, 0);
        ctx.restore();
      });

      return c.toDataURL("image/png");
    };

    // Section: Monthly Trend
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text("Monthly Trend (USD & Cumulative)", margin, y);
    y += 4;

    const imgTrend = drawLineChart(monthRows || []);
    doc.addImage(imgTrend, "PNG", margin, y, pageW - margin * 2, 54);
    y += 62;

    // Section: Status Overview (2 charts)
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text("Status Overview", margin, y);
    y += 4;

    const imgPie = drawDonut(statusRows || []);
    const imgBar = drawBarByStatus(statusRows || []);
    const halfW = (pageW - margin * 2 - 6) / 2;
    doc.addImage(imgPie, "PNG", margin, y, halfW, 60);
    doc.addImage(imgBar, "PNG", margin + halfW + 6, y, halfW, 60);
    y += 68;

    // Section: Buyer Breakdown
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text("Buyer Breakdown (Top 10, USD)", margin, y);
    y += 4;

    const topBuyers = (buyerSeries || []).slice(0, 10);
    const imgBuyer = drawBuyerBars(topBuyers);
    doc.addImage(imgBuyer, "PNG", margin, y, pageW - margin * 2, 52);
    y += 60;

    // Tables
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(`Total (Status): ${fmtUSD(Number(kpis?.find((k: any) => k?.key === "orders")?.value_usd || 0))}`, margin, y);
    y += 3;

    autoTable(doc, {
      startY: y + 2,
      head: [["Status", "Amount (USD)"]],
      body: (statusRows || []).map((r: any) => [safeText(r?.status || "-"), fmtUSD(safeNum(r?.amount_usd))]),
      theme: "grid",
      styles: { fontSize: 10 },
      headStyles: { fillColor: [240, 240, 240], textColor: 20 },
      margin: { left: margin, right: margin },
    });

    const yAfter1 = (doc as any).lastAutoTable?.finalY || (y + 30);

    autoTable(doc, {
      startY: yAfter1 + 6,
      head: [["Buyer", "Amount (USD)"]],
      body: topBuyers.map((r: any) => [safeText(r?.buyer_name || r?.buyer || "-"), fmtUSD(safeNum(r?.amount_usd))]),
      theme: "grid",
      styles: { fontSize: 10 },
      headStyles: { fillColor: [240, 240, 240], textColor: 20 },
      margin: { left: margin, right: margin },
    });

    doc.save(`orders_${safeText(start)}_${safeText(end)}.pdf`);
  } catch (e: any) {
    console.error(e);
    alert(e?.message || String(e));
  }
};


  /* ---------------- Render ---------------- */
  return (
    <div className="p-4 space-y-4">
      {/* Filters */}
      <Card className="rounded-2xl shadow-sm" data-pdf-hide>
        <CardHeader className="py-3">
          <CardTitle className="text-lg">Order Overview (USD only)</CardTitle>
        </CardHeader>

        <CardContent>
          <div className="grid grid-cols-12 gap-3 items-end">
            {/* Dates */}
            <div className="col-span-3">
              <Label className="mb-2 block">Start Date</Label>
              <Input
                type="date"
                value={draftStart}
                onChange={(e) => setDraftStart(e.target.value)}
              />
            </div>

            <div className="col-span-3">
              <Label className="mb-2 block">End Date</Label>
              <Input
                type="date"
                value={draftEnd}
                onChange={(e) => setDraftEnd(e.target.value)}
              />
            </div>

            {/* Buyer Filter (dropdown + Add) */}
            <div className="col-span-4">
              <Label className="mb-2 block">Buyer Filter</Label>

              <div className="flex items-center gap-2 mb-2">
                <input
                  id="all-buyers"
                  type="checkbox"
                  checked={draftAllBuyers}
                  onChange={(e) => setDraftAllBuyers(e.target.checked)}
                />
                <label htmlFor="all-buyers" className="text-sm">
                  All Buyers
                </label>
              </div>

              <div className="flex gap-2">
                <div className="flex-1">
                  <Select
                    value={buyerPick}
                    onValueChange={(v) => setBuyerPick(v)}
                    disabled={draftAllBuyers}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select buyer..." />
                    </SelectTrigger>
                    <SelectContent>
                      {buyerOptions.map((b) => (
                        <SelectItem key={b} value={b}>
                          {b}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Button
                  type="button"
                  variant="secondary"
                  onClick={addBuyer}
                  disabled={draftAllBuyers || !buyerPick}
                 data-pdf-hide>
                  Add
                </Button>
              </div>

              <p className="text-[11px] text-muted-foreground mt-1">
                {draftAllBuyers
                  ? "All Buyers 활성화 상태에서는 Buyer 선택이 적용되지 않습니다."
                  : "Add로 Buyer를 추가한 뒤 Apply를 눌러 반영하세요."}
              </p>

              {!draftAllBuyers && draftBuyers.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {draftBuyers.map((b) => (
                    <span
                      key={b}
                      className="inline-flex items-center gap-2 px-2 py-1 rounded-full bg-blue-100 text-blue-700 text-xs font-medium"
                    >
                      {b}
                      <button
                        className="rounded-full bg-blue-700/10 px-1 leading-none"
                        onClick={() => removeBuyer(b)}
                        aria-label={`Remove ${b}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Buttons */}
            <div className="col-span-2 flex gap-2 justify-end">
              <Button onClick={applyFilters} className="flex-1" data-pdf-hide>
                Apply
              </Button>
              <Button onClick={refresh} variant="secondary" className="flex-1" disabled={isValidating} data-pdf-hide>
                Refresh
              </Button>
            </div>

            <div className="col-span-12 flex gap-2 justify-end mt-2">
              
              <Button onClick={handleCSV} variant="outline" data-pdf-hide>
                CSV
              </Button>
              <Button onClick={handleExcel} variant="outline" data-pdf-hide>
                Excel
              </Button>

              <Button onClick={handlePDF} variant="secondary" data-pdf-hide>
                PDF
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* KPI row */}
      <div className="grid grid-cols-12 gap-4">
        {(kpis ?? []).slice(0, 4).map((k) => (
          <Card key={k.key} className="col-span-3">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">{k.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-semibold">{fmt2(k.value_usd)}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {k.sub_label ? `${k.sub_label}: ` : ""}
                {k.sub_value ?? "-"}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Monthly Trend */}
      <Card ref={refMonthly as any}>
        <CardHeader className="py-3">
          <CardTitle className="text-sm">Monthly Trend (USD &amp; Cumulative)</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartGuard minHeight={240} className="w-full">
            {() =>
              monthRows.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={200}>
                  <LineChart data={monthRows} margin={{ left: 16, right: 16, top: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis tickFormatter={(v) => numberShorten(Number(v))} />
                    <Tooltip
                      formatter={(v: any) => fmt2(v)}
                      labelFormatter={(l) => `Month: ${l}`}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="cumulative"
                      name="Cumulative"
                      stroke={THEME.accent}
                      dot={false}
                      strokeDasharray="4 2"
                    />
                    <Line
                      type="monotone"
                      dataKey="amount"
                      name="Monthly Amount"
                      stroke={THEME.secondary}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-sm text-muted-foreground">No data.</div>
              )
            }
          </ChartGuard>
        </CardContent>
      </Card>

      {/* Status charts */}
      <div className="grid grid-cols-12 gap-4">
        <Card className="col-span-6" ref={refPie as any}>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Status — Pie (USD)</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartGuard minHeight={240} className="w-full">
              {() =>
                statusRows.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={240}>
                    <PieChart>
                      <Tooltip
                        formatter={(v: any, _name, props: any) => fmt2(v)}
                        labelFormatter={(l) => `${l}`}
                      />
                      <Legend />
                      <Pie
                        data={statusRows}
                        dataKey="amount"
                        nameKey="status"
                        outerRadius={110}
                        label={({ name, value }) => `${name}: ${fmt2(value)}`}
                        isAnimationActive={false}
                      >
                        {statusRows.map((r) => (
                          <Cell key={r.status} fill={r.color} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="text-sm text-muted-foreground">No data.</div>
                )
              }
            </ChartGuard>
          </CardContent>
        </Card>

        <Card className="col-span-6" ref={refBar as any}>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Status — Bar (USD)</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartGuard minHeight={240} className="w-full">
              {() =>
                statusRows.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={240}>
                    <BarChart data={statusRows} margin={{ left: 16, right: 16, top: 8, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="status" />
                      <YAxis tickFormatter={(v) => numberShorten(Number(v))} />
                      <Tooltip formatter={(v: any) => fmt2(v)} />
                      <Legend />
                      <Bar dataKey="amount" name="Amount (USD)" isAnimationActive={false}>
                        {statusRows.map((r) => (
                          <Cell key={r.status} fill={r.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="text-sm text-muted-foreground">No data.</div>
                )
              }
            </ChartGuard>
          </CardContent>
        </Card>
      </div>

      {/* Buyer Breakdown */}
      <Card ref={refBuyer as any}>
        <CardHeader className="py-3">
          <CardTitle className="text-sm">Buyer Breakdown — Bar (Top 10, USD)</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartGuard minHeight={340} className="w-full">
            {() =>
              buyerBreakdownRows.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={260}>
                  <BarChart
                    data={buyerBreakdownRows}
                    margin={{ left: 16, right: 16, top: 8, bottom: 40 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="buyer" interval={0} angle={-20} textAnchor="end" height={70} />
                    <YAxis tickFormatter={(v) => numberShorten(Number(v))} />
                    <Tooltip
                      formatter={(v: any) => fmt2(v)}
                      labelFormatter={(l) => `Buyer: ${l}`}
                    />
                    <Legend />
                    <Bar dataKey="amount" name="Amount (USD)" isAnimationActive={false}>
                      {buyerSeries.map((_, idx) => (
                        <Cell key={`buyer-cell-${idx}`} fill={BUYER_BAR_COLORS[idx % BUYER_BAR_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-sm text-muted-foreground">No data.</div>
              )
            }
          </ChartGuard>
        </CardContent>
      </Card>

      {/* API Error */}
      {data && !data.ok && (
        <Card className="border-red-200">
          <CardHeader className="py-3">
            <CardTitle className="text-red-600">API Error</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-red-700">
            {data.message ?? "Unknown error"}
          </CardContent>
        </Card>
      )}
    </div>
  );
}


/* === PDF single-page fit (A4 landscape) === */
function savePdfSinglePage(canvas: HTMLCanvasElement, start: string, end: string) {
  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();

  const imgW = canvas.width;
  const imgH = canvas.height;

  // Fit to page while preserving aspect ratio
  const scale = Math.min(pageW / imgW, pageH / imgH);
  const renderW = imgW * scale;
  const renderH = imgH * scale;

  const marginX = (pageW - renderW) / 2;
  const marginY = (pageH - renderH) / 2;

  const imgData = canvas.toDataURL("image/png");
  pdf.addImage(imgData, "PNG", marginX, marginY, renderW, renderH, undefined, "FAST");
  pdf.save(`orders_${start}_${end}.pdf`);
}
