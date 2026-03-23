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
  po_display?: string | null;
  buyer_name?: string | null;
  ship_mode?: string | null;
  etd?: string | null;
  destination?: string | null;
  status?: string | null;
  total_cartons?: any;
  total_gw?: any;
  total_nw?: any;
  created_at?: string | null;
  invoice_id?: string | null;
  invoice_no?: string | null;
  packing_list_id?: string | null;
  packing_list_no?: string | null;
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
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
function fmtDate10(v: any) {
  const s = safe(v);
  if (!s) return "-";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m?.[1]) return m[1];
  return s;
}
function getStatusBadgeClass(status: string | null | undefined) {
  const s = safe(status).toUpperCase();

  switch (s) {
    case "DRAFT":
      return "inline-flex items-center rounded-full border border-slate-300 bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700";
    case "CONFIRMED":
      return "inline-flex items-center rounded-full border border-blue-300 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700";
    case "SHIPPED":
      return "inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700";
    case "CLOSED":
      return "inline-flex items-center rounded-full border border-violet-300 bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700";
    case "CANCELLED":
    case "CANCELED":
      return "inline-flex items-center rounded-full border border-rose-300 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700";
    default:
      return "inline-flex items-center rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700";
  }
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

  const [creatingInvoiceId, setCreatingInvoiceId] = React.useState<string | null>(null);
  const [creatingPackingId, setCreatingPackingId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (safe(q)) qs.set("q", safe(q));
      if (safe(status) && status !== "ALL") qs.set("status", status);

      const res = await fetch(`/api/shipments/list?${qs.toString()}`, {
        cache: "no-store",
      });

      const j: ListResponse = await res
        .json()
        .catch(() => ({ success: false, error: "Bad JSON" } as any));

      if (!res.ok || !j?.success) {
        throw new Error(j?.error || "Failed to load shipments.");
      }

      setItems(Array.isArray(j.items) ? j.items : []);
      setTotal(Number(j.total ?? (j.items?.length ?? 0)) || 0);

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
  }, [load]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") load();
  };

  const openShipment = (id: string) => router.push(`/shipments/${id}`);
  const openInvoice = (id: string) => router.push(`/invoices/${id}`);
  const openPackingList = (id: string) => router.push(`/packing-lists/${id}`);

  const createInvoice = async (shipmentId: string) => {
    if (!shipmentId || creatingInvoiceId === shipmentId) return;

    try {
      setCreatingInvoiceId(shipmentId);

      const res = await fetch(`/api/shipments/${shipmentId}/invoice`, {
        method: "POST",
      });
      const j = await res.json().catch(() => ({}));

      if (!res.ok || !j?.success) {
        throw new Error(j?.error || "Failed to create invoice");
      }

      const invoiceId = j.invoice_id ?? j.invoice?.id ?? j.invoice?.invoice_id ?? null;
      alert(j.already_exists ? "Invoice already exists." : "Invoice created.");

      if (invoiceId) {
        router.push(`/invoices/${invoiceId}`);
        return;
      }

      await load();
    } catch (e: any) {
      console.error(e);
      alert(e?.message || "Create invoice error");
    } finally {
      setCreatingInvoiceId(null);
    }
  };

  const createPackingList = async (shipmentId: string) => {
    if (!shipmentId || creatingPackingId === shipmentId) return;

    try {
      setCreatingPackingId(shipmentId);

      const res = await fetch(`/api/shipments/${shipmentId}/packing-list`, {
        method: "POST",
      });
      const j = await res.json().catch(() => ({}));

      if (!res.ok || !j?.success) {
        throw new Error(j?.error || "Failed to create packing list");
      }

      const plId =
        j.packing_list_id ?? j.packing_list?.id ?? j.packing_list?.packing_list_id ?? null;

      alert(j.already_exists ? "Packing List already exists." : "Packing List created.");

      if (plId) {
        router.push(`/packing-lists/${plId}`);
        return;
      }

      await load();
    } catch (e: any) {
      console.error(e);
      alert(e?.message || "Create packing list error");
    } finally {
      setCreatingPackingId(null);
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
            {loading ? "Refreshing..." : "Refresh"}
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={() => router.push("/shipments")}>Create Shipment</Button>
        </div>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Shipment List</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_220px_auto] gap-3 items-end">
            <div className="flex items-center gap-2">
              <Input
                placeholder="Search (Shipment No / PO No / Buyer / Destination / Invoice / PL)"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKeyDown}
              />
              <Button onClick={load} disabled={loading}>
                Search
              </Button>
            </div>

            <div>
              <div className="text-sm text-muted-foreground mb-1">Status</div>
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="ALL">All</option>
                <option value="DRAFT">DRAFT</option>
                <option value="CONFIRMED">CONFIRMED</option>
                <option value="SHIPPED">SHIPPED</option>
                <option value="CLOSED">CLOSED</option>
                <option value="CANCELLED">CANCELLED</option>
              </select>
            </div>

            <div className="text-sm text-muted-foreground">
              {fmtInt(total)} shipment(s)
            </div>
          </div>

          <Separator className="my-4" />

          <div className="w-full overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left px-3 py-2 whitespace-nowrap">Shipment No</th>
                  <th className="text-left px-3 py-2 whitespace-nowrap">Status</th>
                  <th className="text-left px-3 py-2 whitespace-nowrap">Buyer</th>
                  <th className="text-left px-3 py-2 whitespace-nowrap">Mode</th>
                  <th className="text-left px-3 py-2 whitespace-nowrap">POs</th>
                  <th className="text-left px-3 py-2 whitespace-nowrap">ETD</th>
                  <th className="text-left px-3 py-2 whitespace-nowrap">Destination</th>
                  <th className="text-right px-3 py-2 whitespace-nowrap">Cartons</th>
                  <th className="text-right px-3 py-2 whitespace-nowrap">G.W.</th>
                  <th className="text-right px-3 py-2 whitespace-nowrap">N.W.</th>
                  <th className="text-left px-3 py-2 whitespace-nowrap">Invoice</th>
                  <th className="text-left px-3 py-2 whitespace-nowrap">Packing List</th>
                  <th className="text-right px-3 py-2 whitespace-nowrap">Actions</th>
                </tr>
              </thead>

              <tbody>
                {!loading && items.length === 0 ? (
                  <tr>
                    <td className="px-3 py-8 text-center text-muted-foreground" colSpan={13}>
                      No shipments found.
                    </td>
                  </tr>
                ) : null}

                {items.map((r) => {
                  const hasInvoice = !!safe(r.invoice_id);
                  const hasPackingList = !!safe(r.packing_list_id);

                  return (
                    <tr key={r.id} className="border-b hover:bg-muted/20">
                      <td className="px-3 py-2 whitespace-nowrap">
                        <button
                          className="text-blue-600 hover:underline"
                          onClick={() => openShipment(r.id)}
                          type="button"
                        >
                          {safe(r.shipment_no) || r.id}
                        </button>
                      </td>

                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={getStatusBadgeClass(r.status)}>{safe(r.status) || "-"}</span>
                      </td>

                      <td className="px-3 py-2 whitespace-nowrap">{safe(r.buyer_name) || "-"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {safe(r.ship_mode)?.toUpperCase() || "-"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {safe(r.po_display) || safe(r.po_no) || "-"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{fmtDate10(r.etd)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{safe(r.destination) || "-"}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {fmtInt(r.total_cartons)}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {fmtNum(r.total_gw, 2)}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {fmtNum(r.total_nw, 2)}
                      </td>

                      <td className="px-3 py-2 whitespace-nowrap">
                        {hasInvoice ? (
                          <button
                            type="button"
                            className="text-blue-600 hover:underline"
                            onClick={() => openInvoice(String(r.invoice_id))}
                          >
                            {safe(r.invoice_no) || "Created"}
                          </button>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>

                      <td className="px-3 py-2 whitespace-nowrap">
                        {hasPackingList ? (
                          <button
                            type="button"
                            className="text-blue-600 hover:underline"
                            onClick={() => openPackingList(String(r.packing_list_id))}
                          >
                            {safe(r.packing_list_no) || "Created"}
                          </button>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>

                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => openShipment(r.id)}>
                            View
                          </Button>

                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => createInvoice(r.id)}
                            disabled={hasInvoice || creatingInvoiceId === r.id}
                          >
                            {hasInvoice
                              ? "Invoice Created"
                              : creatingInvoiceId === r.id
                                ? "Creating..."
                                : "Create Invoice"}
                          </Button>

                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => createPackingList(r.id)}
                            disabled={hasPackingList || creatingPackingId === r.id}
                          >
                            {hasPackingList
                              ? "PL Created"
                              : creatingPackingId === r.id
                                ? "Creating..."
                                : "Create Packing List"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {loading ? (
                  <tr>
                    <td className="px-3 py-8 text-center text-muted-foreground" colSpan={13}>
                      Loading...
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </AppShell>
  );
}
