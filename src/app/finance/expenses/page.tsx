"use client";

import * as React from "react";
import Link from "next/link";

import AppShell from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function fmtMoney(n: number | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n || 0));
}

function fmtDate(v: string | null | undefined) {
  if (!v) return "-";
  return v.slice(0, 10);
}

type ExpenseListRow = {
  id: string;
  expense_no: string | null;
  expense_date: string | null;
  posting_month: string | null;
  expense_type_code: string | null;
  description: string | null;
  currency: string | null;
  fx_rate_to_usd: number | null;
  total_amount_original: number | null;
  total_amount_usd: number | null;
  scope_type: string | null;
  status: string | null;
  note: string | null;
  created_at: string | null;
  updated_at: string | null;
  allocation_count: number;
};

function StatusBadge({ status }: { status: string | null }) {
  if (status === "CONFIRMED") return <Badge>CONFIRMED</Badge>;
  if (status === "DRAFT") return <Badge variant="secondary">DRAFT</Badge>;
  if (status === "VOID") return <Badge variant="destructive">VOID</Badge>;
  return <Badge variant="outline">{status || "-"}</Badge>;
}

export default function ExpensesListPage() {
  const [q, setQ] = React.useState("");
  const [qInput, setQInput] = React.useState("");
  const [status, setStatus] = React.useState("ALL");
  const [scope, setScope] = React.useState("ALL");
  const [page, setPage] = React.useState(1);
  const [items, setItems] = React.useState<ExpenseListRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [total, setTotal] = React.useState(0);
  const [totalPages, setTotalPages] = React.useState(1);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = new URL("/api/finance/expenses", window.location.origin);
      if (q) url.searchParams.set("q", q);
      if (status && status !== "ALL") url.searchParams.set("status", status);
      if (scope && scope !== "ALL") url.searchParams.set("scope", scope);
      url.searchParams.set("page", String(page));
      url.searchParams.set("page_size", "20");

      const res = await fetch(url.toString(), { cache: "no-store" });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || "Failed to load expenses");

      setItems(Array.isArray(json.items) ? json.items : []);
      setTotal(Number(json.total || 0));
      setTotalPages(Number(json.total_pages || 1));
    } catch (e: any) {
      setError(e?.message || String(e));
      setItems([]);
      setTotal(0);
      setTotalPages(1);
    } finally {
      setLoading(false);
    }
  }, [page, q, scope, status]);

  React.useEffect(() => {
    load();
  }, [load]);

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setQ(qInput.trim());
  };

  const onReset = () => {
    setQInput("");
    setQ("");
    setStatus("ALL");
    setScope("ALL");
    setPage(1);
  };

  return (
    <AppShell title="Finance / Expenses">
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Finance · Expenses</h1>
            <p className="text-sm text-muted-foreground">
              Saved expenses list. Click a row or Detail to review, edit, confirm, void, or delete.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={load} disabled={loading}>
              Refresh
            </Button>
            <Button asChild>
              <Link href="/finance/expenses/new">+ New Expense</Link>
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Filters</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSearch} className="grid gap-4 md:grid-cols-12">
              <div className="space-y-2 md:col-span-6">
                <div className="text-sm font-medium">Search</div>
                <Input
                  value={qInput}
                  onChange={(e) => setQInput(e.target.value)}
                  placeholder="Expense No / Type / Description / Note / Scope / Status"
                />
              </div>

              <div className="space-y-2 md:col-span-2">
                <div className="text-sm font-medium">Status</div>
                <Select
                  value={status}
                  onValueChange={(v) => {
                    setStatus(v);
                    setPage(1);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All</SelectItem>
                    <SelectItem value="DRAFT">DRAFT</SelectItem>
                    <SelectItem value="CONFIRMED">CONFIRMED</SelectItem>
                    <SelectItem value="VOID">VOID</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2 md:col-span-2">
                <div className="text-sm font-medium">Scope</div>
                <Select
                  value={scope}
                  onValueChange={(v) => {
                    setScope(v);
                    setPage(1);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All</SelectItem>
                    <SelectItem value="PO">PO</SelectItem>
                    <SelectItem value="SHIPMENT">SHIPMENT</SelectItem>
                    <SelectItem value="LINE">LINE</SelectItem>
                    <SelectItem value="FACTORY">FACTORY</SelectItem>
                    <SelectItem value="GENERAL">GENERAL</SelectItem>
                    <SelectItem value="MULTI">MULTI</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-end gap-2 md:col-span-2">
                <Button type="submit" disabled={loading} className="flex-1">
                  Search
                </Button>
                <Button type="button" variant="secondary" onClick={onReset} disabled={loading}>
                  Reset
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {error ? (
          <Card className="border-destructive">
            <CardContent className="py-3 text-sm text-destructive">{error}</CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Saved Expenses</CardTitle>
            <div className="text-sm text-muted-foreground">
              Total: <span className="font-medium text-foreground">{total}</span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="text-left">
                    <th className="p-2">Expense No</th>
                    <th className="p-2">Date</th>
                    <th className="p-2">Type</th>
                    <th className="p-2">Scope</th>
                    <th className="p-2">Description</th>
                    <th className="p-2 text-right">Original</th>
                    <th className="p-2 text-right">USD</th>
                    <th className="p-2 text-center">Alloc.</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Updated</th>
                    <th className="p-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td className="p-6 text-center text-muted-foreground" colSpan={11}>
                        Loading…
                      </td>
                    </tr>
                  ) : items.length === 0 ? (
                    <tr>
                      <td className="p-6 text-center text-muted-foreground" colSpan={11}>
                        No expenses found.
                      </td>
                    </tr>
                  ) : (
                    items.map((row) => (
                      <tr key={row.id} className="border-t hover:bg-muted/30">
                        <td className="p-2 font-medium">
                          <Link href={`/finance/expenses/${row.id}`} className="hover:underline">
                            {row.expense_no || "-"}
                          </Link>
                        </td>
                        <td className="p-2">{fmtDate(row.expense_date)}</td>
                        <td className="p-2">{row.expense_type_code || "-"}</td>
                        <td className="p-2">{row.scope_type || "-"}</td>
                        <td className="p-2">
                          <div className="max-w-[280px] truncate" title={row.description || row.note || ""}>
                            {row.description || row.note || "-"}
                          </div>
                        </td>
                        <td className="p-2 text-right">
                          {fmtMoney(row.total_amount_original)} {row.currency || ""}
                        </td>
                        <td className="p-2 text-right">{fmtMoney(row.total_amount_usd)}</td>
                        <td className="p-2 text-center">{Number(row.allocation_count || 0)}</td>
                        <td className="p-2">
                          <StatusBadge status={row.status} />
                        </td>
                        <td className="p-2">{fmtDate(row.updated_at || row.created_at)}</td>
                        <td className="p-2 text-right">
                          <Button asChild size="sm" variant="outline">
                            <Link href={`/finance/expenses/${row.id}`}>Detail</Link>
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex items-center justify-between gap-4">
              <div className="text-sm text-muted-foreground">
                Page {page} / {totalPages}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={loading || page <= 1}
                >
                  Prev
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={loading || page >= totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
