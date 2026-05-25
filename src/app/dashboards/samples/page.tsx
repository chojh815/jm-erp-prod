"use client";

import useSWR from "swr";
import AppShell from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import ExcelJS from "exceljs";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { useUnicodePdfFont } from "@/lib/pdfUnicodeFont";

const fetcher = async (url: string) => {
  const r = await fetch(url, { cache: "no-store" });
  return r.json();
};

function fmtPct(n: number) { return `${Number(n || 0).toFixed(2)}%`; }
function fmtInt(n: any) { return Math.trunc(Number(n || 0)).toLocaleString(); }
function todayIso() { return new Date().toISOString().slice(0, 10); }
function alertBadgeClass(v: string) {
  const s = (v || "").toUpperCase();
  if (s === "OVERDUE") return "bg-rose-100 text-rose-700 border border-rose-200";
  if (s === "FOLLOW_UP_DUE") return "bg-amber-100 text-amber-700 border border-amber-200";
  if (s === "WAITING_FEEDBACK") return "bg-sky-100 text-sky-700 border border-sky-200";
  return "bg-slate-100 text-slate-700 border border-slate-200";
}

export default function SampleDashboardPage() {
  const { data } = useSWR("/api/dashboards/samples", fetcher);
  const kpis = data?.kpis || {};
  const buyerRanking = data?.buyer_ranking || [];
  const monthlyRequests = data?.monthly_requests || [];
  const monthlyConverted = data?.monthly_converted || [];
  const aging = data?.aging || [];
  const alerts = data?.alerts || [];

  async function exportExcel() {
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
    const intFmt = "#,##0";
    const pctFmt = "0.00%";

    const styleTitle = (sheet: ExcelJS.Worksheet, title: string, lastCol: string) => {
      sheet.mergeCells(`A1:${lastCol}1`);
      const titleCell = sheet.getCell("A1");
      titleCell.value = title;
      titleCell.font = { bold: true, size: 18, color: { argb: navy } };
      titleCell.alignment = { horizontal: "center" };
      sheet.mergeCells(`A2:${lastCol}2`);
      const scopeCell = sheet.getCell("A2");
      scopeCell.value = `Exported: ${todayIso()}`;
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
    const styleBody = (row: ExcelJS.Row, intCols: number[] = [], pctCols: number[] = []) => {
      row.eachCell((cell, colNumber) => {
        cell.border = border;
        cell.alignment = { vertical: "top", wrapText: true };
        if (intCols.includes(colNumber)) cell.numFmt = intFmt;
        if (pctCols.includes(colNumber)) cell.numFmt = pctFmt;
      });
    };
    const addSection = (sheet: ExcelJS.Worksheet, title: string, lastCol: string) => {
      sheet.addRow([]);
      sheet.mergeCells(`A${sheet.rowCount + 1}:${lastCol}${sheet.rowCount + 1}`);
      const row = sheet.addRow([title]);
      styleSection(row);
    };

    const summary = workbook.addWorksheet("Summary", { views: [{ state: "frozen", ySplit: 4 }] });
    styleTitle(summary, "Sample Dashboard", "F");
    addSection(summary, "KPI Summary", "F");
    styleHeader(summary.addRow(["Metric", "Value", "", "", "", ""]));
    [
      ["Total Requests", kpis.total_requests || 0],
      ["In Progress", kpis.in_progress || 0],
      ["Completed", kpis.completed || 0],
      ["Converted", kpis.converted_requests || 0],
      ["Conversion %", Number(kpis.conversion_pct || 0) / 100],
      ["Overdue", kpis.overdue || 0],
      ["Avg Lead Time", kpis.avg_lead_time_days || 0],
    ].forEach((r, idx) => styleBody(summary.addRow(r), idx === 4 ? [] : [2], idx === 4 ? [2] : []));
    addSection(summary, "Buyer Ranking", "F");
    styleHeader(summary.addRow(["Buyer", "Requests", "Converted", "Conversion %", "Overdue", "Waiting"]));
    buyerRanking.forEach((r: any) => styleBody(summary.addRow([
      r.buyer_name,
      r.requests,
      r.converted,
      Number(r.conversion_pct || 0) / 100,
      r.overdue,
      r.waiting,
    ]), [2, 3, 5, 6], [4]));
    summary.columns = [{ width: 28 }, { width: 14 }, { width: 14 }, { width: 16 }, { width: 14 }, { width: 14 }];

    const monthly = workbook.addWorksheet("Monthly", { views: [{ state: "frozen", ySplit: 4 }] });
    styleTitle(monthly, "Monthly Samples", "D");
    addSection(monthly, "Requests", "D");
    styleHeader(monthly.addRow(["Month", "Requests", "", ""]));
    monthlyRequests.forEach((r: any) => styleBody(monthly.addRow([r.month, r.requests]), [2]));
    addSection(monthly, "Converted", "D");
    styleHeader(monthly.addRow(["Month", "Converted", "", ""]));
    monthlyConverted.forEach((r: any) => styleBody(monthly.addRow([r.month, r.converted]), [2]));
    monthly.columns = [{ width: 16 }, { width: 14 }, { width: 12 }, { width: 12 }];

    const actions = workbook.addWorksheet("Actions", { views: [{ state: "frozen", ySplit: 4 }] });
    styleTitle(actions, "Sample Actions", "F");
    addSection(actions, "Aging", "F");
    styleHeader(actions.addRow(["Bucket", "Count", "", "", "", ""]));
    aging.forEach((r: any) => styleBody(actions.addRow([`${r.bucket} days`, r.count]), [2]));
    addSection(actions, "Alert List", "F");
    styleHeader(actions.addRow(["Request No", "Title", "Buyer", "Target Ship", "Days Open", "Alert"]));
    alerts.forEach((r: any) => styleBody(actions.addRow([
      r.request_no || "",
      r.request_title || "",
      r.buyer_name || "",
      r.target_ship_date || "",
      r.days_open ?? 0,
      r.alert_status || "",
    ]), [5]));
    actions.columns = [{ width: 18 }, { width: 34 }, { width: 24 }, { width: 14 }, { width: 12 }, { width: 18 }];

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sample_dashboard_${todayIso()}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function exportPdf() {
    if (!data) return;
    const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
    const pdfFont = await useUnicodePdfFont(doc);
    doc.setFontSize(18);
    doc.text("Sample Dashboard", 40, 40);
    doc.setFontSize(9);
    doc.text(`Exported: ${todayIso()}`, 40, 58);
    autoTable(doc, {
      startY: 76,
      head: [["Metric", "Value"]],
      body: [
        ["Total Requests", fmtInt(kpis.total_requests)],
        ["In Progress", fmtInt(kpis.in_progress)],
        ["Completed", fmtInt(kpis.completed)],
        ["Converted", fmtInt(kpis.converted_requests)],
        ["Conversion %", fmtPct(kpis.conversion_pct || 0)],
        ["Overdue", fmtInt(kpis.overdue)],
        ["Avg Lead Time", `${kpis.avg_lead_time_days || 0} days`],
      ],
      styles: { font: pdfFont, fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [229, 237, 248], textColor: 20, fontStyle: "bold" },
    });
    autoTable(doc, {
      startY: ((doc as any).lastAutoTable?.finalY || 76) + 16,
      head: [["Buyer", "Requests", "Converted", "Conversion %", "Overdue", "Waiting"]],
      body: buyerRanking.map((r: any) => [r.buyer_name, r.requests, r.converted, fmtPct(r.conversion_pct), r.overdue, r.waiting]),
      styles: { font: pdfFont, fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [229, 237, 248], textColor: 20, fontStyle: "bold" },
    });
    doc.addPage("a4", "landscape");
    doc.setFontSize(15);
    doc.text("Alert List", 40, 40);
    autoTable(doc, {
      startY: 58,
      head: [["Request No", "Title", "Buyer", "Target Ship", "Days Open", "Alert"]],
      body: alerts.map((r: any) => [r.request_no || "", r.request_title || "", r.buyer_name || "", r.target_ship_date || "", r.days_open ?? 0, r.alert_status || ""]),
      styles: { font: pdfFont, fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [229, 237, 248], textColor: 20, fontStyle: "bold" },
    });
    doc.save(`sample_dashboard_${todayIso()}.pdf`);
  }

  return (
    <AppShell title="Sample Dashboard">
      <div className="space-y-6">
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={exportExcel} disabled={!data}>Export Excel</Button>
          <Button type="button" variant="secondary" onClick={exportPdf} disabled={!data}>PDF / Print</Button>
        </div>

        <div className="grid gap-4 md:grid-cols-7">
          {[
            ["Total Requests", kpis.total_requests || 0, ""],
            ["In Progress", kpis.in_progress || 0, ""],
            ["Completed", kpis.completed || 0, ""],
            ["Converted", kpis.converted_requests || 0, ""],
            ["Conversion %", fmtPct(kpis.conversion_pct || 0), ""],
            ["Overdue", kpis.overdue || 0, "text-rose-600"],
            ["Avg Lead Time", `${kpis.avg_lead_time_days || 0} days`, ""],
          ].map(([title, value, valueClass], idx) => (
            <Card key={idx}>
              <CardContent className="flex h-[132px] flex-col justify-between p-6">
                <div className="min-h-[44px] text-sm font-medium leading-5 text-muted-foreground">{title as string}</div>
                <div className={`text-3xl font-bold leading-none ${valueClass as string}`}>{String(value)}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-12">
          <div className="lg:col-span-7 space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">Buyer Ranking</CardTitle>
                <Button type="button" variant="outline" onClick={() => window.open("/sample-requests", "_blank")}>Open Sample Requests</Button>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="p-2 text-left">Buyer</th>
                      <th className="p-2 text-right">Requests</th>
                      <th className="p-2 text-right">Converted</th>
                      <th className="p-2 text-right">Conversion %</th>
                      <th className="p-2 text-right">Overdue</th>
                      <th className="p-2 text-right">Waiting</th>
                    </tr>
                  </thead>
                  <tbody>
                    {buyerRanking.map((r: any, idx: number) => (
                      <tr key={idx} className="border-b">
                        <td className="p-2">{r.buyer_name}</td>
                        <td className="p-2 text-right">{r.requests}</td>
                        <td className="p-2 text-right">{r.converted}</td>
                        <td className="p-2 text-right">{fmtPct(r.conversion_pct)}</td>
                        <td className="p-2 text-right">{r.overdue}</td>
                        <td className="p-2 text-right">{r.waiting}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Monthly Requests / Converted</CardTitle></CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <div>
                  <div className="mb-2 text-sm font-medium">Requests</div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b"><th className="p-2 text-left">Month</th><th className="p-2 text-right">Requests</th></tr>
                    </thead>
                    <tbody>
                      {monthlyRequests.map((r: any) => (
                        <tr key={r.month} className="border-b"><td className="p-2">{r.month}</td><td className="p-2 text-right">{r.requests}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div>
                  <div className="mb-2 text-sm font-medium">Converted</div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b"><th className="p-2 text-left">Month</th><th className="p-2 text-right">Converted</th></tr>
                    </thead>
                    <tbody>
                      {monthlyConverted.map((r: any) => (
                        <tr key={r.month} className="border-b"><td className="p-2">{r.month}</td><td className="p-2 text-right">{r.converted}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-5 space-y-6">
            <Card>
              <CardHeader><CardTitle className="text-base">Aging</CardTitle></CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b"><th className="p-2 text-left">Bucket</th><th className="p-2 text-right">Count</th></tr>
                  </thead>
                  <tbody>
                    {aging.map((r: any) => (
                      <tr key={r.bucket} className="border-b"><td className="p-2">{r.bucket} days</td><td className="p-2 text-right">{r.count}</td></tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Alert List</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {alerts.length === 0 ? (
                  <div className="rounded border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">No alert items.</div>
                ) : alerts.map((r: any) => (
                  <div key={r.id} className="rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium">{r.request_title || "(Untitled request)"}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{r.request_no} · {r.buyer_name || "—"}</div>
                        <div className="mt-1 text-xs text-muted-foreground">Target Ship: {r.target_ship_date || "—"} · Days Open: {r.days_open ?? 0}</div>
                      </div>
                      <span className={`inline-flex rounded-full px-2 py-1 text-xs ${alertBadgeClass(r.alert_status)}`}>{r.alert_status}</span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
