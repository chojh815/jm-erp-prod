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
  summary?: ShipmentSummary | null;
  lines?: ShipmentLine[];
};

type InvoiceLinkResponse = {
  success: boolean;
  error?: string;
  invoice?: any | null;
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
function round1(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? Number(n.toFixed(1)) : 0;
}
function fmt1(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  return n.toFixed(1);
}
function fmtInt(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  return Math.round(n).toLocaleString();
}
function safeText(v: any) {
  const s = (v ?? "").toString().trim();
  return s && s !== "-" ? s : "";
}
function poSort(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}
function normalizeLine(raw: any): ShipmentLine {
  const shippedQty =
    raw?.qty ?? raw?.shipped_qty ?? raw?.shippedQty ?? raw?.order_qty ?? raw?.orderQty ?? 0;

  const cartons = raw?.cartons ?? 0;
  const gwPer =
    raw?.gw_per_carton ?? raw?.gwPerCarton ?? raw?.gw_per_ctn ?? raw?.gwPerCtn ?? null;
  const nwPer =
    raw?.nw_per_carton ?? raw?.nwPerCarton ?? raw?.nw_per_ctn ?? raw?.nwPerCtn ?? null;

  const gw =
    raw?.gw ??
    (gwPer !== null && gwPer !== undefined ? round1(asNum(cartons) * asNum(gwPer)) : null);
  const nw =
    raw?.nw ??
    (nwPer !== null && nwPer !== undefined ? round1(asNum(cartons) * asNum(nwPer)) : null);

  const style =
    safeText(raw?.style_no) ||
    safeText(raw?.po_lines?.buyer_style_no) ||
    safeText(raw?.po_lines?.buyer_style_code) ||
    safeText(raw?.po_lines?.jm_style_no) ||
    safeText(raw?.po_lines?.jm_style_code) ||
    "-";

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
  const role: AppRole = "admin";

  const [loading, setLoading] = React.useState(false);
  const [shipment, setShipment] = React.useState<any>(null);
  const [lines, setLines] = React.useState<ShipmentLine[]>([]);

  const [cancelling, setCancelling] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [shipping, setShipping] = React.useState(false);

  const [editMode, setEditMode] = React.useState(false);
  const [draftShipment, setDraftShipment] = React.useState<any>(null);
  const [draftLines, setDraftLines] = React.useState<DraftShipmentLine[]>([]);
  const [saving, setSaving] = React.useState(false);

  const [linkedInvoice, setLinkedInvoice] = React.useState<any>(null);
  const [creatingInvoice, setCreatingInvoice] = React.useState(false);

  const [linkedPackingList, setLinkedPackingList] = React.useState<any>(null);
  const [creatingPackingList, setCreatingPackingList] = React.useState(false);

  const currentStatus = (editMode ? draftShipment?.status : shipment?.status ?? "")
    .toString()
    .toUpperCase();

  const loadInvoiceLink = React.useCallback(async () => {
    if (!shipmentId) return;
    try {
      const res = await fetch(`/api/shipments/${shipmentId}/invoice`, { cache: "no-store" });
      const j: InvoiceLinkResponse = await res.json();
      if (!res.ok || !j?.success) {
        setLinkedInvoice(null);
        return;
      }
      setLinkedInvoice(j.invoice ?? null);
    } catch {
      setLinkedInvoice(null);
    }
  }, [shipmentId]);

  const loadPackingLink = React.useCallback(async () => {
    if (!shipmentId) return;
    try {
      const res = await fetch(`/api/shipments/${shipmentId}/packing-list`, { cache: "no-store" });
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

      await Promise.all([loadInvoiceLink(), loadPackingLink()]);
    } catch (e: any) {
      console.error(e);
      alert(e?.message || "Load error");
    } finally {
      setLoading(false);
    }
  }, [shipmentId, loadInvoiceLink, loadPackingLink, editMode]);

  React.useEffect(() => {
    load();
  }, [load]);

  async function cancelShipment() {
    if (!shipmentId) return;
    if (!window.confirm("Do you want to cancel this shipment?")) return;
    try {
      setCancelling(true);
      const res = await fetch(`/api/shipments/${shipmentId}/cancel`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.success) {
        alert(j?.error || `Cancel failed (HTTP ${res.status})`);
        return;
      }
      router.push("/shipments");
    } catch (e: any) {
      alert(e?.message || "Cancel failed");
    } finally {
      setCancelling(false);
    }
  }

  const onConfirmShipment = React.useCallback(async () => {
    if (!shipmentId) return;
    if (!window.confirm("Do you want to confirm this shipment?")) return;
    try {
      setConfirming(true);
      const res = await fetch(`/api/shipments/${shipmentId}/confirm`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.success) throw new Error(j?.error || "Confirm shipment failed");
      await load();
      alert(j?.already_done ? "Shipment already confirmed." : "Shipment confirmed.");
    } catch (e: any) {
      console.error(e);
      alert(e?.message || "Confirm shipment error");
    } finally {
      setConfirming(false);
    }
  }, [shipmentId, load]);

  const onMarkAsShipped = React.useCallback(async () => {
    if (!shipmentId) return;
    if (!window.confirm("Do you want to mark this shipment as shipped?")) return;
    try {
      setShipping(true);
      const res = await fetch(`/api/shipments/${shipmentId}/ship`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.success) throw new Error(j?.error || "Mark as shipped failed");
      await load();
      alert(j?.already_done ? "Shipment already marked as shipped." : "Shipment marked as shipped.");
    } catch (e: any) {
      console.error(e);
      alert(e?.message || "Mark as shipped error");
    } finally {
      setShipping(false);
    }
  }, [shipmentId, load]);

  const onCreateInvoice = React.useCallback(async () => {
    if (!shipmentId) return;
    if (!window.confirm("Do you want to create an invoice from this shipment? This may mark the shipment as shipped.")) return;

    setCreatingInvoice(true);
    try {
      const res = await fetch(`/api/shipments/${shipmentId}/invoice`, { method: "POST" });
      const j = await res.json();
      if (!res.ok || !j?.success) throw new Error(j?.error || "Failed to create invoice");

      try {
        await fetch(`/api/shipments/${shipmentId}/ship`, { method: "POST" });
      } catch {}

      const invoiceId = j.invoice_id ?? j.invoice?.id ?? j.invoice?.invoice_id ?? null;
      alert(j.already_exists ? "Invoice already exists. Shipment marked as SHIPPED." : "Invoice created. Shipment marked as SHIPPED.");

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

  const onCreatePackingList = React.useCallback(async () => {
    if (!shipmentId) return;
    if (!window.confirm("Do you want to create a packing list from this shipment?")) return;
    setCreatingPackingList(true);
    try {
      const res = await fetch(`/api/shipments/${shipmentId}/packing-list`, { method: "POST" });
      const j = await res.json();
      if (!res.ok || !j?.success) throw new Error(j?.error || "Failed to create packing list");
      const plId = j.packing_list_id ?? j.packing_list?.id ?? j.packing_list?.packing_list_id ?? null;
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

  const displayShipment = editMode ? draftShipment : shipment;
  const displayLines = (editMode ? draftLines : lines).filter((l: any) => !l?._removed);

  const S: ShipmentSummary | null = React.useMemo(() => {
    const sh = displayShipment ?? shipment;
    if (!sh) return null;

    const headerCartons = asNum(sh?.total_cartons ?? sh?.totalCartons);
    const headerGw = asNum(sh?.total_gw ?? sh?.totalGw);
    const headerNw = asNum(sh?.total_nw ?? sh?.totalNw);

    const lineCartons = (displayLines ?? []).reduce((sum, r) => sum + asNum(r?.cartons), 0);
    const lineGw = round1((displayLines ?? []).reduce((sum, r) => sum + asNum(r?.gw), 0));
    const lineNw = round1((displayLines ?? []).reduce((sum, r) => sum + asNum(r?.nw), 0));

    const totalCartons = headerCartons > 0 ? headerCartons : lineCartons;
    const totalGw = headerGw > 0 ? headerGw : lineGw;
    const totalNw = headerNw > 0 ? headerNw : lineNw;

    return {
      shipment_id: (sh?.id ?? sh?.shipment_id ?? shipmentId ?? "").toString(),
      po_no: sh?.po_no ?? sh?.poNo ?? null,
      buyer_id: sh?.buyer_id ?? sh?.buyerId ?? null,
      buyer_name: sh?.buyer_name ?? sh?.buyerName ?? null,
      currency: sh?.currency ?? sh?.currency_code ?? sh?.currencyCode ?? null,
      total_cartons: totalCartons > 0 ? totalCartons : null,
      total_gw: totalGw > 0 ? totalGw : null,
      total_nw: totalNw > 0 ? totalNw : null,
    };
  }, [displayShipment, shipment, shipmentId, displayLines]);

  const shipmentNo =
    displayShipment?.shipment_no ??
    shipment?.shipmentNo ??
    shipment?.shipment_number ??
    shipment?.shipmentNoText ??
    shipmentId;

  const isInvoiceLinked = !!(linkedInvoice?.id || linkedInvoice?.invoice_id);
  const isPlLinked = !!(linkedPackingList?.id || linkedPackingList?.packing_list_id);

  const poGroups = React.useMemo(() => {
    const map = new Map<string, ShipmentLine[]>();
    for (const r of displayLines as any) {
      const key = (r.po_no ?? "").trim() || "(NO PO)";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return Array.from(map.entries())
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
  }, [displayLines]);

  const poSummary = React.useMemo(() => {
    const poList = poGroups
      .map((g) => (g.poNo || "").trim())
      .filter((v) => v && v !== "(NO PO)");
    const unique = Array.from(new Set(poList)).sort(poSort);

    if (unique.length === 0) return { label: "-", detail: "" };
    if (unique.length === 1) return { label: unique[0], detail: "" };
    return { label: `Multiple (${unique.length})`, detail: unique.join(", ") };
  }, [poGroups]);

  const currentShipMode = (displayShipment?.ship_mode ?? displayShipment?.shipMode ?? "")
    .toString()
    .toUpperCase();
  const editableShipMode = (draftShipment?.ship_mode ?? draftShipment?.shipMode ?? currentShipMode ?? "")
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
  };

  const updateDraftQty = (id: string, qty: number) => {
    setDraftLines((prev) => prev.map((r) => (r.id === id ? { ...r, qty } : r)));
  };

  const onRemoveLine = (id: string) => {
    setDraftLines((prev) => prev.map((r) => (r.id === id ? { ...r, _removed: true, qty: 0 } : r)));
  };

  const openSplit = (line: DraftShipmentLine) => {
    const maxQty = asNum(line.qty);
    if (maxQty <= 1) {
      alert("Qty must be greater than 1 to split.");
      return;
    }
    const input = window.prompt(`Split Qty (1 ~ ${maxQty - 1})`, String(Math.floor(maxQty / 2)));
    if (input === null) return;
    const splitQty = Math.max(1, Math.min(maxQty - 1, asNum(input)));
    if (!splitQty || splitQty >= maxQty) {
      alert("Invalid split qty.");
      return;
    }

    setDraftLines((prev) => {
      const out: DraftShipmentLine[] = [];
      for (const r of prev) {
        if (r.id !== line.id) {
          out.push(r);
          continue;
        }
        out.push({ ...r, qty: maxQty - splitQty });
        out.push({
          ...r,
          id: `${r.id}__split__${Date.now()}`,
          qty: splitQty,
          line_no: r.line_no,
        });
      }
      return out;
    });
  };

  const saveEdits = async () => {
    if (!shipmentId) return;
    if (!window.confirm("Do you want to save shipment edits? Removed lines will be saved as deleted.")) return;
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
        alert(j?.error || "Save failed.");
        return;
      }

      setEditMode(false);
      await load();
      alert("Saved.");
    } catch (e: any) {
      alert(e?.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const disableConfirm = ["CONFIRMED", "SHIPPED", "CANCELLED", "CANCELED", "DELETED"].includes(currentStatus);
  const disableShip = ["SHIPPED", "CANCELLED", "CANCELED", "DELETED"].includes(currentStatus);

  return (
    <AppShell role={role} title="Shipment Detail">
      <div className="flex flex-wrap items-center justify-end gap-2 mb-4">
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

        <Button variant="outline" onClick={onConfirmShipment} disabled={confirming || disableConfirm}>
          {confirming ? "Confirming..." : "Confirm Shipment"}
        </Button>

        <Button onClick={onMarkAsShipped} disabled={shipping || disableShip}>
          {shipping ? "Updating..." : "Mark as Shipped"}
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
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div>
              <div className="text-sm text-muted-foreground mb-1">Shipment No</div>
              <div className="break-all">{shipmentNo}</div>
            </div>

            <div>
              <div className="text-sm text-muted-foreground mb-1">PO No</div>
              <div>{poSummary.label}</div>
              {poSummary.detail ? (
                <div className="mt-1 text-xs text-muted-foreground break-all" title={poSummary.detail}>
                  {poSummary.detail}
                </div>
              ) : null}
            </div>

            <div>
              <div className="text-sm text-muted-foreground mb-1">Status</div>
              <div>{currentStatus || "-"}</div>
            </div>

            <div>
              <div className="text-sm text-muted-foreground mb-1">Ship Mode</div>
              {!editMode ? (
                <div>{currentShipMode || "-"}</div>
              ) : (
                <select
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={(editableShipMode || "").toString()}
                  onChange={(e) =>
                    setDraftShipment((prev: any) => ({
                      ...(prev ?? {}),
                      ship_mode: e.target.value,
                    }))
                  }
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
              <div>{S?.total_gw != null ? fmt1(S.total_gw) : "-"}</div>
            </div>

            <div>
              <div className="text-sm text-muted-foreground mb-1">Total N.W.</div>
              <div>{S?.total_nw != null ? fmt1(S.total_nw) : "-"}</div>
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
                  {creatingInvoice ? "Creating..." : "Create Invoice"}
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
                  {creatingPackingList ? "Creating..." : "Create Packing List"}
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
                              fmtInt(r.qty)
                            ) : (
                              <input
                                className="h-9 w-24 rounded-md border px-2 text-right"
                                value={String(asNum(r.qty))}
                                onChange={(e) => updateDraftQty(r.id, asNum(e.target.value))}
                              />
                            )}
                          </td>
                          <td className="p-2 text-right">{fmtInt(r.cartons)}</td>
                          <td className="p-2 text-right">{fmt1(r.gw)}</td>
                          <td className="p-2 text-right">{fmt1(r.nw)}</td>
                          {editMode && (
                            <td className="p-2 text-right">
                              <div className="flex justify-end gap-2">
                                <Button variant="outline" size="sm" onClick={() => openSplit(r as DraftShipmentLine)}>
                                  Split
                                </Button>
                                <Button variant="destructive" size="sm" onClick={() => onRemoveLine(r.id)}>
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
        </CardContent>
      </Card>
    </AppShell>
  );
}
