"use client";

import React, { useEffect, useMemo, useState } from "react";
import useSWR from "swr";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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

const COMPANY_NAME = "JM International Co., Ltd";

const COLORS = [
  "#2563EB",
  "#F97316",
  "#22C55E",
  "#A855F7",
  "#EF4444",
  "#14B8A6",
  "#EAB308",
  "#6366F1",
  "#F43F5E",
  "#84CC16",
];

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type ApiMonthlyRow = { month: string; amount_usd: number; cumulative_usd: number };
type ApiStatusRow = { status: string; amount_usd: number };
type ApiBuyerRow = { buyer: string; amount_usd: number };

type ApiData = {
  filters_echo?: { start?: string; end?: string; buyer_ids?: string | "ALL" } | null;
  monthly?: ApiMonthlyRow[] | null;
  status?: ApiStatusRow[] | null;
  status_breakdown?: ApiStatusRow[] | null;
  buyer_breakdown?: ApiBuyerRow[] | null;
};

function fmtUSD(v: number) {
  const n = Number(v ?? 0);
  try {
    return `$${n.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

export default function OrdersDashboardPdfClient({
  start,
  end,
  buyerIdsCsv,
}: {
  start: string;
  end: string;
  buyerIdsCsv: string;
}) {
  const apiUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    if (buyerIdsCsv) params.set("buyer_ids", buyerIdsCsv);
    return `/api/dashboards/orders?${params.toString()}`;
  }, [start, end, buyerIdsCsv]);

  const { data, isValidating } = useSWR<ApiData>(apiUrl, fetcher);

  const filtersEcho = data?.filters_echo ?? null;
  const [generatedAt, setGeneratedAt] = useState<string>("");

  useEffect(() => {
    // Avoid hydration mismatch: render empty on server, fill on client after mount
    setGeneratedAt(new Date().toLocaleString());
  }, []);

  const monthly = useMemo(
    () =>
      (data?.monthly ?? []).map((r) => ({
        month: r.month,
        amount: Number(r.amount_usd ?? 0),
        cumulative: Number(r.cumulative_usd ?? 0),
      })),
    [data?.monthly]
  );

  const statusRows = useMemo(() => {
    const src: any[] = ((data as any)?.status ?? (data as any)?.status_breakdown ?? []) as any[];
    return (src ?? []).map((r) => ({
      status: (r.status ?? "UNKNOWN").toString().toUpperCase(),
      amount: Number(r.amount_usd ?? 0),
    }));
  }, [data?.status, (data as any)?.status_breakdown]);

  const buyerRows = useMemo(
    () =>
      (data?.buyer_breakdown ?? []).map((r) => ({
        buyer: (r.buyer ?? "UNKNOWN").toString(),
        amount: Number(r.amount_usd ?? 0),
      })),
    [data?.buyer_breakdown]
  );

  const totalStatus = statusRows.reduce((a, b) => a + (b.amount || 0), 0);

  return (
    <div className="a4-root">
      <style suppressHydrationWarning>{`
        @page { size: A4 portrait; margin: 12mm; }
        @media print { 
        /* Hide AppShell chrome (top bar / sidebar) on PDF page */
        body header,
        body nav,
        body aside,
        header[role=banner],
        nav[role=navigation],
        aside,
        .app-shell-header,
        .app-shell-sidebar,
        .sidebar,
        .topbar,
        .top-bar,
        .header-bar {
          display: none !important;
        }

        /* Remove paddings/margins that AppShell may add to main container */
        main, .app-shell-main, .app-main, .content, .container {
          margin-top: 0 !important;
          padding-top: 0 !important;
        }
.pdf-actions { display:none !important; } }

        .a4-root{
          width: 210mm;
          min-height: 297mm;
          margin: 0 auto;
          background: #fff;
          color: #111827;
        }

        .pdf-actions{
          display:flex;
          justify-content:flex-end;
          gap:8px;
          margin: 0 0 10px 0;
        }

        .pdf-header{
          display:flex;
          align-items:flex-start;
          justify-content:space-between;
          gap:12px;
          margin: 0 0 10px 0;
        }
        .pdf-header-left{ flex:1; }
        .pdf-header-center{ flex:1; text-align:center; }
        .pdf-header-right{ flex:1; text-align:right; }

        .pdf-company{ font-size:14px; font-weight:800; color:#111827; }
        .pdf-generated{ font-size:11px; color:#6B7280; margin-top:2px; }
        .pdf-title{ font-size:26px; font-weight:900; margin:0; }
        .pdf-filters-title{ font-size:12px; font-weight:800; color:#111827; }
        .pdf-filter-line{ font-size:11px; color:#374151; margin-top:2px; }

        .section{ margin-bottom: 14px; page-break-inside: avoid; break-inside: avoid; }
        .grid2{ display:grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      `}</style>

      <div className="pdf-actions">
        <Button variant="outline" onClick={() => window.print()} disabled={isValidating}>
          Print / Save PDF
        </Button>
      </div>

      <div className="pdf-header">
        <div className="pdf-header-left">
          <div className="pdf-company">{COMPANY_NAME}</div>
          <div className="pdf-generated">
            Generated: <b suppressHydrationWarning>{generatedAt || ""}</b>
          </div>
        </div>

        <div className="pdf-header-center">
          <div className="pdf-title">Orders Dashboard</div>
        </div>

        <div className="pdf-header-right">
          <div className="pdf-filters-title">Filters</div>
          <div className="pdf-filter-line">
            Period: <b>{filtersEcho?.start ?? start} ~ {filtersEcho?.end ?? end}</b>
          </div>
          <div className="pdf-filter-line">
            Buyers: <b>{buyerIdsCsv ? buyerIdsCsv : "ALL"}</b>
          </div>
        </div>
      </div>

      <div className="section">
        <div style={{ fontWeight: 800, fontSize: 18, margin: "6px 0" }}>
          Monthly Trend (USD &amp; Cumulative)
        </div>

        <Card>
          <CardContent className="p-3">
            <div style={{ width: "100%", height: 240 }}>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={monthly} margin={{ left: 16, right: 16, top: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis tickFormatter={(v: any) => fmtUSD(Number(v ?? 0))} />
                  <Tooltip formatter={(value: any) => fmtUSD(Number(value ?? 0))} />
                  <Legend />
                  <Line type="monotone" dataKey="cumulative" name="Cumulative" dot={false} />
                  <Line type="monotone" dataKey="amount" name="Monthly Amount" dot />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="section">
        <div style={{ fontWeight: 800, fontSize: 18, margin: "6px 0" }}>Status Overview</div>

        <div className="grid2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Status — Pie (USD)</CardTitle>
            </CardHeader>
            <CardContent className="p-3">
              <div style={{ width: "100%", height: 210 }}>
                <ResponsiveContainer width="100%" height={210}>
                  <PieChart>
                    <Pie
                      data={statusRows}
                      dataKey="amount"
                      nameKey="status"
                      innerRadius={40}
                      outerRadius={80}
                      label={(p: any) => `${p.name}: ${fmtUSD(Number(p.value ?? 0))}`}
                    >
                      {statusRows.map((_, idx) => (
                        <Cell key={`st-${idx}`} fill={COLORS[idx % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: any) => fmtUSD(Number(value ?? 0))} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Status — Bar (USD)</CardTitle>
            </CardHeader>
            <CardContent className="p-3">
              <div style={{ width: "100%", height: 210 }}>
                <ResponsiveContainer width="100%" height={210}>
                  <BarChart data={statusRows} margin={{ left: 16, right: 16, top: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="status" />
                    <YAxis tickFormatter={(v: any) => fmtUSD(Number(v ?? 0))} />
                    <Tooltip formatter={(value: any) => fmtUSD(Number(value ?? 0))} />
                    <Legend />
                    <Bar dataKey="amount" name="Amount (USD)" isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="section">
        <div style={{ fontWeight: 800, fontSize: 18, margin: "6px 0" }}>
          Buyer Breakdown (Top 10, USD)
        </div>

        <Card>
          <CardContent className="p-3">
            <div style={{ width: "100%", height: 240 }}>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={buyerRows} margin={{ left: 16, right: 16, top: 8, bottom: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="buyer" interval={0} angle={-15} textAnchor="end" height={60} />
                  <YAxis tickFormatter={(v: any) => fmtUSD(Number(v ?? 0))} />
                  <Tooltip formatter={(value: any) => fmtUSD(Number(value ?? 0))} />
                  <Legend />
                  <Bar dataKey="amount" name="Amount (USD)" isAnimationActive={false}>
                    {buyerRows.map((_, idx) => (
                      <Cell key={`buyer-${idx}`} fill={COLORS[idx % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <div style={{ fontSize: 11, color: "#6B7280", marginTop: 6 }}>
        Total (Status): {fmtUSD(totalStatus)}
      </div>
    </div>
  );
}
