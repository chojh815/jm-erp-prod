"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import ExcelJS from "exceljs";

type DatePreset = "MTD" | "LAST_30" | "LAST_90" | "LAST_12_MONTHS" | "YTD" | "CUSTOM";
type GroupBy = "buyer" | "buyer_code";

type BuyerOption = { id: string; code: string; name: string };
type SiteOption = { id: string; code: string; name: string };

type AgingBuckets = {
  current: number;
  b1_30: number;
  b31_60: number;
  b61_90: number;
  b90_plus: number;
  total: number;
  invoice_count: number;
};

type AgingRow = {
  key: string;
  buyer_id: string | null;
  buyer_name: string | null;
  buyer_code: string | null;
  current: number;
  b1_30: number;
  b31_60: number;
  b61_90: number;
  b90_plus: number;
  total: number;
  invoice_count: number;
  max_overdue_days: number;
};

type OverdueInvoiceRow = {
  invoice_id: string | null;
  buyer_id?: string | null;
  buyer_name: string | null;
  buyer_code: string | null;
  invoice_no: string | null;
  invoice_date: string | null;
  due_date: string | null;
  payment_term_days: number;
  overdue_days: number;
  balance_usd: number;
};

type ResponseShape = {
  filters_echo: {
    preset: DatePreset;
    start?: string | null;
    end?: string | null;
    buyer_ids: string[] | "ALL";
    site_ids: string[] | "ALL";
    group_by: GroupBy;
  };
  buckets: AgingBuckets;
  rows: AgingRow[];
  outstanding_invoices?: OverdueInvoiceRow[];
  top_overdue_invoices: OverdueInvoiceRow[];
  meta?: {
    detail_row_count?: number;
    unique_invoice_count?: number;
    source?: string;
    debug_counts?: Record<string, any>;
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

function isoToday() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function bucketCellClass(value: number, tone: "current" | "yellow" | "orange" | "red") {
  if (!value) return "text-right p-2 text-muted-foreground";
  if (tone === "current") return "text-right p-2 font-medium text-blue-600";
  if (tone === "yellow") return "text-right p-2 font-medium text-amber-600";
  if (tone === "orange") return "text-right p-2 font-medium text-orange-600";
  return "text-right p-2 font-medium text-red-600";
}

function riskBadge(days: number) {
  if (days > 90) return "bg-red-100 text-red-700 border-red-200";
  if (days > 60) return "bg-orange-100 text-orange-700 border-orange-200";
  if (days > 30) return "bg-amber-100 text-amber-700 border-amber-200";
  if (days > 0) return "bg-yellow-100 text-yellow-700 border-yellow-200";
  return "bg-blue-100 text-blue-700 border-blue-200";
}

function normalizeBuyerKey(v: string | null | undefined) {
  return String(v || "").trim().toLowerCase();
}

export default function ArAgingDashboardPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const [preset, setPreset] = React.useState<DatePreset>((sp.get("preset") as DatePreset) || "MTD");
  const [start, setStart] = React.useState<string>(sp.get("start") || "");
  const [end, setEnd] = React.useState<string>(sp.get("end") || "");
  const [groupBy, setGroupBy] = React.useState<GroupBy>((sp.get("groupBy") as GroupBy) || "buyer");

  const [buyerIds, setBuyerIds] = React.useState<string[]>(
    sp.get("buyerIds") ? sp.get("buyerIds")!.split(",").filter(Boolean) : []
  );
  const [allBuyers, setAllBuyers] = React.useState<boolean>((sp.get("buyerIds") || "") === "ALL" || buyerIds.length === 0);

  const [siteIds, setSiteIds] = React.useState<string[]>(
    sp.get("siteIds") ? sp.get("siteIds")!.split(",").filter(Boolean) : []
  );
  const [allSites, setAllSites] = React.useState<boolean>((sp.get("siteIds") || "") === "ALL" || siteIds.length === 0);

  const [buyerOptions, setBuyerOptions] = React.useState<BuyerOption[]>([]);
  const [siteOptions, setSiteOptions] = React.useState<SiteOption[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [data, setData] = React.useState<ResponseShape | null>(null);
  const [selectedBuyer, setSelectedBuyer] = React.useState<AgingRow | null>(null);

  function syncUrl(next: {
    preset?: DatePreset;
    start?: string;
    end?: string;
    groupBy?: GroupBy;
    buyerIds?: string[] | "ALL";
    siteIds?: string[] | "ALL";
  }) {
    const q = buildQuery({
      preset: next.preset ?? preset,
      start: next.start ?? start,
      end: next.end ?? end,
      groupBy: next.groupBy ?? groupBy,
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
    router.replace(`/dashboards/ar-aging${q}`);
  }


  function openInvoice(invoiceId: string | null | undefined, invoiceNo?: string | null) {
    const target = String(invoiceId || "").trim();
    if (!target) {
      alert(`Invoice id is missing for ${invoiceNo || "this invoice"}.`);
      return;
    }
    router.push(`/invoices/${encodeURIComponent(target)}`);
  }

  function resolveBuyerId(name?: string | null, code?: string | null) {
    const nkName = normalizeBuyerKey(name);
    const nkCode = normalizeBuyerKey(code);
    const hit = buyerOptions.find(
      (b) =>
        (nkName && normalizeBuyerKey(b.name) === nkName) ||
        (nkCode && normalizeBuyerKey(b.code) === nkCode)
    );
    return hit?.id || null;
  }

  function openBuyerAging(name?: string | null, code?: string | null, buyerId?: string | null) {
    const resolved = buyerId || resolveBuyerId(name, code);
    if (!resolved) return;
    syncUrl({ buyerIds: [resolved] });
    setAllBuyers(false);
    setBuyerIds([resolved]);
  }

  React.useEffect(() => {
    let dead = false;
    const ac = new AbortController();
    (async () => {
      try {
        const [buyersRes, sitesRes] = await Promise.allSettled([
          fetchJSON<{ items: BuyerOption[] }>("/api/dashboards/options/buyers", ac.signal),
          fetchJSON<{ items: SiteOption[] }>("/api/dashboards/options/sites", ac.signal),
        ]);
        if (dead) return;
        if (buyersRes.status === "fulfilled") setBuyerOptions(buyersRes.value.items || []);
        if (sitesRes.status === "fulfilled") setSiteOptions(sitesRes.value.items || []);
      } catch {
      }
    })();
    return () => {
      dead = true;
      ac.abort();
    };
  }, []);

  React.useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);

    const q = buildQuery({
      preset,
      start: preset === "CUSTOM" ? start : "",
      end: preset === "CUSTOM" ? end : "",
      groupBy,
      buyerIds: allBuyers ? "ALL" : buyerIds.join(",") || "ALL",
      siteIds: allSites ? "ALL" : siteIds.join(",") || "ALL",
      });

    fetchJSON<ResponseShape>(`/api/dashboards/ar-aging${q}`, ac.signal)
      .then((raw) => {
        setData(raw);
        setSelectedBuyer((prev) => {
          if (!prev) return null;
          const next = (raw.rows || []).find((r) => r.key === prev.key || (prev.buyer_id && r.buyer_id === prev.buyer_id));
          return next || null;
        });
      })
      .catch((e: any) => {
        if (e?.name === "AbortError") return;
        const msg = String(e?.message ?? e ?? "");
        if (msg.includes("signal is aborted")) return;
        setError(msg);
      })
      .finally(() => setLoading(false));

    return () => ac.abort();
  }, [preset, start, end, groupBy, allBuyers, buyerIds, allSites, siteIds]);

  async function handleExportPdf() {
    const [{ jsPDF }, autoTableMod] = await Promise.all([
      import("jspdf"),
      import("jspdf-autotable"),
    ]);
    const autoTable = (autoTableMod as any).default || autoTableMod;
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    let y = 12;

    doc.setFontSize(16);
    doc.text("A/R Aging", 14, y);
    y += 8;

    doc.setFontSize(9);
    doc.text(`Period: ${preset}${preset === "CUSTOM" ? ` (${start || ""} ~ ${end || ""})` : ""}`, 14, y);
    y += 6;

    autoTable(doc, {
      startY: y,
      head: [["Current", "1-30", "31-60", "61-90", "90+", "Total A/R", "Invoices"]],
      body: [[
        fmtMoneyUSD(data?.buckets.current),
        fmtMoneyUSD(data?.buckets.b1_30),
        fmtMoneyUSD(data?.buckets.b31_60),
        fmtMoneyUSD(data?.buckets.b61_90),
        fmtMoneyUSD(data?.buckets.b90_plus),
        fmtMoneyUSD(data?.buckets.total),
        String(data?.buckets.invoice_count || 0),
      ]],
      styles: { fontSize: 9 },
      margin: { left: 14, right: 14 },
    });

    y = (doc as any).lastAutoTable.finalY + 8;

    autoTable(doc, {
      startY: y,
      head: [[groupBy === "buyer_code" ? "Buyer Code" : "Buyer", "Current", "1-30", "31-60", "61-90", "90+", "Total", "Invoices"]],
      body: (data?.rows || []).map((r) => [
        groupBy === "buyer_code" ? (r.buyer_code || "—") : (r.buyer_name || r.buyer_code || "—"),
        fmtMoneyUSD(r.current),
        fmtMoneyUSD(r.b1_30),
        fmtMoneyUSD(r.b31_60),
        fmtMoneyUSD(r.b61_90),
        fmtMoneyUSD(r.b90_plus),
        fmtMoneyUSD(r.total),
        String(r.invoice_count || 0),
      ]),
      styles: { fontSize: 8 },
      margin: { left: 14, right: 14 },
      headStyles: { fillColor: [240, 240, 240], textColor: 20 },
      didParseCell: (hookData: any) => {
        if (hookData.section === "body" && hookData.column.index === 0) {
          hookData.cell.styles.textColor = [37, 99, 235];
          hookData.cell.styles.fontStyle = "bold";
        }
      },
      didDrawCell: (hookData: any) => {
        if (hookData.section === "body" && hookData.column.index === 0) {
          const text = String(hookData.cell.raw || "");
          if (!text || text === "—") return;
          const width = (doc as any).getTextWidth(text);
          const x = hookData.cell.x + 2;
          const yLine = hookData.cell.y + hookData.cell.height - 2.2;
          doc.setDrawColor(37, 99, 235);
          doc.setLineWidth(0.2);
          doc.line(x, yLine, x + width, yLine);
        }
      },
    });

    y = (doc as any).lastAutoTable.finalY + 8;

    autoTable(doc, {
      startY: y,
      head: [["Invoice", "Buyer", "Due Date", "Days", "Balance"]],
      body: (data?.top_overdue_invoices || []).map((r) => [
        r.invoice_no || "—",
        r.buyer_name || r.buyer_code || "—",
        r.due_date || "—",
        String(r.overdue_days),
        fmtMoneyUSD(r.balance_usd),
      ]),
      styles: { fontSize: 8 },
      margin: { left: 14, right: 14 },
      headStyles: { fillColor: [240, 240, 240], textColor: 20 },
      didParseCell: (hookData: any) => {
        if (hookData.section === "body" && hookData.column.index === 0) {
          hookData.cell.styles.textColor = [37, 99, 235];
          hookData.cell.styles.fontStyle = "bold";
        }
      },
      didDrawCell: (hookData: any) => {
        if (hookData.section === "body" && hookData.column.index === 0) {
          const text = String(hookData.cell.raw || "");
          if (!text || text === "—") return;
          const width = (doc as any).getTextWidth(text);
          const x = hookData.cell.x + 2;
          const yLine = hookData.cell.y + hookData.cell.height - 2.2;
          doc.setDrawColor(37, 99, 235);
          doc.setLineWidth(0.2);
          doc.line(x, yLine, x + width, yLine);
        }
      },
    });

    doc.save(`ar-aging-${new Date().toISOString().slice(0, 10)}.pdf`);
  }

  async function handleExportExcel() {
    if (!data) return;

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("AR Aging", { views: [{ state: "frozen", ySplit: 4 }] });
    const headerFill = "FF374151";
    const sectionFill = "FFF3F4F6";
    const border = { style: "thin", color: { argb: "FFD1D5DB" } } as const;
    const moneyFmt = '$#,##0;[Red]-$#,##0';

    sheet.columns = [
      { width: 28 }, { width: 14 }, { width: 14 }, { width: 14 },
      { width: 14 }, { width: 14 }, { width: 16 }, { width: 12 },
    ];

    sheet.mergeCells("A1:H1");
    sheet.getCell("A1").value = "A/R Aging";
    sheet.getCell("A1").font = { bold: true, size: 18, color: { argb: "FF111827" } };
    sheet.getRow(1).height = 26;
    sheet.mergeCells("A2:H2");
    sheet.getCell("A2").value = `Period: ${preset}${preset === "CUSTOM" ? ` (${start || ""} ~ ${end || ""})` : ""} | Group: ${groupBy === "buyer_code" ? "Buyer Code" : "Buyer"}`;
    sheet.getCell("A2").font = { size: 11, color: { argb: "FF334155" } };

    function styleHeader(row: ExcelJS.Row) {
      row.height = 22;
      row.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: headerFill } };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border = { top: border, left: border, bottom: border, right: border };
      });
    }

    function styleBody(row: ExcelJS.Row, moneyCols: number[] = []) {
      row.eachCell((cell, col) => {
        cell.border = { top: border, left: border, bottom: border, right: border };
        cell.alignment = { vertical: "middle", horizontal: moneyCols.includes(col) ? "right" : "left" };
        if (moneyCols.includes(col)) cell.numFmt = moneyFmt;
      });
    }

    function addSection(title: string) {
      const row = sheet.addRow([title]);
      sheet.mergeCells(row.number, 1, row.number, 8);
      row.getCell(1).font = { bold: true, size: 13, color: { argb: "FF111827" } };
      row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: sectionFill } };
      row.getCell(1).border = { top: border, left: border, bottom: border, right: border };
      sheet.addRow([]);
    }

    sheet.addRow([]);
    addSection("Summary");
    const summaryHeader = sheet.addRow(["Current", "1-30", "31-60", "61-90", "90+", "Total A/R", "Invoices"]);
    styleHeader(summaryHeader);
    const summaryRow = sheet.addRow([
      data.buckets.current,
      data.buckets.b1_30,
      data.buckets.b31_60,
      data.buckets.b61_90,
      data.buckets.b90_plus,
      data.buckets.total,
      data.buckets.invoice_count || 0,
    ]);
    styleBody(summaryRow, [1, 2, 3, 4, 5, 6]);

    sheet.addRow([]);
    addSection("A/R Aging by Buyer");
    const agingHeader = sheet.addRow([groupBy === "buyer_code" ? "Buyer Code" : "Buyer", "Current", "1-30", "31-60", "61-90", "90+", "Total", "Invoices"]);
    styleHeader(agingHeader);
    (data.rows || []).forEach((r) => {
      const row = sheet.addRow([
        groupBy === "buyer_code" ? (r.buyer_code || "—") : (r.buyer_name || r.buyer_code || "—"),
        r.current,
        r.b1_30,
        r.b31_60,
        r.b61_90,
        r.b90_plus,
        r.total,
        r.invoice_count || 0,
      ]);
      styleBody(row, [2, 3, 4, 5, 6, 7]);
    });

    sheet.addRow([]);
    addSection("Top Overdue Invoices");
    const overdueHeader = sheet.addRow(["Invoice", "Buyer", "Due Date", "Days", "Balance", "Invoice Date", "Term Days"]);
    styleHeader(overdueHeader);
    (data.top_overdue_invoices || []).forEach((r) => {
      const row = sheet.addRow([
        r.invoice_no || "—",
        r.buyer_name || r.buyer_code || "—",
        r.due_date || "—",
        r.overdue_days,
        r.balance_usd,
        r.invoice_date || "—",
        r.payment_term_days,
      ]);
      styleBody(row, [5]);
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `ar-aging-${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
  }

  const headerRight = (
    <div className="flex items-center gap-2">
      <Button variant="secondary" onClick={handleExportExcel} disabled={loading || !data}>
        Export Excel
      </Button>
      <Button variant="secondary" onClick={handleExportPdf} disabled={loading || !data}>
        Export PDF
      </Button>
      <Button
        variant="secondary"
        onClick={() => {
          if (preset === "CUSTOM") {
            const t = isoToday();
            syncUrl({ preset, start: start || t, end: end || t, groupBy });
          } else {
            syncUrl({ preset, start: "", end: "", groupBy });
          }
        }}
        disabled={loading}
      >
        Refresh
      </Button>
    </div>
  );

  return (
    <AppShell title="A/R Aging">
      <div className="space-y-4">
        <div className="flex items-center justify-end gap-2">{headerRight}</div>

        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Filters</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
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
                      syncUrl({ preset: next, start: "", end: "" });
                    } else {
                      const t = isoToday();
                      const nextStart = start || t;
                      const nextEnd = end || t;
                      setStart(nextStart);
                      setEnd(nextEnd);
                      syncUrl({ preset: next, start: nextStart, end: nextEnd });
                    }
                  }}
                >
                  <SelectTrigger className="rounded-xl"><SelectValue placeholder="Select" /></SelectTrigger>
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
                <Input className="rounded-xl" type="date" value={start} onChange={(e) => setStart(e.target.value)} disabled={preset !== "CUSTOM"} />
              </div>

              <div className="space-y-1">
                <Label>End</Label>
                <Input className="rounded-xl" type="date" value={end} onChange={(e) => setEnd(e.target.value)} disabled={preset !== "CUSTOM"} />
              </div>

              <div className="space-y-1">
                <Label>Group By</Label>
                <Select value={groupBy} onValueChange={(v) => { const next = v as GroupBy; setGroupBy(next); syncUrl({ groupBy: next }); }}>
                  <SelectTrigger className="rounded-xl"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="buyer">Buyer Name</SelectItem>
                    <SelectItem value="buyer_code">Buyer Code</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label>Currency</Label>
                <div className="h-10 flex items-center px-3 rounded-xl border text-sm text-muted-foreground">USD (fixed)</div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Buyers</Label>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant={allBuyers ? "default" : "outline"} className="rounded-xl" onClick={() => { setAllBuyers(true); setBuyerIds([]); syncUrl({ buyerIds: "ALL" }); }}>All Buyers</Button>
                    <Button size="sm" variant={!allBuyers ? "default" : "outline"} className="rounded-xl" onClick={() => { setAllBuyers(false); syncUrl({ buyerIds: buyerIds.length ? buyerIds : [] }); }}>Select</Button>
                  </div>
                </div>
                {!allBuyers && (
                  <div className="flex flex-wrap gap-2">
                    {buyerOptions.map((b) => {
                      const active = buyerIds.includes(b.id);
                      return (
                        <Button
                          key={b.id}
                          size="sm"
                          variant={active ? "default" : "outline"}
                          className="rounded-xl"
                          onClick={() => {
                            setBuyerIds((prev) => {
                              const next = prev.includes(b.id) ? prev.filter((x) => x !== b.id) : [...prev, b.id];
                              setTimeout(() => syncUrl({ buyerIds: next }), 0);
                              return next;
                            });
                          }}
                        >
                          {b.code || b.name}
                        </Button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Sites</Label>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant={allSites ? "default" : "outline"} className="rounded-xl" onClick={() => { setAllSites(true); setSiteIds([]); syncUrl({ siteIds: "ALL" }); }}>All Sites</Button>
                    <Button size="sm" variant={!allSites ? "default" : "outline"} className="rounded-xl" onClick={() => { setAllSites(false); syncUrl({ siteIds: siteIds.length ? siteIds : [] }); }}>Select</Button>
                  </div>
                </div>
                {!allSites && (
                  <div className="flex flex-wrap gap-2">
                    {siteOptions.map((s) => {
                      const active = siteIds.includes(s.id);
                      return (
                        <Button
                          key={s.id}
                          size="sm"
                          variant={active ? "default" : "outline"}
                          className="rounded-xl"
                          onClick={() => {
                            setSiteIds((prev) => {
                              const next = prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id];
                              setTimeout(() => syncUrl({ siteIds: next }), 0);
                              return next;
                            });
                          }}
                        >
                          {s.code || s.name}
                        </Button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <BucketCard title="Current" value={data?.buckets.current} tone="current" />
          <BucketCard title="1–30" value={data?.buckets.b1_30} tone="yellow" />
          <BucketCard title="31–60" value={data?.buckets.b31_60} tone="orange" />
          <BucketCard title="61–90" value={data?.buckets.b61_90} tone="red" />
          <BucketCard title="90+" value={data?.buckets.b90_plus} tone="red" />
          <BucketCard title="Total A/R" value={data?.buckets.total} tone="neutral" subtitle={`${data?.buckets.invoice_count || 0} invoices`} />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
          <Card className="rounded-2xl xl:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">A/R Aging by Buyer</CardTitle>
            </CardHeader>
            <CardContent>
              <AgingTable
                rows={data?.rows || []}
                loading={loading}
                groupBy={groupBy}
                selectedBuyerKey={selectedBuyer?.key}
                onSelectBuyer={(row) => setSelectedBuyer((prev) => (prev?.key === row.key ? null : row))}
              />
            </CardContent>
          </Card>

          <Card className="rounded-2xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Top Overdue Invoices</CardTitle>
            </CardHeader>
            <CardContent>
              <OverdueInvoiceTable rows={data?.top_overdue_invoices || []} loading={loading} onOpenInvoice={openInvoice} onOpenBuyer={openBuyerAging} />
            </CardContent>
          </Card>
        </div>

        {selectedBuyer ? (
          <Card className="rounded-2xl">
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">
                  Outstanding Invoices - {selectedBuyer.buyer_name || selectedBuyer.buyer_code || selectedBuyer.key}
                </CardTitle>
                <Button type="button" variant="secondary" onClick={() => setSelectedBuyer(null)}>
                  Close
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <BuyerInvoiceTable
                rows={(data?.outstanding_invoices || []).filter((r) => {
                  if (selectedBuyer.buyer_id && r.buyer_id) return r.buyer_id === selectedBuyer.buyer_id;
                  return normalizeBuyerKey(r.buyer_name || r.buyer_code) === normalizeBuyerKey(selectedBuyer.buyer_name || selectedBuyer.buyer_code);
                })}
                loading={loading}
                onOpenInvoice={openInvoice}
              />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </AppShell>
  );
}

function BucketCard({ title, value, tone, subtitle }: { title: string; value?: number; tone: "current" | "yellow" | "orange" | "red" | "neutral"; subtitle?: string; }) {
  const textClass =
    tone === "current"
      ? "text-blue-600"
      : tone === "yellow"
      ? "text-amber-600"
      : tone === "orange"
      ? "text-orange-600"
      : tone === "red"
      ? "text-red-600"
      : "text-slate-800";

  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-semibold ${textClass}`}>{fmtMoneyUSD(value)}</div>
        {subtitle ? <div className="mt-1 text-xs text-muted-foreground">{subtitle}</div> : null}
      </CardContent>
    </Card>
  );
}

function AgingTable({
  rows,
  loading,
  groupBy,
  selectedBuyerKey,
  onSelectBuyer,
}: {
  rows: AgingRow[];
  loading: boolean;
  groupBy: GroupBy;
  selectedBuyerKey?: string | null;
  onSelectBuyer?: (row: AgingRow) => void;
}) {
  if (loading) return <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!rows.length) return <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">No outstanding A/R found.</div>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/30">
            <th className="p-2 text-left">{groupBy === "buyer_code" ? "Buyer Code" : "Buyer"}</th>
            <th className="p-2 text-right text-blue-600">Current</th>
            <th className="p-2 text-right text-amber-600">1–30</th>
            <th className="p-2 text-right text-orange-600">31–60</th>
            <th className="p-2 text-right text-red-500">61–90</th>
            <th className="p-2 text-right text-red-700">90+</th>
            <th className="p-2 text-right">Total</th>
            <th className="p-2 text-right">Invoices</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={`border-b last:border-0 hover:bg-muted/20 ${selectedBuyerKey === r.key ? "bg-blue-50/70" : ""}`}>
              <td className="p-2">
                <button
                  type="button"
                  className="text-left"
                  onClick={() => onSelectBuyer?.(r)}
                  disabled={!r.buyer_id && !r.buyer_name && !r.buyer_code}
                >
                  <div className={`font-medium ${(r.buyer_id || r.buyer_name || r.buyer_code) ? "text-blue-600 hover:underline" : ""}`}>
                    {groupBy === "buyer_code" ? (r.buyer_code || "—") : (r.buyer_name || r.buyer_code || "—")}
                  </div>
                  {groupBy === "buyer_code" && r.buyer_name ? <div className="text-xs text-muted-foreground">{r.buyer_name}</div> : null}
                </button>
              </td>
              <td className={bucketCellClass(r.current, "current")}>{fmtMoneyUSD(r.current)}</td>
              <td className={bucketCellClass(r.b1_30, "yellow")}>{fmtMoneyUSD(r.b1_30)}</td>
              <td className={bucketCellClass(r.b31_60, "orange")}>{fmtMoneyUSD(r.b31_60)}</td>
              <td className={bucketCellClass(r.b61_90, "red")}>{fmtMoneyUSD(r.b61_90)}</td>
              <td className={bucketCellClass(r.b90_plus, "red")}>{fmtMoneyUSD(r.b90_plus)}</td>
              <td className="p-2 text-right font-semibold">{fmtMoneyUSD(r.total)}</td>
              <td className="p-2 text-right">{r.invoice_count.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BuyerInvoiceTable({
  rows,
  loading,
  onOpenInvoice,
}: {
  rows: OverdueInvoiceRow[];
  loading: boolean;
  onOpenInvoice?: (invoiceId?: string | null, invoiceNo?: string | null) => void;
}) {
  if (loading) return <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">Loading...</div>;
  if (!rows.length) return <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">No outstanding invoices.</div>;

  const sorted = [...rows].sort((a, b) => {
    const overdue = (b.overdue_days || 0) - (a.overdue_days || 0);
    return overdue || (b.balance_usd || 0) - (a.balance_usd || 0);
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/30">
            <th className="p-2 text-left">Invoice</th>
            <th className="p-2 text-left">Invoice Date</th>
            <th className="p-2 text-left">Due Date</th>
            <th className="p-2 text-right">Term</th>
            <th className="p-2 text-right">Days</th>
            <th className="p-2 text-right">Balance</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, idx) => (
            <tr key={`${r.invoice_id || r.invoice_no || "row"}-${idx}`} className="border-b last:border-0 hover:bg-muted/20">
              <td className="p-2">
                {r.invoice_no ? (
                  <button
                    type="button"
                    className="font-medium text-blue-600 hover:underline"
                    onClick={() => onOpenInvoice?.(r.invoice_id, r.invoice_no)}
                  >
                    {r.invoice_no}
                  </button>
                ) : (
                  <span className="font-medium">-</span>
                )}
              </td>
              <td className="p-2">{r.invoice_date || "-"}</td>
              <td className="p-2">{r.due_date || "-"}</td>
              <td className="p-2 text-right">{r.payment_term_days ? `${r.payment_term_days}d` : "-"}</td>
              <td className="p-2 text-right">
                <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-medium ${riskBadge(r.overdue_days)}`}>
                  {r.overdue_days > 0 ? `+${r.overdue_days}` : r.overdue_days}
                </span>
              </td>
              <td className="p-2 text-right font-semibold">{fmtMoneyUSD(r.balance_usd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OverdueInvoiceTable({
  rows,
  loading,
  onOpenInvoice,
  onOpenBuyer,
}: {
  rows: OverdueInvoiceRow[];
  loading: boolean;
  onOpenInvoice?: (invoiceId?: string | null, invoiceNo?: string | null) => void;
  onOpenBuyer?: (name?: string | null, code?: string | null, buyerId?: string | null) => void;
}) {
  if (loading) return <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!rows.length) return <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">No overdue invoices.</div>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/30">
            <th className="p-2 text-left">Invoice</th>
            <th className="p-2 text-left">Buyer</th>
            <th className="p-2 text-left">Days</th>
            <th className="p-2 text-right">Balance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr key={`${r.invoice_no || "row"}-${idx}`} className="border-b last:border-0 hover:bg-muted/20">
              <td className="p-2">
                {r.invoice_no ? (
                  <button
                    type="button"
                    className="font-medium text-blue-600 hover:underline"
                    onClick={() => onOpenInvoice?.(r.invoice_id, r.invoice_no)}
                  >
                    {r.invoice_no}
                  </button>
                ) : (
                  <div className="font-medium">—</div>
                )}
                <div className="text-xs text-muted-foreground">Due {r.due_date || "—"}</div>
              </td>
              <td className="p-2">
                <button
                  type="button"
                  className="text-left"
                  onClick={() => onOpenBuyer?.(r.buyer_name, r.buyer_code)}
                >
                  <div className="text-blue-600 hover:underline">{r.buyer_name || r.buyer_code || "—"}</div>
                </button>
                <div className="text-xs text-muted-foreground">Term {r.payment_term_days}d</div>
              </td>
              <td className="p-2">
                <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-medium ${riskBadge(r.overdue_days)}`}>
                  +{r.overdue_days}
                </span>
              </td>
              <td className="p-2 text-right font-medium">{fmtMoneyUSD(r.balance_usd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
