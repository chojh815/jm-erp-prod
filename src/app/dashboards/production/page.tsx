"use client";

import * as React from "react";
import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import ExcelJS from "exceljs";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { useUnicodePdfFont } from "@/lib/pdfUnicodeFont";

type BuyerOption = { id: string; code: string; name: string };

type Row = {
  po_line_id: string;
  po_header_id: string | null;
  po_no: string | null;
  buyer_id: string | null;
  buyer_name: string | null;
  brand: string | null;
  ship_mode: string | null;
  courier_carrier?: string | null;
  order_date?: string | null;
  requested_ship_date?: string | null;
  status?: string | null;
  style_no?: string | null;
  qty?: number | null;
  unit_price_usd?: number | null;
  vendor_id?: string | null;
  vendor_name?: string | null;
  unit_cost_usd?: number | null;
  work_sheet_id?: string | null;
  work_sheet_status?: string | null;
  ready_to_ship?: boolean;
};

type ProductionStatusResponse = {
  success?: boolean;
  rows?: Row[];
  error?: string;
};

type BuyerOptionsResponse = {
  items?: BuyerOption[];
};

type OverviewKpi = {
  key: string;
  value_usd?: number | null;
  sub_value?: string | null;
};

type OverviewResponse = {
  kpis?: OverviewKpi[];
};

type ScopeKey = "all" | "in_production" | "ready" | "overdue" | "no_ws";

type VendorSummary = {
  vendor: string;
  poCount: number;
  lineCount: number;
  amountUsd: number;
  overdueCount: number;
  readyCount: number;
  noWsCount: number;
};

function todayIso() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDays(isoDate: string, days: number) {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function n(v: unknown) {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}

function fmtMoney(v: number) {
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function fmtQty(v: number) {
  return v.toLocaleString("en-US");
}

function fmtDate(v?: string | null) {
  return v ? v.slice(0, 10) : "-";
}

function exportDate() {
  return todayIso();
}

function delayDays(v?: string | null, today = todayIso()) {
  if (!v) return null;
  const ms = new Date(`${today}T00:00:00`).getTime() - new Date(`${v.slice(0, 10)}T00:00:00`).getTime();
  return Math.floor(ms / 86400000);
}

function amountOf(row: Row) {
  return n(row.qty) * n(row.unit_price_usd);
}

function isClosedStatus(status?: string | null) {
  const s = String(status ?? "").trim().toUpperCase();
  return ["SHIPPED", "CLOSED", "COMPLETED", "CANCELLED", "CANCELED"].includes(s);
}

function matchesSearch(row: Row, q: string) {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const hay = [
    row.po_no,
    row.buyer_name,
    row.brand,
    row.style_no,
    row.vendor_name,
    row.status,
    row.requested_ship_date,
  ]
    .map((v) => String(v ?? "").toLowerCase())
    .join(" | ");
  return hay.includes(needle);
}

function KpiCard({
  title,
  value,
  sub,
  tone = "default",
}: {
  title: string;
  value: string;
  sub: string;
  tone?: "default" | "warn" | "danger";
}) {
  const toneClass =
    tone === "danger"
      ? "border-rose-200 bg-rose-50/60"
      : tone === "warn"
      ? "border-amber-200 bg-amber-50/60"
      : "";

  return (
    <Card className={toneClass}>
      <CardContent className="flex min-h-[120px] flex-col justify-between p-5">
        <div className="text-sm font-medium text-slate-500">{title}</div>
        <div className="text-3xl font-semibold tracking-tight text-slate-900">{value}</div>
        <div className="text-xs text-slate-500">{sub}</div>
      </CardContent>
    </Card>
  );
}

function RowActions({ row }: { row: Row }) {
  return (
    <div className="flex gap-2">
      {row.po_no ? (
        <Button asChild size="sm" variant="outline">
          <Link href={`/po/${encodeURIComponent(row.po_no)}/samples`} target="_blank">
            PO
          </Link>
        </Button>
      ) : null}
      {row.work_sheet_id ? (
        <Button asChild size="sm">
          <Link href={`/work-sheets/${row.work_sheet_id}`} target="_blank">
            WS
          </Link>
        </Button>
      ) : (
        <Button size="sm" variant="outline" disabled>
          No WS
        </Button>
      )}
    </div>
  );
}

function ProductionTable({
  rows,
  emptyText,
  showDelay = false,
}: {
  rows: Row[];
  emptyText: string;
  showDelay?: boolean;
}) {
  const today = todayIso();

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] text-sm">
        <thead>
          <tr className="border-b bg-slate-50 text-slate-700">
            <th className="p-3 text-left font-semibold">PO</th>
            <th className="p-3 text-left font-semibold">Buyer</th>
            <th className="p-3 text-left font-semibold">Vendor</th>
            <th className="p-3 text-left font-semibold">Style</th>
            <th className="p-3 text-center font-semibold">Req Ship</th>
            {showDelay ? <th className="p-3 text-center font-semibold">Delay</th> : null}
            <th className="p-3 text-center font-semibold">Ship Mode</th>
            <th className="p-3 text-right font-semibold">Qty</th>
            <th className="p-3 text-right font-semibold">Amount</th>
            <th className="p-3 text-center font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={showDelay ? 10 : 9}
                className="p-8 text-center text-sm text-slate-500"
              >
                {emptyText}
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const delay = delayDays(row.requested_ship_date, today);
              return (
                <tr key={row.po_line_id} className="border-b">
                  <td className="p-3 font-medium text-slate-900">{row.po_no || "-"}</td>
                  <td className="p-3">{row.buyer_name || "-"}</td>
                  <td className="p-3">{row.vendor_name || "In-house"}</td>
                  <td className="p-3">{row.style_no || "-"}</td>
                  <td className="p-3 text-center">{fmtDate(row.requested_ship_date)}</td>
                  {showDelay ? (
                    <td className="p-3 text-center">
                      {delay !== null && delay > 0 ? (
                        <span className="rounded-full bg-rose-100 px-2 py-1 text-xs font-medium text-rose-700">
                          {delay}d
                        </span>
                      ) : (
                        "-"
                      )}
                    </td>
                  ) : null}
                  <td className="p-3 text-center">{row.ship_mode || "-"}</td>
                  <td className="p-3 text-right">{fmtQty(n(row.qty))}</td>
                  <td className="p-3 text-right">{fmtMoney(amountOf(row))}</td>
                  <td className="p-3 text-center">
                    <RowActions row={row} />
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function ProductionDashboardPage() {
  const [allRows, setAllRows] = React.useState<Row[]>([]);
  const [buyers, setBuyers] = React.useState<BuyerOption[]>([]);
  const [overviewKpis, setOverviewKpis] = React.useState<Record<string, OverviewKpi>>({});
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [query, setQuery] = React.useState("");
  const [buyerId, setBuyerId] = React.useState("ALL");
  const [vendor, setVendor] = React.useState("ALL");
  const [shipMode, setShipMode] = React.useState("ALL");
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");
  const [scope, setScope] = React.useState<ScopeKey>("all");

  React.useEffect(() => {
    let dead = false;

    const load = async () => {
      try {
        setLoading(true);
        setError(null);

        const overviewUrl = new URL("/api/dashboards/overview", window.location.origin);
        overviewUrl.searchParams.set("preset", dateFrom || dateTo ? "CUSTOM" : "CUSTOM");
        overviewUrl.searchParams.set("start", dateFrom || "1970-01-01");
        overviewUrl.searchParams.set("end", dateTo || todayIso());
        overviewUrl.searchParams.set("buyerIds", buyerId);
        overviewUrl.searchParams.set("siteIds", "ALL");

        const [rowsRes, buyersRes] = await Promise.all([
          fetch("/api/production/status/list", { cache: "no-store" }),
          fetch("/api/dashboards/options/buyers", { cache: "no-store" }),
        ]);
        const overviewRes = await fetch(overviewUrl.toString(), { cache: "no-store" });

        const rowsJson = (await rowsRes.json()) as ProductionStatusResponse;
        const buyersJson = (await buyersRes.json().catch(() => ({ items: [] }))) as BuyerOptionsResponse;
        const overviewJson = (await overviewRes.json().catch(() => ({ kpis: [] }))) as OverviewResponse;

        if (dead) return;

        if (!rowsRes.ok || !rowsJson?.success) {
          throw new Error(rowsJson?.error || `Failed to load production rows (${rowsRes.status})`);
        }

        setAllRows(Array.isArray(rowsJson.rows) ? rowsJson.rows : []);
        setBuyers(Array.isArray(buyersJson.items) ? buyersJson.items : []);
        setOverviewKpis(
          Object.fromEntries(
            (Array.isArray(overviewJson.kpis) ? overviewJson.kpis : [])
              .filter((kpi) => !!kpi?.key)
              .map((kpi) => [kpi.key, kpi])
          )
        );
      } catch (e: any) {
        if (!dead) setError(e?.message || "Failed to load production dashboard.");
      } finally {
        if (!dead) setLoading(false);
      }
    };

    void load();
    return () => {
      dead = true;
    };
  }, [buyerId, dateFrom, dateTo]);

  const vendorOptions = React.useMemo(() => {
    const set = new Set<string>();
    allRows.forEach((row) => {
      const key = String(row.vendor_name || "In-house").trim();
      if (key) set.add(key);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [allRows]);

  const shipModeOptions = React.useMemo(() => {
    const set = new Set<string>();
    allRows.forEach((row) => {
      const key = String(row.ship_mode || "").trim().toUpperCase();
      if (key) set.add(key);
    });
    return Array.from(set).sort();
  }, [allRows]);

  const today = todayIso();

  const filteredRows = React.useMemo(() => {
    return allRows
      .filter((row) => !isClosedStatus(row.status))
      .filter((row) => matchesSearch(row, query))
      .filter((row) => (buyerId === "ALL" ? true : row.buyer_id === buyerId))
      .filter((row) => (vendor === "ALL" ? true : (row.vendor_name || "In-house") === vendor))
      .filter((row) => (shipMode === "ALL" ? true : (row.ship_mode || "").toUpperCase() === shipMode))
      .filter((row) => (dateFrom ? !!row.requested_ship_date && row.requested_ship_date >= dateFrom : true))
      .filter((row) => (dateTo ? !!row.requested_ship_date && row.requested_ship_date <= dateTo : true));
  }, [allRows, query, buyerId, vendor, shipMode, dateFrom, dateTo]);

  const inProductionRows = React.useMemo(
    () => filteredRows.filter((row) => !!row.work_sheet_id && !row.ready_to_ship),
    [filteredRows]
  );

  const readyRows = React.useMemo(
    () => filteredRows.filter((row) => !!row.work_sheet_id && !!row.ready_to_ship),
    [filteredRows]
  );

  const overdueRows = React.useMemo(
    () =>
      filteredRows.filter(
        (row) => !!row.requested_ship_date && row.requested_ship_date < today
      ),
    [filteredRows, today]
  );

  const noWorkSheetRows = React.useMemo(
    () => filteredRows.filter((row) => !row.work_sheet_id),
    [filteredRows]
  );

  const late7Rows = React.useMemo(
    () =>
      overdueRows.filter((row) => {
        const delay = delayDays(row.requested_ship_date, today);
        return delay !== null && delay >= 7;
      }),
    [overdueRows, today]
  );

  const scopedRows = React.useMemo(() => {
    if (scope === "in_production") return inProductionRows;
    if (scope === "ready") return readyRows;
    if (scope === "overdue") return overdueRows;
    if (scope === "no_ws") return noWorkSheetRows;
    return filteredRows;
  }, [scope, filteredRows, inProductionRows, readyRows, overdueRows, noWorkSheetRows]);

  const vendorSummary = React.useMemo<VendorSummary[]>(() => {
    const map = new Map<string, VendorSummary>();

    scopedRows.forEach((row) => {
      const key = row.vendor_name || "In-house";
      const current =
        map.get(key) ||
        {
          vendor: key,
          poCount: 0,
          lineCount: 0,
          amountUsd: 0,
          overdueCount: 0,
          readyCount: 0,
          noWsCount: 0,
        };

      current.lineCount += 1;
      current.amountUsd += amountOf(row);
      if (!current.poCount || !Array.from(map.values()).some((item) => item.vendor === key && item.poCount)) {
        // handled below through Set-like local map
      }
      if (!!row.requested_ship_date && row.requested_ship_date < today) current.overdueCount += 1;
      if (!!row.work_sheet_id && !!row.ready_to_ship) current.readyCount += 1;
      if (!row.work_sheet_id) current.noWsCount += 1;
      map.set(key, current);
    });

    const poSeen = new Map<string, Set<string>>();
    scopedRows.forEach((row) => {
      const key = row.vendor_name || "In-house";
      const poNo = row.po_no || "";
      if (!poSeen.has(key)) poSeen.set(key, new Set<string>());
      if (poNo) poSeen.get(key)!.add(poNo);
    });

    return Array.from(map.values())
      .map((item) => ({
        ...item,
        poCount: poSeen.get(item.vendor)?.size || 0,
      }))
      .sort((a, b) => b.amountUsd - a.amountUsd);
  }, [scopedRows, today]);

  const shipModeMixText = React.useMemo(() => {
    const counts = new Map<string, number>();
    scopedRows.forEach((row) => {
      const key = row.ship_mode || "N/A";
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => `${key}: ${count}`)
      .join(" / ");
  }, [scopedRows]);

  const totalAmount = React.useMemo(
    () => filteredRows.reduce((sum, row) => sum + amountOf(row), 0),
    [filteredRows]
  );

  const inProductionAmount = React.useMemo(
    () => inProductionRows.reduce((sum, row) => sum + amountOf(row), 0),
    [inProductionRows]
  );

  const readyAmount = React.useMemo(
    () => readyRows.reduce((sum, row) => sum + amountOf(row), 0),
    [readyRows]
  );

  const overdueAmount = React.useMemo(
    () => overdueRows.reduce((sum, row) => sum + amountOf(row), 0),
    [overdueRows]
  );

  const canUseOverviewKpis =
    !query.trim() &&
    vendor === "ALL" &&
    shipMode === "ALL" &&
    scope === "all";

  const pendingOrdersValue = canUseOverviewKpis
    ? n(overviewKpis.pending?.value_usd)
    : totalAmount;
  const pendingOrdersSub = canUseOverviewKpis
    ? `${overviewKpis.pending?.sub_value || "0"} POs / ${filteredRows.length} lines`
    : `${new Set(filteredRows.map((row) => row.po_no).filter(Boolean)).size} POs / ${filteredRows.length} lines`;

  const inProductionValue = canUseOverviewKpis
    ? n(overviewKpis.production?.value_usd)
    : inProductionAmount;
  const inProductionSub = canUseOverviewKpis
    ? `${overviewKpis.production?.sub_value || "0"} lines`
    : `${new Set(inProductionRows.map((row) => row.po_no).filter(Boolean)).size} POs / ${inProductionRows.length} lines`;

  const readyValue = canUseOverviewKpis
    ? n(overviewKpis.ready?.value_usd)
    : readyAmount;
  const readySub = canUseOverviewKpis
    ? `${overviewKpis.ready?.sub_value || "0"} ready POs`
    : `${new Set(readyRows.map((row) => row.po_no).filter(Boolean)).size} ready POs`;

  const filterScopeText = React.useMemo(() => {
    return [
      `Search: ${query.trim() || "ALL"}`,
      `Buyer: ${buyerId === "ALL" ? "ALL" : buyers.find((buyer) => buyer.id === buyerId)?.name || buyerId}`,
      `Vendor: ${vendor}`,
      `Ship Mode: ${shipMode}`,
      `Scope: ${scope}`,
      `Req Ship: ${dateFrom || "-"} ~ ${dateTo || "-"}`,
    ].join("    ");
  }, [query, buyerId, buyers, vendor, shipMode, scope, dateFrom, dateTo]);

  const exportRows = React.useMemo(() => {
    return scopedRows.map((row) => ({
      PO: row.po_no || "",
      Buyer: row.buyer_name || "",
      Vendor: row.vendor_name || "In-house",
      Style: row.style_no || "",
      "Req Ship": fmtDate(row.requested_ship_date),
      Delay: delayDays(row.requested_ship_date, today) ?? "",
      "Ship Mode": row.ship_mode || "",
      Status: row.status || "",
      "Work Sheet": row.work_sheet_id || "",
      Ready: row.ready_to_ship ? "Y" : "",
      Qty: n(row.qty),
      Amount: amountOf(row),
    }));
  }, [scopedRows, today]);

  async function exportExcel() {
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

    const styleTitle = (sheet: ExcelJS.Worksheet, title: string, lastCol: string) => {
      sheet.mergeCells(`A1:${lastCol}1`);
      const titleCell = sheet.getCell("A1");
      titleCell.value = title;
      titleCell.font = { bold: true, size: 18, color: { argb: navy } };
      titleCell.alignment = { horizontal: "center" };
      sheet.mergeCells(`A2:${lastCol}2`);
      const scopeCell = sheet.getCell("A2");
      scopeCell.value = filterScopeText;
      scopeCell.font = { size: 10, color: { argb: "FF64748B" } };
      scopeCell.alignment = { horizontal: "center" };
      sheet.addRow([]);
    };

    const styleHeader = (row: ExcelJS.Row) => {
      row.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: headerFill } };
        cell.font = { bold: true, color: { argb: "FF0F172A" } };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border = border;
      });
    };

    const styleBody = (row: ExcelJS.Row, moneyCols: number[] = [], qtyCols: number[] = []) => {
      row.eachCell((cell, colNumber) => {
        cell.border = border;
        cell.alignment = { vertical: "top", wrapText: true };
        if (moneyCols.includes(colNumber)) cell.numFmt = '"USD "#,##0.00';
        if (qtyCols.includes(colNumber)) cell.numFmt = "#,##0";
      });
    };

    const addSection = (sheet: ExcelJS.Worksheet, title: string, lastCol: string) => {
      sheet.addRow([]);
      sheet.mergeCells(`A${sheet.rowCount + 1}:${lastCol}${sheet.rowCount + 1}`);
      const row = sheet.addRow([title]);
      row.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: pale } };
        cell.font = { bold: true, color: { argb: navy } };
        cell.border = border;
      });
    };

    const summary = workbook.addWorksheet("Summary", { views: [{ state: "frozen", ySplit: 4 }] });
    styleTitle(summary, "Production Dashboard", "E");
    addSection(summary, "KPI Summary", "E");
    styleHeader(summary.addRow(["Metric", "Value", "Sub", "", ""]));
    [
      ["Pending Orders", pendingOrdersValue, pendingOrdersSub],
      ["In Production", inProductionValue, inProductionSub],
      ["Ready to Ship", readyValue, readySub],
      ["Overdue Production", overdueAmount, `${new Set(overdueRows.map((row) => row.po_no).filter(Boolean)).size} overdue POs`],
      ["No Work Sheet Yet", noWorkSheetRows.length, `${new Set(noWorkSheetRows.map((row) => row.po_no).filter(Boolean)).size} POs not started`],
      ["Late by 7+ Days", late7Rows.length, `${new Set(late7Rows.map((row) => row.po_no).filter(Boolean)).size} high-risk lines`],
      ["Active Vendors", new Set(inProductionRows.map((row) => row.vendor_name || "In-house")).size, "Vendors with production lines"],
    ].forEach((row, idx) => styleBody(summary.addRow(row), idx <= 3 ? [2] : [], idx > 3 ? [2] : []));

    addSection(summary, "Vendor Summary", "E");
    styleHeader(summary.addRow(["Vendor", "POs", "Lines", "Amount", "Risk"]));
    vendorSummary.forEach((row) => {
      styleBody(
        summary.addRow([
          row.vendor,
          row.poCount,
          row.lineCount,
          row.amountUsd,
          `Overdue ${row.overdueCount} / Ready ${row.readyCount} / No WS ${row.noWsCount}`,
        ]),
        [4],
        [2, 3]
      );
    });
    summary.columns = [{ width: 30 }, { width: 14 }, { width: 14 }, { width: 18 }, { width: 34 }];

    const lines = workbook.addWorksheet("Production Lines", { views: [{ state: "frozen", ySplit: 4 }] });
    styleTitle(lines, "Production Lines", "L");
    styleHeader(lines.addRow(Object.keys(exportRows[0] || {
      PO: "",
      Buyer: "",
      Vendor: "",
      Style: "",
      "Req Ship": "",
      Delay: "",
      "Ship Mode": "",
      Status: "",
      "Work Sheet": "",
      Ready: "",
      Qty: "",
      Amount: "",
    })));
    exportRows.forEach((row) => {
      styleBody(lines.addRow(Object.values(row)), [12], [6, 11]);
    });
    lines.columns = [
      { width: 16 },
      { width: 24 },
      { width: 28 },
      { width: 18 },
      { width: 14 },
      { width: 10 },
      { width: 14 },
      { width: 16 },
      { width: 20 },
      { width: 10 },
      { width: 14 },
      { width: 16 },
    ];

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `production_dashboard_${exportDate()}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function exportPdf() {
    const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
    const pdfFont = await useUnicodePdfFont(doc);
    doc.setFont(pdfFont, "bold");
    doc.setFontSize(18);
    doc.text("Production Dashboard", 40, 40);
    doc.setFont(pdfFont, "normal");
    doc.setFontSize(9);
    doc.text(filterScopeText, 40, 58, { maxWidth: 760 });

    autoTable(doc, {
      startY: 78,
      head: [["Metric", "Value", "Sub"]],
      body: [
        ["Pending Orders", fmtMoney(pendingOrdersValue), pendingOrdersSub],
        ["In Production", fmtMoney(inProductionValue), inProductionSub],
        ["Ready to Ship", fmtMoney(readyValue), readySub],
        ["Overdue Production", fmtMoney(overdueAmount), `${new Set(overdueRows.map((row) => row.po_no).filter(Boolean)).size} overdue POs`],
        ["No Work Sheet Yet", String(noWorkSheetRows.length), `${new Set(noWorkSheetRows.map((row) => row.po_no).filter(Boolean)).size} POs not started`],
        ["Late by 7+ Days", String(late7Rows.length), `${new Set(late7Rows.map((row) => row.po_no).filter(Boolean)).size} high-risk lines`],
      ],
      styles: { font: pdfFont, fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [229, 237, 248], textColor: 20, fontStyle: "bold" },
      margin: { left: 40, right: 40 },
    });

    autoTable(doc, {
      startY: ((doc as any).lastAutoTable?.finalY || 78) + 16,
      head: [["Vendor", "POs", "Lines", "Amount", "Risk"]],
      body: vendorSummary.slice(0, 20).map((row) => [
        row.vendor,
        row.poCount,
        row.lineCount,
        fmtMoney(row.amountUsd),
        `Overdue ${row.overdueCount} / Ready ${row.readyCount} / No WS ${row.noWsCount}`,
      ]),
      styles: { font: pdfFont, fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [229, 237, 248], textColor: 20, fontStyle: "bold" },
      margin: { left: 40, right: 40 },
    });

    doc.addPage("a4", "landscape");
    doc.setFont(pdfFont, "bold");
    doc.setFontSize(14);
    doc.text("Production Lines", 40, 40);
    autoTable(doc, {
      startY: 58,
      head: [["PO", "Buyer", "Vendor", "Style", "Req Ship", "Delay", "Ship Mode", "Qty", "Amount"]],
      body: scopedRows.slice(0, 120).map((row) => [
        row.po_no || "",
        row.buyer_name || "",
        row.vendor_name || "In-house",
        row.style_no || "",
        fmtDate(row.requested_ship_date),
        delayDays(row.requested_ship_date, today) ?? "",
        row.ship_mode || "",
        fmtQty(n(row.qty)),
        fmtMoney(amountOf(row)),
      ]),
      styles: { font: pdfFont, fontSize: 7, cellPadding: 3 },
      headStyles: { fillColor: [229, 237, 248], textColor: 20, fontStyle: "bold" },
      margin: { left: 40, right: 40 },
    });

    doc.save(`production_dashboard_${exportDate()}.pdf`);
  }

  const resetFilters = () => {
    setQuery("");
    setBuyerId("ALL");
    setVendor("ALL");
    setShipMode("ALL");
    setDateFrom("");
    setDateTo("");
    setScope("all");
  };

  return (
    <AppShell title="Production Dashboard" description="Execution dashboard for overdue, ready-to-ship and no-work-sheet production items.">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Filters</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
              <div className="space-y-2 xl:col-span-2">
                <Label>Search</Label>
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="PO / Buyer / Style / Vendor"
                />
              </div>
              <div className="space-y-2">
                <Label>Buyer</Label>
                <Select value={buyerId} onValueChange={setBuyerId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Buyers</SelectItem>
                    {buyers.map((buyer) => (
                      <SelectItem key={buyer.id} value={buyer.id}>
                        {buyer.code ? `${buyer.code} - ` : ""}{buyer.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Vendor</Label>
                <Select value={vendor} onValueChange={setVendor}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Vendors</SelectItem>
                    {vendorOptions.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Ship Mode</Label>
                <Select value={shipMode} onValueChange={setShipMode}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Modes</SelectItem>
                    {shipModeOptions.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Scope</Label>
                <Select value={scope} onValueChange={(value) => setScope(value as ScopeKey)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="in_production">In Production</SelectItem>
                    <SelectItem value="ready">Ready to Ship</SelectItem>
                    <SelectItem value="overdue">Overdue</SelectItem>
                    <SelectItem value="no_ws">No Work Sheet Yet</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-4">
              <div className="space-y-2">
                <Label>Req Ship Date From</Label>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Req Ship Date To</Label>
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
              <div className="flex items-end gap-2 md:col-span-2">
                <Button type="button" variant="outline" onClick={resetFilters}>
                  Reset
                </Button>
                <Button type="button" variant="outline" onClick={exportExcel} disabled={loading}>
                  Export Excel
                </Button>
                <Button type="button" variant="secondary" onClick={exportPdf} disabled={loading}>
                  PDF / Print
                </Button>
                <div className="text-sm text-slate-500">
                  Today: <span className="font-medium text-slate-700">{today}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {error ? (
          <Card>
            <CardContent className="p-6 text-sm text-rose-600">{error}</CardContent>
          </Card>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            title="Pending Orders"
            value={fmtMoney(pendingOrdersValue)}
            sub={pendingOrdersSub}
          />
          <KpiCard
            title="In Production"
            value={fmtMoney(inProductionValue)}
            sub={inProductionSub}
          />
          <KpiCard
            title="Ready to Ship"
            value={fmtMoney(readyValue)}
            sub={readySub}
            tone="warn"
          />
          <KpiCard
            title="Overdue Production"
            value={fmtMoney(overdueAmount)}
            sub={`${new Set(overdueRows.map((row) => row.po_no).filter(Boolean)).size} overdue POs`}
            tone="danger"
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            title="No Work Sheet Yet"
            value={String(noWorkSheetRows.length)}
            sub={`${new Set(noWorkSheetRows.map((row) => row.po_no).filter(Boolean)).size} POs not started`}
            tone="warn"
          />
          <KpiCard
            title="Late by 7+ Days"
            value={String(late7Rows.length)}
            sub={`${new Set(late7Rows.map((row) => row.po_no).filter(Boolean)).size} high-risk lines`}
            tone="danger"
          />
          <KpiCard
            title="Ship Mode Mix"
            value={String(new Set(scopedRows.map((row) => row.ship_mode).filter(Boolean)).size)}
            sub={shipModeMixText || "No active rows"}
          />
          <KpiCard
            title="Active Vendors"
            value={String(new Set(inProductionRows.map((row) => row.vendor_name || "In-house")).size)}
            sub="Vendors with production lines"
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-12">
          <Card className="lg:col-span-8">
            <CardHeader>
              <CardTitle className="text-base">Overdue PO List</CardTitle>
            </CardHeader>
            <CardContent>
              <ProductionTable rows={overdueRows.slice(0, 100)} emptyText={loading ? "Loading..." : "No overdue production rows."} showDelay />
            </CardContent>
          </Card>

          <Card className="lg:col-span-4">
            <CardHeader>
              <CardTitle className="text-base">Vendor Summary</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-slate-50 text-slate-700">
                    <th className="p-3 text-left font-semibold">Vendor</th>
                    <th className="p-3 text-right font-semibold">POs</th>
                    <th className="p-3 text-right font-semibold">Lines</th>
                    <th className="p-3 text-right font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {vendorSummary.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="p-8 text-center text-sm text-slate-500">
                        {loading ? "Loading..." : "No vendor summary rows."}
                      </td>
                    </tr>
                  ) : (
                    vendorSummary.slice(0, 12).map((row) => (
                      <tr key={row.vendor} className="border-b">
                        <td className="p-3">
                          <div className="font-medium text-slate-900">{row.vendor}</div>
                          <div className="text-xs text-slate-500">
                            Overdue {row.overdueCount} / Ready {row.readyCount} / No WS {row.noWsCount}
                          </div>
                        </td>
                        <td className="p-3 text-right">{row.poCount}</td>
                        <td className="p-3 text-right">{row.lineCount}</td>
                        <td className="p-3 text-right">{fmtMoney(row.amountUsd)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Execution Lists</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="ready" className="space-y-4">
              <TabsList className="flex flex-wrap h-auto">
                <TabsTrigger value="ready">Ready to Ship</TabsTrigger>
                <TabsTrigger value="no-ws">No Work Sheet Yet</TabsTrigger>
                <TabsTrigger value="all">Filtered All</TabsTrigger>
              </TabsList>

              <TabsContent value="ready">
                <ProductionTable rows={readyRows} emptyText={loading ? "Loading..." : "No ready-to-ship rows."} />
              </TabsContent>

              <TabsContent value="no-ws">
                <ProductionTable rows={noWorkSheetRows} emptyText={loading ? "Loading..." : "All filtered rows already have work sheets."} />
              </TabsContent>

              <TabsContent value="all">
                <ProductionTable rows={scopedRows.slice(0, 150)} emptyText={loading ? "Loading..." : "No rows for the current filters."} />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
