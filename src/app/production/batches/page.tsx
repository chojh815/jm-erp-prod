// src/app/production/batches/page.tsx
"use client";

import * as React from "react";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

type BatchRow = {
  id: string;
  buyer_code: string;
  mfg_date: string; // YYYY-MM-DD
  label_type: string;
  version: number;
  batch_code: string;
  po_no: string | null;
  created_at: string;
};

function fmtDateTime(s?: string | null) {
  if (!s) return "";
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    return d.toLocaleString();
  } catch {
    return s ?? "";
  }
}

export default function ProductionBatchesPage() {
  const [mfgDate, setMfgDate] = React.useState<string>(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  });

  const [poNo, setPoNo] = React.useState<string>("");
  const [filterPoNo, setFilterPoNo] = React.useState<string>("");

  const [rows, setRows] = React.useState<BatchRow[]>([]);
  const [loading, setLoading] = React.useState(false);

  const [saving, setSaving] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  const [updating, setUpdating] = React.useState(false);

  const [error, setError] = React.useState<string | null>(null);

  const [dateRows, setDateRows] = React.useState<BatchRow[]>([]);
  const [dateVersions, setDateVersions] = React.useState<number[]>([]);
  const [nextVersion, setNextVersion] = React.useState<number>(0);
  const [lastSaved, setLastSaved] = React.useState<BatchRow | null>(null);

  // Update-PO section state
  const [selectedVersion, setSelectedVersion] = React.useState<number | null>(null);
  const [selectedRow, setSelectedRow] = React.useState<BatchRow | null>(null);
  const [editPo, setEditPo] = React.useState<string>("");

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (filterPoNo.trim()) qs.set("po_no", filterPoNo.trim());

      const res = await fetch(`/api/production-batches${qs.toString() ? `?${qs.toString()}` : ""}`, {
        cache: "no-store",
      });
      const j = await res.json().catch(() => null);

      if (!res.ok || !j?.success) throw new Error(j?.message || `Failed to load: ${res.status}`);
      setRows(Array.isArray(j.rows) ? j.rows : []);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [filterPoNo]);

  const loadRowsForDate = React.useCallback(async (date: string) => {
    setError(null);
    try {
      const qs = new URLSearchParams();
      qs.set("mfg_date", date);

      const res = await fetch(`/api/production-batches?${qs.toString()}`, { cache: "no-store" });
      const j = await res.json().catch(() => null);

      if (!res.ok || !j?.success) throw new Error(j?.message || `Failed to load versions: ${res.status}`);

      const dr = (Array.isArray(j.rows) ? j.rows : []) as BatchRow[];
      // For date view, order asc version for UI selection
      const ordered = [...dr].sort((a, b) => a.version - b.version);
      setDateRows(ordered);

      const vs = ordered.map((r) => r.version);
      setDateVersions(vs);
      setNextVersion(vs.length ? Math.max(...vs) + 1 : 0);

      // keep selection if possible
      if (selectedVersion !== null) {
        const found = ordered.find((r) => r.version === selectedVersion) ?? null;
        setSelectedRow(found);
        setEditPo(found?.po_no ?? "");
      } else {
        setSelectedRow(null);
        setEditPo("");
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setDateRows([]);
      setDateVersions([]);
      setNextVersion(0);
      setSelectedRow(null);
      setEditPo("");
    }
  }, [selectedVersion]);

  React.useEffect(() => {
    load();
  }, [load]);

  React.useEffect(() => {
    if (mfgDate) loadRowsForDate(mfgDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mfgDate]);

  React.useEffect(() => {
    if (selectedVersion === null) {
      setSelectedRow(null);
      setEditPo("");
      return;
    }
    const found = dateRows.find((r) => r.version === selectedVersion) ?? null;
    setSelectedRow(found);
    setEditPo(found?.po_no ?? "");
  }, [selectedVersion, dateRows]);

  async function onSaveNextVersion() {
    setSaving(true);
    setError(null);
    setLastSaved(null);
    try {
      const payload = {
        mfg_date: mfgDate,
        po_no: poNo.trim() ? poNo.trim() : null,
        label_type: "M",
      };

      const res = await fetch("/api/production-batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => null);

      if (!res.ok || !j?.success) throw new Error(j?.message || `Failed to save: ${res.status}`);

      setLastSaved(j.row as BatchRow);
      await Promise.all([load(), loadRowsForDate(mfgDate)]);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  async function onUpdatePo() {
    if (!selectedRow) {
      setError("Select a version first.");
      return;
    }

    setUpdating(true);
    setError(null);
    try {
      const payload = {
        id: selectedRow.id,
        po_no: editPo.trim() ? editPo.trim() : null,
      };

      const res = await fetch("/api/production-batches", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => null);

      if (!res.ok || !j?.success) throw new Error(j?.message || `Failed to update: ${res.status}`);

      await Promise.all([load(), loadRowsForDate(mfgDate)]);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setUpdating(false);
    }
  }

  async function onDelete(row: BatchRow) {
    const ok = window.confirm(
      `Delete this batch?\n\n${row.batch_code} (v${row.version})\nMFG: ${row.mfg_date}\nPO: ${row.po_no ?? "-"}`
    );
    if (!ok) return;

    setDeletingId(row.id);
    setError(null);
    try {
      const res = await fetch(`/api/production-batches?id=${encodeURIComponent(row.id)}`, {
        method: "DELETE",
      });
      const j = await res.json().catch(() => null);

      if (!res.ok || !j?.success) throw new Error(j?.message || `Failed to delete: ${res.status}`);

      // if deleted selected row, clear selection
      if (selectedRow?.id === row.id) {
        setSelectedVersion(null);
        setSelectedRow(null);
        setEditPo("");
      }

      await Promise.all([load(), loadRowsForDate(mfgDate)]);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Production Batches (RED only)</h1>
        <p className="text-sm text-muted-foreground">
          Batch code = <span className="font-mono">J + YEAR_CODE + WEEK(01-52) + DAY + M + VERSION</span>
        </p>
      </div>

      <Card className="rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Save next version (auto)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <div className="text-sm font-medium">Manufacturing Date</div>
              <Input type="date" value={mfgDate} onChange={(e) => setMfgDate(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <div className="text-sm font-medium">PO No (optional)</div>
              <Input placeholder="e.g., PO-TEST-001" value={poNo} onChange={(e) => setPoNo(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <div className="text-sm font-medium">Action</div>
              <Button onClick={onSaveNextVersion} disabled={saving || !mfgDate}>
                {saving ? "Saving..." : `Save (v${nextVersion})`}
              </Button>
              <div className="text-xs text-muted-foreground">Auto: v0, v1, v2… per same manufacturing date</div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Existing versions for {mfgDate}:</span>
            {dateVersions.length === 0 ? (
              <span className="font-mono">none</span>
            ) : (
              dateVersions.map((v) => (
                <Badge key={v} variant="secondary" className="font-mono">
                  v{v}
                </Badge>
              ))
            )}
            <span className="text-muted-foreground ml-2">→ Next:</span>
            <Badge className="font-mono">v{nextVersion}</Badge>
          </div>

          {lastSaved && (
            <div className="rounded-xl border p-3 text-sm flex items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="font-medium">Saved</div>
                <div className="text-muted-foreground">
                  Batch: <span className="font-mono">{lastSaved.batch_code}</span> · Date:{" "}
                  <span className="font-mono">{lastSaved.mfg_date}</span> · Version:{" "}
                  <span className="font-mono">{lastSaved.version}</span> · PO:{" "}
                  <span className="font-mono">{lastSaved.po_no ?? "-"}</span>
                </div>
              </div>
              <Badge variant="secondary">RED</Badge>
            </div>
          )}

          {error && <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Update PO (select an existing version)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <div className="text-sm font-medium">Select Version (for {mfgDate})</div>
              <select
                className="h-10 rounded-md border bg-background px-3 text-sm"
                value={selectedVersion === null ? "" : String(selectedVersion)}
                onChange={(e) => {
                  const v = e.target.value === "" ? null : Number(e.target.value);
                  setSelectedVersion(v);
                }}
              >
                <option value="">-- select --</option>
                {dateRows.map((r) => (
                  <option key={r.id} value={r.version}>
                    v{r.version} · {r.batch_code}
                  </option>
                ))}
              </select>
              <div className="text-xs text-muted-foreground">
                Existing versions: {dateVersions.length ? dateVersions.map((v) => `v${v}`).join(", ") : "none"}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="text-sm font-medium">PO No</div>
              <Input
                placeholder="PO No"
                value={editPo}
                onChange={(e) => setEditPo(e.target.value)}
                disabled={!selectedRow}
              />
              <div className="text-xs text-muted-foreground">
                Selected: {selectedRow ? <span className="font-mono">{selectedRow.batch_code}</span> : "-"}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="text-sm font-medium">Action</div>
              <Button onClick={onUpdatePo} disabled={updating || !selectedRow}>
                {updating ? "Updating..." : "Update PO only"}
              </Button>
              <div className="text-xs text-muted-foreground">This does not change version or batch code.</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader className="pb-3">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <CardTitle className="text-lg">Batch List</CardTitle>
            <div className="flex items-center gap-2">
              <Input
                className="w-56"
                placeholder="Filter by PO No"
                value={filterPoNo}
                onChange={(e) => setFilterPoNo(e.target.value)}
              />
              <Button variant="outline" onClick={load} disabled={loading}>
                {loading ? "Loading..." : "Refresh"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground mb-3">
            URL: <span className="font-mono">/production/batches</span> · API:{" "}
            <span className="font-mono">/api/production-batches</span>
          </div>

          <div className="rounded-xl border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">MFG Date</TableHead>
                  <TableHead className="whitespace-nowrap">Version</TableHead>
                  <TableHead className="whitespace-nowrap">Batch Code</TableHead>
                  <TableHead className="whitespace-nowrap">PO No</TableHead>
                  <TableHead className="whitespace-nowrap">Created</TableHead>
                  <TableHead className="whitespace-nowrap text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      No rows
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono whitespace-nowrap">{r.mfg_date}</TableCell>
                      <TableCell className="font-mono whitespace-nowrap">{r.version}</TableCell>
                      <TableCell className="font-mono whitespace-nowrap">{r.batch_code}</TableCell>
                      <TableCell className="font-mono whitespace-nowrap">{r.po_no ?? "-"}</TableCell>
                      <TableCell className="whitespace-nowrap">{fmtDateTime(r.created_at)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        <Button variant="destructive" size="sm" onClick={() => onDelete(r)} disabled={!!deletingId}>
                          {deletingId === r.id ? "Deleting..." : "Delete"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
