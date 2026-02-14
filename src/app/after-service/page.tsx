"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import AppShell from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Row = any;

const STATUS_OPTIONS = ["ALL", "OPEN", "NEGOTIATING", "APPROVED", "REJECTED", "CLOSED"] as const;

function fmtMoney(v: any) {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return "0.00";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function AfterServiceListPage() {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]>("ALL");
  const [poNo, setPoNo] = useState("");
  const [caseNo, setCaseNo] = useState("");
  const [start, setStart] = useState(""); // YYYY-MM-DD
  const [end, setEnd] = useState("");     // YYYY-MM-DD

  const totals = useMemo(() => {
    const totalClaims = rows.reduce((s, r) => s + (Number(r.claim_amount) || 0), 0);
    const totalApproved = rows.reduce((s, r) => s + (Number(r.approved_amount) || 0), 0);
    const totalLossUsd = rows.reduce((s, r) => s + (Number(r.loss_amount_usd) || 0), 0);
    return { totalClaims, totalApproved, totalLossUsd };
  }, [rows]);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (status !== "ALL") params.set("status", status);
      if (poNo.trim()) params.set("po_no", poNo.trim());
      if (caseNo.trim()) params.set("case_no", caseNo.trim());
      if (start) params.set("start", start);
      if (end) params.set("end", end);
      params.set("limit", "500");

      const res = await fetch(`/api/after-service/list?${params.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Failed to load");
      setRows(json.rows || []);
    } catch (e: any) {
      alert(e?.message || "Load failed");
    } finally {
      setLoading(false);
    }
  }

  async function createNew() {
    setLoading(true);
    try {
      const res = await fetch("/api/after-service/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New After Service", status: "OPEN" }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Create failed");
      const id = json.row?.id;
      if (!id) throw new Error("No id returned");
      window.location.href = `/after-service/${id}`;
    } catch (e: any) {
      alert(e?.message || "Create failed");
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <AppShell>
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold">After Service</h1>
            <div className="text-sm text-muted-foreground">
              Claims / post-shipment issue tracking (Phase 1)
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={load} variant="secondary" disabled={loading}>
              {loading ? "Loading..." : "Refresh"}
            </Button>
            <Button onClick={createNew} disabled={loading}>
              + New Case
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Filters</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
              <div className="space-y-1">
                <Label>Search</Label>
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="case_no / po_no / buyer / vendor / text" />
              </div>

              <div className="space-y-1">
                <Label>Status</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as any)}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label>PO No</Label>
                <Input value={poNo} onChange={(e) => setPoNo(e.target.value)} placeholder="e.g. PO-1234" />
              </div>

              <div className="space-y-1">
                <Label>Case No</Label>
                <Input value={caseNo} onChange={(e) => setCaseNo(e.target.value)} placeholder="e.g. AS-26-000001" />
              </div>

              <div className="space-y-1 md:col-span-2">
  <Label>Date Range</Label>
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 min-w-0">
    <Input
      type="date"
      value={start}
      onChange={(e) => setStart(e.target.value)}
      className="w-full min-w-0"
    />
    <Input
      type="date"
      value={end}
      onChange={(e) => setEnd(e.target.value)}
      className="w-full min-w-0"
    />
  </div>
</div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button onClick={load} variant="secondary" disabled={loading}>
                Apply
              </Button>
            </div>

            <Separator />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
              <div className="rounded-md border p-3">
                <div className="text-muted-foreground">Total Claim Amount</div>
                <div className="text-lg font-semibold">US$ {fmtMoney(totals.totalClaims)}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-muted-foreground">Total Approved</div>
                <div className="text-lg font-semibold">US$ {fmtMoney(totals.totalApproved)}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-muted-foreground">Total Loss (USD)</div>
                <div className="text-lg font-semibold">US$ {fmtMoney(totals.totalLossUsd)}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Cases ({rows.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-auto border rounded-md">
              <table className="min-w-[980px] w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="text-left">
                    <th className="p-2">Case</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Type</th>
                    <th className="p-2">PO</th>
                    <th className="p-2">Buyer</th>
                    <th className="p-2">Vendor</th>
                    <th className="p-2 text-right">Claim</th>
                    <th className="p-2 text-right">Approved</th>
                    <th className="p-2 text-right">Loss(USD)</th>
                    <th className="p-2">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td className="p-4 text-muted-foreground" colSpan={10}>
                        No data.
                      </td>
                    </tr>
                  ) : (
                    rows.map((r) => (
                      <tr key={r.id} className="border-t hover:bg-muted/30">
                        <td className="p-2 font-medium">
                          <Link className="underline" href={`/after-service/${r.id}`}>
                            {r.case_no || r.id?.slice(0, 8)}
                          </Link>
                          <div className="text-xs text-muted-foreground">{r.title || ""}</div>
                        </td>
                        <td className="p-2">{r.status}</td>
                        <td className="p-2">{r.issue_type}</td>
                        <td className="p-2">{r.po_no || "-"}</td>
                        <td className="p-2">{r.buyer_name || "-"}</td>
                        <td className="p-2">{r.vendor_name || "-"}</td>
                        <td className="p-2 text-right">US$ {fmtMoney(r.claim_amount)}</td>
                        <td className="p-2 text-right">US$ {fmtMoney(r.approved_amount)}</td>
                        <td className="p-2 text-right">US$ {fmtMoney(r.loss_amount_usd)}</td>
                        <td className="p-2">{(r.updated_at || "").toString().slice(0, 10)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
