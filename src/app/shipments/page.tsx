"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";

import AppShell from "@/components/layout/AppShell";
import type { AppRole } from "@/config/menuConfig";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

type DevRole = AppRole;

type ShipmentListItem = {
  id: string;
  shipment_no?: string | null;
  buyer_name?: string | null;
  buyer_id?: string | null;

  ship_mode?: string | null;
  status?: string | null;

  po_no?: string | null;
  po_nos?: string[] | string | null;

  destination?: string | null;
  final_destination?: string | null;

  etd?: string | null;
  eta?: string | null;

  invoice_id?: string | null;
  invoice_no?: string | null;

  packing_list_id?: string | null;
  packing_list_no?: string | null;

  created_at?: string | null;
};

function safe(v: any) {
  return (v ?? "").toString().trim();
}

/**
 * 에러 수정 부분: map 함수의 인자 x에 명시적 타입을 지정했습니다.
 */
function asArray(v: unknown): string[] {
  if (v === null || v === undefined) return [];
  
  // 이미 배열인 경우 처리
  if (Array.isArray(v)) {
    return (v as unknown[]).map((x: any) => safe(x)).filter(Boolean);
  }

  const s = safe(v);
  if (!s) return [];

  // JSON 배열 형태인 경우 처리 (예: '["A","B"]')
  try {
    const j: unknown = JSON.parse(s);
    if (Array.isArray(j)) {
      return (j as unknown[]).map((x: any) => safe(x)).filter(Boolean);
    }
  } catch {}

  // 콤마나 공백으로 구분된 문자열 처리
  return s.split(/[,\s]+/g).map((x: string) => x.trim()).filter(Boolean);
}

function fmtDate(s?: string | null) {
  const v = safe(s);
  if (!v) return "-";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function statusVariant(s?: string | null): "default" | "secondary" | "destructive" | "outline" {
  const v = safe(s).toUpperCase();
  if (v === "DRAFT") return "secondary";
  if (v === "CANCELLED" || v === "DELETED") return "destructive";
  if (v === "SHIPPED" || v === "CLOSED") return "default";
  return "outline";
}

export default function ShipmentsListPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [items, setItems] = React.useState<ShipmentListItem[]>([]);

  const [qShipmentNo, setQShipmentNo] = React.useState(sp.get("shipment_no") ?? "");
  const [qPoNo, setQPoNo] = React.useState(sp.get("po_no") ?? "");
  const [qBuyer, setQBuyer] = React.useState(sp.get("buyer") ?? "");
  const [qStatus, setQStatus] = React.useState(sp.get("status") ?? "ALL");

  async function load(next?: {
    shipment_no?: string;
    po_no?: string;
    buyer?: string;
    status?: string;
  }) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      const shipment_no = (next?.shipment_no ?? qShipmentNo).trim();
      const po_no = (next?.po_no ?? qPoNo).trim();
      const buyer = (next?.buyer ?? qBuyer).trim();
      const status = (next?.status ?? qStatus).trim();

      if (shipment_no) params.set("shipment_no", shipment_no);
      if (po_no) params.set("po_no", po_no);
      if (buyer) params.set("buyer", buyer);
      if (status && status !== "ALL") params.set("status", status);

      const qs = params.toString();
      router.replace(qs ? `/shipments?${qs}` : "/shipments");

      const res = await fetch(`/api/shipments/list?${params.toString()}`, { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j?.success === false) {
        throw new Error(j?.error || `Failed to load shipments (HTTP ${res.status})`);
      }
      
      const list = (j?.items ?? j?.data ?? j?.rows ?? []) as any[];
      const normalized: ShipmentListItem[] = (Array.isArray(list) ? list : []).map((r) => ({
        id: safe(r?.id),
        shipment_no: r?.shipment_no ?? r?.shipmentNo ?? null,
        buyer_name: r?.buyer_name ?? r?.buyerName ?? r?.buyer ?? null,
        buyer_id: r?.buyer_id ?? r?.buyerId ?? null,
        ship_mode: r?.ship_mode ?? r?.shipMode ?? null,
        status: r?.status ?? null,
        po_no: r?.po_no ?? r?.poNo ?? null,
        po_nos: r?.po_nos ?? r?.poNos ?? null,
        destination: r?.destination ?? null,
        final_destination: r?.final_destination ?? r?.finalDestination ?? null,
        etd: r?.etd ?? null,
        eta: r?.eta ?? null,
        invoice_id: r?.invoice_id ?? r?.invoiceId ?? null,
        invoice_no: r?.invoice_no ?? r?.invoiceNo ?? null,
        packing_list_id: r?.packing_list_id ?? r?.packingListId ?? null,
        packing_list_no: r?.packing_list_no ?? r?.packingListNo ?? null,
        created_at: r?.created_at ?? r?.createdAt ?? null,
      })).filter((x) => x.id);

      setItems(normalized);
    } catch (e: any) {
      setError(e?.message || "Failed to load shipments");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openDetail(id: string) {
    router.push(`/shipments/${id}`);
  }

  return (
    <AppShell role={"admin" as DevRole} title="Shipments" description="Search and open shipments">
      <div className="space-y-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle>Shipment List</CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => load()} disabled={loading}>
                {loading ? "Loading..." : "Refresh"}
              </Button>
              <Button onClick={() => router.push("/shipments/create-from-po")}>
                Create Shipment
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <Input
                value={qShipmentNo}
                onChange={(e) => setQShipmentNo(e.target.value)}
                placeholder="Shipment No"
              />
              <Input
                value={qPoNo}
                onChange={(e) => setQPoNo(e.target.value)}
                placeholder="PO No"
              />
              <Input
                value={qBuyer}
                onChange={(e) => setQBuyer(e.target.value)}
                placeholder="Buyer"
              />
              <Select value={qStatus} onValueChange={setQStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All</SelectItem>
                  <SelectItem value="DRAFT">DRAFT</SelectItem>
                  <SelectItem value="INVOICED">INVOICED</SelectItem>
                  <SelectItem value="PACKED">PACKED</SelectItem>
                  <SelectItem value="SHIPPED">SHIPPED</SelectItem>
                  <SelectItem value="CANCELLED">CANCELLED</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <Button
                onClick={() =>
                  load({
                    shipment_no: qShipmentNo,
                    po_no: qPoNo,
                    buyer: qBuyer,
                    status: qStatus,
                  })
                }
                disabled={loading}
              >
                Search
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setQShipmentNo("");
                  setQPoNo("");
                  setQBuyer("");
                  setQStatus("ALL");
                  load({ shipment_no: "", po_no: "", buyer: "", status: "ALL" });
                }}
                disabled={loading}
              >
                Clear
              </Button>

              {error ? (
                <div className="ml-2 text-sm text-red-600">{error}</div>
              ) : (
                <div className="ml-2 text-sm text-muted-foreground">
                  {items.length} shipment(s)
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Shipment No</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Buyer</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead>POs</TableHead>
                    <TableHead>ETD</TableHead>
                    <TableHead>Destination</TableHead>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Packing List</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center text-muted-foreground py-10">
                        {loading ? "Loading..." : "No shipments found"}
                      </TableCell>
                    </TableRow>
                  ) : (
                    items.map((r) => {
                      const pos = asArray(r.po_nos).length ? asArray(r.po_nos) : asArray(r.po_no);
                      const dest = safe(r.final_destination) || safe(r.destination) || "-";
                      return (
                        <TableRow
                          key={r.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => openDetail(r.id)}
                        >
                          <TableCell className="font-medium">{safe(r.shipment_no) || "-"}</TableCell>
                          <TableCell>
                            <Badge variant={statusVariant(r.status)}>{safe(r.status) || "-"}</Badge>
                          </TableCell>
                          <TableCell>{safe(r.buyer_name) || "-"}</TableCell>
                          <TableCell>{safe(r.ship_mode) || "-"}</TableCell>
                          <TableCell className="max-w-[260px] truncate" title={pos.join(", ")}>
                            {pos.length ? pos.join(", ") : "-"}
                          </TableCell>
                          <TableCell>{fmtDate(r.etd)}</TableCell>
                          <TableCell className="max-w-[260px] truncate" title={dest}>
                            {dest}
                          </TableCell>
                          <TableCell className="max-w-[220px] truncate" title={safe(r.invoice_no)}>
                            {safe(r.invoice_no) || "-"}
                          </TableCell>
                          <TableCell className="max-w-[220px] truncate" title={safe(r.packing_list_no)}>
                            {safe(r.packing_list_no) || "-"}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                              <Button variant="outline" size="sm" onClick={() => openDetail(r.id)}>
                                View
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="mt-3 text-xs text-muted-foreground">
              Tip: Click a row to open Shipment Detail. Use “Create Shipment” to go to the PO-based creation page.
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}