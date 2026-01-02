// src/app/invoices/create/page.tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import AppShell from "@/components/layout/AppShell";
import type { AppRole } from "@/config/menuConfig";
import { createSupabaseBrowserClient } from "@/lib/supabaseClient";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type DevRole = AppRole;

type ShipmentRow = {
  id: string;
  shipment_no: string | null;
  po_no: string | null;
  buyer_id: string | null;
  buyer_name: string | null;
  currency: string | null;
  status: string | null;
  etd: string | null;
  eta: string | null;
  total_cartons: number | null;
  total_gw: number | null;
  total_nw: number | null;
  created_at: string | null;
};

function supabaseErrorToString(err: any) {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  if (err?.message) return err.message;
  if (err?.error_description) return err.error_description;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export default function InvoiceCreatePage() {
  const router = useRouter();
  const supabase = React.useMemo(() => createSupabaseBrowserClient(), []);
  const [role] = React.useState<DevRole>("admin");

  const [rows, setRows] = React.useState<ShipmentRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const [keyword, setKeyword] = React.useState("");
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [creating, setCreating] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      setLoading(true);
      setErr(null);

      // shipments 테이블에서 최근 200개 로딩
      // (원하면 status 조건/필터를 더 걸 수 있음)
      let q = supabase
        .from("shipments")
        .select(
          "id, shipment_no, po_no, buyer_id, buyer_name, currency, status, etd, eta, total_cartons, total_gw, total_nw, created_at"
        )
        .order("created_at", { ascending: false })
        .limit(200);

      // 간단 검색(클라이언트 필터도 가능하지만, 일단 ilike로)
      const k = keyword.trim();
      if (k) {
        // shipment_no / po_no / buyer_name 중 하나라도 매칭
        q = q.or(
          `shipment_no.ilike.%${k}%,po_no.ilike.%${k}%,buyer_name.ilike.%${k}%`
        );
      }

      const { data, error } = await q;
      if (error) throw error;

      setRows((data || []) as ShipmentRow[]);
    } catch (e: any) {
      console.error("[InvoiceCreate] load shipments error:", e);
      setErr(supabaseErrorToString(e) || "Failed to load shipments");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, keyword]);

  React.useEffect(() => {
    load();
  }, [load]);

  // Buyer 동일 선택 강제 (UI 레벨)
  const selectedBuyerId = React.useMemo(() => {
    if (selectedIds.length === 0) return null;
    const first = rows.find((r) => r.id === selectedIds[0]);
    return first?.buyer_id ?? null;
  }, [rows, selectedIds]);

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const has = prev.includes(id);
      if (has) return prev.filter((x) => x !== id);

      // 새로 추가할 때 buyer가 다르면 막기
      const target = rows.find((r) => r.id === id);
      if (selectedBuyerId && target?.buyer_id && target.buyer_id !== selectedBuyerId) {
        alert("Buyer가 다른 Shipment는 같은 Invoice로 합칠 수 없습니다.");
        return prev;
      }

      return [...prev, id];
    });
  };

  const createInvoice = async () => {
    if (selectedIds.length === 0) {
      alert("먼저 Shipment를 선택해 주세요.");
      return;
    }

    try {
      setCreating(true);
      setErr(null);

      const res = await fetch("/api/invoices/create-from-shipment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          selectedIds.length === 1
            ? { shipmentId: selectedIds[0] }
            : { shipmentIds: selectedIds }
        ),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || "Failed to create invoice");
      }

      const invoiceId = json.invoice_id as string | undefined;
      const invoiceNo = json.invoice_no as string | undefined;

      alert(
        json.already_exists
          ? `이미 연결된 Invoice가 있습니다.\nInvoice: ${invoiceId ?? "-"}`
          : `Invoice 생성 완료\nInvoice No: ${invoiceNo ?? "-"}`
      );

      if (invoiceId) {
        router.push(`/invoices/${invoiceId}`);
      } else {
        router.push("/invoices");
      }
    } catch (e: any) {
      console.error("[InvoiceCreate] create error:", e);
      setErr(e?.message || "Failed to create invoice");
    } finally {
      setCreating(false);
    }
  };

  return (
    <AppShell currentRole={role}>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Create Invoice (from Shipment)</h1>
          <Button variant="outline" onClick={() => router.push("/invoices")}>
            Back to List
          </Button>
        </div>

        {err && (
          <div className="text-sm text-red-600 border border-red-300 bg-red-50 rounded-md px-3 py-2">
            {err}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>1) Select Shipment (same Buyer only)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <Label className="block mb-1">Search</Label>
                <Input
                  placeholder="Shipment No / PO No / Buyer"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                />
              </div>
              <Button variant="outline" onClick={load} disabled={loading}>
                {loading ? "Loading..." : "Search"}
              </Button>
            </div>

            <div className="text-sm text-gray-600">
              Selected: <b>{selectedIds.length}</b>
              {selectedBuyerId ? " (Buyer locked)" : ""}
            </div>

            <div className="overflow-x-auto max-h-[420px] border rounded-md">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="border px-2 py-1 w-14">Select</th>
                    <th className="border px-2 py-1">Shipment No</th>
                    <th className="border px-2 py-1">PO No</th>
                    <th className="border px-2 py-1">Buyer</th>
                    <th className="border px-2 py-1">Currency</th>
                    <th className="border px-2 py-1">Status</th>
                    <th className="border px-2 py-1">ETD</th>
                    <th className="border px-2 py-1">ETA</th>
                    <th className="border px-2 py-1">Cartons</th>
                    <th className="border px-2 py-1">GW</th>
                    <th className="border px-2 py-1">NW</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="border px-2 py-6 text-center text-gray-500">
                        No shipments found.
                      </td>
                    </tr>
                  ) : (
                    rows.map((r) => {
                      const checked = selectedIds.includes(r.id);
                      const buyerMismatch =
                        selectedBuyerId &&
                        r.buyer_id &&
                        r.buyer_id !== selectedBuyerId;

                      return (
                        <tr key={r.id} className="border-t">
                          <td className="border px-2 py-1 text-center">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!checked && !!buyerMismatch}
                              onChange={() => toggle(r.id)}
                            />
                          </td>
                          <td className="border px-2 py-1">{r.shipment_no ?? "-"}</td>
                          <td className="border px-2 py-1">{r.po_no ?? "-"}</td>
                          <td className="border px-2 py-1">{r.buyer_name ?? "-"}</td>
                          <td className="border px-2 py-1">{r.currency ?? "-"}</td>
                          <td className="border px-2 py-1">{r.status ?? "-"}</td>
                          <td className="border px-2 py-1">{r.etd ?? "-"}</td>
                          <td className="border px-2 py-1">{r.eta ?? "-"}</td>
                          <td className="border px-2 py-1 text-right">{r.total_cartons ?? "-"}</td>
                          <td className="border px-2 py-1 text-right">{r.total_gw ?? "-"}</td>
                          <td className="border px-2 py-1 text-right">{r.total_nw ?? "-"}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end">
              <Button onClick={createInvoice} disabled={creating || selectedIds.length === 0}>
                {creating ? "Creating..." : "Create Invoice"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
