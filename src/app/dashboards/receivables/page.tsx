 "use client";

import * as React from "react";
import AppShell from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import ExcelJS from "exceljs";

type BuyerItem = {
  buyer_id: string | null;
  buyer_name: string;
  buyer_code?: string | null;
  gross_received?: number;
  net_received?: number;
  outstanding_amount?: number;
  receipt_count?: number;
  invoice_count?: number;
};

type MonthlyReceipt = {
  month: string;
  gross_received: number;
  net_received: number;
};

type MonthlyOutstanding = {
  month: string;
  outstanding_amount: number;
};

type ReceiptRow = {
  id: string;
  deposit_date: string | null;
  buyer_name: string | null;
  buyer_code: string | null;
  method: string | null;
  reference_no: string | null;
  total_received: number;
  net_received_amount: number;
};

type InvoiceRow = {
  id: string;
  invoice_no: string;
  invoice_date: string | null;
  buyer_name: string | null;
  total_amount: number;
  paid_amount: number;
  balance_amount: number;
  status: string | null;
  partial_payment_count?: number;
  receipt_trace_count?: number;
};

type InvoiceTraceResponse = {
  success: boolean;
  invoice: {
    id: string;
    invoice_no: string;
    invoice_date: string | null;
    buyer_name: string | null;
    total_amount: number;
    paid_amount: number;
    balance_amount: number;
    currency: string | null;
    status: string | null;
  };
  reconcile: {
    invoice_total: number;
    paid_amount: number;
    balance_amount: number;
    traced_applied_amount: number;
    traced_writeoff_amount: number;
    traced_settled_amount: number;
    delta_paid_vs_trace: number;
  };
  receipt_trace: Array<{
    receipt_id: string;
    deposit_date: string | null;
    method: string | null;
    reference_no: string | null;
    applied_amount: number;
    writeoff_amount: number;
    allocated_our_fee: number;
    allocated_buyer_fee: number;
    allocated_claim: number;
    settled_amount: number;
  }>;
  partial_payment_history: Array<{
    seq: number;
    receipt_id: string;
    deposit_date: string | null;
    applied_amount: number;
    writeoff_amount: number;
    settled_amount: number;
    cumulative_paid: number;
  }>;
};

type DashboardPayload = {
  success: boolean;
  filters_echo: {
    start: string;
    end: string;
    buyer_id: string | null;
    aging_bucket?: string | null;
  };
  kpis: {
    receipt_count: number;
    gross_received: number;
    net_received: number;
    applied_total: number;
  };
  ar_kpis: {
    open_invoice_count: number;
    outstanding_amount: number;
    overdue_amount: number;
    traced_invoice_count?: number;
  };
  receipts_by_month: MonthlyReceipt[];
  receipts_by_buyer: BuyerItem[];
  outstanding_by_buyer: BuyerItem[];
  outstanding_by_month: MonthlyOutstanding[];
  aging: {
    current: number;
    d1_30: number;
    d31_60: number;
    d61_90: number;
    d90_plus: number;
  };
  recent_receipts: ReceiptRow[];
  open_invoices: InvoiceRow[];
};

function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function fmt2(v: any): string {
  return num(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtInt(v: any): string {
  return Math.trunc(num(v)).toLocaleString();
}
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function startOfMonth12Ago(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 11);
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

export default function ReceivablesDashboardPage() {
  const [buyerId, setBuyerId] = React.useState<string>("ALL");
  const [start, setStart] = React.useState<string>(startOfMonth12Ago());
  const [end, setEnd] = React.useState<string>(todayIso());
  const [agingBucket, setAgingBucket] = React.useState<string>("ALL");
  const [data, setData] = React.useState<DashboardPayload | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState("");
  const [traceOpen, setTraceOpen] = React.useState(false);
  const [traceLoading, setTraceLoading] = React.useState(false);
  const [traceData, setTraceData] = React.useState<InvoiceTraceResponse | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const qs = new URLSearchParams();
      if (buyerId !== "ALL") qs.set("buyer_id", buyerId);
      if (start) qs.set("start", start);
      if (end) qs.set("end", end);
      if (agingBucket !== "ALL") qs.set("aging_bucket", agingBucket);
      const res = await fetch(`/api/dashboards/receivables?${qs.toString()}`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok || !j?.success) throw new Error(j?.error || `Failed to load (${res.status})`);
      setData(j);
    } catch (e: any) {
      setErrorMsg(e?.message || "Failed to load dashboard");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [buyerId, start, end, agingBucket]);

  React.useEffect(() => {
    load();
  }, [load]);

  const openInvoiceTrace = React.useCallback(async (invoiceId: string) => {
    if (!invoiceId) return;
    setTraceOpen(true);
    setTraceLoading(true);
    setTraceData(null);
    try {
      const res = await fetch(`/api/dashboards/receivables/invoice/${encodeURIComponent(invoiceId)}`, {
        cache: "no-store",
      });
      const j = await res.json();
      if (!res.ok || !j?.success) throw new Error(j?.error || `Failed to load invoice trace (${res.status})`);
      setTraceData(j);
    } catch (e: any) {
      setErrorMsg(e?.message || "Failed to load invoice trace");
    } finally {
      setTraceLoading(false);
    }
  }, []);

  const allBuyers = React.useMemo(() => {
    const map = new Map<string, BuyerItem>();
    for (const row of data?.receipts_by_buyer || []) {
      if (row.buyer_id) map.set(String(row.buyer_id), row);
    }
    for (const row of data?.outstanding_by_buyer || []) {
      if (row.buyer_id && !map.has(String(row.buyer_id))) map.set(String(row.buyer_id), row);
    }
    return Array.from(map.values()).sort((a, b) => String(a.buyer_name || "").localeCompare(String(b.buyer_name || "")));
  }, [data]);

  const exportExcel = React.useCallback(async () => {
    if (!data) return;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "JM ERP";
    workbook.created = new Date();

    const navy = "FF1E3A5F";
    const pale = "FFEFF6FF";
    const headerFill = "FFE5EDF8";
    const borderColor = "FFD6E0EA";
    const border = {
      top: { style: "thin", color: { argb: borderColor } },
      left: { style: "thin", color: { argb: borderColor } },
      bottom: { style: "thin", color: { argb: borderColor } },
      right: { style: "thin", color: { argb: borderColor } },
    } as const;
    const moneyFmt = '"USD "#,##0.00';
    const intFmt = "#,##0";

    const scope = `Period: ${start} ~ ${end}    Buyer: ${
      buyerId === "ALL" ? "ALL" : allBuyers.find((b) => String(b.buyer_id) === buyerId)?.buyer_name || buyerId
    }    Aging: ${agingBucket}`;

    const styleTitle = (sheet: ExcelJS.Worksheet, title: string, lastCol: string) => {
      sheet.mergeCells(`A1:${lastCol}1`);
      const titleCell = sheet.getCell("A1");
      titleCell.value = title;
      titleCell.font = { bold: true, size: 18, color: { argb: navy } };
      titleCell.alignment = { horizontal: "center" };
      sheet.mergeCells(`A2:${lastCol}2`);
      const scopeCell = sheet.getCell("A2");
      scopeCell.value = scope;
      scopeCell.font = { size: 10, color: { argb: "FF64748B" } };
      scopeCell.alignment = { horizontal: "center" };
      sheet.addRow([]);
    };

    const styleSection = (row: ExcelJS.Row) => {
      row.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: pale } };
        cell.font = { bold: true, color: { argb: navy } };
        cell.border = border;
      });
    };

    const styleHeader = (row: ExcelJS.Row) => {
      row.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: headerFill } };
        cell.font = { bold: true, color: { argb: "FF0F172A" } };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border = border;
      });
    };

    const styleBody = (row: ExcelJS.Row, moneyCols: number[] = [], intCols: number[] = []) => {
      row.eachCell((cell, colNumber) => {
        cell.border = border;
        cell.alignment = { vertical: "top", wrapText: true };
        if (moneyCols.includes(colNumber)) cell.numFmt = moneyFmt;
        if (intCols.includes(colNumber)) cell.numFmt = intFmt;
      });
    };

    const addSection = (sheet: ExcelJS.Worksheet, title: string, lastCol: string) => {
      sheet.addRow([]);
      sheet.mergeCells(`A${sheet.rowCount + 1}:${lastCol}${sheet.rowCount + 1}`);
      const row = sheet.addRow([title]);
      styleSection(row);
    };

    const summary = workbook.addWorksheet("Summary", { views: [{ state: "frozen", ySplit: 4 }] });
    styleTitle(summary, "Receivables Dashboard", "F");
    addSection(summary, "KPI Summary", "F");
    styleHeader(summary.addRow(["Metric", "Value", "Count / Note", "", "", ""]));
    [
      ["Gross Received", data.kpis.gross_received, `Receipts ${data.kpis.receipt_count}`],
      ["Net Received", data.kpis.net_received, `Applied ${fmt2(data.kpis.applied_total)}`],
      ["Outstanding A/R", data.ar_kpis.outstanding_amount, `Open invoices ${data.ar_kpis.open_invoice_count}`],
      ["Overdue Amount", data.ar_kpis.overdue_amount, ""],
      ["Traced Invoices", data.ar_kpis.traced_invoice_count || 0, "Receipt linked invoices"],
    ].forEach((r) => styleBody(summary.addRow(r), [2], []));

    addSection(summary, "A/R Aging", "F");
    styleHeader(summary.addRow(["Bucket", "Amount", "", "", "", ""]));
    [
      ["Current", data.aging.current],
      ["1-30", data.aging.d1_30],
      ["31-60", data.aging.d31_60],
      ["61-90", data.aging.d61_90],
      ["90+", data.aging.d90_plus],
    ].forEach((r) => styleBody(summary.addRow(r), [2], []));
    summary.columns = [{ width: 24 }, { width: 18 }, { width: 28 }, { width: 12 }, { width: 12 }, { width: 12 }];

    const monthly = workbook.addWorksheet("Monthly", { views: [{ state: "frozen", ySplit: 4 }] });
    styleTitle(monthly, "Monthly Receivables", "D");
    addSection(monthly, "Monthly Receipts", "D");
    styleHeader(monthly.addRow(["Month", "Gross Received", "Net Received", ""]));
    data.receipts_by_month.forEach((r) => styleBody(monthly.addRow([r.month, r.gross_received, r.net_received]), [2, 3], []));
    addSection(monthly, "Monthly Outstanding", "D");
    styleHeader(monthly.addRow(["Month", "Outstanding", "", ""]));
    data.outstanding_by_month.forEach((r) => styleBody(monthly.addRow([r.month, r.outstanding_amount]), [2], []));
    monthly.columns = [{ width: 16 }, { width: 18 }, { width: 18 }, { width: 12 }];

    const receipts = workbook.addWorksheet("Receipts", { views: [{ state: "frozen", ySplit: 4 }] });
    styleTitle(receipts, "Receipts", "H");
    addSection(receipts, "Receipts by Buyer", "H");
    styleHeader(receipts.addRow(["Buyer", "Code", "Gross", "Net", "Receipt Count", "", "", ""]));
    data.receipts_by_buyer.forEach((r) => styleBody(receipts.addRow([
      r.buyer_name,
      r.buyer_code || "",
      r.gross_received || 0,
      r.net_received || 0,
      r.receipt_count || 0,
    ]), [3, 4], [5]));
    addSection(receipts, "Recent Receipts", "H");
    styleHeader(receipts.addRow(["Date", "Buyer", "Code", "Method", "Reference", "Gross", "Net", ""]));
    data.recent_receipts.forEach((r) => styleBody(receipts.addRow([
      r.deposit_date || "",
      r.buyer_name || "",
      r.buyer_code || "",
      r.method || "",
      r.reference_no || "",
      r.total_received,
      r.net_received_amount,
    ]), [6, 7], []));
    receipts.columns = [
      { width: 16 }, { width: 28 }, { width: 12 }, { width: 14 },
      { width: 18 }, { width: 16 }, { width: 16 }, { width: 12 },
    ];

    const invoices = workbook.addWorksheet("Open Invoices", { views: [{ state: "frozen", ySplit: 4 }] });
    styleTitle(invoices, "Open Invoice Detail", "I");
    styleHeader(invoices.addRow([
      "Invoice No",
      "Invoice Date",
      "Buyer",
      "Total",
      "Paid",
      "Balance",
      "Partial Count",
      "Trace Count",
      "Status",
    ]));
    data.open_invoices.forEach((r) => styleBody(invoices.addRow([
      r.invoice_no,
      r.invoice_date || "",
      r.buyer_name || "",
      r.total_amount,
      r.paid_amount,
      r.balance_amount,
      r.partial_payment_count || 0,
      r.receipt_trace_count || 0,
      r.status || "",
    ]), [4, 5, 6], [7, 8]));
    invoices.columns = [
      { width: 18 }, { width: 14 }, { width: 28 }, { width: 16 }, { width: 16 },
      { width: 16 }, { width: 14 }, { width: 14 }, { width: 14 },
    ];

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `receivables_dashboard_${start}_${end}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }, [agingBucket, allBuyers, buyerId, data, end, start]);

  const agingCards = [
    { key: "ALL", label: "All Open" },
    { key: "current", label: "Current", value: data?.aging.current || 0 },
    { key: "d1_30", label: "1-30", value: data?.aging.d1_30 || 0 },
    { key: "d31_60", label: "31-60", value: data?.aging.d31_60 || 0 },
    { key: "d61_90", label: "61-90", value: data?.aging.d61_90 || 0 },
    { key: "d90_plus", label: "90+", value: data?.aging.d90_plus || 0 },
  ];

  return (
    <AppShell>
      <div className="space-y-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Receivables Dashboard</CardTitle>
              <div className="text-sm text-muted-foreground">
                Receipt → Invoice 자동 reconcile / Partial payment history / A/R Aging drill-down
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={exportExcel} disabled={!data}>
                Export Excel
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {errorMsg ? <div className="text-sm text-red-600">{errorMsg}</div> : null}

            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div>
                <div className="mb-1 text-sm font-medium">Buyer</div>
                <Select value={buyerId} onValueChange={setBuyerId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Buyers</SelectItem>
                    {allBuyers.map((b) => (
                      <SelectItem key={String(b.buyer_id)} value={String(b.buyer_id)}>
                        {b.buyer_name}{b.buyer_code ? ` (${b.buyer_code})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <div className="mb-1 text-sm font-medium">Start</div>
                <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
              </div>
              <div>
                <div className="mb-1 text-sm font-medium">End</div>
                <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
              </div>
              <div className="flex items-end">
                <Button onClick={load} disabled={loading}>{loading ? "Loading..." : "Refresh"}</Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Card><CardContent className="p-4"><div className="text-sm text-muted-foreground">Gross Received</div><div className="text-2xl font-bold">{fmt2(data?.kpis.gross_received || 0)}</div><div className="text-xs text-muted-foreground">Receipts: {fmtInt(data?.kpis.receipt_count || 0)}</div></CardContent></Card>
              <Card><CardContent className="p-4"><div className="text-sm text-muted-foreground">Net Received</div><div className="text-2xl font-bold">{fmt2(data?.kpis.net_received || 0)}</div><div className="text-xs text-muted-foreground">Applied: {fmt2(data?.kpis.applied_total || 0)}</div></CardContent></Card>
              <Card><CardContent className="p-4"><div className="text-sm text-muted-foreground">Outstanding A/R</div><div className="text-2xl font-bold">{fmt2(data?.ar_kpis.outstanding_amount || 0)}</div><div className="text-xs text-muted-foreground">Open invoices: {fmtInt(data?.ar_kpis.open_invoice_count || 0)}</div></CardContent></Card>
              <Card><CardContent className="p-4"><div className="text-sm text-muted-foreground">Traced Invoices</div><div className="text-2xl font-bold">{fmtInt(data?.ar_kpis.traced_invoice_count || 0)}</div><div className="text-xs text-muted-foreground">Receipt linked invoices</div></CardContent></Card>
            </div>

            <Card>
              <CardHeader><CardTitle>A/R Aging Drill-down</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-2 gap-2 md:grid-cols-6">
                {agingCards.map((item) => (
                  <button
                    key={item.key}
                    className={`rounded-xl border px-3 py-3 text-left ${agingBucket === item.key ? "border-primary bg-primary/5" : ""}`}
                    onClick={() => setAgingBucket(item.key)}
                    type="button"
                  >
                    <div className="text-xs text-muted-foreground">{item.label}</div>
                    <div className="text-lg font-semibold">{item.key === "ALL" ? fmt2(data?.ar_kpis.outstanding_amount || 0) : fmt2((item as any).value || 0)}</div>
                  </button>
                ))}
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader><CardTitle>Monthly Receipts</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {(data?.receipts_by_month || []).map((m) => (
                    <div key={m.month} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                      <div>{m.month}</div>
                      <div className="flex gap-4">
                        <span>Gross {fmt2(m.gross_received)}</span>
                        <span>Net {fmt2(m.net_received)}</span>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>Monthly Outstanding</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {(data?.outstanding_by_month || []).map((m) => (
                    <div key={m.month} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                      <div>{m.month}</div>
                      <div>{fmt2(m.outstanding_amount)}</div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader><CardTitle>Receipts by Buyer</CardTitle></CardHeader>
                <CardContent className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="py-2">Buyer</th>
                        <th className="py-2 text-right">Gross</th>
                        <th className="py-2 text-right">Net</th>
                        <th className="py-2 text-right">Receipts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data?.receipts_by_buyer || []).map((row) => (
                        <tr key={String(row.buyer_id || row.buyer_name)} className="border-b">
                          <td className="py-2">{row.buyer_name}</td>
                          <td className="py-2 text-right">{fmt2(row.gross_received || 0)}</td>
                          <td className="py-2 text-right">{fmt2(row.net_received || 0)}</td>
                          <td className="py-2 text-right">{fmtInt(row.receipt_count || 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>Recent Receipts</CardTitle></CardHeader>
                <CardContent className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="py-2">Date</th>
                        <th className="py-2">Buyer</th>
                        <th className="py-2">Method</th>
                        <th className="py-2 text-right">Gross</th>
                        <th className="py-2 text-right">Net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data?.recent_receipts || []).map((row) => (
                        <tr key={row.id} className="border-b">
                          <td className="py-2">{row.deposit_date || ""}</td>
                          <td className="py-2">{row.buyer_name || ""}</td>
                          <td className="py-2">{row.method || ""}</td>
                          <td className="py-2 text-right">{fmt2(row.total_received)}</td>
                          <td className="py-2 text-right">{fmt2(row.net_received_amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader><CardTitle>Open Invoice Detail (click invoice for receipt trace)</CardTitle></CardHeader>
              <CardContent className="overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="py-2">Invoice No</th>
                      <th className="py-2">Date</th>
                      <th className="py-2">Buyer</th>
                      <th className="py-2 text-right">Total</th>
                      <th className="py-2 text-right">Paid</th>
                      <th className="py-2 text-right">Balance</th>
                      <th className="py-2 text-right">Partial Count</th>
                      <th className="py-2 text-right">Trace Count</th>
                      <th className="py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.open_invoices || []).map((row) => (
                      <tr key={row.id} className="border-b">
                        <td className="py-2">
                          <button
                            type="button"
                            className="font-medium text-blue-600 hover:underline"
                            onClick={() => openInvoiceTrace(row.id)}
                          >
                            {row.invoice_no}
                          </button>
                        </td>
                        <td className="py-2">{row.invoice_date || ""}</td>
                        <td className="py-2">{row.buyer_name || ""}</td>
                        <td className="py-2 text-right">{fmt2(row.total_amount)}</td>
                        <td className="py-2 text-right">{fmt2(row.paid_amount)}</td>
                        <td className="py-2 text-right text-red-600">{fmt2(row.balance_amount)}</td>
                        <td className="py-2 text-right">{fmtInt(row.partial_payment_count || 0)}</td>
                        <td className="py-2 text-right">{fmtInt(row.receipt_trace_count || 0)}</td>
                        <td className="py-2">{row.status || ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </CardContent>
        </Card>

        <Dialog open={traceOpen} onOpenChange={setTraceOpen}>
          <DialogContent className="max-w-5xl">
            <DialogHeader>
              <DialogTitle>Invoice Receipt Trace</DialogTitle>
            </DialogHeader>

            {traceLoading ? (
              <div className="py-8 text-sm text-muted-foreground">Loading trace...</div>
            ) : traceData?.invoice ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Invoice</div><div className="font-semibold">{traceData.invoice.invoice_no}</div><div className="text-xs">{traceData.invoice.invoice_date || ""}</div></CardContent></Card>
                  <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Total</div><div className="font-semibold">{fmt2(traceData.invoice.total_amount)}</div><div className="text-xs">Paid {fmt2(traceData.invoice.paid_amount)}</div></CardContent></Card>
                  <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Balance</div><div className="font-semibold text-red-600">{fmt2(traceData.invoice.balance_amount)}</div><div className="text-xs">{traceData.invoice.status || ""}</div></CardContent></Card>
                  <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Trace Delta</div><div className="font-semibold">{fmt2(traceData.reconcile.delta_paid_vs_trace)}</div><div className="text-xs">Paid vs trace</div></CardContent></Card>
                </div>

                <Card>
                  <CardHeader><CardTitle>Partial Payment History</CardTitle></CardHeader>
                  <CardContent className="overflow-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left">
                          <th className="py-2">Seq</th>
                          <th className="py-2">Deposit Date</th>
                          <th className="py-2">Receipt ID</th>
                          <th className="py-2 text-right">Applied</th>
                          <th className="py-2 text-right">Writeoff</th>
                          <th className="py-2 text-right">Settled</th>
                          <th className="py-2 text-right">Cumulative Paid</th>
                        </tr>
                      </thead>
                      <tbody>
                        {traceData.partial_payment_history.map((row) => (
                          <tr key={`${row.receipt_id}-${row.seq}`} className="border-b">
                            <td className="py-2">{row.seq}</td>
                            <td className="py-2">{row.deposit_date || ""}</td>
                            <td className="py-2">{row.receipt_id}</td>
                            <td className="py-2 text-right">{fmt2(row.applied_amount)}</td>
                            <td className="py-2 text-right">{fmt2(row.writeoff_amount)}</td>
                            <td className="py-2 text-right">{fmt2(row.settled_amount)}</td>
                            <td className="py-2 text-right">{fmt2(row.cumulative_paid)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader><CardTitle>Receipt Trace Detail</CardTitle></CardHeader>
                  <CardContent className="overflow-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left">
                          <th className="py-2">Deposit Date</th>
                          <th className="py-2">Method</th>
                          <th className="py-2">Reference</th>
                          <th className="py-2 text-right">Applied</th>
                          <th className="py-2 text-right">Our Fee</th>
                          <th className="py-2 text-right">Buyer Fee</th>
                          <th className="py-2 text-right">Claim</th>
                          <th className="py-2 text-right">Settled</th>
                        </tr>
                      </thead>
                      <tbody>
                        {traceData.receipt_trace.map((row) => (
                          <tr key={`${row.receipt_id}-${row.deposit_date}`} className="border-b">
                            <td className="py-2">{row.deposit_date || ""}</td>
                            <td className="py-2">{row.method || ""}</td>
                            <td className="py-2">{row.reference_no || ""}</td>
                            <td className="py-2 text-right">{fmt2(row.applied_amount)}</td>
                            <td className="py-2 text-right">{fmt2(row.allocated_our_fee)}</td>
                            <td className="py-2 text-right">{fmt2(row.allocated_buyer_fee)}</td>
                            <td className="py-2 text-right">{fmt2(row.allocated_claim)}</td>
                            <td className="py-2 text-right">{fmt2(row.settled_amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <div className="py-8 text-sm text-muted-foreground">No trace data.</div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
