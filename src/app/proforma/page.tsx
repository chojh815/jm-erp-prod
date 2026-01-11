"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import AppShell from "@/components/layout/AppShell";
import type { AppRole } from "@/config/menuConfig";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type Role = AppRole;

type ProformaListItem = {
  id: string;
  invoiceNo: string;
  poNo?: string | null;
  buyerName?: string | null;
  currency?: string | null;
  createdAt?: string | null;
  subtotal?: number | null;
};

function fmtMoney(currency: string | null | undefined, v: number | null | undefined) {
  const n = Number(v ?? 0);
  const safe = Number.isFinite(n) ? n : 0;
  const cur = (currency ?? "").toString().trim() || "USD";
  return `${cur} ${safe.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(v?: string | null) {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString();
}

async function fetchJSON(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error || data?.message || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

export default function ProformaListPage() {
  const router = useRouter();
  const role = "admin" as Role; // AppShell 내부에서 role 활용(현재 프로젝트 방식 유지)

  const [q, setQ] = React.useState("");
  const [items, setItems] = React.useState<ProformaListItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (q.trim()) qs.set("q", q.trim());
      const url = `/api/proforma/list?${qs.toString()}`;
      const json = await fetchJSON(url);
      const list: ProformaListItem[] = Array.isArray(json?.items) ? json.items : [];
      setItems(list);
    } catch (e: any) {
      setItems([]);
      setError(e?.message || "Failed to load proforma list");
    } finally {
      setLoading(false);
    }
  }, [q]);

  React.useEffect(() => {
    // 첫 진입 시 자동 로드
    load();
  }, [load]);

  const onSearch = React.useCallback(() => {
    load();
  }, [load]);

  const onReset = React.useCallback(() => {
    setQ("");
    // reset 후 즉시 전체 로드
    setTimeout(() => load(), 0);
  }, [load]);

  const openPO = (poNo?: string | null) => {
    // ✅ Open PO uses PO No (not UUID). PO Samples route resolves po_no -> header id internally.

    if (!poNo) return;
    // 기존 PO 상세/샘플 화면 규칙에 맞춰 필요시 경로만 조정
    router.push(`/po/${encodeURIComponent(poNo)}/samples`);
  };

  const openPDF = (id: string) => {
    // ✅ PDF는 /api/proforma/[id]/pdf 라우트를 사용
    const url = `/api/proforma/${encodeURIComponent(id)}/pdf`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <AppShell
      role={role}
      title="Proforma Invoices"
      description="Search and open Proforma Invoices created from Purchase Orders."
    >
      <div className="p-4 space-y-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Proforma Invoices</CardTitle>
              <div className="text-sm text-muted-foreground mt-1">
                Search and open Proforma Invoices created from Purchase Orders.
              </div>
            </div>
            <Button variant="ghost" onClick={() => router.push("/po/create")}>
              Go to PO Create
            </Button>
          </CardHeader>

          <CardContent className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by Invoice No, PO No, Buyer..."
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSearch();
                }}
              />
              <div className="flex gap-2">
                <Button onClick={onSearch} disabled={loading}>
                  Search
                </Button>
                <Button variant="outline" onClick={onReset} disabled={loading}>
                  Reset
                </Button>
              </div>
            </div>

            {error ? (
              <div className="text-sm text-red-600">{error}</div>
            ) : null}

            <div className="overflow-x-auto border rounded-md">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="text-left">
                    <th className="p-3 font-medium">Invoice No</th>
                    <th className="p-3 font-medium">PO No</th>
                    <th className="p-3 font-medium">Buyer</th>
                    <th className="p-3 font-medium">Created At</th>
                    <th className="p-3 font-medium text-right">Subtotal</th>
                    <th className="p-3 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td className="p-3" colSpan={6}>
                        Loading...
                      </td>
                    </tr>
                  ) : items.length === 0 ? (
                    <tr>
                      <td className="p-3 text-muted-foreground" colSpan={6}>
                        No Proforma Invoice found.
                      </td>
                    </tr>
                  ) : (
                    items.map((it) => (
                      <tr key={it.id} className="border-t">
                        <td className="p-3 whitespace-nowrap">{it.invoiceNo}</td>
                        <td className="p-3 whitespace-nowrap">{it.poNo ?? ""}</td>
                        <td className="p-3">{it.buyerName ?? ""}</td>
                        <td className="p-3 whitespace-nowrap">{fmtDate(it.createdAt)}</td>
                        <td className="p-3 text-right whitespace-nowrap">
                          {fmtMoney(it.currency, it.subtotal)}
                        </td>
                        <td className="p-3 text-right whitespace-nowrap">
                          <div className="inline-flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openPO(it.poNo)}
                              disabled={!it.poNo}
                            >
                              PO (Samples)
                            </Button>
                            <Button size="sm" onClick={() => openPDF(it.id)}>
                              PDF
                            </Button>
                          </div>
                        </td>
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
