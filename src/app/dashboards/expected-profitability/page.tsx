"use client";

import * as React from "react";
import AppShell from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import ExcelJS from "exceljs";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { CalendarDays } from "lucide-react";

function fmtMoney(v: any) {
  const n = Number(v ?? 0);
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtQty(v: any) {
  const n = Number(v ?? 0);
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function fmtPct(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  return `${(n * 100).toFixed(2)}%`;
}

function fmtInt(v: any) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 0 }) : "0";
}

function marginTone(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "secondary" as const;
  if (n < 0) return "destructive" as const;
  if (n < 0.2) return "secondary" as const;
  return "default" as const;
}

type Row = {
  po_line_id: string;
  po_no: string | null;
  buyer_id?: string | null;
  buyer_name: string | null;
  buyer_brand_name: string | null;
  jm_style_no: string | null;
  buyer_style_no: string | null;
  description: string | null;
  qty: number;
  unit_price_usd: number;
  revenue_usd: number;
  planned_unit_cost: number;
  optional_unit_cost: number;
  total_unit_cost: number;
  expected_cogs: number;
  expected_margin: number;
  margin_pct: number | null;
  has_planned_cost: boolean;
  source_cost_currency?: string | null;
  source_fx_rate_to_usd?: number | null;
};

type BuyerOption = {
  id: string;
  name: string;
};

type ExtraCostRow = {
  id?: string;
  cost_name: string;
  unit_cost: number;
  enabled: boolean;
  sort_order: number;
  remark?: string | null;
};

export default function ExpectedProfitabilityPage() {
  const [loading, setLoading] = React.useState(false);
  const [rows, setRows] = React.useState<Row[]>([]);
  const [buyers, setBuyers] = React.useState<BuyerOption[]>([]);
  const [summary, setSummary] = React.useState<any>(null);
  const [q, setQ] = React.useState("");
  const [brand, setBrand] = React.useState("");
  const [buyerId, setBuyerId] = React.useState("ALL");
  const [start, setStart] = React.useState("");
  const [end, setEnd] = React.useState("");
  const [marginMin, setMarginMin] = React.useState("");
  const [marginMax, setMarginMax] = React.useState("");
  const [missingOnly, setMissingOnly] = React.useState(false);

  const [editing, setEditing] = React.useState<Row | null>(null);
  const [extraRows, setExtraRows] = React.useState<ExtraCostRow[]>([]);
  const [savingExtra, setSavingExtra] = React.useState(false);
  const startDateRef = React.useRef<HTMLInputElement>(null);
  const endDateRef = React.useRef<HTMLInputElement>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (q.trim()) sp.set("q", q.trim());
      if (brand.trim()) sp.set("brand", brand.trim());
      if (buyerId !== "ALL") sp.set("buyer_id", buyerId);
      if (start) sp.set("start", start);
      if (end) sp.set("end", end);
      if (marginMin.trim()) sp.set("margin_min", marginMin.trim());
      if (marginMax.trim()) sp.set("margin_max", marginMax.trim());
      if (missingOnly) sp.set("missing_only", "true");

      const res = await fetch(`/api/dashboards/expected-profitability?${sp.toString()}`, {
        cache: "no-store",
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.success) throw new Error(j?.error || "Failed to load");
      setRows(Array.isArray(j.rows) ? j.rows : []);
      setSummary(j.summary ?? null);
      setBuyers(Array.isArray(j.buyers) ? j.buyers : []);
    } catch (e: any) {
      toast.error("Load failed", { description: e?.message ?? "Server error" });
    } finally {
      setLoading(false);
    }
  }, [q, brand, buyerId, start, end, marginMin, marginMax, missingOnly]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function openEditor(row: Row) {
    try {
      setEditing(row);
      const res = await fetch(`/api/po-lines/${row.po_line_id}/extra-costs`, { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.success) throw new Error(j?.error || "Failed to load extra costs");
      setExtraRows(Array.isArray(j.rows) ? j.rows : []);
    } catch (e: any) {
      toast.error("Failed to open extra costs", { description: e?.message ?? "Server error" });
    }
  }

  async function saveExtraCosts() {
    if (!editing) return;
    setSavingExtra(true);
    try {
      const res = await fetch(`/api/po-lines/${editing.po_line_id}/extra-costs`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: extraRows }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.success) throw new Error(j?.error || "Failed to save");
      toast.success("Extra costs saved");
      setExtraRows(Array.isArray(j.rows) ? j.rows : []);
      await load();
      setEditing(null);
    } catch (e: any) {
      toast.error("Save failed", { description: e?.message ?? "Server error" });
    } finally {
      setSavingExtra(false);
    }
  }

  const extraUnitCost = React.useMemo(
    () => extraRows.reduce((acc, r) => acc + (r.enabled ? Number(r.unit_cost || 0) : 0), 0),
    [extraRows]
  );

  function exportFilterText() {
    const buyerName = buyers.find((b) => b.id === buyerId)?.name;
    const parts = [
      q.trim() ? `Search: ${q.trim()}` : "",
      buyerId !== "ALL" ? `Buyer: ${buyerName || buyerId}` : "",
      brand.trim() ? `Brand: ${brand.trim()}` : "",
      start ? `Order Start: ${start}` : "",
      end ? `Order End: ${end}` : "",
      marginMin.trim() ? `Min Margin: ${marginMin.trim()}%` : "",
      marginMax.trim() ? `Max Margin: ${marginMax.trim()}%` : "",
      missingOnly ? "Missing planned cost only" : "",
    ].filter(Boolean);
    return parts.length ? parts.join(" | ") : "All records";
  }

  function plannedCostSource(row: Row) {
    if (!row.has_planned_cost) return "No Cost";
    const currency = row.source_cost_currency || "USD";
    const fx = Number(row.source_fx_rate_to_usd ?? 1);
    return Number.isFinite(fx) && fx !== 1 ? `${currency} to USD @ ${fx.toFixed(4)}` : currency;
  }

  function openDatePicker(ref: React.RefObject<HTMLInputElement>) {
    const input = ref.current;
    if (!input) return;
    input.focus();
    (input as HTMLInputElement & { showPicker?: () => void }).showPicker?.();
  }

  async function handleExportExcel() {
    if (rows.length === 0) {
      toast.info("No data to export");
      return;
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "JM ERP";
    workbook.created = new Date();
    const sheet = workbook.addWorksheet("Expected Margin", {
      views: [{ state: "frozen", ySplit: 7 }],
    });

    const charcoal = "FF374151";
    const pale = "FFF3F4F6";
    const borderColor = "FFD1D5DB";
    const border = { style: "thin", color: { argb: borderColor } } as const;

    sheet.mergeCells("A1:P1");
    sheet.getCell("A1").value = "Expected Margin";
    sheet.getCell("A1").font = { bold: true, size: 18, color: { argb: "FF111827" } };
    sheet.getCell("A1").alignment = { vertical: "middle" };
    sheet.getRow(1).height = 28;

    sheet.mergeCells("A2:P2");
    sheet.getCell("A2").value = `Filters: ${exportFilterText()}`;
    sheet.getCell("A2").font = { color: { argb: "FF4B5563" } };

    const summaryHeader = sheet.addRow([
      "Expected Revenue",
      "Expected COGS",
      "Expected Margin",
      "Avg Margin %",
      "Missing Cost Lines",
      "Rows",
    ]);
    summaryHeader.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: pale } };
      cell.font = { bold: true, color: { argb: "FF111827" } };
      cell.border = { top: border, left: border, bottom: border, right: border };
      cell.alignment = { horizontal: "center" };
    });

    const summaryRow = sheet.addRow([
      Number(summary?.revenue_usd ?? 0),
      Number(summary?.expected_cogs ?? 0),
      Number(summary?.expected_margin ?? 0),
      Number(summary?.margin_pct ?? 0),
      Number(summary?.missing_count ?? 0),
      rows.length,
    ]);
    summaryRow.eachCell((cell, colNumber) => {
      cell.border = { top: border, left: border, bottom: border, right: border };
      cell.alignment = { horizontal: "right" };
      if (colNumber <= 3) cell.numFmt = '$#,##0.00;[Red]-$#,##0.00';
      if (colNumber === 4) cell.numFmt = "0.00%";
      if (colNumber >= 5) cell.numFmt = "#,##0";
    });

    sheet.addRow([]);
    const headerRow = sheet.addRow([
      "PO",
      "Buyer",
      "Brand",
      "JM Style",
      "Buyer Style",
      "Qty",
      "Unit Price (USD)",
      "Revenue (USD)",
      "Planned Unit (USD)",
      "Planned Cost Source",
      "Optional Unit (USD)",
      "Total Unit (USD)",
      "Expected COGS (USD)",
      "Expected Margin (USD)",
      "Margin %",
      "Missing Planned Cost",
    ]);

    headerRow.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: charcoal } };
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.border = { top: border, left: border, bottom: border, right: border };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    });

    for (const row of rows) {
      const excelRow = sheet.addRow([
        row.po_no || "-",
        row.buyer_name || "-",
        row.buyer_brand_name || "-",
        row.jm_style_no || "-",
        row.buyer_style_no || "-",
        Number(row.qty ?? 0),
        Number(row.unit_price_usd ?? 0),
        Number(row.revenue_usd ?? 0),
        row.has_planned_cost ? Number(row.planned_unit_cost ?? 0) : "",
        plannedCostSource(row),
        Number(row.optional_unit_cost ?? 0),
        Number(row.total_unit_cost ?? 0),
        Number(row.expected_cogs ?? 0),
        Number(row.expected_margin ?? 0),
        row.has_planned_cost && row.margin_pct !== null ? Number(row.margin_pct) : "",
        row.has_planned_cost ? "No" : "Yes",
      ]);

      excelRow.eachCell((cell, colNumber) => {
        cell.border = { top: border, left: border, bottom: border, right: border };
        cell.alignment = { vertical: "middle", wrapText: true };
        if ([6, 7, 8, 9, 11, 12, 13, 14, 15].includes(colNumber)) {
          cell.alignment = { horizontal: "right", vertical: "middle" };
        }
        if (colNumber === 6) cell.numFmt = "#,##0.##";
        if ([7, 8, 9, 11, 12, 13, 14].includes(colNumber)) cell.numFmt = '$#,##0.00;[Red]-$#,##0.00';
        if (colNumber === 15) cell.numFmt = "0.00%";
        if (colNumber === 16 && cell.value === "Yes") {
          cell.font = { color: { argb: "FFB91C1C" }, bold: true };
        }
      });
    }

    sheet.columns = [
      { width: 15 }, { width: 24 }, { width: 18 }, { width: 16 }, { width: 18 }, { width: 12 },
      { width: 16 }, { width: 16 }, { width: 18 }, { width: 24 }, { width: 17 }, { width: 16 },
      { width: 18 }, { width: 19 }, { width: 13 }, { width: 18 },
    ];
    sheet.autoFilter = { from: "A6", to: "P6" };

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `expected-margin-${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleExportPdf() {
    if (rows.length === 0) {
      toast.info("No data to export");
      return;
    }

    const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
    doc.setFontSize(18);
    doc.text("Expected Margin", 40, 40);
    doc.setFontSize(9);
    doc.text(`Filters: ${exportFilterText()}`, 40, 58, { maxWidth: 760 });

    autoTable(doc, {
      startY: 76,
      head: [["Expected Revenue", "Expected COGS", "Expected Margin", "Avg Margin %", "Missing Cost Lines", "Rows"]],
      body: [[
        `$${fmtMoney(summary?.revenue_usd)}`,
        `$${fmtMoney(summary?.expected_cogs)}`,
        `$${fmtMoney(summary?.expected_margin)}`,
        fmtPct(summary?.margin_pct),
        fmtInt(summary?.missing_count),
        fmtInt(rows.length),
      ]],
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [243, 244, 246], textColor: [17, 24, 39], lineColor: [209, 213, 219] },
      bodyStyles: { lineColor: [209, 213, 219] },
    });

    autoTable(doc, {
      startY: (doc as any).lastAutoTable.finalY + 18,
      head: [[
        "PO",
        "Buyer",
        "Brand",
        "Style",
        "Qty",
        "Revenue",
        "Planned Unit",
        "Optional Unit",
        "Total Unit",
        "Expected Margin",
        "Margin %",
        "Missing",
      ]],
      body: rows.map((row) => [
        row.po_no || "-",
        row.buyer_name || "-",
        row.buyer_brand_name || "-",
        row.jm_style_no || row.buyer_style_no || "-",
        fmtQty(row.qty),
        `$${fmtMoney(row.revenue_usd)}`,
        row.has_planned_cost ? `$${fmtMoney(row.planned_unit_cost)}` : "No Cost",
        `$${fmtMoney(row.optional_unit_cost)}`,
        `$${fmtMoney(row.total_unit_cost)}`,
        `$${fmtMoney(row.expected_margin)}`,
        row.has_planned_cost ? fmtPct(row.margin_pct) : "No Cost",
        row.has_planned_cost ? "No" : "Yes",
      ]),
      theme: "grid",
      styles: { fontSize: 7, cellPadding: 3, overflow: "linebreak" },
      headStyles: { fillColor: [55, 65, 81], textColor: [255, 255, 255], lineColor: [209, 213, 219] },
      bodyStyles: { lineColor: [209, 213, 219] },
      columnStyles: {
        4: { halign: "right" },
        5: { halign: "right" },
        6: { halign: "right" },
        7: { halign: "right" },
        8: { halign: "right" },
        9: { halign: "right" },
        10: { halign: "right" },
      },
    });

    doc.save(`expected-margin-${new Date().toISOString().slice(0, 10)}.pdf`);
  }

  return (
    <AppShell title="Expected Margin">
      <div className="mx-auto w-full max-w-[1500px] space-y-4 p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Card>
            <CardHeader><CardTitle className="text-sm">Expected Revenue</CardTitle></CardHeader>
            <CardContent className="text-2xl font-semibold">{fmtMoney(summary?.revenue_usd)}</CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">Expected COGS</CardTitle></CardHeader>
            <CardContent className="text-2xl font-semibold">{fmtMoney(summary?.expected_cogs)}</CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">Expected Margin</CardTitle></CardHeader>
            <CardContent className="text-2xl font-semibold">{fmtMoney(summary?.expected_margin)}</CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">Avg Margin %</CardTitle></CardHeader>
            <CardContent className="text-2xl font-semibold">{fmtPct(summary?.margin_pct)}</CardContent>
          </Card>
          <Card className={(summary?.missing_count ?? 0) > 0 ? "border-amber-300 bg-amber-50/40" : ""}>
            <CardHeader><CardTitle className="text-sm">Missing Cost Lines</CardTitle></CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">{fmtInt(summary?.missing_count)}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Planned unit cost not entered yet
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle>Filters</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-4 xl:grid-cols-8">
            <div>
              <Label>Search</Label>
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="PO / Style / Buyer" />
            </div>
            <div>
              <Label>Buyer</Label>
              <Select value={buyerId} onValueChange={setBuyerId}>
                <SelectTrigger>
                  <SelectValue placeholder="All Buyers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Buyers</SelectItem>
                  {buyers.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Brand</Label>
              <Input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Brand" />
            </div>
            <div>
              <Label>Order Start</Label>
              <div className="relative">
                <Input
                  ref={startDateRef}
                  className="cursor-pointer pr-10"
                  type="date"
                  value={start}
                  onClick={() => openDatePicker(startDateRef)}
                  onChange={(e) => setStart(e.target.value)}
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-2 flex items-center text-slate-500 hover:text-slate-900"
                  onClick={() => openDatePicker(startDateRef)}
                  aria-label="Open order start calendar"
                >
                  <CalendarDays className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div>
              <Label>Order End</Label>
              <div className="relative">
                <Input
                  ref={endDateRef}
                  className="cursor-pointer pr-10"
                  type="date"
                  value={end}
                  onClick={() => openDatePicker(endDateRef)}
                  onChange={(e) => setEnd(e.target.value)}
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-2 flex items-center text-slate-500 hover:text-slate-900"
                  onClick={() => openDatePicker(endDateRef)}
                  aria-label="Open order end calendar"
                >
                  <CalendarDays className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div>
              <Label>Min Margin %</Label>
              <Input value={marginMin} onChange={(e) => setMarginMin(e.target.value)} placeholder="e.g. 20" />
            </div>
            <div>
              <Label>Max Margin %</Label>
              <Input value={marginMax} onChange={(e) => setMarginMax(e.target.value)} placeholder="e.g. 60" />
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => setMissingOnly((v) => !v)}
                className={[
                  "flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition",
                  missingOnly
                    ? "border-amber-400 bg-amber-50 text-amber-900"
                    : "border-slate-200 bg-white hover:bg-slate-50",
                ].join(" ")}
              >
                <Checkbox
                  checked={missingOnly}
                  onCheckedChange={(v) => setMissingOnly(Boolean(v))}
                />
                <div className="leading-tight">
                  <div className="text-sm font-medium">Missing planned cost only</div>
                  <div className="text-[11px] text-muted-foreground">
                    Show only lines with no planned unit cost
                  </div>
                </div>
              </button>
            </div>

            <div className="xl:col-span-8 flex gap-2">
              <Button onClick={() => void load()} disabled={loading}>{loading ? "Loading..." : "Search"}</Button>
              <Button variant="outline" onClick={() => void handleExportExcel()} disabled={loading || rows.length === 0}>
                Export Excel
              </Button>
              <Button variant="outline" onClick={handleExportPdf} disabled={loading || rows.length === 0}>
                Export PDF
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Expected Margin by Order Line</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO</TableHead>
                  <TableHead>Buyer</TableHead>
                  <TableHead>Style</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit Price</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Planned Unit (USD)</TableHead>
                  <TableHead className="text-right">Optional Unit</TableHead>
                  <TableHead className="text-right">Total Unit</TableHead>
                  <TableHead className="text-right">Expected Margin</TableHead>
                  <TableHead className="text-right">Margin %</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={12} className="py-8 text-center text-sm text-muted-foreground">
                      No data found.
                    </TableCell>
                  </TableRow>
                ) : rows.map((r) => (
                  <TableRow key={r.po_line_id}>
                    <TableCell>{r.po_no || "-"}</TableCell>
                    <TableCell>
                      <div>{r.buyer_name || "-"}</div>
                      <div className="text-xs text-muted-foreground">{r.buyer_brand_name || "-"}</div>
                    </TableCell>
                    <TableCell>
                      <div>{r.jm_style_no || "-"}</div>
                      <div className="text-xs text-muted-foreground">{r.buyer_style_no || "-"}</div>
                    </TableCell>
                    <TableCell className="text-right">{fmtQty(r.qty)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(r.unit_price_usd)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(r.revenue_usd)}</TableCell>
                    <TableCell className="text-right">
                      {r.has_planned_cost ? (
                        <div>
                          <div>{fmtMoney(r.planned_unit_cost)}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {r.source_cost_currency || "USD"}
                            {Number(r.source_fx_rate_to_usd ?? 1) !== 1 ? ` → USD @ ${Number(r.source_fx_rate_to_usd).toFixed(4)}` : ""}
                          </div>
                        </div>
                      ) : (
                        <span className="text-red-600">No Cost</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{fmtMoney(r.optional_unit_cost)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(r.total_unit_cost)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(r.expected_margin)}</TableCell>
                    <TableCell className="text-right">
                      {r.has_planned_cost ? <Badge variant={marginTone(r.margin_pct)}>{fmtPct(r.margin_pct)}</Badge> : <Badge variant="secondary">No Cost</Badge>}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" onClick={() => void openEditor(r)}>Extra Costs</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Extra Costs {editing?.po_no ? `- ${editing.po_no}` : ""}</DialogTitle>
            </DialogHeader>

            <div className="space-y-3">
              {extraRows.map((row, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-4">
                    <Input
                      value={row.cost_name}
                      onChange={(e) => {
                        const next = [...extraRows];
                        next[idx] = { ...next[idx], cost_name: e.target.value };
                        setExtraRows(next);
                      }}
                      placeholder="Cost name"
                    />
                  </div>
                  <div className="col-span-3">
                    <Input
                      type="number"
                      step="0.0001"
                      value={row.unit_cost}
                      onChange={(e) => {
                        const next = [...extraRows];
                        next[idx] = { ...next[idx], unit_cost: Number(e.target.value || 0) };
                        setExtraRows(next);
                      }}
                      placeholder="Unit cost"
                    />
                  </div>
                  <div className="col-span-3">
                    <Input
                      value={row.remark ?? ""}
                      onChange={(e) => {
                        const next = [...extraRows];
                        next[idx] = { ...next[idx], remark: e.target.value };
                        setExtraRows(next);
                      }}
                      placeholder="Remark"
                    />
                  </div>
                  <div className="col-span-1 flex justify-center">
                    <Checkbox
                      checked={!!row.enabled}
                      onCheckedChange={(v) => {
                        const next = [...extraRows];
                        next[idx] = { ...next[idx], enabled: Boolean(v) };
                        setExtraRows(next);
                      }}
                    />
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <Button
                      variant="ghost"
                      onClick={() => setExtraRows(extraRows.filter((_, i) => i !== idx))}
                    >
                      Del
                    </Button>
                  </div>
                </div>
              ))}

              <div className="flex items-center justify-between pt-2">
                <div className="text-sm text-muted-foreground">
                  Optional Unit Total: <span className="font-medium text-foreground">{fmtMoney(extraUnitCost)}</span>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setExtraRows([...extraRows, { cost_name: "", unit_cost: 0, enabled: true, sort_order: extraRows.length + 1, remark: "" }])}
                  >
                    Add Row
                  </Button>
                  <Button onClick={() => void saveExtraCosts()} disabled={savingExtra}>
                    {savingExtra ? "Saving..." : "Save"}
                  </Button>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
