"use client";

import { useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell,
  BarChart, Bar,
} from "recharts";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import QRCode from "qrcode";

/* ---------------- Types & fetcher ---------------- */
const fetcher = (url: string) => fetch(url).then((r) => r.json());

type ApiData = {
  ok: boolean;
  currency: "USD";
  period: { start: string; end: string };
  totals: { count: number; amountUSD: number };
  byStatus: Record<string, number>;
  topBuyers: { buyer: string; amount: number }[];
  byMonth: Record<string, number>;
  buyers: string[];
  createdInfo?: {
    createdAt: string | null;
    createdBy: string[];
  };
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
  CONFIRMED: "#0ea5e9",
  APPROVED: "#22d3ee",
  SHIPPED: "#16a34a",
  INVOICED: "#f59e0b",
  PAID: "#15803d",
  PENDING: "#a78bfa",
  HOLD: "#eab308",
  CANCELLED: "#ef4444",
  UNKNOWN: "#6b7280",
};

/* ---------------- Utils ---------------- */
function numberShorten(v: number) {
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return `${v}`;
}
function fmtNumber(v: number) {
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/* ---------------- Component ---------------- */
export default function OrdersDashboardClient() {
  const today = new Date().toISOString().slice(0, 10);
  const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);

  const [start, setStart] = useState(yearStart);
  const [end, setEnd] = useState(today);

  // ✅ ALL / Multi 둘 다 지원 (멀티셀렉트는 항상 표시)
  const [allBuyers, setAllBuyers] = useState(true);
  const [buyers, setBuyers] = useState<string[]>([]);

  const q = useMemo(() => {
    const params = new URLSearchParams({ start, end });
    if (!allBuyers && buyers.length > 0) params.set("buyer", buyers.join(","));
    return `/api/dashboard/orders?${params.toString()}`;
  }, [start, end, allBuyers, buyers]);

  const { data, mutate } = useSWR<ApiData>(q, fetcher);

  // 월별 rows(+누적합)
  const monthRows = useMemo(() => {
    const base = Object.entries(data?.byMonth ?? {}).map(([k, v]) => ({ month: k, amount: Number(v) }));
    base.sort((a, b) => a.month.localeCompare(b.month));
    let run = 0;
    return base.map((r) => ({ ...r, cumulative: (run += r.amount) }));
  }, [data?.byMonth]);

  // 상태별 rows
  const statusRows = useMemo(() => {
    const rows = Object.entries(data?.byStatus ?? {}).map(([k, v]) => ({
      status: k,
      amount: Number(v),
      color: STATUS_COLORS[k] ?? "#94a3b8",
    }));
    rows.sort((a, b) => b.amount - a.amount);
    return rows;
  }, [data?.byStatus]);

  // 캡처 refs
  const refMonthly = useRef<HTMLDivElement>(null);
  const refPie = useRef<HTMLDivElement>(null);
  const refBar = useRef<HTMLDivElement>(null);

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

  /* ---------------- Helpers for PDF ---------------- */
  const toImage = async (el: HTMLElement | null, scale = 2) => {
    if (!el) return null;
    const canvas = await html2canvas(el, { scale, backgroundColor: "#ffffff", useCORS: true });
    return canvas.toDataURL("image/png");
  };

  /* ---------------- PDF (A4 landscape) ---------------- */
  const handlePDF = async () => {
    const imgMonthly = await toImage(refMonthly.current, 2);
    const imgBar = await toImage(refBar.current, 2);
    const imgPie = await toImage(refPie.current, 2);

    const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();

    // ---- 헤더: 로고/주소/QR 모두 제거, 중앙 제목만 유지 ----
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(20);
    pdf.setTextColor("#000000");
    pdf.text("Orders Dashboard", pageW / 2, 42, { align: "center" });

    // 기간/바이어
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(11);
    pdf.setTextColor("#6b7280");
    const buyersLine = !allBuyers && buyers.length > 0 ? `Buyers: ${buyers.join(", ")}` : "Buyers: ALL";
    let y = 72;
    pdf.text(`Period: ${start} ~ ${end}`, 24, y);
    pdf.text(buyersLine, 24, y + 16);
    y += 36;

    // ---- KPI 카드 ----
    const kpiY = y;
    const colW = (pageW - 48) / 3;
    const kpis = [
      { label: "Total Orders", value: (data?.totals?.count ?? 0).toLocaleString() },
      { label: "Total Amount (USD)", value: (data?.totals?.amountUSD ?? 0).toLocaleString() },
      { label: "Currency", value: "USD" },
    ];
    pdf.setDrawColor(220);
    pdf.setLineWidth(0.5);
    kpis.forEach((kpi, i) => {
      const x = 24 + i * colW;
      pdf.roundedRect(x, kpiY, colW - 16, 58, 6, 6);
      pdf.setFont("helvetica", "bold");
      pdf.setTextColor(THEME.secondary);
      pdf.setFontSize(12);
      pdf.text(kpi.label, x + 12, kpiY + 20);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(THEME.textDark);
      pdf.setFontSize(16);
      pdf.text(String(kpi.value), x + 12, kpiY + 42);
    });
    y = kpiY + 74;

    // ---- Monthly Trend ----
    if (imgMonthly) {
      const boxH = 220;
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(12);
      pdf.setTextColor(THEME.textDark);
      pdf.text("Monthly Trend (USD & Cumulative)", 24, y);
      pdf.addImage(imgMonthly, "PNG", 24, y + 10, pageW - 48, boxH, undefined, "FAST");
      y += boxH + 28;
    }

    // ---- Status Overview (Pie + Bar) ----
    const blockW = (pageW - 48 - 12) / 2;
    const blockH = 220;
    if (imgPie || imgBar) {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(12);
      pdf.setTextColor(THEME.textDark);
      pdf.text("Status Overview", 24, y);
      if (imgPie) pdf.addImage(imgPie, "PNG", 24, y + 10, blockW, blockH, undefined, "FAST");
      if (imgBar) pdf.addImage(imgBar, "PNG", 24 + blockW + 12, y + 10, blockW, blockH, undefined, "FAST");
      y += blockH + 28;
    }

    // ---- Top Buyers ----
    const top = (data?.topBuyers ?? []).slice(0, 15);
    if (top.length > 0) {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(12);
      pdf.setTextColor(THEME.textDark);
      pdf.text("Top Buyers", 24, y);
      y += 10;
      pdf.setDrawColor(210);
      pdf.line(24, y, pageW - 24, y);
      y += 14;

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);
      pdf.setTextColor(THEME.textDark);
      top.forEach((row, idx) => {
        const line = `${idx + 1}. ${row.buyer} — ${row.amount.toLocaleString()} USD`;
        if (y + 14 > pageH - 36) { pdf.addPage(); y = 36; }
        pdf.text(line, 24, y); y += 14;
      });
    }

    // ✅ 푸터 완전 제거 (겹침 문제 원천 차단)

    pdf.save(`orders_${start}_${end}_A4-landscape.pdf`);
  };

  const removeBuyer = (b: string) => setBuyers((prev) => prev.filter((x) => x !== b));

  /* ---------------- Render ---------------- */
  return (
    <div className="p-6 space-y-6">
      {/* Filters */}
      <Card className="rounded-2xl shadow-sm">
        <CardHeader>
          <CardTitle className="text-xl">Order Overview (USD only)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-12 gap-4 items-end">
            <div className="col-span-3">
              <Label className="mb-2 block">Start Date</Label>
              <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="col-span-3">
              <Label className="mb-2 block">End Date</Label>
              <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>

            {/* Buyer ALL + Multi (멀티셀렉트 항상 보임) */}
            <div className="col-span-3">
              <Label className="mb-2 block">Buyer Filter</Label>
              <div className="flex items-center gap-2 mb-2">
                <input
                  id="all-buyers"
                  type="checkbox"
                  checked={allBuyers}
                  onChange={(e) => setAllBuyers(e.target.checked)}
                />
                <label htmlFor="all-buyers" className="text-sm">All Buyers</label>
              </div>
              <select
                multiple
                value={buyers}
                onChange={(e) =>
                  setBuyers(Array.from(e.target.selectedOptions).map((opt) => opt.value))
                }
                className="w-full h-28 rounded-md border px-2 py-1 text-sm"
              >
                {(data?.buyers ?? []).map((b) => (
                  <option key={b} value={b}>{b || "UNKNOWN"}</option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground mt-1">
                {allBuyers
                  ? "All Buyers 활성화 상태에서는 아래 선택값이 쿼리에 적용되지 않습니다."
                  : "선택된 Buyer만 대시보드에 반영됩니다."}
              </p>
              {buyers.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {buyers.map((b) => (
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

            <div className="col-span-3 flex gap-2">
              <Button onClick={() => mutate()} className="flex-1">Refresh</Button>
              <Button onClick={handleCSV} variant="secondary" className="flex-1">CSV</Button>
              <Button onClick={handlePDF} variant="secondary" className="flex-1">PDF</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* Charts */}
      <Card ref={refMonthly as any}>
        <CardHeader><CardTitle>Monthly Trend (USD & Cumulative)</CardTitle></CardHeader>
        <CardContent className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={monthRows} margin={{ left: 16, right: 16, top: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis tickFormatter={(v) => numberShorten(v as number)} />
              <Tooltip formatter={(v: any) => (typeof v === "number" ? fmtNumber(v) : v)} />
              <Legend />
              <Line type="monotone" dataKey="amount" name="Monthly Amount" stroke={THEME.secondary} dot={false} />
              <Line type="monotone" dataKey="cumulative" name="Cumulative" stroke={THEME.accent} dot={false} strokeDasharray="4 2" />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid grid-cols-12 gap-6">
        <Card className="col-span-6" ref={refPie as any}>
          <CardHeader><CardTitle>Status — Pie (USD)</CardTitle></CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Tooltip formatter={(v: any) => (typeof v === "number" ? fmtNumber(v) : v)} />
                <Legend />
                <Pie data={statusRows} dataKey="amount" nameKey="status" outerRadius={100} label>
                  {statusRows.map((r) => <Cell key={r.status} fill={r.color} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="col-span-6" ref={refBar as any}>
          <CardHeader><CardTitle>Status — Bar (USD)</CardTitle></CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={statusRows} margin={{ left: 16, right: 16, top: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="status" />
                <YAxis tickFormatter={(v) => numberShorten(v as number)} />
                <Tooltip formatter={(v: any) => (typeof v === "number" ? fmtNumber(v) : v)} />
                <Legend />
                <Bar dataKey="amount" name="Amount (USD)">
                  {statusRows.map((r) => <Cell key={r.status} fill={r.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Top Buyers */}
      <Card>
        <CardHeader><CardTitle>Top Buyers (USD)</CardTitle></CardHeader>
        <CardContent>
          <div className="w-full overflow-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left px-4 py-2">#</th>
                  <th className="text-left px-4 py-2">Buyer</th>
                  <th className="text-left px-4 py-2">Amount (USD)</th>
                </tr>
              </thead>
              <tbody>
                {(data?.topBuyers ?? []).length === 0 ? (
                  <tr><td className="px-4 py-4 text-muted-foreground" colSpan={3}>No data</td></tr>
                ) : (
                  (data?.topBuyers ?? []).map((r, i) => (
                    <tr key={r.buyer} className="border-t">
                      <td className="px-4 py-2">{i + 1}</td>
                      <td className="px-4 py-2">{r.buyer}</td>
                      <td className="px-4 py-2">{r.amount.toLocaleString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
