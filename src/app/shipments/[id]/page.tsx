// src/app/shipments/[id]/page.tsx
"use client";

import * as React from "react";
import { useRouter, useParams } from "next/navigation";

import AppShell from "@/components/layout/AppShell";
import type { AppRole } from "@/config/menuConfig";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

type DevRole = AppRole;

type ShipmentSummary = {
  shipment_id: string;
  po_no: string | null;
  buyer_id: string | null;
  buyer_name: string | null;
  currency: string | null;
  total_cartons: number | null;
  total_gw: number | null;
  total_nw: number | null;
};

type ShipmentLine = {
  id: string;
  line_no: number | null;
  po_no: string | null;
  style_no: string | null;
  description: string | null;
  color: string | null;
  size: string | null;
  qty: any;
  cartons: any;
  gw: any;
  nw: any;
};

type ApiResponse = {
  success: boolean;
  error?: string;
  shipment?: any;
  summary?: ShipmentSummary | null;
  lines?: ShipmentLine[];
  invoice?: any;
};

type PackingLinkResponse = {
  success: boolean;
  error?: string;
  packing_list?: any | null;
};

function asNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function poSort(a: string, b: string) {
  // 숫자처럼 보이는 PO도 자연 정렬되게
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export default function ShipmentDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const shipmentId = params?.id;

  const [loading, setLoading] = React.useState(false);
  const [shipment, setShipment] = React.useState<any>(null);
  const [summary, setSummary] = React.useState<ShipmentSummary | null>(null);
  const [lines, setLines] = React.useState<ShipmentLine[]>([]);

  // Invoice link
  const [linkedInvoice, setLinkedInvoice] = React.useState<any>(null);
  const [creatingInvoice, setCreatingInvoice] = React.useState(false);

  // Packing List link
  const [linkedPackingList, setLinkedPackingList] = React.useState<any>(null);
  const [creatingPackingList, setCreatingPackingList] = React.useState(false);

  const loadPackingLink = React.useCallback(async () => {
    if (!shipmentId) return;
    try {
      const res = await fetch(`/api/shipments/${shipmentId}/packing-list`, {
        cache: "no-store",
      });
      const j: PackingLinkResponse = await res.json();
      if (!res.ok || !j?.success) {
        setLinkedPackingList(null);
        return;
      }
      setLinkedPackingList(j.packing_list ?? null);
    } catch {
      setLinkedPackingList(null);
    }
  }, [shipmentId]);

  const load = React.useCallback(async () => {
    if (!shipmentId) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/shipments/${shipmentId}`, { cache: "no-store" });
      const j: ApiResponse = await res.json();
      if (!res.ok || !j?.success) throw new Error(j?.error || "Failed to load shipment");

      setShipment(j.shipment ?? null);
      setSummary(j.summary ?? null);
      setLines(Array.isArray(j.lines) ? j.lines : []);

      setLinkedInvoice(j.invoice ?? null);
      await loadPackingLink();
    } catch (e: any) {
      console.error(e);
      alert(e?.message || "Load error");
    } finally {
      setLoading(false);
    }
  }, [shipmentId, loadPackingLink]);

  React.useEffect(() => {
    load();
  }, [load]);

  // ===== Invoice
  const onCreateInvoice = React.useCallback(async () => {
    if (!shipmentId) return;

    setCreatingInvoice(true);
    try {
      const res = await fetch(`/api/shipments/${shipmentId}/invoice`, { method: "POST" });
      const j = await res.json();
      if (!res.ok || !j?.success) throw new Error(j?.error || "Failed to create invoice");

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
      setCreatingInvoice(false);
    }
  }, [shipmentId, load, router]);

  const onOpenInvoice = React.useCallback(() => {
    const id = linkedInvoice?.id ?? linkedInvoice?.invoice_id ?? null;
    if (!id) return alert("Invoice id is missing.");
    router.push(`/invoices/${id}`);
  }, [linkedInvoice, router]);

  const onOpenInvoicePdf = React.useCallback(() => {
    const id = linkedInvoice?.id ?? linkedInvoice?.invoice_id ?? null;
    if (!id) return alert("Invoice id is missing.");
    window.open(`/api/invoices/${id}/pdf`, "_blank");
  }, [linkedInvoice]);

  // ===== Packing List
  const onCreatePackingList = React.useCallback(async () => {
    if (!shipmentId) return;

    setCreatingPackingList(true);
    try {
      const res = await fetch(`/api/shipments/${shipmentId}/packing-list`, { method: "POST" });
      const j = await res.json();
      if (!res.ok || !j?.success) throw new Error(j?.error || "Failed to create packing list");

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
      setCreatingPackingList(false);
    }
  }, [shipmentId, load, router]);

  const onOpenPackingList = React.useCallback(() => {
    const id = linkedPackingList?.id ?? linkedPackingList?.packing_list_id ?? null;
    if (!id) return alert("Packing List id is missing.");
    router.push(`/packing-lists/${id}`);
  }, [linkedPackingList, router]);

  const onOpenPackingListPdf = React.useCallback(() => {
    const id = linkedPackingList?.id ?? linkedPackingList?.packing_list_id ?? null;
    if (!id) return alert("Packing List id is missing.");
    window.open(`/api/packing-lists/${id}/pdf`, "_blank");
  }, [linkedPackingList]);

  const S = summary;
  const role: AppRole = "admin";

  const shipmentNo =
    shipment?.shipment_no ??
    shipment?.shipmentNo ??
    shipment?.shipment_number ??
    shipment?.shipmentNoText ??
    shipmentId;

  const isInvoiceLinked = !!(linkedInvoice?.id || linkedInvoice?.invoice_id);
  const isPlLinked = !!(linkedPackingList?.id || linkedPackingList?.packing_list_id);

  // ✅ 핵심: PO별 그룹 + 정렬
  const poGroups = React.useMemo(() => {
    const map = new Map<string, ShipmentLine[]>();
    for (const r of lines) {
      const key = (r.po_no ?? "").trim() || "(NO PO)";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }

    const groups = Array.from(map.entries())
      .map(([poNo, rows]) => ({
        poNo,
        rows: rows
          .slice()
          .sort((a, b) => asNum(a.line_no) - asNum(b.line_no) || (a.style_no ?? "").localeCompare(b.style_no ?? "")),
      }))
      .sort((a, b) => poSort(a.poNo, b.poNo));

    return groups;
  }, [lines]);

  return (
    <AppShell role={role} title="Shipment Detail">
      <div className="flex items-center justify-end gap-2 mb-4">
        <Button variant="outline" onClick={() => router.back()}>
          Back
        </Button>
        <Button onClick={load} disabled={loading}>
          Refresh
        </Button>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Shipment Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-6">
            <div>
              <div className="text-sm text-muted-foreground mb-1">Shipment No</div>
              <div className="break-all">{shipmentNo}</div>
            </div>

            <div>
              <div className="text-sm text-muted-foreground mb-1">PO No</div>
              <div>{S?.po_no ?? "-"}</div>
            </div>

            <div>
              <div className="text-sm text-muted-foreground mb-1">Buyer</div>
              <div>{S?.buyer_name ?? "-"}</div>
            </div>

            <div>
              <div className="text-sm text-muted-foreground mb-1">Currency</div>
              <div>{S?.currency ?? "-"}</div>
            </div>

            <div>
              <div className="text-sm text-muted-foreground mb-1">Total Cartons</div>
              <div>{S?.total_cartons ?? "-"}</div>
            </div>

            <div>
              <div className="text-sm text-muted-foreground mb-1">Total G.W.</div>
              <div>{S?.total_gw ?? "-"}</div>
            </div>

            <div>
              <div className="text-sm text-muted-foreground mb-1">Total N.W.</div>
              <div>{S?.total_nw ?? "-"}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Invoice Link Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground mb-4">
            {isInvoiceLinked ? "Invoice is linked to this shipment." : "No invoice linked to this shipment yet."}
          </div>

          <div className="flex gap-2">
            {!isInvoiceLinked ? (
              <>
                <Button onClick={onCreateInvoice} disabled={creatingInvoice}>
                  Create Invoice
                </Button>
                <Button variant="outline" onClick={load} disabled={loading}>
                  Refresh Status
                </Button>
              </>
            ) : (
              <>
                <Button onClick={onOpenInvoice}>Open Invoice</Button>
                <Button variant="outline" onClick={onOpenInvoicePdf}>
                  Generate PDF
                </Button>
                <Button variant="outline" onClick={load} disabled={loading}>
                  Refresh
                </Button>
              </>
            )}
          </div>

          {isInvoiceLinked && (
            <div className="mt-3 text-sm text-muted-foreground">
              Invoice No: {linkedInvoice?.invoice_no ?? linkedInvoice?.invoiceNo ?? "-"}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Packing List Link Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground mb-4">
            {isPlLinked ? "Packing List is linked to this shipment." : "No packing list linked to this shipment yet."}
          </div>

          <div className="flex gap-2">
            {!isPlLinked ? (
              <>
                <Button onClick={onCreatePackingList} disabled={creatingPackingList}>
                  Create Packing List
                </Button>
                <Button variant="outline" onClick={load} disabled={loading}>
                  Refresh Status
                </Button>
              </>
            ) : (
              <>
                <Button onClick={onOpenPackingList}>Open Packing List</Button>
                <Button variant="outline" onClick={onOpenPackingListPdf}>
                  Generate PDF
                </Button>
                <Button variant="outline" onClick={load} disabled={loading}>
                  Refresh
                </Button>
              </>
            )}
          </div>

          {isPlLinked && (
            <div className="mt-3 text-sm text-muted-foreground">
              Packing List No: {linkedPackingList?.packing_list_no ?? linkedPackingList?.packingListNo ?? "-"}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Shipment Lines (Grouped by PO)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-auto border rounded-md">
            <table className="min-w-[900px] w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-2 text-left">Line</th>
                  <th className="p-2 text-left">PO</th>
                  <th className="p-2 text-left">Style</th>
                  <th className="p-2 text-left">Description</th>
                  <th className="p-2 text-left">Color</th>
                  <th className="p-2 text-left">Size</th>
                  <th className="p-2 text-right">Qty</th>
                  <th className="p-2 text-right">Cartons</th>
                  <th className="p-2 text-right">G.W.</th>
                  <th className="p-2 text-right">N.W.</th>
                </tr>
              </thead>

              <tbody>
                {lines.length === 0 ? (
                  <tr>
                    <td className="p-3 text-muted-foreground" colSpan={10}>
                      No lines.
                    </td>
                  </tr>
                ) : (
                  poGroups.map((g) => (
                    <React.Fragment key={g.poNo}>
                      {/* PO 헤더 행 */}
                      <tr className="border-t bg-muted/30">
                        <td className="p-2 font-semibold" colSpan={10}>
                          PO: {g.poNo}
                        </td>
                      </tr>

                      {g.rows.map((r, idx) => (
                        <tr key={r.id} className="border-t">
                          <td className="p-2">{r.line_no ?? idx + 1}</td>
                          <td className="p-2">{r.po_no ?? "-"}</td>
                          <td className="p-2">{r.style_no ?? "-"}</td>
                          <td className="p-2">{r.description ?? "-"}</td>
                          <td className="p-2">{r.color ?? "-"}</td>
                          <td className="p-2">{r.size ?? "-"}</td>
                          <td className="p-2 text-right">{asNum(r.qty)}</td>
                          <td className="p-2 text-right">{asNum(r.cartons)}</td>
                          <td className="p-2 text-right">{asNum(r.gw)}</td>
                          <td className="p-2 text-right">{asNum(r.nw)}</td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <Separator className="my-4" />
          <div className="text-sm text-muted-foreground">
            Lines are loaded from /api/shipments/[id]. Display is grouped by PO and sorted by line_no.
          </div>
        </CardContent>
      </Card>
    </AppShell>
  );
}
