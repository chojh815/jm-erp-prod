"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import AppShell from "@/components/layout/AppShell";
import type { AppRole } from "@/config/menuConfig";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type DevRole = AppRole;

type Row = {
  id: string;
  po_no: string | null;
  buyer_name: string | null;
  buyer_code: string | null;
  currency: string | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
};

function fmtDate(s: string | null) {
  if (!s) return "-";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toISOString().slice(0, 10);
}

function statusBadge(st?: string | null) {
  const v = String(st ?? "").toUpperCase();
  const base = "inline-block rounded px-2 py-0.5 text-xs font-medium";

  if (v === "SENT")
    return <span className={`${base} bg-blue-100 text-blue-700`}>SENT</span>;

  if (v === "CLOSED")
    return <span className={`${base} bg-gray-200 text-gray-700`}>CLOSED</span>;

  return <span className={`${base} bg-green-100 text-green-700`}>DRAFT</span>;
}

export default function WorkSheetsPage() {
  const router = useRouter();
  const role: DevRole = "admin";

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<Row[]>([]);

  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState<string>("ALL");

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      if (q.trim()) sp.set("q", q.trim());
      if (status !== "ALL") sp.set("status", status);

      const res = await fetch(`/api/work-sheets/list?${sp.toString()}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.error || "Load failed");
      setRows(json.rows ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Error");
    } finally {
      setLoading(false);
    }
  }, [q, status]);

  React.useEffect(() => {
    load();
  }, [load]);

  function openPdf(id: string) {
    window.open(`/work-sheets/${id}/pdf`, "_blank", "noopener,noreferrer");
  }

  return (
    <AppShell role={role}>
      <div className="p-6 space-y-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle>Work Sheets</CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={load} disabled={loading}>
                Refresh
              </Button>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="w-[280px]"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search PO / Buyer / Code"
              />
              <div className="w-[180px]">
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger>
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All</SelectItem>
                    <SelectItem value="DRAFT">DRAFT</SelectItem>
                    <SelectItem value="SENT">SENT</SelectItem>
                    <SelectItem value="CLOSED">CLOSED</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={load} disabled={loading}>
                Search
              </Button>
            </div>

            {error ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                {error}
              </div>
            ) : null}

            <div className="overflow-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/60">
                  <tr>
                    <th className="p-2 text-left">PO No</th>
                    <th className="p-2 text-left">Buyer</th>
                    <th className="p-2 text-left">Currency</th>
                    <th className="p-2 text-left">Status</th>
                    <th className="p-2 text-left">Created</th>
                    <th className="p-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td className="p-4 text-muted-foreground" colSpan={6}>
                        Loading...
                      </td>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td className="p-4 text-muted-foreground" colSpan={6}>
                        No work sheets.
                      </td>
                    </tr>
                  ) : (
                    rows.map((r) => (
                      <tr key={r.id} className="border-t">
                        <td className="p-2 font-medium">{r.po_no ?? "-"}</td>
                        <td className="p-2">
                          {r.buyer_name ?? "-"}{" "}
                          {r.buyer_code ? (
                            <span className="text-xs text-muted-foreground">
                              ({r.buyer_code})
                            </span>
                          ) : null}
                        </td>
                        <td className="p-2">{r.currency ?? "USD"}</td>
                        <td className="p-2">{statusBadge(r.status)}</td>
                        <td className="p-2">{fmtDate(r.created_at)}</td>
                        <td className="p-2 text-right">
                          <div className="inline-flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => router.push(`/work-sheets/${r.id}`)}
                            >
                              Detail
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => openPdf(r.id)}
                            >
                              PDF (Vendor)
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="text-xs text-muted-foreground">
              PDF(Vendor)는 새 탭에서 자동 생성/인쇄됩니다. (Buyer 가격/마진 없음)
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
