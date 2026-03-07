"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";

import AppShell from "@/components/layout/AppShell";
import type { AppRole } from "@/config/menuConfig";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

type ShipmentRow = {
  id: string;
  shipment_no?: string | null;
  po_no?: string | null;
  buyer_name?: string | null;
  ship_mode?: string | null;
  etd?: string | null;
  destination?: string | null;
  status?: string | null;
  total_cartons?: any;
  total_gw?: any;
  total_nw?: any;
  created_at?: string | null;
};

type ListResponse = {
  success: boolean;
  error?: string;
  items?: ShipmentRow[];
  total?: number;
};

function safe(v: any) {
  return (v ?? "").toString().trim();
}

function fmtInt(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  return Math.round(n).toLocaleString();
}

function fmtNum(v: any, digits = 2) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtDate10(v: any) {
  const s = safe(v);
  if (!s) return "-";
  // already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // ISO datetime
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m?.[1]) return m[1];
  return s;
}

export default function ShipmentListPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const role: AppRole = "admin";

  const [q, setQ] = React.useState<string>(() => sp?.get("q") ?? "");
  const [status, setStatus] = React.useState<string>(() => sp?.get("status") ?? "ALL");

  const [loading, setLoading] = React.useState(false);
  const [items, setItems] = React.useState<ShipmentRow[]>([]);
  const [total, setTotal] = React.useState<number>(0);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (safe(q)) qs.set("q", safe(q));
      if (safe(status) && status !== "ALL") qs.set("status", status);
      const url = `/api/shipments/list?${qs.toString()}`;

      const res = await fetch(url, { cache: "no-store" });
      const j: ListResponse = await res.json().catch(() => ({ success: false, error: "Bad JSON" } as any));
      if (!res.ok || !j?.success) throw new Error(j?.error || "Failed to load shipments.");

      setItems(Array.isArray(j.items) ? j.items : []);
      setTotal(Number(j.total ?? (j.items?.length ?? 0)) || 0);

      // URL sync (검색/필터 유지)
      const next = new URLSearchParams();
      if (safe(q)) next.set("q", safe(q));
      if (safe(status) && status !== "ALL") next.set("status", status);
      const href = next.toString() ? `/shipments/list?${next.toString()}` : "/shipments/list";
      router.replace(href);
    } catch (e: any) {
      console.error(e);
      alert(e?.message || "Load error");
    } finally {
      setLoading(false);
    }
  }, [q, status, router]);

  React.useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") load();
  };

  const openShipment = (id: string) => router.push(`/shipments/${id}`);

  const createInvoice = async (shipmentId: string) => {
    try {
      const res = await fetch(`/api/shipments/${shipmentId}/invoice`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.success) throw new Error(j?.error || "Failed to create invoice");
      const invoiceId = j.invoice_id ?? j.invoice?.id ?? j.invoice?.invoice_id ?? null;
      alert(j.already_exists ? "Invoice already exists." : "Invoice created.");
      if (invoiceId) router.push(`/invoices/${invoiceId}`);
    } catch (e: any) {
      console.error(e);
      alert(e?.message || "Create invoice error");
    }
  };

  const createPackingList = async (shipmentId: string) => {
    try {
      const res = await fetch(`/api/shipments/${shipmentId}/packing-list`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.success) throw new Error(j?.error || "Failed to create packing list");
      const plId = j.packing_list_id ?? j.packing_list?.id ?? j.packing_list?.packing_list_id ?? null;
      alert(j.already_exists ? "Packing List already exists." : "Packing List created.");
      if (plId) router.push(`/packing-lists/${plId}`);
    } catch (e: any) {
      console.error(e);
      alert(e?.message || "Create packing list error");
    }
  };

  return (
    <AppShell role={role} title="Shipments">
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => router.back()}>
            Back
          </Button>
          <Button onClick={load} disabled={loading}>
            Refresh
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => router.push("/shipments")}>
            New Shipment
          </Button>
        </div>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Shipment List</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row gap-2 md:items-center md:justify-between">
            <div className="flex items-center gap-2">
              <Input
                placeholder="Search (Shipment No / PO No / Buyer / Destination)"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKeyDown}
                className="w-[420px] max-w-full"
              />
              <Button onClick={load} disabled={loading}>
                Search
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <div className="text-sm text-muted-foreground">Status</div>
              <select
                className="h-9 rounded-md border bg-background px-3 text-sm"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="ALL">ALL</option>
                <option value="DRAFT">DRAFT</option>
                <option value="CONFIRMED">CONFIRMED</option>
                <option value="CLOSED">CLOSED</option>
              </select>

              <div className="text-sm text-muted-foreground ml-2">
                Total: {fmtInt(total)}
              </div>
            </div>
          </div>

          <Separator className="my-4" />

          <div className="w-full overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left px-3 py-2 whitespace-nowrap">Shipment No</th>
                  <th className="text-left px-3 py-2 whitespace-nowrap">Buyer</th>
                  <th className="text-left px-3 py-2 whitespace-nowrap">PO No</th>
                  <th className="text-left px-3 py-2 whitespace-nowrap">Ship Mode</th>
                  <th className="text-left px-3 py-2 whitespace-nowrap">ETD</th>
                  <th className="text-left px-3 py-2 whitespace-nowrap">Destination</th>
                  <th className="text-right px-3 py-2 whitespace-nowrap">Cartons</th>
                  <th className="text-right px-3 py-2 whitespace-nowrap">GW</th>
                  <th className="text-right px-3 py-2 whitespace-nowrap">NW</th>
                  <th className="text-left px-3 py-2 whitespace-nowrap">Status</th>
                  <th className="text-right px-3 py-2 whitespace-nowrap">Actions</th>
                </tr>
              </thead>

              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td className="px-3 py-8 text-center text-muted-foreground" colSpan={11}>
                      No shipments found.
                    </td>
                  </tr>
                ) : (
                  items.map((r) => (
                    <tr key={r.id} className="border-b hover:bg-muted/30">
                      <td className="px-3 py-2 whitespace-nowrap">
                        <button
                          className="text-blue-600 hover:underline"
                          onClick={() => openShipment(r.id)}
                          type="button"
                        >
                          {safe(r.shipment_no) || r.id}
                        </button>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{safe(r.buyer_name) || "-"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{safe(r.po_no) || "-"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{safe(r.ship_mode)?.toUpperCase() || "-"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{fmtDate10(r.etd)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{safe(r.destination) || "-"}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{fmtInt(r.total_cartons)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{fmtNum(r.total_gw, 2)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{fmtNum(r.total_nw, 2)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{safe(r.status) || "-"}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => openShipment(r.id)}>
                            View
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => createInvoice(r.id)}>
                            Create Invoice
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => createPackingList(r.id)}>
                            Create Packing List
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
    </AppShell>
  );
}
