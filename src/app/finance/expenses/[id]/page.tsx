"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";

import AppShell from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

import ExpenseForm, { AllocationRow, ExpenseHeaderDraft } from "../_components/ExpenseForm";

function fmtMoney(n: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n || 0);
}

function fmtDate(v: string | null | undefined) {
  return v ? String(v).slice(0, 10) : "-";
}

function formatBasisLabel(basis: string | null | undefined, basisValue: number | null | undefined) {
  const key = String(basis || "").toUpperCase();

  if (key === "REVENUE") {
    return `Revenue (Sales): ${fmtMoney(Number(basisValue || 0))}`;
  }
  if (key === "CBM") {
    return `CBM: ${fmtMoney(Number(basisValue || 0))}`;
  }
  if (key === "GW") {
    return `GW: ${fmtMoney(Number(basisValue || 0))}`;
  }
  if (key === "QTY") {
    return `Qty: ${fmtMoney(Number(basisValue || 0))}`;
  }
  if (key === "EQUAL") {
    return "Equal Split";
  }
  if (key === "MANUAL") {
    return basisValue != null ? `Manual: ${fmtMoney(Number(basisValue || 0))}` : "Manual";
  }

  return basisValue != null ? `${basis || "-"}: ${fmtMoney(Number(basisValue || 0))}` : (basis || "-");
}

export default function ExpenseDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id);

  const [loading, setLoading] = React.useState(false);
  const [data, setData] = React.useState<any>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/finance/expenses/${id}`, { cache: "no-store" });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || "Load failed");
      setData(json.data);
    } catch (e: any) {
      console.error(e);
      alert(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    load();
  }, [id]);

  const confirmDialog = (msg: string) => window.confirm(msg);

  const confirm = async () => {
    if (!confirmDialog("Confirm this expense? It will be locked and allocation results will be snapshotted.")) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/finance/expenses/${id}/confirm`, { method: "POST" });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || "Confirm failed");
      await load();
      alert(`Confirmed. Results: ${json.data?.results_count || 0}`);
    } catch (e: any) {
      console.error(e);
      alert(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const voidExpense = async () => {
    if (!confirmDialog("Void this expense? (soft delete results).")) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/finance/expenses/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...data.header, status: "VOID", allocations: data.allocations }),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || "Void failed");
      await load();
    } catch (e: any) {
      console.error(e);
      alert(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const del = async () => {
    if (!confirmDialog("Delete this draft expense?")) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/finance/expenses/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || "Delete failed");
      router.push("/finance/expenses");
    } catch (e: any) {
      console.error(e);
      alert(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const header = data?.header;
  const allocations = (data?.allocations || []) as AllocationRow[];
  const results = (data?.results || []) as any[];

  const statusBadge = (s: string) => {
    if (s === "CONFIRMED") return <Badge>CONFIRMED</Badge>;
    if (s === "DRAFT") return <Badge variant="secondary">DRAFT</Badge>;
    if (s === "VOID") return <Badge variant="destructive">VOID</Badge>;
    return <Badge variant="outline">{s}</Badge>;
  };

  return (
    <AppShell title="Finance / Expenses / Detail">
      <div className="space-y-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                {header?.expense_no || "Expense Detail"}
                {header?.status ? statusBadge(header.status) : null}
              </CardTitle>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={load} disabled={loading}>
                Refresh
              </Button>
              {header?.status === "DRAFT" ? (
                <>
                  <Button onClick={confirm} disabled={loading}>
                    Confirm
                  </Button>
                  <Button variant="destructive" onClick={del} disabled={loading}>
                    Delete
                  </Button>
                </>
              ) : null}
              {header?.status === "CONFIRMED" ? (
                <Button variant="outline" onClick={voidExpense} disabled={loading}>
                  Void (manual)
                </Button>
              ) : null}
            </div>
          </CardHeader>

          <CardContent className="text-sm">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
              <div>
                <div className="text-xs text-muted-foreground">Type</div>
                <div className="font-medium">{header?.expense_type_code}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Scope</div>
                <div className="font-medium">{header?.scope_type}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Amount</div>
                <div className="font-medium">
                  {fmtMoney(Number(header?.total_amount_original || 0))} {header?.currency}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">USD</div>
                <div className="font-medium">{fmtMoney(Number(header?.total_amount_usd || 0))}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {header?.status === "DRAFT" ? (
          <ExpenseForm
            mode="edit"
            initialHeader={header as Partial<ExpenseHeaderDraft>}
            initialAllocations={allocations}
          />
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Allocation Results (snapshot)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-xs text-muted-foreground">
              These rows are generated on Confirm. Profitability dashboard should SUM these.
            </div>

            <Separator />

            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="text-left">
                    <th className="p-2">Month</th>
                    <th className="p-2">PO</th>
                    <th className="p-2">Line</th>
                    <th className="p-2">Shipment</th>
                    <th className="p-2">Buyer</th>
                    <th className="p-2">Brand</th>
                    <th className="p-2 text-right">USD</th>
                    <th className="p-2">Basis</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r: any) => (
                    <tr key={r.id} className="border-t">
                      <td className="p-2">{fmtDate(r.posting_month)}</td>
                      <td className="p-2">{r.po_no || "-"}</td>
                      <td className="p-2">{r.po_line_label || "-"}</td>
                      <td className="p-2">{r.shipment_no || "-"}</td>
                      <td className="p-2">{r.buyer_name || "-"}</td>
                      <td className="p-2">{r.brand_name || "-"}</td>
                      <td className="p-2 text-right">{fmtMoney(Number(r.allocated_usd || 0))}</td>
                      <td className="p-2">{formatBasisLabel(r.allocated_basis, r.basis_value)}</td>
                    </tr>
                  ))}
                  {!results.length ? (
                    <tr>
                      <td className="p-6 text-center text-muted-foreground" colSpan={8}>
                        No results yet. Confirm the expense.
                      </td>
                    </tr>
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
