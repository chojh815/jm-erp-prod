"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import ExcelJS from "exceljs";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

type SummaryRow = {
  vendor_id: string | null;
  vendor_name: string;
  vendor_code: string | null;

  line_count: number;
  po_count: number;
  buyer_count: number;

  ordered_qty: number;
  shipped_qty: number;
  pending_qty: number;

  buyer_revenue: number;
  planned_vendor_cost_usd: number;
  actual_vendor_cost_usd: number;

  planned_margin: number;
  planned_margin_pct: number | null;
  actual_margin: number;
  actual_margin_pct: number | null;

  completed_delivery_count: number;
  on_time_count: number;
  late_count: number;
  pending_delivery_count: number;

  otd_pct: number | null;
  avg_delay_days: number | null;
  worst_delay_days: number | null;
};

type OrdersRow = {
  vendor_id: string | null;
  vendor_name: string | null;
  vendor_code?: string | null;

  po_no?: string | null;
  buyer_id?: string | null;
  buyer_name?: string | null;
  brand?: string | null;

  jm_style_no?: string | null;
  buyer_style_no?: string | null;
  description?: string | null;

  order_date?: string | null;
  requested_ship_date?: string | null;
  vendor_due_date?: string | null;
  vendor_ready_date?: string | null;
  vendor_delivery_status?: string | null;
  vendor_delay_days?: number | null;

  ordered_qty?: number | null;
  shipped_qty?: number | null;
  pending_qty?: number | null;

  buyer_revenue?: number | null;
  planned_vendor_cost_usd?: number | null;
  actual_vendor_cost_usd?: number | null;

  planned_margin?: number | null;
  actual_margin?: number | null;

  pending_revenue?: number | null;
  pending_planned_cost_usd?: number | null;
  pending_planned_margin?: number | null;

  production_mode?: string | null;
};

type SummaryResponse = {
  success: boolean;
  filters?: Record<string, any>;
  kpis?: {
    active_vendors: number;
    total_ordered_qty: number;
    total_shipped_qty: number;
    total_pending_qty: number;
    total_buyer_revenue: number;
    total_planned_vendor_cost_usd: number;
    total_actual_vendor_cost_usd: number;
    total_planned_margin: number;
    total_actual_margin: number;
    avg_planned_margin_pct: number | null;
    avg_actual_margin_pct: number | null;
    otd_pct: number | null;
  };
  rows?: SummaryRow[];
  raw_count?: number;
  error?: string;
};

type OrdersResponse = {
  success: boolean;
  rows?: OrdersRow[];
  error?: string;
};

type RankingRow = {
  vendor_id: string | null;
  vendor_name: string;
  vendor_code?: string | null;
  po_count: number;
  buyer_revenue: number;
  planned_vendor_cost_usd: number;
  planned_margin: number;
  planned_margin_pct: number | null;
  ordered_qty: number;
  pending_qty: number;
  pending_revenue: number;
  pending_planned_cost_usd: number;
  pending_planned_margin: number;
  completed_delivery_count: number;
  on_time_count: number;
  late_count: number;
  pending_delivery_count: number;
  otd_pct: number | null;
  late_rate_pct: number | null;
  avg_delay_days: number | null;
};

type RankingResponse = {
  success: boolean;
  highlights?: {
    top_revenue_vendor?: RankingRow | null;
    top_margin_vendor?: RankingRow | null;
    highest_pending_vendor?: RankingRow | null;
    worst_otd_vendor?: RankingRow | null;
  };
  rankings?: {
    by_revenue?: RankingRow[];
    by_margin_pct?: RankingRow[];
    by_pending_revenue?: RankingRow[];
    by_otd_asc?: RankingRow[];
  };
  error?: string;
};

function n(v: any, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}
function fmtQty(v: any) {
  return n(v).toLocaleString("en-US");
}
function fmtMoney(v: any) {
  return n(v).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
function fmtPct(v: any) {
  const x = Number(v);
  if (!Number.isFinite(x)) return "-";
  return `${x.toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}
function fmtOtd(v: any, completedCount?: any) {
  if (n(completedCount) <= 0) return "-";
  return fmtPct(v);
}
function fmtDelayLabel(v: any) {
  const x = Number(v);
  if (!Number.isFinite(x)) return "-";
  if (x < 0) return `Early ${Math.abs(x)}d`;
  if (x > 0) return `Late ${x}d`;
  return "On time";
}
function fmtDate(v: any) {
  const s = (v ?? "").toString().trim();
  return s ? s.slice(0, 10) : "-";
}
function safeText(v: any) {
  return (v ?? "").toString().trim();
}

function KpiCard({
  title,
  value,
  sub,
}: {
  title: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card className="h-full">
      <CardContent className="flex min-h-[110px] flex-col justify-between p-4">
        <div className="text-xs leading-4 text-muted-foreground">{title}</div>
        <div className="mt-2 overflow-hidden text-ellipsis whitespace-nowrap text-2xl font-semibold tabular-nums tracking-tight md:text-[2rem]">
          {value}
        </div>
        {sub ? (
          <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
        ) : (
          <div className="mt-1 text-xs text-transparent">.</div>
        )}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ row }: { row: SummaryRow }) {
  const late = n(row.late_count);
  const completed = n(row.completed_delivery_count);
  const otd = row.otd_pct;
  const noVendor =
    !safeText(row.vendor_id) ||
    safeText(row.vendor_name).toLowerCase() === "(no vendor)";

  if (noVendor) {
    return <Badge variant="outline">UNASSIGNED</Badge>;
  }
  if (late > 0) {
    return <Badge variant="destructive">LATE</Badge>;
  }
  if (!completed && n(row.pending_delivery_count) > 0) {
    return <Badge variant="secondary">PENDING</Badge>;
  }
  if (typeof otd === "number" && otd >= 90) {
    return <Badge>ON TIME</Badge>;
  }
  return <Badge variant="secondary">WATCH</Badge>;
}

function DataTable({
  columns,
  rows,
}: {
  columns: {
    key: string;
    label: string;
    className?: string;
    render?: (row: SummaryRow) => React.ReactNode;
  }[];
  rows: SummaryRow[];
}) {
  return (
    <div className="overflow-auto rounded-xl border">
      <table className="min-w-full text-sm">
        <thead className="bg-muted/40">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={`px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap ${c.className ?? ""}`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-3 py-10 text-center text-muted-foreground"
              >
                No data
              </td>
            </tr>
          ) : (
            rows.map((row, idx) => (
              <tr
                key={`${row.vendor_id ?? row.vendor_name}-${idx}`}
                className="border-t"
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-3 py-2 whitespace-nowrap align-middle ${c.className ?? ""}`}
                  >
                    {c.render ? c.render(row) : (row as any)[c.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function OrdersTable({
  rows,
  selectedVendorName,
}: {
  rows: OrdersRow[];
  selectedVendorName?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          Orders Detail{selectedVendorName ? ` - ${selectedVendorName}` : ""}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-auto rounded-xl border">
          <table className="min-w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                {[
                  "Vendor",
                  "PO No",
                  "Buyer",
                  "Brand",
                  "Style",
                  "Ordered Qty",
                  "Shipped Qty",
                  "Pending Qty",
                  "Revenue",
                  "Planned Cost",
                  "Planned Margin",
                  "Req Ship Date",
                  "Due Date",
                  "Ready Date",
                  "Status",
                  "Delay",
                ].map((label) => (
                  <th
                    key={label}
                    className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={16}
                    className="px-3 py-10 text-center text-muted-foreground"
                  >
                    No detail rows
                  </td>
                </tr>
              ) : (
                rows.map((r, idx) => (
                  <tr
                    key={`${r.vendor_id ?? "no-vendor"}-${r.po_no ?? "no-po"}-${idx}`}
                    className="border-t"
                  >
                    <td className="px-3 py-2 whitespace-nowrap">
                      {safeText(r.vendor_name) || "(No Vendor)"}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {safeText(r.po_no) || "-"}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {safeText(r.buyer_name) || "-"}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {safeText(r.brand) || "-"}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="font-medium">
                        {safeText(r.jm_style_no) || "-"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {safeText(r.buyer_style_no) || "-"}
                      </div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {fmtQty(r.ordered_qty)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {fmtQty(r.shipped_qty)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {fmtQty(r.pending_qty)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {fmtMoney(r.buyer_revenue)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {fmtMoney(r.planned_vendor_cost_usd)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {fmtMoney(r.planned_margin)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {fmtDate(r.requested_ship_date)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {fmtDate(r.vendor_due_date)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {fmtDate(r.vendor_ready_date)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Badge
                        variant={
                          !safeText(r.vendor_id)
                            ? "outline"
                            : safeText(r.vendor_delivery_status).toUpperCase() ===
                                "LATE"
                              ? "destructive"
                              : safeText(r.vendor_delivery_status).toUpperCase() ===
                                  "ON_TIME"
                                ? "default"
                                : "secondary"
                        }
                      >
                        {!safeText(r.vendor_id)
                          ? "UNASSIGNED"
                          : safeText(r.vendor_delivery_status).toUpperCase() ||
                            "PENDING"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {fmtDelayLabel(r.vendor_delay_days)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

export default function VendorDashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<SummaryRow[]>([]);
  const [kpis, setKpis] =
    React.useState<SummaryResponse["kpis"] | null>(null);
  const [ordersRows, setOrdersRows] = React.useState<OrdersRow[]>([]);
  const [ranking, setRanking] = React.useState<RankingResponse | null>(null);
  const [selectedVendorId, setSelectedVendorId] = React.useState("ALL");
  const [selectedVendorName, setSelectedVendorName] = React.useState("");

  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");
  const [vendorFilter, setVendorFilter] = React.useState("ALL");
  const [productionMode, setProductionMode] = React.useState("ALL");
  const [scope, setScope] = React.useState<"ALL" | "PENDING" | "LATE">("ALL");

  const load = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      if (vendorFilter !== "ALL") params.set("vendor_id", vendorFilter);
      if (productionMode !== "ALL") {
        params.set("production_mode", productionMode);
      }
      if (scope === "PENDING") params.set("pending_only", "true");
      if (scope === "LATE") params.set("late_only", "true");

      const res = await fetch(
        `/api/dashboards/vendors/summary?${params.toString()}`,
        {
          cache: "no-store",
        }
      );
      const j: SummaryResponse = await res.json();
      if (!res.ok || !j?.success) {
        throw new Error(j?.error || "Failed to load vendor dashboard");
      }

      setRows(Array.isArray(j.rows) ? j.rows : []);
      setKpis(j.kpis ?? null);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load");
      toast.error("Failed to load vendor dashboard", {
        description: e?.message ?? "Server error",
      });
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, vendorFilter, productionMode, scope]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const loadOrders = React.useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      if (selectedVendorId !== "ALL") params.set("vendor_id", selectedVendorId);
      if (productionMode !== "ALL") {
        params.set("production_mode", productionMode);
      }
      if (scope === "PENDING") params.set("pending_only", "true");
      if (scope === "LATE") params.set("late_only", "true");

      const res = await fetch(
        `/api/dashboards/vendors/orders?${params.toString()}`,
        {
          cache: "no-store",
        }
      );
      const j: OrdersResponse = await res.json();
      if (!res.ok || !j?.success) {
        throw new Error(j?.error || "Failed to load vendor orders");
      }
      setOrdersRows(Array.isArray(j.rows) ? j.rows : []);
    } catch (e: any) {
      toast.error("Failed to load vendor orders", {
        description: e?.message ?? "Server error",
      });
    }
  }, [dateFrom, dateTo, selectedVendorId, productionMode, scope]);

  React.useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  const loadRanking = React.useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      if (productionMode !== "ALL") {
        params.set("production_mode", productionMode);
      }
      if (scope === "PENDING") params.set("pending_only", "true");
      if (scope === "LATE") params.set("late_only", "true");

      const res = await fetch(
        `/api/dashboards/vendors/ranking?${params.toString()}`,
        { cache: "no-store" }
      );
      const j: RankingResponse = await res.json();
      if (!res.ok || !j?.success) {
        throw new Error(j?.error || "Failed to load vendor ranking");
      }
      setRanking(j);
    } catch (e: any) {
      toast.error("Failed to load vendor ranking", {
        description: e?.message ?? "Server error",
      });
    }
  }, [dateFrom, dateTo, productionMode, scope]);

  React.useEffect(() => {
    void loadRanking();
  }, [loadRanking]);

  const vendorOptions = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) {
      const id = safeText(r.vendor_id);
      if (!id) continue;
      const label = safeText(r.vendor_name) || "(No Vendor)";
      if (!map.has(id)) map.set(id, label);
    }
    return Array.from(map.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  const sortNoVendorLast = React.useCallback((a: SummaryRow, b: SummaryRow) => {
    const an =
      safeText(a.vendor_name).toLowerCase() === "(no vendor)".toLowerCase() ||
      !safeText(a.vendor_id);
    const bn =
      safeText(b.vendor_name).toLowerCase() === "(no vendor)".toLowerCase() ||
      !safeText(b.vendor_id);
    if (an !== bn) return an ? 1 : -1;
    return safeText(a.vendor_name).localeCompare(safeText(b.vendor_name));
  }, []);

  const unassignedRows = React.useMemo(
    () =>
      rows.filter(
        (r) =>
          !safeText(r.vendor_id) ||
          safeText(r.vendor_name).toLowerCase() === "(no vendor)"
      ),
    [rows]
  );

  const assignedRows = React.useMemo(
    () =>
      rows.filter(
        (r) =>
          safeText(r.vendor_id) &&
          safeText(r.vendor_name).toLowerCase() !== "(no vendor)"
      ),
    [rows]
  );

  const scopedAssignedRows = React.useMemo(() => {
    if (selectedVendorId === "ALL") return assignedRows;
    return assignedRows.filter((r) => safeText(r.vendor_id) === selectedVendorId);
  }, [assignedRows, selectedVendorId]);

  const overviewRows = React.useMemo(
    () => [...scopedAssignedRows].sort(sortNoVendorLast),
    [scopedAssignedRows, sortNoVendorLast]
  );

  const pendingRows = React.useMemo(
    () =>
      [...scopedAssignedRows]
        .filter((r) => n(r.pending_qty) > 0)
        .sort((a, b) => {
          const diff = n(b.pending_qty) - n(a.pending_qty);
          if (diff !== 0) return diff;
          return sortNoVendorLast(a, b);
        }),
    [scopedAssignedRows, sortNoVendorLast]
  );

  const marginRows = React.useMemo(
    () =>
      [...scopedAssignedRows].sort((a, b) => {
        const diff =
          n(b.actual_margin || b.planned_margin) -
          n(a.actual_margin || a.planned_margin);
        if (diff !== 0) return diff;
        return sortNoVendorLast(a, b);
      }),
    [scopedAssignedRows, sortNoVendorLast]
  );

  const deliveryRows = React.useMemo(
    () =>
      [...scopedAssignedRows].sort((a, b) => {
        const aLate = n(a.late_count);
        const bLate = n(b.late_count);
        if (bLate !== aLate) return bLate - aLate;
        const otdDiff = n(a.otd_pct) - n(b.otd_pct);
        if (otdDiff !== 0) return otdDiff;
        return sortNoVendorLast(a, b);
      }),
    [scopedAssignedRows, sortNoVendorLast]
  );

  const unassignedRevenue = React.useMemo(
    () => unassignedRows.reduce((s, r) => s + n(r.buyer_revenue), 0),
    [unassignedRows]
  );

  const unassignedPendingQty = React.useMemo(
    () => unassignedRows.reduce((s, r) => s + n(r.pending_qty), 0),
    [unassignedRows]
  );

  const actualReady = React.useMemo(
    () => scopedAssignedRows.some((r) => n(r.actual_vendor_cost_usd) > 0),
    [scopedAssignedRows]
  );

  const pendingRevenue = React.useMemo(
    () =>
      scopedAssignedRows.reduce((s, r) => {
        const ordered = n(r.ordered_qty);
        const pending = n(r.pending_qty);
        const revenue = n(r.buyer_revenue);
        if (ordered <= 0 || pending <= 0 || revenue <= 0) return s;
        return s + (revenue * pending) / ordered;
      }, 0),
    [scopedAssignedRows]
  );

  const pendingPlannedCost = React.useMemo(
    () =>
      scopedAssignedRows.reduce((s, r) => {
        const ordered = n(r.ordered_qty);
        const pending = n(r.pending_qty);
        const cost = n(r.planned_vendor_cost_usd);
        if (ordered <= 0 || pending <= 0 || cost <= 0) return s;
        return s + (cost * pending) / ordered;
      }, 0),
    [scopedAssignedRows]
  );

  const pendingPlannedMargin = React.useMemo(
    () => pendingRevenue - pendingPlannedCost,
    [pendingRevenue, pendingPlannedCost]
  );

  const visibleOverviewRows = React.useMemo(
    () => overviewRows.filter((r) => safeText(r.vendor_id)),
    [overviewRows]
  );
  const visiblePendingRows = React.useMemo(
    () => pendingRows.filter((r) => safeText(r.vendor_id)),
    [pendingRows]
  );
  const visibleMarginRows = React.useMemo(
    () => marginRows.filter((r) => safeText(r.vendor_id)),
    [marginRows]
  );
  const visibleDeliveryRows = React.useMemo(
    () => deliveryRows.filter((r) => safeText(r.vendor_id)),
    [deliveryRows]
  );

  const assignedCompletedDelivery = React.useMemo(
    () => scopedAssignedRows.reduce((s, r) => s + n(r.completed_delivery_count), 0),
    [scopedAssignedRows]
  );

  const assignedOnTimeDelivery = React.useMemo(
    () => scopedAssignedRows.reduce((s, r) => s + n(r.on_time_count), 0),
    [scopedAssignedRows]
  );

  const handleVendorSelect = React.useCallback((row: SummaryRow) => {
    const id = safeText(row.vendor_id);
    if (!id) return;
    router.push(`/po/list?vendor_id=${encodeURIComponent(id)}`);
  }, [router]);

  function exportFilterText() {
    const vendorName =
      vendorFilter === "ALL"
        ? "All Vendors"
        : vendorOptions.find((v) => v.id === vendorFilter)?.label || selectedVendorName || vendorFilter;
    return [
      dateFrom ? `Date From: ${dateFrom}` : "",
      dateTo ? `Date To: ${dateTo}` : "",
      `Vendor: ${vendorName}`,
      `Production Mode: ${productionMode}`,
      `Scope: ${scope}`,
    ].filter(Boolean).join(" | ");
  }

  function exportKpis() {
    const revenue = scopedAssignedRows.reduce((s, r) => s + n(r.buyer_revenue), 0);
    const plannedCost = scopedAssignedRows.reduce((s, r) => s + n(r.planned_vendor_cost_usd), 0);
    const actualCost = scopedAssignedRows.reduce((s, r) => s + n(r.actual_vendor_cost_usd), 0);
    const plannedMargin = scopedAssignedRows.reduce((s, r) => s + n(r.planned_margin), 0);
    const actualMargin = scopedAssignedRows.reduce((s, r) => s + n(r.actual_margin), 0);
    return [
      ["Revenue (USD)", revenue],
      ["Planned Cost (USD)", plannedCost],
      ["Actual Cost (USD)", actualReady ? actualCost : ""],
      ["Planned Margin (USD)", plannedMargin],
      ["Actual Margin (USD)", actualReady ? actualMargin : ""],
      ["Pending Revenue (USD)", pendingRevenue],
      ["Pending Planned Cost (USD)", pendingPlannedCost],
      ["Pending Margin (USD)", pendingPlannedMargin],
      ["Completed OTD %", assignedCompletedDelivery > 0 ? (assignedOnTimeDelivery / assignedCompletedDelivery) * 100 : ""],
      ["Active Vendors", scopedAssignedRows.length],
      ["Pending Vendors", scopedAssignedRows.filter((r) => n(r.pending_qty) > 0).length],
      ["Late Vendors", scopedAssignedRows.filter((r) => n(r.late_count) > 0).length],
      ["Ordered Qty", scopedAssignedRows.reduce((s, r) => s + n(r.ordered_qty), 0)],
      ["Shipped Qty", scopedAssignedRows.reduce((s, r) => s + n(r.shipped_qty), 0)],
      ["Pending Qty", scopedAssignedRows.reduce((s, r) => s + n(r.pending_qty), 0)],
      ["Unassigned Revenue (USD)", unassignedRevenue],
    ] as [string, string | number][];
  }

  function handleExportExcel() {
    if (scopedAssignedRows.length === 0 && ordersRows.length === 0) {
      toast.info("No data to export");
      return;
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "JM ERP";
    workbook.created = new Date();
    const charcoal = "FF374151";
    const pale = "FFF3F4F6";
    const borderColor = "FFD1D5DB";
    const border = { style: "thin", color: { argb: borderColor } } as const;

    const styleTitle = (sheet: ExcelJS.Worksheet, title: string, lastCol: string) => {
      sheet.mergeCells(`A1:${lastCol}1`);
      sheet.getCell("A1").value = title;
      sheet.getCell("A1").font = { bold: true, size: 18, color: { argb: "FF111827" } };
      sheet.getRow(1).height = 28;
      sheet.mergeCells(`A2:${lastCol}2`);
      sheet.getCell("A2").value = `Filters: ${exportFilterText()}`;
      sheet.getCell("A2").font = { color: { argb: "FF4B5563" } };
    };

    const styleHeader = (row: ExcelJS.Row) => {
      row.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: charcoal } };
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.border = { top: border, left: border, bottom: border, right: border };
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      });
    };

    const styleBody = (row: ExcelJS.Row, numericColumns: number[], moneyColumns: number[], pctColumns: number[]) => {
      row.eachCell((cell, colNumber) => {
        cell.border = { top: border, left: border, bottom: border, right: border };
        cell.alignment = { vertical: "middle", wrapText: true };
        if (numericColumns.includes(colNumber) || moneyColumns.includes(colNumber) || pctColumns.includes(colNumber)) {
          cell.alignment = { horizontal: "right", vertical: "middle" };
        }
        if (numericColumns.includes(colNumber)) cell.numFmt = "#,##0.##";
        if (moneyColumns.includes(colNumber)) cell.numFmt = '$#,##0.00;[Red]-$#,##0.00';
        if (pctColumns.includes(colNumber)) cell.numFmt = "0.0%";
      });
    };

    const summarySheet = workbook.addWorksheet("Summary", { views: [{ state: "frozen", ySplit: 4 }] });
    styleTitle(summarySheet, "Vendor Dashboard", "D");
    const kpiHeader = summarySheet.addRow(["Metric", "Value", "Metric", "Value"]);
    styleHeader(kpiHeader);
    const kpiPairs = exportKpis();
    for (let i = 0; i < kpiPairs.length; i += 2) {
      const row = summarySheet.addRow([
        kpiPairs[i]?.[0] || "",
        kpiPairs[i]?.[1] ?? "",
        kpiPairs[i + 1]?.[0] || "",
        kpiPairs[i + 1]?.[1] ?? "",
      ]);
      styleBody(row, [2, 4], [], []);
      const leftMetric = String(kpiPairs[i]?.[0] || "");
      const rightMetric = String(kpiPairs[i + 1]?.[0] || "");
      row.getCell(2).numFmt = leftMetric.includes("(USD)") ? '$#,##0.00;[Red]-$#,##0.00' : leftMetric.includes("%") ? "0.0" : "#,##0.##";
      row.getCell(4).numFmt = rightMetric.includes("(USD)") ? '$#,##0.00;[Red]-$#,##0.00' : rightMetric.includes("%") ? "0.0" : "#,##0.##";
    }
    summarySheet.columns = [{ width: 28 }, { width: 18 }, { width: 28 }, { width: 18 }];

    const addSummaryTable = (name: string, title: string, tableRows: SummaryRow[]) => {
      const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 4 }] });
      styleTitle(sheet, title, "N");
      styleHeader(sheet.addRow([
        "Vendor", "Vendor Code", "POs", "Buyers", "Ordered Qty", "Shipped Qty", "Pending Qty",
        "Revenue", "Planned Cost", "Actual Cost", "Planned Margin", "Planned %", "OTD %", "Avg Delay",
      ]));
      for (const r of tableRows) {
        styleBody(sheet.addRow([
          safeText(r.vendor_name) || "(No Vendor)",
          safeText(r.vendor_code) || "-",
          n(r.po_count),
          n(r.buyer_count),
          n(r.ordered_qty),
          n(r.shipped_qty),
          n(r.pending_qty),
          n(r.buyer_revenue),
          n(r.planned_vendor_cost_usd),
          n(r.actual_vendor_cost_usd),
          n(r.planned_margin),
          Number.isFinite(Number(r.planned_margin_pct)) ? n(r.planned_margin_pct) / 100 : "",
          Number.isFinite(Number(r.otd_pct)) ? n(r.otd_pct) / 100 : "",
          Number.isFinite(Number(r.avg_delay_days)) ? n(r.avg_delay_days) : "",
        ]), [3, 4, 5, 6, 7, 14], [8, 9, 10, 11], [12, 13]);
      }
      sheet.columns = [
        { width: 28 }, { width: 14 }, { width: 10 }, { width: 10 }, { width: 14 }, { width: 14 }, { width: 14 },
        { width: 16 }, { width: 16 }, { width: 16 }, { width: 17 }, { width: 12 }, { width: 12 }, { width: 12 },
      ];
    };

    addSummaryTable("Overview", "Vendor Overview", visibleOverviewRows);
    addSummaryTable("Pending", "Vendor Pending", visiblePendingRows);
    addSummaryTable("Margin", "Vendor Margin", visibleMarginRows);
    addSummaryTable("Delivery", "Vendor Delivery", visibleDeliveryRows);

    const ordersSheet = workbook.addWorksheet("Orders", { views: [{ state: "frozen", ySplit: 4 }] });
    styleTitle(ordersSheet, "Vendor Orders Detail", "P");
    styleHeader(ordersSheet.addRow([
      "Vendor", "PO No", "Buyer", "Brand", "JM Style", "Buyer Style", "Ordered Qty", "Shipped Qty",
      "Pending Qty", "Revenue", "Planned Cost", "Planned Margin", "Req Ship Date", "Due Date", "Ready Date", "Status",
    ]));
    for (const r of ordersRows) {
      styleBody(ordersSheet.addRow([
        safeText(r.vendor_name) || "(No Vendor)",
        safeText(r.po_no) || "-",
        safeText(r.buyer_name) || "-",
        safeText(r.brand) || "-",
        safeText(r.jm_style_no) || "-",
        safeText(r.buyer_style_no) || "-",
        n(r.ordered_qty),
        n(r.shipped_qty),
        n(r.pending_qty),
        n(r.buyer_revenue),
        n(r.planned_vendor_cost_usd),
        n(r.planned_margin),
        fmtDate(r.requested_ship_date),
        fmtDate(r.vendor_due_date),
        fmtDate(r.vendor_ready_date),
        safeText(r.vendor_delivery_status).toUpperCase() || "PENDING",
      ]), [7, 8, 9], [10, 11, 12], []);
    }
    ordersSheet.columns = [
      { width: 28 }, { width: 16 }, { width: 22 }, { width: 18 }, { width: 16 }, { width: 16 }, { width: 14 }, { width: 14 },
      { width: 14 }, { width: 16 }, { width: 16 }, { width: 17 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 },
    ];

    const rankingsSheet = workbook.addWorksheet("Rankings");
    styleTitle(rankingsSheet, "Vendor Rankings", "D");
    const addRankingBlock = (title: string, rankingRows: RankingRow[], valueLabel: string, value: (r: RankingRow) => any) => {
      rankingsSheet.addRow([]);
      const section = rankingsSheet.addRow([title]);
      section.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: pale } };
      section.getCell(1).font = { bold: true };
      styleHeader(rankingsSheet.addRow(["Vendor", valueLabel, "Revenue", "Margin %"]));
      for (const r of rankingRows) {
        styleBody(rankingsSheet.addRow([
          r.vendor_name,
          value(r),
          n(r.buyer_revenue),
          Number.isFinite(Number(r.planned_margin_pct)) ? n(r.planned_margin_pct) / 100 : "",
        ]), [2], [3], [4]);
      }
    };
    addRankingBlock("Top Revenue", ranking?.rankings?.by_revenue ?? [], "Revenue", (r) => n(r.buyer_revenue));
    addRankingBlock("Top Margin %", ranking?.rankings?.by_margin_pct ?? [], "Margin %", (r) => Number.isFinite(Number(r.planned_margin_pct)) ? n(r.planned_margin_pct) / 100 : "");
    addRankingBlock("Highest Pending", ranking?.rankings?.by_pending_revenue ?? [], "Pending Revenue", (r) => n(r.pending_revenue));
    addRankingBlock("Worst OTD", ranking?.rankings?.by_otd_asc ?? [], "OTD %", (r) => Number.isFinite(Number(r.otd_pct)) ? n(r.otd_pct) / 100 : "");
    rankingsSheet.columns = [{ width: 28 }, { width: 18 }, { width: 18 }, { width: 14 }];

    workbook.xlsx.writeBuffer().then((buffer) => {
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `vendor-dashboard-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  function handleExportPdf() {
    if (scopedAssignedRows.length === 0 && ordersRows.length === 0) {
      toast.info("No data to export");
      return;
    }

    const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
    doc.setFontSize(18);
    doc.text("Vendor Dashboard", 40, 40);
    doc.setFontSize(9);
    doc.text(`Filters: ${exportFilterText()}`, 40, 58, { maxWidth: 760 });

    const kpiPairs = exportKpis();
    autoTable(doc, {
      startY: 76,
      head: [["Metric", "Value", "Metric", "Value"]],
      body: Array.from({ length: Math.ceil(kpiPairs.length / 2) }, (_, i) => {
        const left = kpiPairs[i * 2];
        const right = kpiPairs[i * 2 + 1];
        return [
          left?.[0] || "",
          typeof left?.[1] === "number" ? fmtMoney(left[1]) : left?.[1] || "-",
          right?.[0] || "",
          typeof right?.[1] === "number" ? fmtMoney(right[1]) : right?.[1] || "-",
        ];
      }),
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [55, 65, 81], textColor: [255, 255, 255], lineColor: [209, 213, 219] },
      bodyStyles: { lineColor: [209, 213, 219] },
    });

    autoTable(doc, {
      startY: (doc as any).lastAutoTable.finalY + 18,
      head: [["Vendor", "POs", "Ordered", "Shipped", "Pending", "Revenue", "Planned Cost", "Planned Margin", "Planned %", "OTD %"]],
      body: visibleOverviewRows.map((r) => [
        safeText(r.vendor_name) || "(No Vendor)",
        fmtQty(r.po_count),
        fmtQty(r.ordered_qty),
        fmtQty(r.shipped_qty),
        fmtQty(r.pending_qty),
        fmtMoney(r.buyer_revenue),
        fmtMoney(r.planned_vendor_cost_usd),
        fmtMoney(r.planned_margin),
        fmtPct(r.planned_margin_pct),
        fmtOtd(r.otd_pct, r.completed_delivery_count),
      ]),
      theme: "grid",
      styles: { fontSize: 7, cellPadding: 3, overflow: "linebreak" },
      headStyles: { fillColor: [55, 65, 81], textColor: [255, 255, 255], lineColor: [209, 213, 219] },
      bodyStyles: { lineColor: [209, 213, 219] },
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" }, 7: { halign: "right" }, 8: { halign: "right" }, 9: { halign: "right" } },
    });

    autoTable(doc, {
      startY: (doc as any).lastAutoTable.finalY + 18,
      head: [["Vendor", "PO No", "Buyer", "Brand", "Style", "Ordered", "Pending", "Revenue", "Planned Margin", "Req Ship", "Due", "Status"]],
      body: ordersRows.map((r) => [
        safeText(r.vendor_name) || "(No Vendor)",
        safeText(r.po_no) || "-",
        safeText(r.buyer_name) || "-",
        safeText(r.brand) || "-",
        safeText(r.jm_style_no) || safeText(r.buyer_style_no) || "-",
        fmtQty(r.ordered_qty),
        fmtQty(r.pending_qty),
        fmtMoney(r.buyer_revenue),
        fmtMoney(r.planned_margin),
        fmtDate(r.requested_ship_date),
        fmtDate(r.vendor_due_date),
        safeText(r.vendor_delivery_status).toUpperCase() || "PENDING",
      ]),
      theme: "grid",
      styles: { fontSize: 6.5, cellPadding: 3, overflow: "linebreak" },
      headStyles: { fillColor: [55, 65, 81], textColor: [255, 255, 255], lineColor: [209, 213, 219] },
      bodyStyles: { lineColor: [209, 213, 219] },
      columnStyles: { 5: { halign: "right" }, 6: { halign: "right" }, 7: { halign: "right" }, 8: { halign: "right" } },
    });

    doc.save(`vendor-dashboard-${new Date().toISOString().slice(0, 10)}.pdf`);
  }

  return (
    <AppShell>
      <div className="space-y-4 p-4">
        <div>
          <h1 className="text-2xl font-semibold">Vendor Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Vendor order, pending, margin, and delivery performance overview.
          </p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Filters</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
              <div className="space-y-1">
                <Label>Date From</Label>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Date To</Label>
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Vendor</Label>
                <Select
                  value={vendorFilter}
                  onValueChange={(v) => {
                    setVendorFilter(v);
                    setSelectedVendorId(v);
                    setSelectedVendorName(
                      v === "ALL"
                        ? ""
                        : vendorOptions.find((x) => x.id === v)?.label || ""
                    );
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All Vendors" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Vendors</SelectItem>
                    {vendorOptions.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Production Mode</Label>
                <Select value={productionMode} onValueChange={setProductionMode}>
                  <SelectTrigger>
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All</SelectItem>
                    <SelectItem value="IN_HOUSE">IN_HOUSE</SelectItem>
                    <SelectItem value="OUTSOURCED">OUTSOURCED</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Scope</Label>
                <Select value={scope} onValueChange={(v: any) => setScope(v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All</SelectItem>
                    <SelectItem value="PENDING">Pending Only</SelectItem>
                    <SelectItem value="LATE">Late Only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-2">
                <Button onClick={() => void load()} disabled={loading}>
                  {loading ? "Loading..." : "Apply"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setDateFrom("");
                    setDateTo("");
                    setVendorFilter("ALL");
                    setSelectedVendorId("ALL");
                    setSelectedVendorName("");
                    setProductionMode("ALL");
                    setScope("ALL");
                  }}
                  disabled={loading}
                >
                  Reset
                </Button>
                <Button variant="outline" onClick={handleExportExcel} disabled={loading}>
                  Export XLSX
                </Button>
                <Button variant="outline" onClick={handleExportPdf} disabled={loading}>
                  Export PDF
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard title="Revenue (USD)" value={fmtMoney(scopedAssignedRows.reduce((s, r) => s + n(r.buyer_revenue), 0))} />
          <KpiCard title="Planned Cost (USD)" value={fmtMoney(scopedAssignedRows.reduce((s, r) => s + n(r.planned_vendor_cost_usd), 0))} />
          <KpiCard title="Actual Cost (USD)" value={actualReady ? fmtMoney(scopedAssignedRows.reduce((s, r) => s + n(r.actual_vendor_cost_usd), 0)) : "-"} sub={actualReady ? undefined : "Actual cost not entered"} />
          <KpiCard title="Planned Margin (USD)" value={fmtMoney(scopedAssignedRows.reduce((s, r) => s + n(r.planned_margin), 0))} sub={fmtPct((() => { const rev = scopedAssignedRows.reduce((s, r) => s + n(r.buyer_revenue), 0); const mg = scopedAssignedRows.reduce((s, r) => s + n(r.planned_margin), 0); return rev > 0 ? (mg / rev) * 100 : null; })())} />
          <KpiCard title="Actual Margin (USD)" value={actualReady ? fmtMoney(scopedAssignedRows.reduce((s, r) => s + n(r.actual_margin), 0)) : "-"} sub={actualReady ? fmtPct((() => { const rev = scopedAssignedRows.reduce((s, r) => s + n(r.buyer_revenue), 0); const mg = scopedAssignedRows.reduce((s, r) => s + n(r.actual_margin), 0); return rev > 0 ? (mg / rev) * 100 : null; })()) : "Actual cost not entered"} />
          <KpiCard title="Pending Revenue (USD)" value={fmtMoney(pendingRevenue)} />
          <KpiCard title="Pending Planned Cost (USD)" value={fmtMoney(pendingPlannedCost)} />
          <KpiCard title="Pending Margin (USD)" value={fmtMoney(pendingPlannedMargin)} />
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard title="Completed OTD %" value={fmtOtd(assignedCompletedDelivery > 0 ? (assignedOnTimeDelivery / assignedCompletedDelivery) * 100 : null, assignedCompletedDelivery)} sub="Ready orders only" />
          <KpiCard title="Active Vendors" value={fmtQty(scopedAssignedRows.length)} />
          <KpiCard title="Pending Vendors" value={fmtQty(scopedAssignedRows.filter((r) => n(r.pending_qty) > 0).length)} />
          <KpiCard title="Late Vendors" value={fmtQty(scopedAssignedRows.filter((r) => n(r.late_count) > 0).length)} />
          <KpiCard title="Ordered Qty" value={fmtQty(scopedAssignedRows.reduce((s, r) => s + n(r.ordered_qty), 0))} />
          <KpiCard title="Shipped Qty" value={fmtQty(scopedAssignedRows.reduce((s, r) => s + n(r.shipped_qty), 0))} />
          <KpiCard title="Pending Qty" value={fmtQty(scopedAssignedRows.reduce((s, r) => s + n(r.pending_qty), 0))} />
          <KpiCard title="Unassigned Revenue (USD)" value={fmtMoney(unassignedRevenue)} sub={`${fmtQty(unassignedRows.length)} row(s)`} />
        </div>


        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Vendor Ranking</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <KpiCard
                title="Top Revenue Vendor"
                value={safeText(ranking?.highlights?.top_revenue_vendor?.vendor_name) || "-"}
                sub={ranking?.highlights?.top_revenue_vendor ? `Revenue ${fmtMoney(ranking?.highlights?.top_revenue_vendor?.buyer_revenue)}` : undefined}
              />
              <KpiCard
                title="Top Margin Vendor"
                value={safeText(ranking?.highlights?.top_margin_vendor?.vendor_name) || "-"}
                sub={ranking?.highlights?.top_margin_vendor ? `Margin ${fmtPct(ranking?.highlights?.top_margin_vendor?.planned_margin_pct)}` : undefined}
              />
              <KpiCard
                title="Highest Pending Vendor"
                value={safeText(ranking?.highlights?.highest_pending_vendor?.vendor_name) || "-"}
                sub={ranking?.highlights?.highest_pending_vendor ? `Pending ${fmtMoney(ranking?.highlights?.highest_pending_vendor?.pending_revenue)}` : undefined}
              />
              <KpiCard
                title="Worst OTD Vendor"
                value={safeText(ranking?.highlights?.worst_otd_vendor?.vendor_name) || "-"}
                sub={ranking?.highlights?.worst_otd_vendor ? `OTD ${fmtPct(ranking?.highlights?.worst_otd_vendor?.otd_pct)}` : undefined}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <div className="overflow-auto rounded-xl border">
                <table className="min-w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Top Revenue</th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground">Revenue</th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground">Margin %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(ranking?.rankings?.by_revenue ?? []).map((r, i) => (
                      <tr key={`rev-${r.vendor_id}-${i}`} className="border-t">
                        <td className="px-3 py-2">{r.vendor_name}</td>
                        <td className="px-3 py-2 text-right">{fmtMoney(r.buyer_revenue)}</td>
                        <td className="px-3 py-2 text-right">{fmtPct(r.planned_margin_pct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="overflow-auto rounded-xl border">
                <table className="min-w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Top Margin %</th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground">Margin %</th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(ranking?.rankings?.by_margin_pct ?? []).map((r, i) => (
                      <tr key={`mg-${r.vendor_id}-${i}`} className="border-t">
                        <td className="px-3 py-2">{r.vendor_name}</td>
                        <td className="px-3 py-2 text-right">{fmtPct(r.planned_margin_pct)}</td>
                        <td className="px-3 py-2 text-right">{fmtMoney(r.buyer_revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="overflow-auto rounded-xl border">
                <table className="min-w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Highest Pending</th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground">Pending Revenue</th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground">Pending Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(ranking?.rankings?.by_pending_revenue ?? []).map((r, i) => (
                      <tr key={`pd-${r.vendor_id}-${i}`} className="border-t">
                        <td className="px-3 py-2">{r.vendor_name}</td>
                        <td className="px-3 py-2 text-right">{fmtMoney(r.pending_revenue)}</td>
                        <td className="px-3 py-2 text-right">{fmtQty(r.pending_qty)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="overflow-auto rounded-xl border">
                <table className="min-w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Worst OTD</th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground">OTD %</th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground">Avg Delay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(ranking?.rankings?.by_otd_asc ?? []).map((r, i) => (
                      <tr key={`otd-${r.vendor_id}-${i}`} className="border-t">
                        <td className="px-3 py-2">{r.vendor_name}</td>
                        <td className="px-3 py-2 text-right">{fmtOtd(r.otd_pct, r.completed_delivery_count)}</td>
                        <td className="px-3 py-2 text-right">{fmtDelayLabel(r.avg_delay_days)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </CardContent>
        </Card>

        {unassignedRows.length > 0 ? (
          <Card className="border-amber-300">
            <CardContent className="p-4">
              <div className="text-sm font-medium text-amber-700">Unassigned vendor rows detected</div>
              <div className="mt-1 text-sm text-muted-foreground">
                {fmtQty(unassignedRows.length)} vendor summary row(s), Revenue {fmtMoney(unassignedRevenue)}, Pending Qty {fmtQty(unassignedPendingQty)}
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Separator />

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">
            Vendor Scope: {selectedVendorId === "ALL" ? "All Vendors" : selectedVendorName || selectedVendorId}
          </Badge>
          {selectedVendorId !== "ALL" ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSelectedVendorId("ALL");
                setSelectedVendorName("");
                setVendorFilter("ALL");
              }}
            >
              Back to All Vendors
            </Button>
          ) : null}
        </div>

        {error ? (
          <Card>
            <CardContent className="p-6 text-sm text-destructive">{error}</CardContent>
          </Card>
        ) : null}

        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="grid w-full grid-cols-5 md:w-auto">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="pending">Pending</TabsTrigger>
            <TabsTrigger value="margin">Margin</TabsTrigger>
            <TabsTrigger value="delivery">Delivery</TabsTrigger>
            <TabsTrigger value="orders">Orders</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <DataTable
              rows={visibleOverviewRows}
              columns={[
                {
                  key: "vendor_name",
                  label: "Vendor",
                  render: (r) => (
                    <div className="flex items-center gap-2">
                      <StatusBadge row={r} />
                      <div>
                        <button
                          type="button"
                          className="font-medium hover:underline"
                          onClick={() => handleVendorSelect(r)}
                        >
                          {safeText(r.vendor_name) || "(No Vendor)"}
                        </button>
                        <div className="text-xs text-muted-foreground">
                          {safeText(r.vendor_code) || "-"}
                        </div>
                      </div>
                    </div>
                  ),
                },
                { key: "po_count", label: "POs", render: (r) => fmtQty(r.po_count) },
                { key: "ordered_qty", label: "Ordered Qty", render: (r) => fmtQty(r.ordered_qty) },
                { key: "shipped_qty", label: "Shipped Qty", render: (r) => fmtQty(r.shipped_qty) },
                { key: "pending_qty", label: "Pending Qty", render: (r) => fmtQty(r.pending_qty) },
                { key: "buyer_revenue", label: "Revenue", render: (r) => fmtMoney(r.buyer_revenue) },
                { key: "planned_margin", label: "Planned Margin", render: (r) => fmtMoney(r.planned_margin) },
                { key: "planned_margin_pct", label: "Planned %", render: (r) => fmtPct(r.planned_margin_pct) },
                { key: "otd_pct", label: "OTD %", render: (r) => fmtOtd(r.otd_pct, r.completed_delivery_count) },
                { key: "avg_delay_days", label: "Avg Delay", render: (r) => fmtDelayLabel(r.avg_delay_days) },
              ]}
            />
          </TabsContent>

          <TabsContent value="pending">
            <DataTable
              rows={visiblePendingRows}
              columns={[
                { key: "vendor_name", label: "Vendor", render: (r) => <button type="button" className="hover:underline" onClick={() => handleVendorSelect(r)}>{safeText(r.vendor_name) || "(No Vendor)"}</button> },
                { key: "po_count", label: "POs", render: (r) => fmtQty(r.po_count) },
                { key: "ordered_qty", label: "Ordered Qty", render: (r) => fmtQty(r.ordered_qty) },
                { key: "shipped_qty", label: "Shipped Qty", render: (r) => fmtQty(r.shipped_qty) },
                { key: "pending_qty", label: "Pending Qty", render: (r) => fmtQty(r.pending_qty) },
                { key: "buyer_revenue", label: "Revenue", render: (r) => fmtMoney(r.buyer_revenue) },
                { key: "planned_vendor_cost_usd", label: "Planned Cost", render: (r) => fmtMoney(r.planned_vendor_cost_usd) },
                { key: "planned_margin", label: "Planned Margin", render: (r) => fmtMoney(r.planned_margin) },
              ]}
            />
          </TabsContent>

          <TabsContent value="margin">
            <DataTable
              rows={visibleMarginRows}
              columns={[
                { key: "vendor_name", label: "Vendor", render: (r) => <button type="button" className="hover:underline" onClick={() => handleVendorSelect(r)}>{safeText(r.vendor_name) || "(No Vendor)"}</button> },
                { key: "buyer_revenue", label: "Revenue", render: (r) => fmtMoney(r.buyer_revenue) },
                { key: "planned_vendor_cost_usd", label: "Planned Cost", render: (r) => fmtMoney(r.planned_vendor_cost_usd) },
                { key: "actual_vendor_cost_usd", label: "Actual Cost", render: (r) => n(r.actual_vendor_cost_usd) > 0 ? fmtMoney(r.actual_vendor_cost_usd) : "-" },
                { key: "planned_margin", label: "Planned Margin", render: (r) => fmtMoney(r.planned_margin) },
                { key: "planned_margin_pct", label: "Planned %", render: (r) => fmtPct(r.planned_margin_pct) },
                { key: "actual_margin", label: "Actual Margin", render: (r) => n(r.actual_vendor_cost_usd) > 0 ? fmtMoney(r.actual_margin) : "-" },
                { key: "actual_margin_pct", label: "Actual %", render: (r) => n(r.actual_vendor_cost_usd) > 0 ? fmtPct(r.actual_margin_pct) : "-" },
              ]}
            />
          </TabsContent>

          <TabsContent value="delivery">
            <DataTable
              rows={visibleDeliveryRows}
              columns={[
                { key: "vendor_name", label: "Vendor", render: (r) => <button type="button" className="hover:underline" onClick={() => handleVendorSelect(r)}>{safeText(r.vendor_name) || "(No Vendor)"}</button> },
                { key: "completed_delivery_count", label: "Ready Orders", render: (r) => fmtQty(r.completed_delivery_count) },
                { key: "on_time_count", label: "On Time", render: (r) => fmtQty(r.on_time_count) },
                { key: "late_count", label: "Late", render: (r) => fmtQty(r.late_count) },
                { key: "pending_delivery_count", label: "Pending", render: (r) => fmtQty(r.pending_delivery_count) },
                { key: "otd_pct", label: "OTD %", render: (r) => fmtOtd(r.otd_pct, r.completed_delivery_count) },
                { key: "avg_delay_days", label: "Avg Delay", render: (r) => fmtDelayLabel(r.avg_delay_days) },
                { key: "worst_delay_days", label: "Worst Delay", render: (r) => fmtDelayLabel(r.worst_delay_days) },
              ]}
            />
          </TabsContent>

          <TabsContent value="orders">
            <OrdersTable rows={ordersRows} selectedVendorName={selectedVendorName} />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
