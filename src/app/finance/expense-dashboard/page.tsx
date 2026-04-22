"use client";

import * as React from "react";
import AppShell from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Currency = "ALL" | "USD" | "KRW" | "CNY" | "VND";

type LedgerRow = {
  id: string;
  tx_date: string;
  account_code: string;
  account_name: string;
  in_out: "IN" | "OUT";
  category: "RECEIPT" | "EXPENSE" | "MANUAL" | "TRANSFER" | "FX";
  purpose_code?: string | null;
  purpose_group?: string | null;
  description: string;
  counterparty_name?: string | null;
  amount: number;
  currency: Exclude<Currency, "ALL">;
};

const purposeLabels: Record<string, string> = {
  SALES_RECEIPT: "Sales Receipt",
  PURCHASE_PAYMENT: "Purchase Payment",
  FREIGHT: "Freight",
  SAMPLE_COST: "Sample Cost",
  PAYROLL: "Payroll",
  RENT: "Rent",
  UTILITIES: "Utilities",
  OFFICE_SUPPLIES: "Office Supplies",
  MEALS: "Meals",
  TRAVEL: "Travel",
  VEHICLE_MAINTENANCE: "Vehicle Maintenance",
  TRANSPORTATION: "Transportation",
  EMPLOYEE_BENEFITS: "Employee Benefits",
  MISC_EXPENSE: "Misc Expense",
  BANK_FEE: "Bank Fee",
  TAX_PAYMENT: "Tax Payment",
  OWNER_DRAW: "Owner Draw",
  CAPITAL_INJECTION: "Capital Injection",
  ADJUSTMENT: "Adjustment",
  OTHER: "Other",
};

const purposeColors: Record<string, string> = {
  "Purchase Payment": "#2563eb",
  Freight: "#0891b2",
  "Sample Cost": "#0d9488",
  Payroll: "#dc2626",
  Rent: "#9333ea",
  Utilities: "#ca8a04",
  "Office Supplies": "#64748b",
  Meals: "#f97316",
  Travel: "#16a34a",
  "Vehicle Maintenance": "#7c3aed",
  Transportation: "#0284c7",
  "Employee Benefits": "#be123c",
  "Misc Expense": "#6b7280",
  "Bank Fee": "#475569",
  "Tax Payment": "#b45309",
  "Owner Draw": "#a16207",
  "Capital Injection": "#059669",
  Adjustment: "#4f46e5",
  Other: "#71717a",
  Uncategorized: "#9ca3af",
};

function purposeColor(name: string) {
  return purposeColors[name] || "#71717a";
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function yearStart() {
  return `${new Date().getFullYear()}-01-01`;
}

function fmtMoney(value: number | null | undefined) {
  return Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtTooltip(value: number | string | undefined) {
  return fmtMoney(Number(value || 0));
}

function purposeName(code?: string | null) {
  if (!code) return "Uncategorized";
  return purposeLabels[code] || code;
}

function monthKey(date: string) {
  return String(date || "").slice(0, 7) || "-";
}

function addToMap(map: Map<string, number>, key: string, value: number) {
  map.set(key, (map.get(key) || 0) + value);
}

export default function ExpenseDashboardPage() {
  const reportRef = React.useRef<HTMLDivElement | null>(null);
  const [dateFrom, setDateFrom] = React.useState(yearStart());
  const [dateTo, setDateTo] = React.useState(today());
  const [currency, setCurrency] = React.useState<Currency>("ALL");
  const [rows, setRows] = React.useState<LedgerRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      params.set("category", "EXPENSE");
      params.set("date_from", dateFrom);
      params.set("date_to", dateTo);
      params.set("limit", "2000");
      if (currency !== "ALL") params.set("currency", currency);

      const res = await fetch(`/api/finance/cash-ledger?${params.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Failed to load expense dashboard");
      setRows((json.items || []).filter((row: LedgerRow) => row.in_out === "OUT"));
    } catch (err: any) {
      setError(err?.message || "Failed to load expense dashboard");
    } finally {
      setLoading(false);
    }
  }, [currency, dateFrom, dateTo]);

  React.useEffect(() => {
    load();
  }, [load]);

  const summary = React.useMemo(() => {
    const byCurrency = new Map<string, number>();
    const byGroup = new Map<string, number>();
    const byPurpose = new Map<string, number>();
    const byMonth = new Map<string, number>();
    const countByPurpose = new Map<string, number>();

    for (const row of rows) {
      const amount = Number(row.amount || 0);
      const group = row.purpose_group || "Uncategorized";
      const purpose = purposeName(row.purpose_code);
      addToMap(byCurrency, row.currency, amount);
      addToMap(byGroup, group, amount);
      addToMap(byPurpose, purpose, amount);
      addToMap(byMonth, monthKey(row.tx_date), amount);
      countByPurpose.set(purpose, (countByPurpose.get(purpose) || 0) + 1);
    }

    const toRows = (map: Map<string, number>) =>
      Array.from(map.entries())
        .map(([name, amount]) => ({ name, amount }))
        .sort((a, b) => b.amount - a.amount);

    return {
      total: rows.reduce((sum, row) => sum + Number(row.amount || 0), 0),
      count: rows.length,
      byCurrency: toRows(byCurrency),
      byGroup: toRows(byGroup),
      byPurpose: toRows(byPurpose),
      byMonth: Array.from(byMonth.entries()).map(([month, amount]) => ({ month, amount })).sort((a, b) => a.month.localeCompare(b.month)),
      topPurposes: toRows(byPurpose).slice(0, 8).map((item) => ({ ...item, count: countByPurpose.get(item.name) || 0 })),
    };
  }, [rows]);

  const currencyLabel = currency === "ALL" ? "Mixed" : currency;

  async function exportPdf() {
    if (!reportRef.current) return;

    const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
      import("jspdf"),
      import("html2canvas"),
    ]);

    const canvas = await html2canvas(reportRef.current, {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
    });
    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 8;
    const imgWidth = pageWidth - margin * 2;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    let heightLeft = imgHeight;
    let position = margin;
    pdf.addImage(imgData, "PNG", margin, position, imgWidth, imgHeight);
    heightLeft -= pageHeight - margin * 2;

    while (heightLeft > 0) {
      pdf.addPage();
      position = heightLeft - imgHeight + margin;
      pdf.addImage(imgData, "PNG", margin, position, imgWidth, imgHeight);
      heightLeft -= pageHeight - margin * 2;
    }

    pdf.save(`expense_dashboard_${dateFrom}_${dateTo}.pdf`);
  }

  return (
    <AppShell title="Finance / Expense Dashboard">
      <div className="space-y-4 p-4 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Expense Dashboard</h1>
            <p className="mt-1 text-xs text-gray-500">Cashbook expenses by purpose, group, and month.</p>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 text-xs" />
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 text-xs" />
            <Select value={currency} onValueChange={(value) => setCurrency(value as Currency)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Currencies</SelectItem>
                <SelectItem value="USD">USD</SelectItem>
                <SelectItem value="KRW">KRW</SelectItem>
                <SelectItem value="CNY">CNY</SelectItem>
                <SelectItem value="VND">VND</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={load} disabled={loading} className="h-8 text-xs">
              {loading ? "Loading..." : "Refresh"}
            </Button>
            <Button onClick={exportPdf} variant="outline" className="h-8 text-xs">
              PDF
            </Button>
          </div>
        </div>

        {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div> : null}

        <div ref={reportRef} className="space-y-4 bg-white">
          <div className="hidden border-b pb-2 print:block">
            <div className="text-lg font-semibold">Expense Dashboard</div>
            <div className="text-xs text-gray-500">{dateFrom} to {dateTo} / {currency === "ALL" ? "All Currencies" : currency}</div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <Card className="rounded-lg">
              <CardHeader className="p-3 pb-1"><CardTitle className="text-xs text-gray-500">Total Expense</CardTitle></CardHeader>
              <CardContent className="p-3 pt-0 text-xl font-semibold">{fmtMoney(summary.total)} <span className="text-xs font-normal text-gray-500">{currencyLabel}</span></CardContent>
            </Card>
            <Card className="rounded-lg">
              <CardHeader className="p-3 pb-1"><CardTitle className="text-xs text-gray-500">Lines</CardTitle></CardHeader>
              <CardContent className="p-3 pt-0 text-xl font-semibold">{summary.count}</CardContent>
            </Card>
            <Card className="rounded-lg">
              <CardHeader className="p-3 pb-1"><CardTitle className="text-xs text-gray-500">Top Purpose</CardTitle></CardHeader>
              <CardContent className="p-3 pt-0 text-sm font-semibold">{summary.topPurposes[0]?.name || "-"}</CardContent>
            </Card>
            <Card className="rounded-lg">
              <CardHeader className="p-3 pb-1"><CardTitle className="text-xs text-gray-500">Top Group</CardTitle></CardHeader>
              <CardContent className="p-3 pt-0 text-sm font-semibold">{summary.byGroup[0]?.name || "-"}</CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card className="rounded-lg">
              <CardHeader className="p-3"><CardTitle className="text-sm">Expense Ratio by Purpose</CardTitle></CardHeader>
              <CardContent className="h-80 p-3 pt-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={summary.byPurpose.slice(0, 9)} dataKey="amount" nameKey="name" outerRadius={105} label>
                    {summary.byPurpose.slice(0, 9).map((item) => <Cell key={item.name} fill={purposeColor(item.name)} />)}
                    </Pie>
                    <Tooltip formatter={fmtTooltip} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="rounded-lg">
              <CardHeader className="p-3"><CardTitle className="text-sm">Monthly Expense Trend</CardTitle></CardHeader>
              <CardContent className="h-80 p-3 pt-0">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={summary.byMonth}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={fmtTooltip} />
                    <Bar dataKey="amount" fill="#2563eb" name="Expense" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card className="rounded-lg">
              <CardHeader className="p-3"><CardTitle className="text-sm">Purpose Group</CardTitle></CardHeader>
              <CardContent className="p-3 pt-0">
                <div className="overflow-x-auto rounded-md border">
                  <table className="min-w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr className="border-b text-left">
                        <th className="px-2.5 py-2">Group</th>
                        <th className="px-2.5 py-2 text-right">Amount</th>
                        <th className="px-2.5 py-2 text-right">Ratio</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.byGroup.map((row) => (
                        <tr key={row.name} className="border-b">
                          <td className="px-2.5 py-2 font-medium">{row.name}</td>
                          <td className="px-2.5 py-2 text-right">{fmtMoney(row.amount)}</td>
                          <td className="px-2.5 py-2 text-right">{summary.total ? ((row.amount / summary.total) * 100).toFixed(1) : "0.0"}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-lg">
              <CardHeader className="p-3"><CardTitle className="text-sm">Top Expense Purposes</CardTitle></CardHeader>
              <CardContent className="p-3 pt-0">
                <div className="overflow-x-auto rounded-md border">
                  <table className="min-w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr className="border-b text-left">
                        <th className="px-2.5 py-2">Purpose</th>
                        <th className="px-2.5 py-2 text-right">Lines</th>
                        <th className="px-2.5 py-2 text-right">Amount</th>
                        <th className="px-2.5 py-2 text-right">Ratio</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.topPurposes.map((row) => (
                        <tr key={row.name} className="border-b">
                          <td className="px-2.5 py-2 font-medium">{row.name}</td>
                          <td className="px-2.5 py-2 text-right">{row.count}</td>
                          <td className="px-2.5 py-2 text-right">{fmtMoney(row.amount)}</td>
                          <td className="px-2.5 py-2 text-right">{summary.total ? ((row.amount / summary.total) * 100).toFixed(1) : "0.0"}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>

          {currency === "ALL" ? (
            <Card className="rounded-lg">
              <CardHeader className="p-3"><CardTitle className="text-sm">Currency Split</CardTitle></CardHeader>
              <CardContent className="p-3 pt-0">
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  {summary.byCurrency.map((row) => (
                    <div key={row.name} className="rounded-md border px-3 py-2">
                      <div className="text-xs text-gray-500">{row.name}</div>
                      <div className="text-base font-semibold">{fmtMoney(row.amount)}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}
