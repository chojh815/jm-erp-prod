"use client";

import * as React from "react";
import { useParams } from "next/navigation";

import AppShell from "@/components/layout/AppShell";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type ValuationRow = {
  costing_id: string;
  as_of_date: string; // YYYY-MM-DD
  default_currency: string;
  offer_price_usd: number | null;

  materials_total_usd: number;
  operations_total_usd: number;
  total_cost_usd: number;
  margin_pct: number;
};

type SnapshotRow = {
  id: string;
  costing_id: string;
  as_of_date: string;
  base_currency: string;
  materials_total_usd: number;
  operations_total_usd: number;
  total_cost_usd: number;
  offer_price_usd: number | null;
  margin_pct: number | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

function todayUtcDateString() {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function n(v: any, digits = 2) {
  const x = Number(v ?? 0);
  if (!isFinite(x)) return "0";
  return x.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export default function CostingDetailValuationPanel() {
  const params = useParams();
  const id = String((params as any)?.id || "");

  const [asOfDate, setAsOfDate] = React.useState<string>(todayUtcDateString());
  const [note, setNote] = React.useState<string>("");
  const [loadingPreview, setLoadingPreview] = React.useState(false);
  const [loadingSave, setLoadingSave] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const [valuation, setValuation] = React.useState<ValuationRow | null>(null);
  const [snapshots, setSnapshots] = React.useState<SnapshotRow[]>([]);
  const [loadingSnapshots, setLoadingSnapshots] = React.useState(false);

  async function fetchPreview() {
    if (!id) return;
    setErr(null);
    setLoadingPreview(true);
    try {
      const r = await fetch(`/api/costings/${encodeURIComponent(id)}/valuation?as_of=${encodeURIComponent(asOfDate)}`, {
        method: "GET",
        headers: { accept: "application/json" },
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error || `Preview failed (${r.status})`);
      setValuation(j.row as ValuationRow);
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setLoadingPreview(false);
    }
  }

  async function fetchSnapshots() {
    if (!id) return;
    setLoadingSnapshots(true);
    try {
      const r = await fetch(`/api/costings/${encodeURIComponent(id)}/valuation/snapshots`, {
        method: "GET",
        headers: { accept: "application/json" },
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error || `Snapshots failed (${r.status})`);
      setSnapshots(Array.isArray(j.rows) ? j.rows : []);
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setLoadingSnapshots(false);
    }
  }

  async function saveSnapshot() {
    if (!id) return;
    if (!window.confirm("Do you want to save this valuation snapshot? Existing snapshot for the same date may be overwritten.")) return;
    setErr(null);
    setLoadingSave(true);
    try {
      const r = await fetch(`/api/costings/${encodeURIComponent(id)}/valuation/snapshots`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ as_of_date: asOfDate, note: note || null, overwrite: true }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error || `Save snapshot failed (${r.status})`);
      await fetchPreview();
      await fetchSnapshots();
      alert("Saved.");
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setLoadingSave(false);
    }
  }

  React.useEffect(() => {
    fetchSnapshots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <AppShell title="Costing Detail">
      <div className="space-y-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>FX Valuation (as-of)</CardTitle>
              <div className="text-sm text-muted-foreground">
                Revalue USD totals using FX history at a specific date (does not overwrite current totals).
              </div>
            </div>
            <Badge variant="secondary">USD Base</Badge>
          </CardHeader>

          <CardContent className="space-y-3">
            {err ? (
              <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">{err}</div>
            ) : null}

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <div className="text-sm font-medium">Valuation Date (UTC)</div>
                <Input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} />
              </div>

              <div className="space-y-1 md:col-span-2">
                <div className="text-sm font-medium">Snapshot Note (optional)</div>
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g., Month-end valuation" />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={fetchPreview} disabled={loadingPreview || !asOfDate}>
                {loadingPreview ? "Previewing..." : "Preview"}
              </Button>
              <Button onClick={saveSnapshot} disabled={loadingSave || !asOfDate} variant="secondary">
                {loadingSave ? "Saving..." : "Save Snapshot"}
              </Button>
              <Button onClick={fetchSnapshots} disabled={loadingSnapshots} variant="outline">
                {loadingSnapshots ? "Refreshing..." : "Refresh Snapshots"}
              </Button>
            </div>

            {valuation ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <Card className="md:col-span-2">
                  <CardHeader>
                    <CardTitle className="text-base">As-of Summary</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span>Materials (USD)</span>
                      <span className="font-medium">{n(valuation.materials_total_usd, 4)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Operations (USD)</span>
                      <span className="font-medium">{n(valuation.operations_total_usd, 4)}</span>
                    </div>
                    <div className="flex items-center justify-between border-t pt-2">
                      <span>Total Cost (USD)</span>
                      <span className="font-semibold">{n(valuation.total_cost_usd, 4)}</span>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Offer</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span>Offer Price (USD)</span>
                      <span className="font-semibold">{n(valuation.offer_price_usd ?? 0, 4)}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">Offer comes from header (offer_price_usd)</div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Margin</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span>Margin %</span>
                      <span className="font-semibold">{n(valuation.margin_pct, 2)}%</span>
                    </div>
                    <div className="text-xs text-muted-foreground">Margin uses as-of total_cost_usd</div>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                Click <b>Preview</b> to compute USD totals at the selected as-of date.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Saved Snapshots</CardTitle>
            <Badge variant="outline">{snapshots.length}</Badge>
          </CardHeader>
          <CardContent>
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>As-of</TableHead>
                    <TableHead className="text-right">Materials (USD)</TableHead>
                    <TableHead className="text-right">Operations (USD)</TableHead>
                    <TableHead className="text-right">Total (USD)</TableHead>
                    <TableHead className="text-right">Offer (USD)</TableHead>
                    <TableHead className="text-right">Margin %</TableHead>
                    <TableHead>Note</TableHead>
                    <TableHead>Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {snapshots.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-sm text-muted-foreground">
                        No snapshots saved yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    snapshots.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium">{s.as_of_date}</TableCell>
                        <TableCell className="text-right">{n(s.materials_total_usd, 4)}</TableCell>
                        <TableCell className="text-right">{n(s.operations_total_usd, 4)}</TableCell>
                        <TableCell className="text-right font-semibold">{n(s.total_cost_usd, 4)}</TableCell>
                        <TableCell className="text-right">{n(s.offer_price_usd ?? 0, 4)}</TableCell>
                        <TableCell className="text-right">{n(s.margin_pct ?? 0, 2)}%</TableCell>
                        <TableCell className="max-w-[220px] truncate">{s.note ?? ""}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{new Date(s.updated_at).toLocaleString()}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="mt-2 text-xs text-muted-foreground">
              Snapshots are stored in <code>costing_fx_valuations</code> and do not overwrite current totals in{" "}
              <code>costing_headers</code>.
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
