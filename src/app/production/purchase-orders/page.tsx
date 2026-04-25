"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import AppShell from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { fmtCny } from "@/lib/productionOrders";

type Row = {
  id: string;
  order_no: string;
  order_date: string;
  vendor_name: string;
  buyer_po_ref?: string | null;
  work_sheet_ref?: string | null;
  delivery_date?: string | null;
  status: string;
  subtotal_amount: number;
};

function statusBadge(status?: string | null) {
  const value = String(status ?? "").toUpperCase();
  const base = "inline-flex rounded-full px-2 py-0.5 text-xs font-medium";
  if (value === "CONFIRMED") return <span className={`${base} bg-green-100 text-green-700`}>CONFIRMED</span>;
  if (value === "CANCELLED") return <span className={`${base} bg-slate-200 text-slate-700`}>CANCELLED</span>;
  return <span className={`${base} bg-amber-100 text-amber-700`}>DRAFT</span>;
}

export default function ProductionOrdersPage() {
  const router = useRouter();
  const [rows, setRows] = React.useState<Row[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState("ALL");

  const load = React.useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const sp = new URLSearchParams();
      if (q.trim()) sp.set("q", q.trim());
      if (status !== "ALL") sp.set("status", status);

      const res = await fetch(`/api/production/purchase-orders?${sp.toString()}`, {
        cache: "no-store",
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || "Failed to load production orders");
      }
      setRows(Array.isArray(json.rows) ? json.rows : []);
    } catch (e: any) {
      setError(e?.message || "Failed to load production orders");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [q, status]);

  React.useEffect(() => {
    load();
  }, [load]);

  return (
    <AppShell
      role="admin"
      title="Production Orders"
      description="生产订单列表 / Production order list"
    >
      <div className="space-y-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle>Filters / 查询条件</CardTitle>
            <Button asChild>
              <Link href="/production/purchase-orders/new">New Production Order</Link>
            </Button>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-[1fr_220px_auto]">
            <Input
              placeholder="Search order no, supplier, buyer PO, work sheet"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") load();
              }}
            />
            <select
              className="h-9 rounded-md border border-slate-300 bg-white px-2.5 text-sm outline-none focus:border-slate-900"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="ALL">全部 / All</option>
              <option value="DRAFT">草稿 / Draft</option>
              <option value="CONFIRMED">确认 / Confirmed</option>
              <option value="CANCELLED">取消 / Cancelled</option>
            </select>
            <Button variant="outline" onClick={load} disabled={loading}>
              Refresh
            </Button>
          </CardContent>
        </Card>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Orders / 发注单</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="min-w-full border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-500">
                  <th className="px-3 py-2">订单号 / Order No</th>
                  <th className="px-3 py-2">日期 / Date</th>
                  <th className="px-3 py-2">供应商 / Supplier</th>
                  <th className="px-3 py-2">客户PO / Buyer PO</th>
                  <th className="px-3 py-2">Work Sheet</th>
                  <th className="px-3 py-2">交期 / Delivery</th>
                  <th className="px-3 py-2">状态 / Status</th>
                  <th className="px-3 py-2 text-right">金额 / Amount</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-sm text-slate-500">
                      Loading...
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-sm text-slate-500">
                      No production orders found.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr
                      key={row.id}
                      className="cursor-pointer border-b border-slate-100 text-sm hover:bg-slate-50"
                      onClick={() => router.push(`/production/purchase-orders/${row.id}`)}
                    >
                      <td className="px-3 py-3 font-medium text-slate-950">{row.order_no}</td>
                      <td className="px-3 py-3">{row.order_date || "-"}</td>
                      <td className="px-3 py-3">{row.vendor_name || "-"}</td>
                      <td className="px-3 py-3">{row.buyer_po_ref || "-"}</td>
                      <td className="px-3 py-3">{row.work_sheet_ref || "-"}</td>
                      <td className="px-3 py-3">{row.delivery_date || "-"}</td>
                      <td className="px-3 py-3">{statusBadge(row.status)}</td>
                      <td className="px-3 py-3 text-right">{fmtCny(row.subtotal_amount)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

