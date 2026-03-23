"use client";

import * as React from "react";
import AppShell from "@/components/layout/AppShell";
import type { AppRole } from "@/config/menuConfig";
import { createSupabaseBrowserClient } from "@/lib/supabaseClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

type DevRole = AppRole;

type BuyerRow = {
  id: string;
  company_name?: string | null;
  code?: string | null;
  company_type?: string | null;
};

type DashboardPayload = {
  success: boolean;
  error?: string;
  filters_echo: { start: string; end: string; buyer_id?: string | null };
  kpis: {
    receipt_count: number;
    gross_received: number;
    our_fee: number;
    buyer_fee: number;
    claim_deduction: number;
    net_received: number;
    applied_total: number;
    writeoff_total: number;
  };
  ar_kpis: {
    open_invoice_count: number;
    outstanding_amount: number;
    overdue_amount: number;
  };
  receipts_by_month: Array<{
    month: string;
    gross_received: number;
    net_received: number;
    our_fee: number;
    buyer_fee: number;
    claim_deduction: number;
    receipt_count: number;
  }>;
  receipts_by_buyer: Array<{
    buyer_id?: string | null;
    buyer_name: string;
    buyer_code?: string | null;
    gross_received: number;
    net_received: number;
    receipt_count: number;
  }>;
  outstanding_by_buyer: Array<{
    buyer_id?: string | null;
    buyer_name: string;
    buyer_code?: string | null;
    outstanding_amount: number;
    invoice_count: number;
  }>;
  outstanding_by_month: Array<{
    month: string;
    outstanding_amount: number;
    invoice_count: number;
  }>;
  aging: {
    current: number;
    d1_30: number;
    d31_60: number;
    d61_90: number;
    d90_plus: number;
  };
  recent_receipts: Array<{
    id: string;
    deposit_date?: string | null;
    buyer_name?: string | null;
    buyer_code?: string | null;
    method?: string | null;
    reference_no?: string | null;
    total_received: number;
    bank_fee_amount: number;
    buyer_bank_fee_amount: number;
    claim_deduction_amount: number;
    net_received_amount: number;
    note?: string | null;
  }>;
  receipt_details: Array<{
    receipt_id: string;
    deposit_date?: string | null;
    buyer_name?: string | null;
    buyer_code?: string | null;
    invoice_no?: string | null;
    invoice_date?: string | null;
    invoice_total: number;
    applied_amount: number;
    writeoff_amount: number;
    allocated_our_fee: number;
    allocated_buyer_fee: number;
    allocated_claim: number;
    settled_amount: number;
  }>;
  open_invoices: Array<{
    id: string;
    invoice_no?: string | null;
    invoice_date?: string | null;
    buyer_name?: string | null;
    buyer_code?: string | null;
    total_amount: number;
    paid_amount: number;
    balance_amount: number;
    status?: string | null;
  }>;
};

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

function monthStartMonthsAgo(monthsAgo: number) {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsAgo, 1);
  return d.toISOString().slice(0, 10);
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtMoney(v: unknown) {
  return num(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function shortDate(v?: string | null) {
  return v ? String(v).slice(0, 10) : "";
}

function csvEscape(v: unknown) {
  const s = v == null ? "" : String(v);
  const needs = /[",\n\r]/.test(s);
  const body = s.replace(/"/g, '""');
  return needs ? `"${body}"` : body;
}

function downloadText(filename: string, content: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

const PIE_COLORS = ["#2563eb", "#16a34a", "#ea580c", "#7c3aed", "#dc2626"];

export default function ReceivablesDashboardPage() {
  const role: DevRole = "admin" as DevRole;
  const supabase = React.useMemo(() => createSupabaseBrowserClient(), []);

  const [buyers, setBuyers] = React.useState<BuyerRow[]>([]);
  const [buyerId, setBuyerId] = React.useState("");
  const [start, setStart] = React.useState(monthStartMonthsAgo(11));
  const [end, setEnd] = React.useState(todayISODate());
  const [loading, setLoading] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState("");
  const [data, setData] = React.useState<DashboardPayload | null>(null);

  const loadBuyers = React.useCallback(async () => {
    try {
      let rows: any[] = [];
      const r = await supabase
        .from("companies")
        .select("id, company_name, code, company_type, is_deleted")
        .eq("is_deleted", false)
        .order("company_name", { ascending: true });

      if (!r.error) {
        rows = (r.data || []) as any[];
      } else {
        const r2 = await supabase
          .from("companies")
          .select("id, company_name, code, company_type")
          .order("company_name", { ascending: true });
        if (r2.error) throw r2.error;
        rows = (r2.data || []) as any[];
      }

      setBuyers(
        rows
          .filter((x) => /buyer/i.test(String(x?.company_type || "")))
          .map((x) => ({
            id: String(x.id),
            company_name: x.company_name ?? null,
            code: x.code ?? null,
            company_type: x.company_type ?? null,
          }))
      );
    } catch (e) {
      console.error(e);
    }
  }, [supabase]);

  const loadDashboard = React.useCallback(async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const qs = new URLSearchParams();
      qs.set("start", start);
      qs.set("end", end);
      if (buyerId) qs.set("buyer_id", buyerId);
      const res = await fetch(`/api/dashboards/receivables?${qs.toString()}`, {
        method: "GET",
        cache: "no-store",
      });
      const j = (await res.json().catch(() => ({}))) as DashboardPayload;
      if (!res.ok || !j?.success) throw new Error((j as any)?.error || `Failed to load dashboard (${res.status})`);
      setData(j);
    } catch (e: any) {
      console.error(e);
      setData(null);
      setErrorMsg(e?.message || "Failed to load receivables dashboard");
    } finally {
      setLoading(false);
    }
  }, [start, end, buyerId]);

  React.useEffect(() => {
    void loadBuyers();
  }, [loadBuyers]);

  React.useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const buyerLabel = React.useMemo(() => {
    const row = buyers.find((x) => x.id === buyerId);
    return row ? `${row.company_name || ""}${row.code ? ` (${row.code})` : ""}` : "All Buyers";
  }, [buyers, buyerId]);

  const exportReceiptsSummaryCSV = React.useCallback(() => {
    if (!data) return;
    const lines: string[] = [];
    lines.push(["month", "gross_received", "net_received", "our_fee", "buyer_fee", "claim_deduction", "receipt_count"].map(csvEscape).join(","));
    for (const row of data.receipts_by_month) {
      lines.push([
        row.month,
        row.gross_received,
        row.net_received,
        row.our_fee,
        row.buyer_fee,
        row.claim_deduction,
        row.receipt_count,
      ].map(csvEscape).join(","));
    }
    downloadText(`receipts_summary_${start}_${end}.csv`, lines.join("\n"));
  }, [data, start, end]);

  const exportReceiptsDetailCSV = React.useCallback(() => {
    if (!data) return;
    const lines: string[] = [];
    lines.push([
      "deposit_date",
      "buyer_name",
      "buyer_code",
      "invoice_no",
      "invoice_date",
      "invoice_total",
      "applied_amount",
      "writeoff_amount",
      "allocated_our_fee",
      "allocated_buyer_fee",
      "allocated_claim",
      "settled_amount",
    ].map(csvEscape).join(","));
    for (const row of data.receipt_details) {
      lines.push([
        shortDate(row.deposit_date),
        row.buyer_name || "",
        row.buyer_code || "",
        row.invoice_no || "",
        shortDate(row.invoice_date),
        row.invoice_total,
        row.applied_amount,
        row.writeoff_amount,
        row.allocated_our_fee,
        row.allocated_buyer_fee,
        row.allocated_claim,
        row.settled_amount,
      ].map(csvEscape).join(","));
    }
    downloadText(`receipts_detail_${start}_${end}.csv`, lines.join("\n"));
  }, [data, start, end]);

  const exportOutstandingCSV = React.useCallback(() => {
    if (!data) return;
    const lines: string[] = [];
    lines.push([
      "invoice_no",
      "invoice_date",
      "buyer_name",
      "buyer_code",
      "total_amount",
      "paid_amount",
      "balance_amount",
      "status",
    ].map(csvEscape).join(","));
    for (const row of data.open_invoices) {
      lines.push([
        row.invoice_no || "",
        shortDate(row.invoice_date),
        row.buyer_name || "",
        row.buyer_code || "",
        row.total_amount,
        row.paid_amount,
        row.balance_amount,
        row.status || "",
      ].map(csvEscape).join(","));
    }
    downloadText(`outstanding_ar_${start}_${end}.csv`, lines.join("\n"));
  }, [data, start, end]);

  const agingChartData = React.useMemo(() => {
    if (!data) return [];
    return [
      { name: "Current", value: data.aging.current },
      { name: "1-30", value: data.aging.d1_30 },
      { name: "31-60", value: data.aging.d31_60 },
      { name: "61-90", value: data.aging.d61_90 },
      { name: "90+", value: data.aging.d90_plus },
    ];
  }, [data]);

  return (
    <AppShell role={role}>
      <div className="space-y-6 p-4 md:p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Receivables Dashboard</h1>
            <p className="text-sm text-muted-foreground">Buyer별 / 기간별 수금현황과 미수금현황을 한 화면에서 확인합니다.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={exportReceiptsSummaryCSV} disabled={!data}>Receipts CSV</Button>
            <Button variant="outline" onClick={exportReceiptsDetailCSV} disabled={!data}>Receipt Detail CSV</Button>
            <Button onClick={exportOutstandingCSV} disabled={!data}>Outstanding CSV</Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Filters</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div className="space-y-1">
                <div className="text-sm font-medium">Buyer</div>
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={buyerId}
                  onChange={(e) => setBuyerId(e.target.value)}
                >
                  <option value="">All Buyers</option>
                  {buyers.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.company_name || "(No Name)"}{b.code ? ` (${b.code})` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <div className="text-sm font-medium">Start</div>
                <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
              </div>
              <div className="space-y-1">
                <div className="text-sm font-medium">End</div>
                <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
              </div>
              <div className="flex items-end gap-2">
                <Button onClick={() => void loadDashboard()} disabled={loading} className="w-full">
                  {loading ? "Loading..." : "Refresh"}
                </Button>
              </div>
            </div>
            <div className="mt-3 text-sm text-muted-foreground">
              Scope: <span className="font-medium text-foreground">{buyerLabel}</span> / {start} ~ {end}
            </div>
            {errorMsg ? <div className="mt-3 text-sm text-red-600">{errorMsg}</div> : null}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Gross Received</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-semibold">{fmtMoney(data?.kpis.gross_received)}</div><div className="text-xs text-muted-foreground">Receipts: {data?.kpis.receipt_count || 0}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Net Received</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-semibold">{fmtMoney(data?.kpis.net_received)}</div><div className="text-xs text-muted-foreground">Applied: {fmtMoney(data?.kpis.applied_total)}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Outstanding A/R</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-semibold">{fmtMoney(data?.ar_kpis.outstanding_amount)}</div><div className="text-xs text-muted-foreground">Open invoices: {data?.ar_kpis.open_invoice_count || 0}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Overdue A/R</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-semibold">{fmtMoney(data?.ar_kpis.overdue_amount)}</div><div className="text-xs text-muted-foreground">Aging by invoice date</div></CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Monthly Receipts</CardTitle></CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data?.receipts_by_month || []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis />
                    <Tooltip formatter={(v: any) => fmtMoney(v)} />
                    <Legend />
                    <Bar dataKey="gross_received" name="Gross" fill="#2563eb" />
                    <Bar dataKey="net_received" name="Net" fill="#16a34a" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Monthly Outstanding</CardTitle></CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data?.outstanding_by_month || []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis />
                    <Tooltip formatter={(v: any) => fmtMoney(v)} />
                    <Legend />
                    <Line type="monotone" dataKey="outstanding_amount" name="Outstanding" stroke="#dc2626" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader><CardTitle>Receipts by Buyer</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-left">
                      <th className="px-3 py-2">Buyer</th>
                      <th className="px-3 py-2 text-right">Gross</th>
                      <th className="px-3 py-2 text-right">Net</th>
                      <th className="px-3 py-2 text-right">Receipt Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.receipts_by_buyer || []).map((row) => (
                      <tr key={`${row.buyer_id}-${row.buyer_code}`} className="border-b">
                        <td className="px-3 py-2">{row.buyer_name}{row.buyer_code ? ` (${row.buyer_code})` : ""}</td>
                        <td className="px-3 py-2 text-right">{fmtMoney(row.gross_received)}</td>
                        <td className="px-3 py-2 text-right">{fmtMoney(row.net_received)}</td>
                        <td className="px-3 py-2 text-right">{row.receipt_count}</td>
                      </tr>
                    ))}
                    {!(data?.receipts_by_buyer || []).length ? (
                      <tr><td className="px-3 py-6 text-center text-muted-foreground" colSpan={4}>No receipt data.</td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>A/R Aging</CardTitle></CardHeader>
            <CardContent>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={agingChartData} dataKey="value" nameKey="name" outerRadius={100} label>
                      {agingChartData.map((_, idx) => <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: any) => fmtMoney(v)} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Outstanding by Buyer</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-left">
                      <th className="px-3 py-2">Buyer</th>
                      <th className="px-3 py-2 text-right">Outstanding</th>
                      <th className="px-3 py-2 text-right">Open Invoices</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.outstanding_by_buyer || []).map((row) => (
                      <tr key={`${row.buyer_id}-${row.buyer_code}`} className="border-b">
                        <td className="px-3 py-2">{row.buyer_name}{row.buyer_code ? ` (${row.buyer_code})` : ""}</td>
                        <td className="px-3 py-2 text-right">{fmtMoney(row.outstanding_amount)}</td>
                        <td className="px-3 py-2 text-right">{row.invoice_count}</td>
                      </tr>
                    ))}
                    {!(data?.outstanding_by_buyer || []).length ? (
                      <tr><td className="px-3 py-6 text-center text-muted-foreground" colSpan={3}>No outstanding invoices.</td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Recent Receipts</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-left">
                      <th className="px-3 py-2">Deposit Date</th>
                      <th className="px-3 py-2">Buyer</th>
                      <th className="px-3 py-2">Method</th>
                      <th className="px-3 py-2">Reference</th>
                      <th className="px-3 py-2 text-right">Gross</th>
                      <th className="px-3 py-2 text-right">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.recent_receipts || []).map((row) => (
                      <tr key={row.id} className="border-b">
                        <td className="px-3 py-2">{shortDate(row.deposit_date)}</td>
                        <td className="px-3 py-2">{row.buyer_name || ""}{row.buyer_code ? ` (${row.buyer_code})` : ""}</td>
                        <td className="px-3 py-2">{row.method || ""}</td>
                        <td className="px-3 py-2">{row.reference_no || ""}</td>
                        <td className="px-3 py-2 text-right">{fmtMoney(row.total_received)}</td>
                        <td className="px-3 py-2 text-right">{fmtMoney(row.net_received_amount)}</td>
                      </tr>
                    ))}
                    {!(data?.recent_receipts || []).length ? (
                      <tr><td className="px-3 py-6 text-center text-muted-foreground" colSpan={6}>No receipts found.</td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle>Open Invoice Detail</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left">
                    <th className="px-3 py-2">Invoice No</th>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Buyer</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2 text-right">Paid</th>
                    <th className="px-3 py-2 text-right">Balance</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.open_invoices || []).map((row) => (
                    <tr key={row.id} className="border-b">
                      <td className="px-3 py-2">{row.invoice_no || ""}</td>
                      <td className="px-3 py-2">{shortDate(row.invoice_date)}</td>
                      <td className="px-3 py-2">{row.buyer_name || ""}{row.buyer_code ? ` (${row.buyer_code})` : ""}</td>
                      <td className="px-3 py-2 text-right">{fmtMoney(row.total_amount)}</td>
                      <td className="px-3 py-2 text-right">{fmtMoney(row.paid_amount)}</td>
                      <td className="px-3 py-2 text-right font-medium text-red-600">{fmtMoney(row.balance_amount)}</td>
                      <td className="px-3 py-2">{row.status || ""}</td>
                    </tr>
                  ))}
                  {!(data?.open_invoices || []).length ? (
                    <tr><td className="px-3 py-6 text-center text-muted-foreground" colSpan={7}>No open invoices.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
