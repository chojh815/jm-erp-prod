"use client";

import * as React from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";

import AppShell from "@/components/layout/AppShell";
import type { AppRole } from "@/config/menuConfig";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
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

  // optional fields that may exist from API
  shipped_qty?: any;
  order_qty?: any;
  unit_price?: any;
  amount?: any;
  gw_per_ctn?: any;
  nw_per_ctn?: any;
  gw_per_carton?: any;
  nw_per_carton?: any;
  po_lines?: any;
};

type DraftShipmentLine = ShipmentLine & {
  _removed?: boolean;
};

type ApiResponse = {
  success: boolean;
  error?: string;
  shipment?: any;
  summary?: ShipmentSummary | null; // (legacy) may be missing from API
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

function safeText(v: any) {
  const s = (v ?? "").toString().trim();
  return s && s !== "-" ? s : "";
}

function poSort(a: string, b: string) {
  // 숫자처럼 보이는 PO도 자연 정렬되게
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function normalizeLine(raw: any): ShipmentLine {
  const shippedQty = raw?.qty ?? raw?.shipped_qty ?? raw?.shippedQty ?? raw?.order_qty ?? raw?.orderQty ?? 0;

  // GW/NW: 라인에 gw/nw가 없고 per-ctn만 있을 수 있음 (cartons도 0/NULL 가능)
  const cartons = raw?.cartons ?? 0;

  const gwPer =
    raw?.gw_per_carton ?? raw?.gwPerCarton ?? raw?.gw_per_ctn ?? raw?.gwPerCtn ?? null;
  const nwPer =
    raw?.nw_per_carton ?? raw?.nwPerCarton ?? raw?.nw_per_ctn ?? raw?.nwPerCtn ?? null;

  const gw =
    raw?.gw ??
    (gwPer !== null && gwPer !== undefined ? asNum(cartons) * asNum(gwPer) : null);
  const nw =
    raw?.nw ??
    (nwPer !== null && nwPer !== undefined ? asNum(cartons) * asNum(nwPer) : null);

  // Style fallback: API에서 style_no가 "-"로 올 때 po_lines.jm_style_no가 진짜 값
  const style =
    safeText(raw?.style_no) ||
    // ✅ 우선순위: Buyer Style No/Code → JM Style No/Code
    safeText(raw?.po_lines?.buyer_style_no) ||
    safeText(raw?.po_lines?.buyer_style_code) ||
    safeText(raw?.po_lines?.jm_style_no) ||
    safeText(raw?.po_lines?.jm_style_code) ||
    "-";

  // Color/Size fallback
  const color =
    safeText(raw?.color) ||
    safeText(raw?.po_lines?.plating_color) ||
    safeText(raw?.po_lines?.color) ||
    "-";
  const size = safeText(raw?.size) || safeText(raw?.po_lines?.size) || "-";

  return {
    ...raw,
    qty: shippedQty,
    cartons,
    gw,
    nw,
    style_no: style,
    color,
    size,
  };
}

export default function ShipmentDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const shipmentId = params?.id;

  const [loading, setLoading] = React.useState(false);
  const [shipment, setShipment] = React.useState<any>(null);
  const [lines, setLines] = React.useState<ShipmentLine[]>([]);

const [cancelling, setCancelling] = React.useState(false);

async function cancelShipment() {
  const id = shipmentId;
  if (!id) return;
  try {
    setCancelling(true);
    const res = await fetch(`/api/shipments/${id}/cancel`, { method: "POST" });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j?.success) {
      alert(j?.error || `Cancel failed (HTTP ${res.status})`);
      return;
    }
    // go back to list so user doesn't re-create duplicates
    router.push("/shipments");
  } catch (e: any) {
    alert(e?.message || "Cancel failed");
  } finally {
    setCancelling(false);
  }
}

  // Edit Mode (partial / split)
  const [editMode, setEditMode] = React.useState(false);
  const [draftShipment, setDraftShipment] = React.useState<any>(null);
  const [draftLines, setDraftLines] = React.useState<DraftShipmentLine[]>([]);
  const [saving, setSaving] = React.useState(false);

  // Split modal state
  const [splitOpen, setSplitOpen] = React.useState(false);
  const [splitLine, setSplitLine] = React.useState<DraftShipmentLine | null>(null);
  const [splitQty, setSplitQty] = React.useState<number>(0);
  const [splitMode, setSplitMode] = React.useState<"SEA" | "AIR" | "COURIER">("AIR");
  const [splitCarrier, setSplitCarrier] = React.useState("");
  const [splitTracking, setSplitTracking] = React.useState("");

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

      const sh = j.shipment ?? null;
      setShipment(sh);

      const loadedLines = (Array.isArray(j.lines) ? j.lines : []).map(normalizeLine);
      setLines(loadedLines);

      if (!editMode) {
        setDraftShipment(sh);
        setDraftLines(loadedLines as any);
      }

      setLinkedInvoice((j as any).invoice ?? null);
      await loadPackingLink();
    } catch (e: any) {
      console.error(e);
      alert(e?.message || "Load error");
    } finally {
      setLoading(false);
    }
  }, [shipmentId, loadPackingLink, editMode]);

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

  const role: AppRole = "admin";

  const displayShipment = editMode ? draftShipment : shipment;
  const displayLines = (editMode ? draftLines : lines).filter((l: any) => !l?._removed);

  // ✅ Summary 카드가 API의 "summary"를 보지 않도록, shipment에서 직접 파생 (summary가 없어서 '-' 나오던 문제 해결)
  const S: ShipmentSummary | null = React.useMemo(() => {
    const sh = displayShipment ?? shipment;
    if (!sh) return null;

    const totalCartons = asNum(sh?.total_cartons ?? sh?.totalCartons);
    const totalGw = asNum(sh?.total_gw ?? sh?.totalGw);
    const totalNw = asNum(sh?.total_nw ?? sh?.totalNw);

    return {
      shipment_id: (sh?.id ?? sh?.shipment_id ?? shipmentId ?? "").toString(),
      po_no: sh?.po_no ?? sh?.poNo ?? null,
      buyer_id: sh?.buyer_id ?? sh?.buyerId ?? null,
      buyer_name: sh?.buyer_name ?? sh?.buyerName ?? null,
      currency: sh?.currency ?? sh?.currency_code ?? sh?.currencyCode ?? null,

      // totals는 사용자가 일부러 안 쓰는 상태라면, 0일 때는 '-'로 보이도록 null 처리
      total_cartons: totalCartons > 0 ? totalCartons : null,
      total_gw: totalGw > 0 ? totalGw : null,
      total_nw: totalNw > 0 ? totalNw : null,
    };
  }, [displayShipment, shipment, shipmentId]);

  const shipmentNo =
    displayShipment?.shipment_no ??
    shipment?.shipmentNo ??
    shipment?.shipment_number ??
    shipment?.shipmentNoText ??
    shipmentId;

  const isInvoiceLinked = !!(linkedInvoice?.id || linkedInvoice?.invoice_id);
  const isPlLinked = !!(linkedPackingList?.id || linkedPackingList?.packing_list_id);

  // ✅ 핵심: PO별 그룹 + 정렬
  const poGroups = React.useMemo(() => {
    const map = new Map<string, ShipmentLine[]>();
    for (const r of displayLines as any) {
      const key = (r.po_no ?? "").trim() || "(NO PO)";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }

    const groups = Array.from(map.entries())
      .map(([poNo, rows]) => ({
        poNo,
        rows: rows
          .slice()
          .sort(
            (a, b) =>
              asNum(a.line_no) - asNum(b.line_no) ||
              (a.style_no ?? "").localeCompare(b.style_no ?? "")
          ),
      }))
      .sort((a, b) => poSort(a.poNo, b.poNo));

    return groups;
  }, [displayLines]);

  const currentShipMode = (displayShipment?.ship_mode ?? displayShipment?.shipMode ?? "")
    .toString()
    .toUpperCase();
  const editableShipMode = (draftShipment?.ship_mode ??
    draftShipment?.shipMode ??
    currentShipMode ??
    "")
    .toString()
    .toUpperCase();

  const enterEditMode = () => {
    setDraftShipment(shipment);
    setDraftLines(lines as any);
    setEditMode(true);
  };

  const cancelEditMode = () => {
    setEditMode(false);
    setDraftShipment(shipment);
    setDraftLines(lines as any);
    setSplitOpen(false);
    setSplitLine(null);
    setSplitQty(0);
    setSplitCarrier("");
    setSplitTracking("");
  };

  const onChangeLineQty = (id: string, v: any) => {
    const n = asNum(v);
    setDraftLines((prev) => prev.map((r) => (r.id === id ? { ...r, qty: n } : r)));
  };

  const onRemoveLine = (id: string) => {
    setDraftLines((prev) =>
      prev.map((r) => (r.id === id ? { ...r, _removed: true, qty: 0 } : r))
    );
  };

  const openSplit = (line: DraftShipmentLine) => {
    setSplitLine(line);
    setSplitQty(0); // 사용자가 직접 입력하도록 0부터
    setSplitMode("AIR");
    setSplitCarrier("");
    setSplitTracking("");
    setSplitOpen(true);
  };

  const confirmSplit = async () => {
    if (!shipmentId || !splitLine) return;

    const maxQty = asNum(splitLine.qty);
    const qty = Math.max(0, Math.min(maxQty, asNum(splitQty)));
    if (!qty || qty <= 0) {
      alert("Split Qty must be greater than 0.");
      return;
    }

    // optimistic update: decrease current line qty
    setDraftLines((prev) =>
      prev.map((r) =>
        r.id === splitLine.id ? { ...r, qty: Math.max(0, asNum(r.qty) - qty) } : r
      )
    );

    setSplitOpen(false);

    try {
      const res = await fetch(`/api/shipments/${shipmentId}/split`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shipment_line_id: splitLine.id,
          split_qty: qty,
          new_ship_mode: splitMode,
          carrier: splitMode === "COURIER" ? splitCarrier : null,
          tracking_no: splitMode === "COURIER" ? splitTracking : null,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.success) {
        alert(j?.error || "Split failed (API not implemented yet).");
      } else {
        await load();
      }
    } catch (e: any) {
      alert(e?.message || "Split failed.");
    }
  };

  const saveEdits = async () => {
    if (!shipmentId) return;

    setSaving(true);
    try {
      const payload = {
        shipment: {
          ship_mode: editableShipMode || null,
          carrier: (draftShipment?.carrier ?? draftShipment?.courier_carrier ?? null) ?? null,
          tracking_no:
            (draftShipment?.tracking_no ?? draftShipment?.courier_tracking_no ?? null) ?? null,
        },
        lines: (draftLines as any).map((r: any) => ({
          id: r.id,
          qty: asNum(r.qty),
          is_deleted: !!r._removed,
        })),
      };

      const res = await fetch(`/api/shipments/${shipmentId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.success) {
        alert(j?.error || "Save failed (API not implemented yet).");
        return;
      }

      setEditMode(false);
      await load();
    } catch (e: any) {
      alert(e?.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell role={role} title="Shipment Detail">
      <div className="flex items-center justify-end gap-2 mb-4">
        <Button variant="outline" asChild>
                <Link href="/shipments">Back to Shipments List</Link>
              </Button>

      <Button variant="outline" onClick={() => router.back()}>
          Back
        </Button>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="destructive" disabled={cancelling}>
            {cancelling ? "Cancelling..." : "Cancel Shipment"}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this shipment?</AlertDialogTitle>
            <AlertDialogDescription>
              This will mark the shipment as CANCELLED (soft delete). Only DRAFT shipments can be cancelled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction onClick={cancelShipment}>Cancel Shipment</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
              <div className="text-sm text-muted-foreground mb-1">Ship Mode</div>
              {!editMode ? (
                <div>{currentShipMode || "-"}</div>
              ) : (
                <select
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={(editableShipMode || "").toString()}
                  onChange={(e) => {
                    const v = e.target.value;
                    setDraftShipment((prev: any) => ({
                      ...(prev ?? {}),
                      ship_mode: v,
                    }));
                  }}
                >
                  <option value="">(Default)</option>
                  <option value="SEA">SEA</option>
                  <option value="AIR">AIR</option>
                  <option value="COURIER">COURIER</option>
                </select>
              )}
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
            {isInvoiceLinked
              ? "Invoice is linked to this shipment."
              : "No invoice linked to this shipment yet."}
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
            {isPlLinked
              ? "Packing List is linked to this shipment."
              : "No packing list linked to this shipment yet."}
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
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Shipment Lines (Grouped by PO)</CardTitle>
            {!editMode ? (
              <Button variant="secondary" onClick={enterEditMode}>
                Enable Partial / Split
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={cancelEditMode} disabled={saving}>
                  Cancel
                </Button>
                <Button onClick={saveEdits} disabled={saving}>
                  {saving ? "Saving..." : "Save"}
                </Button>
              </div>
            )}
          </div>
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
                  {editMode && <th className="p-2 text-right">Actions</th>}
                </tr>
              </thead>

              <tbody>
                {displayLines.length === 0 ? (
                  <tr>
                    <td className="p-3 text-muted-foreground" colSpan={editMode ? 11 : 10}>
                      No lines.
                    </td>
                  </tr>
                ) : (
                  poGroups.map((g) => (
                    <React.Fragment key={g.poNo}>
                      <tr className="border-t bg-muted/30">
                        <td className="p-2 font-semibold" colSpan={editMode ? 11 : 10}>
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
                          <td className="p-2 text-right">
                            {!editMode ? (
                              asNum((r as any).qty)
                            ) : (
                              <input
                                className="h-8 w-24 rounded-md border bg-background px-2 text-right text-sm"
                                type="number"
                                step="1"
                                min="0"
                                value={asNum((r as any).qty)}
                                onChange={(e) => onChangeLineQty(r.id, e.target.value)}
                              />
                            )}
                          </td>
                          <td className="p-2 text-right">{asNum((r as any).cartons)}</td>
                          <td className="p-2 text-right">{asNum((r as any).gw)}</td>
                          <td className="p-2 text-right">{asNum((r as any).nw)}</td>
                          {editMode && (
                            <td className="p-2 text-right">
                              <div className="flex justify-end gap-2">
                                <Button size="sm" variant="outline" onClick={() => openSplit(r as any)}>
                                  Split
                                </Button>
                                <Button size="sm" variant="destructive" onClick={() => onRemoveLine(r.id)}>
                                  Remove
                                </Button>
                              </div>
                            </td>
                          )}
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

      {splitOpen && splitLine && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-lg bg-background shadow-lg border">
            <div className="p-4 border-b">
              <div className="font-semibold">Split Line</div>
              <div className="text-sm text-muted-foreground mt-1">
                PO: {splitLine.po_no ?? "-"} • Style: {splitLine.style_no ?? "-"} • Available:{" "}
                {asNum((splitLine as any).qty)}
              </div>
            </div>

            <div className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-sm text-muted-foreground mb-1">Split Qty</div>
                  <input
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm text-right"
                    type="number"
                    min="1"
                    step="1"
                    value={splitQty}
                    onChange={(e) => setSplitQty(asNum(e.target.value))}
                  />
                </div>
                <div>
                  <div className="text-sm text-muted-foreground mb-1">New Ship Mode</div>
                  <select
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                    value={splitMode}
                    onChange={(e) => setSplitMode(e.target.value as any)}
                  >
                    <option value="SEA">SEA</option>
                    <option value="AIR">AIR</option>
                    <option value="COURIER">COURIER</option>
                  </select>
                </div>
              </div>

              {splitMode === "COURIER" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-sm text-muted-foreground mb-1">Carrier</div>
                    <input
                      className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                      value={splitCarrier}
                      onChange={(e) => setSplitCarrier(e.target.value)}
                      placeholder="DHL / UPS / FedEx..."
                    />
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground mb-1">Tracking No</div>
                    <input
                      className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                      value={splitTracking}
                      onChange={(e) => setSplitTracking(e.target.value)}
                      placeholder="Tracking number"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 border-t flex items-center justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setSplitOpen(false);
                  setSplitLine(null);
                }}
              >
                Cancel
              </Button>
              <Button onClick={confirmSplit}>Confirm Split</Button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
