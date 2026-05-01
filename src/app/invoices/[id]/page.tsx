// src/app/invoices/[id]/page.tsx
"use client";

import * as React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

import AppShell from "@/components/layout/AppShell";
import type { AppRole } from "@/config/menuConfig";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { getCompanyStampByOrigin } from "@/lib/companyStamp";

import jsPDF from "jspdf";
// @ts-ignore
import autoTable from "jspdf-autotable";
import ExcelJS from "exceljs";

type DevRole = AppRole;

type InvoiceHeader = {
  id: string;

  invoice_no: string | null;
  invoice_date: string | null; // date

  buyer_id: string | null;
  buyer_name: string | null;
  buyer_code: string | null;

  currency: string | null;
  incoterm: string | null;
  payment_term: string | null;

  destination: string | null;

  shipping_origin_code: string | null;
  port_of_loading: string | null;
  final_destination: string | null;

  etd: string | null;
  eta: string | null;

  status: string | null;
  total_amount: number | null;

  remarks: string | null;
  consignee_text: string | null;
  notify_party_text: string | null;

  shipper_name: string | null;
  shipper_address: string | null;

  coo_text: string | null;

  is_deleted?: boolean | null;
};

type InvoiceLine = {
  id: string;

  invoice_id: string | null;
  invoice_header_id: string | null;
  shipment_id: string | null;

  po_no: string | null;
  line_no: number | null;

  style_no: string | null;
  description: string | null;

  material_content: string | null;
  hs_code: string | null;

  qty: number | null;
  unit_price: number | null;
  amount: number | null;

  is_deleted: boolean;

  color?: string | null;
  size?: string | null;
  cartons?: number | null;
  gw?: number | null;
  nw?: number | null;
};

type ReceiptRow = {
  id: string;
  invoice_id?: string | null;
  invoice_no?: string | null;

  receipt_date: string | null;
  received_amount: number | null;

  payment_method?: string | null;
  reference_no?: string | null;
  note?: string | null;

  created_at?: string | null;
  created_by_email?: string | null;

  is_deleted?: boolean | null;
};

type ReceiptTraceRow = {
  receipt_id: string;
  receipt_date: string | null;
  receipt_no?: string | null;
  gross_amount: number;
  applied_amount: number;
  writeoff_amount?: number;
  our_fee_amount?: number;
  buyer_fee_amount?: number;
  claim_amount?: number;
  method?: string | null;
  reference_no?: string | null;
  note?: string | null;
  created_by_email?: string | null;
};

type ReceiptTraceSummary = {
  invoice_total: number;
  gross_received_total: number;
  applied_total: number;
  balance: number;
  payment_status: string;
  rows: ReceiptTraceRow[];
};

function todayISODate() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function normalizeDateInput(v?: string | null) {
  if (!v) return "";
  return String(v).trim().slice(0, 10);
}
function fmtDate10(v?: string | null) {
  if (!v) return "";
  try {
    return String(v).slice(0, 10);
  } catch {
    return String(v);
  }
}

function fmtMoney2(v: any) {
  return Number(v || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function shortId(v?: string | null) {
  const x = s(v);
  if (!x) return "";
  return x.length <= 12 ? x : `${x.slice(0, 8)}-${x.slice(-4)}`;
}
function displayReceiptLabel(r: { receipt_no?: string | null; reference_no?: string | null; receipt_id?: string | null }) {
  return s(r.receipt_no) || s(r.reference_no) || shortId(r.receipt_id) || "-";
}

function fmtQty0(v: any) {
  const n = Number(v || 0);
  const isInt = Number.isFinite(n) && Math.abs(n - Math.round(n)) < 1e-9;
  return isInt
    ? n.toLocaleString("en-US", { maximumFractionDigits: 0 })
    : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function upperIncludesLDC(header: InvoiceHeader) {
  const s0 = `${header.buyer_name || ""} ${header.buyer_code || ""} ${
    header.invoice_no || ""
  }`.toUpperCase();
  return s0.includes("LDC");
}

function shouldShowMaterialHS(header: InvoiceHeader, lines: InvoiceLine[]) {
  if (upperIncludesLDC(header)) return true;
  return (lines || []).some(
    (l) =>
      (l.material_content && l.material_content.trim() !== "") ||
      (l.hs_code && l.hs_code.trim() !== "")
  );
}

function getStampAssetByOrigin(origin?: string | null) {
  const stamp = getCompanyStampByOrigin(origin);
  return { src: stamp.publicPath, format: stamp.format };
}

function originCodeToCooText(origin?: string | null) {
  const o = String(origin || "").toUpperCase();
  if (!o) return "";
  if (o.startsWith("VN_") || o.includes("VIET")) return "MADE IN VIETNAM";
  if (o.startsWith("CN_") || o.includes("CHINA") || o.includes("QINGDAO"))
    return "MADE IN CHINA";
  if (o.startsWith("KR_") || o.includes("KOREA") || o.includes("SEOUL"))
    return "MADE IN KOREA";
  return `MADE IN ${o.replace(/_/g, " ")}`;
}

function getContainedSize(
  naturalWidth: number,
  naturalHeight: number,
  maxWidth: number,
  maxHeight: number
) {
  const nw = Number.isFinite(naturalWidth) && naturalWidth > 0 ? naturalWidth : maxWidth;
  const nh = Number.isFinite(naturalHeight) && naturalHeight > 0 ? naturalHeight : maxHeight;
  const scale = Math.min(maxWidth / nw, maxHeight / nh, 1);
  return { width: nw * scale, height: nh * scale };
}

function n(v: any) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}
function s(v: any) {
  return (v ?? "").toString().trim();
}
function poSort(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function buildLineSnapshot(lines: InvoiceLine[]) {
  const snapshot: Record<string, { material_content: string; hs_code: string }> = {};
  for (const l of lines || []) {
    snapshot[l.id] = {
      material_content: (l.material_content || "").trim(),
      hs_code: (l.hs_code || "").trim(),
    };
  }
  return snapshot;
}

function groupInvoiceLines(lines: InvoiceLine[]) {
  const alive = (lines || []).filter((l) => !l?.is_deleted);

  const map = new Map<string, InvoiceLine[]>();
  for (const l of alive) {
    const key = s(l.po_no) || "-";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(l);
  }

  const poNos = Array.from(map.keys()).sort(poSort);

  return poNos.map((poNo) => {
    const arr = (map.get(poNo) || []).slice();
    arr.sort((a, b) => {
      const sa = s(a.style_no);
      const sb = s(b.style_no);
      if (sa !== sb) return sa.localeCompare(sb);

      const la = Number(a.line_no ?? 999999);
      const lb = Number(b.line_no ?? 999999);
      if (la !== lb) return la - lb;

      return s(a.id).localeCompare(s(b.id));
    });

    const poSubtotal = arr.reduce((sum, r) => sum + n(r.amount), 0);
    const poQty = arr.reduce((sum, r) => sum + n(r.qty), 0);

    return { poNo, lines: arr, poSubtotal, poQty };
  });
}


function InfoBox({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-base font-semibold">{value ?? "—"}</div>
    </div>
  );
}


export default function InvoiceDetailPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useParams<{ id: string }>();
  const invoiceId = params?.id;

  const [role, setRole] = React.useState<DevRole>("viewer");

  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);

  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [savedAt, setSavedAt] = React.useState<string | null>(null);
  const [originalInvoiceDate, setOriginalInvoiceDate] = React.useState<string>("");
  const [refreshing, setRefreshing] = React.useState(false);

  const [header, setHeader] = React.useState<InvoiceHeader | null>(null);
  const [lines, setLines] = React.useState<InvoiceLine[]>([]);
  const [savedLineSnapshot, setSavedLineSnapshot] = React.useState<Record<string, { material_content: string; hs_code: string }>>({});

  const [receiptsLoading, setReceiptsLoading] = React.useState(false);
  const [receipts, setReceipts] = React.useState<ReceiptRow[]>([]);

  const [traceLoading, setTraceLoading] = React.useState(false);
  const [traceSummary, setTraceSummary] = React.useState<ReceiptTraceSummary | null>(null);
  const [selectedReceipt, setSelectedReceipt] = React.useState<any | null>(null);
  const [receiptDetailLoading, setReceiptDetailLoading] = React.useState(false);

  const [creatingReceipt, setCreatingReceipt] = React.useState(false);
  const [savingReceipt, setSavingReceipt] = React.useState(false);

  const [editingReceiptId, setEditingReceiptId] = React.useState<string | null>(null);
  const [editReceipt, setEditReceipt] = React.useState({
    receipt_date: todayISODate(),
    received_amount: "",
    payment_method: "WIRE",
    reference_no: "",
    note: "",
  });

  const [newReceipt, setNewReceipt] = React.useState({
    receipt_date: todayISODate(),
    received_amount: "",
    payment_method: "WIRE",
    reference_no: "",
    note: "",
  });

  const parseAmount = (v: any) => {
    const x = Number(String(v ?? "").replace(/,/g, "").trim());
    return Number.isFinite(x) ? x : 0;
  };

  const loadReceipts = React.useCallback(async () => {
    if (!invoiceId) return;
    setReceiptsLoading(true);
    try {
      const res = await fetch(
        `/api/invoices/${encodeURIComponent(invoiceId)}/receipts`,
        { cache: "no-store" }
      );
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        console.warn("Failed to load receipts", json);
        setReceipts([]);
        return;
      }

      const rows: ReceiptRow[] =
        json?.rows ?? json?.data?.rows ?? json?.receipts ?? json?.data ?? [];

      setReceipts((rows || []).filter((r) => !r?.is_deleted));
    } catch (e) {
      console.error(e);
      setReceipts([]);
    } finally {
      setReceiptsLoading(false);
    }
  }, [invoiceId]);

  React.useEffect(() => {
    loadReceipts();
  }, [loadReceipts]);

  const loadReceiptTrace = React.useCallback(async () => {
    if (!invoiceId) return;
    setTraceLoading(true);
    try {
      const res = await fetch(
        `/api/invoices/${encodeURIComponent(invoiceId)}/receipt-trace`,
        { cache: "no-store" }
      );
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        console.warn("Failed to load receipt trace", json);
        setTraceSummary(null);
        return;
      }

      const payload = json?.data ?? json ?? {};
      setTraceSummary({
        invoice_total: Number(payload?.invoice_total || 0),
        gross_received_total: Number(payload?.gross_received_total || 0),
        applied_total: Number(payload?.applied_total || 0),
        balance: Number(payload?.balance || 0),
        payment_status: String(payload?.payment_status || "UNPAID"),
        rows: Array.isArray(payload?.rows) ? payload.rows : [],
      });
    } catch (e) {
      console.error(e);
      setTraceSummary(null);
    } finally {
      setTraceLoading(false);
    }
  }, [invoiceId]);

  React.useEffect(() => {
    loadReceipts();
    loadReceiptTrace();
  }, [loadReceipts, loadReceiptTrace]);


  const openReceiptDetail = React.useCallback(async (receiptId: string) => {
    if (!receiptId) return;
    setReceiptDetailLoading(true);
    try {
      const res = await fetch(`/api/receipts/${encodeURIComponent(receiptId)}`, {
        cache: "no-store",
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        alert(json?.error || json?.message || "Failed to load receipt detail.");
        return;
      }
      setSelectedReceipt(json?.row ?? null);
    } catch (e) {
      console.error(e);
      alert("Failed to load receipt detail.");
    } finally {
      setReceiptDetailLoading(false);
    }
  }, []);

  const closeReceiptDetail = React.useCallback(() => {
    setSelectedReceipt(null);
  }, []);

  const recomputeTotal = React.useMemo(() => {
    const sum = (lines || []).reduce((acc, l) => acc + Number(l.amount || 0), 0);
    return sum;
  }, [lines]);

  const grossReceivedTotal = React.useMemo(() => {
    if (traceSummary) return Number(traceSummary.gross_received_total || 0);
    return (receipts || []).reduce((sum, r) => sum + parseAmount(r.received_amount), 0);
  }, [receipts, traceSummary]);

  const invoiceTotalForPayment = React.useMemo(() => {
    const t =
      traceSummary?.invoice_total != null && Number(traceSummary.invoice_total) > 0
        ? Number(traceSummary.invoice_total)
        : header?.total_amount != null && Number(header.total_amount) > 0
        ? Number(header.total_amount)
        : Number(recomputeTotal || 0);
    return Number.isFinite(t) ? t : 0;
  }, [traceSummary?.invoice_total, header?.total_amount, recomputeTotal]);

  const receivedTotal = React.useMemo(() => {
    if (traceSummary) return Number(traceSummary.applied_total || 0);
    return 0;
  }, [traceSummary]);

  const balance = React.useMemo(() => {
    if (traceSummary) return Number(traceSummary.balance || 0);
    return invoiceTotalForPayment - receivedTotal;
  }, [invoiceTotalForPayment, receivedTotal, traceSummary]);

  const paymentStatus = React.useMemo(() => {
    if (traceSummary?.payment_status) return traceSummary.payment_status;
    const inv = Number(invoiceTotalForPayment || 0);
    const rec = Number(receivedTotal || 0);
    const tol = 0.005;

    if (rec <= tol) return "UNPAID";
    if (rec < inv - tol) return "PARTIALLY_PAID";
    if (Math.abs(rec - inv) <= tol) return "PAID";
    return "OVERPAID";
  }, [invoiceTotalForPayment, receivedTotal, traceSummary]);

  const resetNewReceiptDefaults = React.useCallback(() => {
    setNewReceipt({
      receipt_date: todayISODate(),
      received_amount: balance > 0 ? String(Math.round(balance * 100) / 100) : "",
      payment_method: "WIRE",
      reference_no: "",
      note: "",
    });
  }, [balance]);

  React.useEffect(() => {
    resetNewReceiptDefaults();
  }, [resetNewReceiptDefaults]);

  const handleCreateReceipt = React.useCallback(async () => {
    if (!invoiceId) return;

    const amt = parseAmount(newReceipt.received_amount);
    if (amt <= 0) {
      alert("Amount must be greater than 0.");
      return;
    }

    setCreatingReceipt(true);
    try {
      const res = await fetch(
        `/api/invoices/${encodeURIComponent(invoiceId)}/receipts`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            receipt_date: newReceipt.receipt_date || null,
            received_amount: amt,
            amount: amt,
            payment_method: (newReceipt.payment_method || "WIRE").trim(),
            method: (newReceipt.payment_method || "WIRE").trim(),
            reference_no: (newReceipt.reference_no || "").trim() || null,
            note: (newReceipt.note || "").trim() || null,
          }),
        }
      );

      const json = await res.json().catch(() => null);
      if (!res.ok) {
        alert(json?.error || json?.message || `Create failed (${res.status})`);
        return;
      }

      await Promise.all([loadReceipts(), loadReceiptTrace()]);
      resetNewReceiptDefaults();
    } catch (e) {
      console.error(e);
      alert("Create failed.");
    } finally {
      setCreatingReceipt(false);
    }
  }, [invoiceId, newReceipt, loadReceipts, resetNewReceiptDefaults]);

  const startEditReceipt = React.useCallback((r: ReceiptRow) => {
    setEditingReceiptId(r.id);
    setEditReceipt({
      receipt_date: fmtDate10(r.receipt_date) || todayISODate(),
      received_amount: r.received_amount == null ? "" : String(r.received_amount),
      payment_method: (r.payment_method || "WIRE").toString(),
      reference_no: (r.reference_no || "").toString(),
      note: (r.note || "").toString(),
    });
  }, []);

  const cancelEditReceipt = React.useCallback(() => {
    setEditingReceiptId(null);
  }, []);

  const handleUpdateReceipt = React.useCallback(
    async (receiptId: string) => {
      const amt = parseAmount(editReceipt.received_amount);
      if (amt <= 0) {
        alert("Amount must be greater than 0.");
        return;
      }

      setSavingReceipt(true);
      try {
        const res = await fetch(`/api/receipts/${encodeURIComponent(receiptId)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            receipt_date: editReceipt.receipt_date || null,
            received_amount: amt,
            payment_method: (editReceipt.payment_method || "WIRE").trim(),
            reference_no: (editReceipt.reference_no || "").trim() || null,
            note: (editReceipt.note || "").trim() || null,
          }),
        });

        const json = await res.json().catch(() => null);
        if (!res.ok) {
          alert(json?.error || json?.message || `Update failed (${res.status})`);
          return;
        }

        setEditingReceiptId(null);
        await Promise.all([loadReceipts(), loadReceiptTrace()]);
      } catch (e) {
        console.error(e);
        alert("Update failed.");
      } finally {
        setSavingReceipt(false);
      }
    },
    [editReceipt, loadReceipts]
  );

  const handleDeleteReceipt = React.useCallback(
    async (receiptId: string) => {
      const ok = confirm("Delete this receipt? (soft delete)");
      if (!ok) return;

      try {
        const res = await fetch(`/api/receipts/${encodeURIComponent(receiptId)}`, {
          method: "DELETE",
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          alert(json?.error || json?.message || `Delete failed (${res.status})`);
          return;
        }
        await Promise.all([loadReceipts(), loadReceiptTrace()]);
      } catch (e) {
        console.error(e);
        alert("Delete failed.");
      }
    },
    [loadReceipts]
  );

  const autoPdfRequested = (searchParams?.get("autoPdf") || "") === "1";
  const autoExcelRequested = (searchParams?.get("autoExcel") || "") === "1";
  const autoPdfRanRef = React.useRef(false);
  const autoExcelRanRef = React.useRef(false);

  const applyInvoiceState = React.useCallback((h: InvoiceHeader, rawLines: InvoiceLine[]) => {
    const patchedHeader: InvoiceHeader = {
      ...h,
      invoice_date: normalizeDateInput(h.invoice_date) || "",
      etd: normalizeDateInput(h.etd) || "",
      eta: normalizeDateInput(h.eta) || "",
    };

    const aliveLines = (rawLines || []).filter((l) => !l?.is_deleted);

    setHeader(patchedHeader);
    setLines(aliveLines);
    setSavedLineSnapshot(buildLineSnapshot(aliveLines));
    setOriginalInvoiceDate(normalizeDateInput(patchedHeader.invoice_date));
    setSaveError(null);

    return { header: patchedHeader, lines: aliveLines };
  }, []);

  React.useEffect(() => {
    setRole("admin");
  }, []);

  const loadInvoice = React.useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!invoiceId) return null;

      const silent = !!opts?.silent;
      if (silent) setRefreshing(true);
      else setLoading(true);

      setErrorMsg(null);

      try {
        const res = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}`, {
          cache: "no-store",
        });
        const json = await res.json().catch(() => null);

        if (!res.ok) {
          const msg =
            json?.error ||
            json?.message ||
            `Failed to load invoice (${res.status})`;
          setErrorMsg(msg);
          setHeader(null);
          setLines([]);
          return null;
        }

        const h: InvoiceHeader | null =
          json?.header ?? json?.data?.header ?? json?.invoice?.header ?? null;

        const rawLines: InvoiceLine[] =
          json?.lines ?? json?.data?.lines ?? json?.invoice?.lines ?? [];

        if (!h) {
          setErrorMsg("Failed to load invoice.");
          setHeader(null);
          setLines([]);
          return null;
        }

        return applyInvoiceState(h, rawLines);
      } catch (e: any) {
        console.error(e);
        setErrorMsg("Failed to load invoice.");
        setHeader(null);
        setLines([]);
        return null;
      } finally {
        if (silent) setRefreshing(false);
        else setLoading(false);
      }
    },
    [invoiceId, applyInvoiceState]
  );

  React.useEffect(() => {
    void loadInvoice();
  }, [loadInvoice]);

  const currency = header?.currency || "USD";
  const invoiceDateDirty =
    normalizeDateInput(header?.invoice_date) !== normalizeDateInput(originalInvoiceDate);

  const setHeaderField = <K extends keyof InvoiceHeader>(
    key: K,
    value: InvoiceHeader[K]
  ) => {
    setSavedAt(null);
    setSaveError(null);
    setHeader((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const setLineField = <K extends keyof InvoiceLine>(
    idx: number,
    key: K,
    value: InvoiceLine[K]
  ) => {
    setSavedAt(null);
    setSaveError(null);
    setLines((prev) => {
      const next = [...prev];
      const row = { ...(next[idx] as InvoiceLine) };

      (row as any)[key] = value;

      if (key === "qty" || key === "unit_price") {
        const q = Number((key === "qty" ? value : row.qty) || 0);
        const u = Number((key === "unit_price" ? value : row.unit_price) || 0);
        row.amount = q * u;
      }

      next[idx] = row;
      return next;
    });
  };

  const handleSave = React.useCallback(async () => {
    if (!invoiceId || !header) return;

    const overwriteTargets = (lines || []).filter((l) => {
      const prev = savedLineSnapshot[l.id];
      if (!prev) return false;

      const prevMaterial = (prev.material_content || "").trim();
      const prevHs = (prev.hs_code || "").trim();
      const nextMaterial = (l.material_content || "").trim();
      const nextHs = (l.hs_code || "").trim();

      const materialChanged = prevMaterial !== "" && prevMaterial !== nextMaterial;
      const hsChanged = prevHs !== "" && prevHs !== nextHs;

      return materialChanged || hsChanged;
    });

    if (overwriteTargets.length > 0) {
      const ok = window.confirm(
        `Existing Material / HS Code value will be overwritten for ${overwriteTargets.length} line(s). Continue?`
      );
      if (!ok) return;
    }

    setSaving(true);
    setSaveError(null);
    setSavedAt(null);

    try {
      const safeDate = normalizeDateInput(header.invoice_date) || null;
      const payload = {
        header: {
          invoice_no: header.invoice_no ?? null,
          invoice_date: safeDate,

          currency: header.currency ?? null,
          incoterm: header.incoterm ?? null,
          payment_term: header.payment_term ?? null,

          destination: header.destination ?? null,

          remarks: header.remarks ?? null,
          consignee_text: header.consignee_text ?? null,
          notify_party_text: header.notify_party_text ?? null,

          shipper_name: header.shipper_name ?? null,
          shipper_address: header.shipper_address ?? null,

          shipping_origin_code: header.shipping_origin_code ?? null,
          port_of_loading: header.port_of_loading ?? null,
          final_destination: header.final_destination ?? null,

          etd: normalizeDateInput(header.etd) || null,
          eta: normalizeDateInput(header.eta) || null,

          status: header.status ?? null,

          total_amount:
            header.total_amount != null
              ? Number(header.total_amount)
              : Number(recomputeTotal),
        },
        lines: (lines || []).map((l) => ({
          id: l.id,
          invoice_id: l.invoice_id ?? invoiceId,
          invoice_header_id: l.invoice_header_id ?? invoiceId,
          shipment_id: l.shipment_id ?? null,

          po_no: l.po_no ?? null,
          line_no: l.line_no ?? null,
          style_no: l.style_no ?? null,
          description: l.description ?? null,

          material_content: l.material_content ?? null,
          hs_code: l.hs_code ?? null,

          qty: l.qty ?? null,
          unit_price: l.unit_price ?? null,
          amount: l.amount ?? null,

          is_deleted: !!l.is_deleted,
        })),
      };

      const res = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(payload),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        const msg =
          json?.error || json?.message || `Save failed (status ${res.status})`;
        setSaveError(msg);
        alert(msg);
        return;
      }

      const h: InvoiceHeader | null =
        json?.header ?? json?.data?.header ?? json?.invoice?.header ?? null;
      const rawLines: InvoiceLine[] =
        json?.lines ?? json?.data?.lines ?? json?.invoice?.lines ?? [];

      if (h) {
        applyInvoiceState(h, rawLines || []);
      }

      const refreshed = await loadInvoice({ silent: true });
      const finalSavedDate =
        normalizeDateInput(refreshed?.header?.invoice_date) ||
        normalizeDateInput(h?.invoice_date);

      if (safeDate && finalSavedDate !== safeDate) {
        const msg = `Invoice Date save mismatch.\nRequested: ${safeDate}\nSaved: ${finalSavedDate || "(blank)"}`;
        setSaveError(msg);
        alert(msg);
        return;
      }

      setSavedAt(
        new Date().toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        })
      );
    } catch (e: any) {
      console.error(e);
      setSaveError("Save failed.");
      alert("Save failed.");
    } finally {
      setSaving(false);
    }
  }, [invoiceId, header, lines, recomputeTotal, savedLineSnapshot, applyInvoiceState, loadInvoice]);

  const handlePdf = React.useCallback(async (): Promise<void> => {
    if (!header) return;
    setExporting(true);
    try {
      const doc = new jsPDF("p", "mm", "a4");
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 10;
      const contentWidth = pageWidth - margin * 2;
      const half = contentWidth / 2;
      let y = 14;

      doc.setFontSize(20);
      doc.setFont("helvetica", "bold");
      doc.text("COMMERCIAL INVOICE", pageWidth / 2, y, { align: "center" });
      y += 12;

      doc.setFontSize(13);
      doc.setFont("helvetica", "normal");
      doc.text(`Buyer: ${header.buyer_name || "-"}`, margin, y);
      y += 8;

      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");

      const shipperName = (header.shipper_name || "JM International Co.,Ltd").trim();
      const shipperAddress = (header.shipper_address || "").trim();

      const invoiceNo = header.invoice_no || "-";
      const invoiceDate = fmtDate10(header.invoice_date) || "-";
      const cur = header.currency || "USD";
      const incoterm = header.incoterm || "-";
      const payTerm = header.payment_term || "-";

      const remarksText = (header.remarks || "").trim();
      const remarksFontSize = 10;
      const remarksLineH = 4.5;
      const remarksLinesRaw = remarksText
        ? (() => {
            doc.setFontSize(remarksFontSize);
            doc.setFont("helvetica", "bold");
            const lines = doc.splitTextToSize(`Remarks: ${remarksText}`, half - 4);
            doc.setFontSize(9);
            doc.setFont("helvetica", "normal");
            return lines;
          })()
        : [];
      const remarksLines = remarksLinesRaw.slice(0, 2);

      const infoBase = [
        `Invoice No: ${invoiceNo}`,
        `Date: ${invoiceDate}`,
        `Currency: ${cur}`,
        `Incoterm: ${incoterm}`,
        `Payment Term: ${payTerm}`,
      ];

      const topBoxH = Math.max(
        22 + remarksLines.length * remarksLineH,
        9 + infoBase.length * 3.5 + (remarksLines.length > 0 ? 1 + remarksLines.length * remarksLineH : 0) + 4
      );

      doc.rect(margin, y, half, topBoxH);
      doc.setFont("helvetica", "bold");
      doc.text("Shipper / Exporter", margin + 2, y + 4.8);
      doc.setFont("helvetica", "normal");
      const shipperLines = doc.splitTextToSize(
        shipperAddress ? `${shipperName}
${shipperAddress}` : `${shipperName}`,
        half - 4
      );
      doc.text(shipperLines, margin + 2, y + 9.4);

      doc.rect(margin + half, y, half, topBoxH);
      doc.setFont("helvetica", "bold");
      doc.text("Invoice Info", margin + half + 2, y + 4.8);
      doc.setFont("helvetica", "normal");

      let infoY = y + 9.4;
      for (const line of infoBase) {
        doc.text(line, margin + half + 2, infoY);
        infoY += 3.5;
      }

      if (remarksLines.length > 0) {
        infoY += 1;
        doc.setFontSize(remarksFontSize);
        doc.setFont("helvetica", "bold");
        doc.text(remarksLines, margin + half + 2, infoY);
        doc.setFontSize(9);
        doc.setFont("helvetica", "normal");
      }

      y += topBoxH;

      const consignee = (header.consignee_text || "").trim() || "-";
      const notify = (header.notify_party_text || "").trim() || "-";

      const consigneeLines = doc.splitTextToSize(consignee, half - 4);
      const notifyLines = doc.splitTextToSize(notify, half - 4);
      const partyBodyLines = Math.max(consigneeLines.length, notifyLines.length, 1);
      const partyLineH = 3.5;
      const partyTextY = y + 8.6;
      const partyH = Math.max(16, 8.6 + partyBodyLines * partyLineH + 2.5);
      doc.rect(margin, y, half, partyH);
      doc.rect(margin + half, y, half, partyH);

      doc.setFont("helvetica", "bold");
      doc.text("Consignee", margin + 2, y + 4.5);
      doc.text("Notify Party", margin + half + 2, y + 4.5);

      doc.setFont("helvetica", "normal");
      doc.text(consigneeLines, margin + 2, partyTextY, { lineHeightFactor: 1.05 });
      doc.text(notifyLines, margin + half + 2, partyTextY, { lineHeightFactor: 1.05 });

      y += partyH;

      const pol = (header.port_of_loading || "").trim() || "-";
      const finalDest = (header.final_destination || header.destination || "").trim() || "-";
      const polLines = doc.splitTextToSize(pol, half - 4);
      const finalDestLines = doc.splitTextToSize(finalDest, half - 4);
      const transportBodyLines = Math.max(polLines.length, finalDestLines.length, 1);
      const transportH = Math.max(14, 10 + transportBodyLines * 4 + 3);

      doc.rect(margin, y, half, transportH);
      doc.rect(margin + half, y, half, transportH);

      doc.setFont("helvetica", "bold");
      doc.text("Port of Loading", margin + 2, y + 5);
      doc.text("Final Destination", margin + half + 2, y + 5);

      doc.setFont("helvetica", "normal");
      doc.text(polLines, margin + 2, y + 10);
      doc.text(finalDestLines, margin + half + 2, y + 10);

      y += transportH;

      const originCode = (header.shipping_origin_code || "").toUpperCase();
      const originDisplay =
      originCode.includes("VN")
    ? "MADE IN VIETNAM"
    : originCode.includes("KR")
    ? "MADE IN KOREA"
    : originCode.includes("CN")
    ? "MADE IN CHINA"
    : "-";
      const cooH = 18;
      doc.rect(margin, y, contentWidth, cooH);
      doc.setFont("helvetica", "bold");
      doc.text("COO / Certification", margin + 2, y + 5);
      doc.setFont("helvetica", "normal");

      const cooText = (header.coo_text || "").trim();
      doc.text(`COO: ${cooText || originDisplay || "-"}`, margin + 2, y + 10);
      doc.text(
        "WE CERTIFY THERE IS NO WOOD PACKING MATERIAL USED IN THIS SHIPMENT.",
        margin + 2,
        y + 14
      );

      y += cooH + 6;

      const showMatHs = shouldShowMaterialHS(header, lines);

      const headBase = ["PO No", "Style No", "Description"];
      const headMat = showMatHs ? ["Material", "HS Code"] : [];
      const headTail = ["Qty", "Unit Price", "Amount"];
      const head = [[...headBase, ...headMat, ...headTail]];

      const colCount = head[0].length;

      const groups = groupInvoiceLines(lines);
      const body: any[] = [];
      let grandTotalCalc = 0;

      for (const g of groups) {
        grandTotalCalc += Number(g.poSubtotal || 0);

        body.push([
          {
            content: `PO# ${g.poNo}`,
            colSpan: colCount,
            styles: { fontStyle: "bold", halign: "left" },
          },
        ]);

        for (const l of g.lines) {
          const row: any[] = [l.po_no || "", l.style_no || "", l.description || ""];
          if (showMatHs) row.push(l.material_content || "", l.hs_code || "");
          row.push(fmtQty0(l.qty), fmtMoney2(l.unit_price), fmtMoney2(l.amount));
          body.push(row);
        }

        body.push([
          {
            content: `PO Subtotal (Qty: ${fmtQty0(g.poQty)})`,
            colSpan: colCount - 1,
            styles: { fontStyle: "bold", halign: "right" },
          },
          {
            content: `${cur} ${fmtMoney2(g.poSubtotal)}`,
            styles: { fontStyle: "bold", halign: "right" },
          },
        ]);
      }

      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin },
        head,
        body,
        theme: "grid",
        styles: { fontSize: 8, cellPadding: 1.8, halign: "center", valign: "middle" },
        headStyles: { fontStyle: "bold" },
        columnStyles: {
          [colCount - 3]: { halign: "right" },
          [colCount - 2]: { halign: "right" },
          [colCount - 1]: { halign: "right" },
        },
      });

      const lastTableY = (doc as any).lastAutoTable?.finalY ?? y + 40;
      let y2 = lastTableY + 10;
      if (y2 > pageHeight - 40) {
        doc.addPage();
        y2 = 20;
      }

      const grandTotal =
        header.total_amount != null && Number(header.total_amount) > 0
          ? Number(header.total_amount)
          : Number(recomputeTotal || grandTotalCalc);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text("Grand Total", margin, y2);
      doc.text(`${cur} ${fmtMoney2(grandTotal)}`, pageWidth - margin, y2, { align: "right" });

      const stampAsset = getStampAssetByOrigin(header.shipping_origin_code);
      const stampImg = new Image();
      stampImg.src = stampAsset.src;

      await new Promise<void>((resolve, reject) => {
        stampImg.onload = () => resolve();
        stampImg.onerror = () => reject(new Error("Stamp image load error"));
      });

      const maxStampWidth = 60;
      const maxStampHeight = 30;
      const stampSize = getContainedSize(
        stampImg.naturalWidth,
        stampImg.naturalHeight,
        maxStampWidth,
        maxStampHeight
      );
      const stampWidth = stampSize.width;
      const stampHeight = stampSize.height;
      const sigTextTopGap = 6;
      const sigBottomGap = 8;
      const sigBlockH = sigTextTopGap + stampHeight + sigBottomGap + 10;
      let stampY = Math.max(y2 + 24, pageHeight - 12 - sigBlockH);
      const fitsSamePage = stampY + sigBlockH <= pageHeight - 12;

      if (!fitsSamePage) {
        doc.addPage();
        stampY = pageHeight - 12 - sigBlockH;
      }

      const stampX = pageWidth - margin - stampWidth;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      doc.text("Signed by", pageWidth - margin, stampY - 4, { align: "right" });

      doc.addImage(stampImg, stampAsset.format, stampX, stampY, stampWidth, stampHeight);
      doc.text("JM International Co.,Ltd", pageWidth - margin, stampY + stampHeight + 6, {
        align: "right",
      });

      const pageCount = doc.getNumberOfPages();
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);

      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.text(`Page ${i} of ${pageCount}`, pageWidth / 2, pageHeight - 10, {
          align: "center",
        });
      }

      doc.save(`${header.invoice_no || "commercial-invoice"}.pdf`);
    } catch (e) {
      console.error(e);
      alert("Failed to export PDF.");
    } finally {
      setExporting(false);
    }
  }, [header, lines, recomputeTotal]);

  const handleExcel = React.useCallback(async (): Promise<void> => {
    if (!header) return;
    setExporting(true);
    try {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "JM ERP";
      workbook.created = new Date();
      const sheet = workbook.addWorksheet("Commercial Invoice", {
        pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
        views: [{ showGridLines: false }],
      });

      sheet.columns = [
        { width: 14 }, { width: 18 }, { width: 24 }, { width: 14 },
        { width: 12 }, { width: 10 }, { width: 14 }, { width: 16 },
      ];

      const border = { style: "thin", color: { argb: "FF000000" } } as const;
      const lightBorder = { style: "thin", color: { argb: "FF999999" } } as const;
      const headerFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF3F7" } } as const;

      const boxRange = (from: string, to: string) => {
        const fromCell = sheet.getCell(from);
        const toCell = sheet.getCell(to);
        for (let rowNo = Number(fromCell.row); rowNo <= Number(toCell.row); rowNo++) {
          for (let colNo = Number(fromCell.col); colNo <= Number(toCell.col); colNo++) {
            const cell = sheet.getCell(rowNo, colNo);
            cell.border = { top: border, left: border, bottom: border, right: border };
            cell.alignment = { vertical: "top", wrapText: true };
          }
        }
      };

      const currency = header.currency || "USD";
      const shipperName = s(header.shipper_name || "JM International Co.,Ltd");
      const shipperAddress = s(header.shipper_address || "");
      const invoiceNo = s(header.invoice_no) || "commercial-invoice";
      const invoiceDate = fmtDate10(header.invoice_date) || "-";
      const poNos = Array.from(new Set((lines || []).filter((l) => !l.is_deleted).map((l) => s(l.po_no)).filter(Boolean))).sort(poSort);
      const poText = poNos.length ? poNos.join(", ") : "-";
      const consignee = s(header.consignee_text) || "-";
      const notify = s(header.notify_party_text) || "-";
      const portOfLoading = s(header.port_of_loading) || "-";
      const finalDestination = s(header.final_destination || header.destination) || "-";
      const cooText = s(header.coo_text) || originCodeToCooText(header.shipping_origin_code) || "-";

      sheet.mergeCells("A1:H1");
      sheet.getCell("A1").value = "Commercial Invoice";
      sheet.getCell("A1").font = { bold: true, size: 18 };
      sheet.getCell("A1").alignment = { horizontal: "center" };
      sheet.getRow(1).height = 28;

      sheet.mergeCells("A2:D2");
      sheet.mergeCells("E2:H2");
      sheet.mergeCells("A3:D3");
      sheet.mergeCells("E3:H3");
      sheet.getCell("A2").value = `Buyer: ${header.buyer_name || "-"}`;
      sheet.getCell("E2").value = `Invoice No: ${invoiceNo}`;
      sheet.getCell("A3").value = `PO No: ${poText}`;
      sheet.getCell("E3").value = `Date: ${invoiceDate}`;
      sheet.getCell("E2").alignment = { horizontal: "right" };
      sheet.getCell("E3").alignment = { horizontal: "right" };

      sheet.mergeCells("A5:D5");
      sheet.mergeCells("E5:H5");
      sheet.mergeCells("A6:D7");
      sheet.mergeCells("E6:H7");
      sheet.getCell("A5").value = "Shipper / Exporter";
      sheet.getCell("E5").value = "Invoice & Terms";
      sheet.getCell("A6").value = [shipperName, shipperAddress].filter(Boolean).join("\n");
      sheet.getCell("E6").value = `Terms: ${header.payment_term || "-"}\nIncoterm: ${header.incoterm || "-"}\nCurrency: ${currency}`;
      boxRange("A5", "H7");

      sheet.mergeCells("A9:D9");
      sheet.mergeCells("E9:H9");
      sheet.mergeCells("A10:D12");
      sheet.mergeCells("E10:H12");
      sheet.getCell("A9").value = "Consignee";
      sheet.getCell("E9").value = "Notify Party";
      sheet.getCell("A10").value = consignee;
      sheet.getCell("E10").value = notify;
      boxRange("A9", "H12");

      sheet.mergeCells("A14:D14");
      sheet.mergeCells("E14:H14");
      sheet.mergeCells("A15:D15");
      sheet.mergeCells("E15:H15");
      sheet.getCell("A14").value = "Port of Loading";
      sheet.getCell("E14").value = "Final Destination";
      sheet.getCell("A15").value = portOfLoading;
      sheet.getCell("E15").value = finalDestination;
      boxRange("A14", "H15");

      sheet.mergeCells("A17:H17");
      sheet.mergeCells("A18:H19");
      sheet.getCell("A17").value = "COO / Certification";
      sheet.getCell("A18").value = `${cooText}\nWE CERTIFY THERE IS NO WOOD PACKING MATERIAL USED IN THIS SHIPMENT.`;
      boxRange("A17", "H19");

      for (const addr of ["A5", "E5", "A9", "E9", "A14", "E14", "A17"]) {
        sheet.getCell(addr).font = { bold: true };
        sheet.getCell(addr).fill = headerFill;
      }

      const showMatHs = shouldShowMaterialHS(header, lines);
      const tableStart = 21;
      const tableHeader = [
        "PO #",
        "Style #",
        "Description",
        ...(showMatHs ? ["Material", "HS Code"] : []),
        "Qty",
        "Unit Price",
        "Amount",
      ];
      const headerRow = sheet.getRow(tableStart);
      headerRow.values = tableHeader;
      headerRow.eachCell((cell) => {
        cell.fill = headerFill;
        cell.font = { bold: true };
        cell.border = { top: lightBorder, left: lightBorder, bottom: lightBorder, right: lightBorder };
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      });

      let rowNo = tableStart + 1;
      for (const g of groupInvoiceLines(lines)) {
        for (const l of g.lines) {
          const row = sheet.getRow(rowNo++);
          row.values = [
            l.po_no || "",
            l.style_no || "",
            l.description || "",
            ...(showMatHs ? [l.material_content || "", l.hs_code || ""] : []),
            n(l.qty),
            n(l.unit_price),
            n(l.amount),
          ];
          row.eachCell((cell, colNumber) => {
            cell.border = { top: lightBorder, left: lightBorder, bottom: lightBorder, right: lightBorder };
            cell.alignment = { vertical: "middle", wrapText: true };
            if (colNumber >= tableHeader.length - 2) {
              cell.alignment = { horizontal: "right", vertical: "middle", wrapText: true };
            }
          });
          row.getCell(tableHeader.length - 2).numFmt = "#,##0";
          row.getCell(tableHeader.length - 1).numFmt = "#,##0.00";
          row.getCell(tableHeader.length).numFmt = "#,##0.00";
        }
      }

      const total =
        header.total_amount != null && Number(header.total_amount) > 0
          ? Number(header.total_amount)
          : Number(recomputeTotal || lines.reduce((sum, l) => sum + n(l.amount), 0));
      const totalRowNo = rowNo + 1;
      sheet.mergeCells(totalRowNo, 1, totalRowNo, tableHeader.length - 1);
      sheet.getCell(totalRowNo, 1).value = "Grand Total";
      sheet.getCell(totalRowNo, 1).font = { bold: true };
      sheet.getCell(totalRowNo, 1).alignment = { horizontal: "right" };
      sheet.getCell(totalRowNo, tableHeader.length).value = total;
      sheet.getCell(totalRowNo, tableHeader.length).font = { bold: true };
      sheet.getCell(totalRowNo, tableHeader.length).numFmt = `"${currency} "#,##0.00`;

      const signRowNo = totalRowNo + 4;
      sheet.mergeCells(signRowNo, 6, signRowNo, 8);
      sheet.getCell(signRowNo, 6).value = "Signed by";
      sheet.getCell(signRowNo, 6).alignment = { horizontal: "center" };

      const stamp = getCompanyStampByOrigin(header.shipping_origin_code);
      try {
        const stampRes = await fetch(stamp.publicPath);
        const stampBuffer = await stampRes.arrayBuffer();
        const imageId = workbook.addImage({
          buffer: stampBuffer as any,
          extension: stamp.format === "JPEG" ? "jpeg" : "png",
        });
        sheet.addImage(imageId, {
          tl: { col: 5.65, row: signRowNo },
          ext: { width: stamp.boxW * 3.5, height: stamp.boxH * 3.5 },
        });
      } catch (e) {
        console.warn("Failed to add invoice stamp to Excel:", e);
      }

      sheet.mergeCells(signRowNo + 8, 6, signRowNo + 8, 8);
      sheet.getCell(signRowNo + 8, 6).value = stamp.companyName;
      sheet.getCell(signRowNo + 8, 6).alignment = { horizontal: "center" };

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${invoiceNo}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert("Failed to export Excel.");
    } finally {
      setExporting(false);
    }
  }, [header, lines, recomputeTotal]);

  React.useEffect(() => {
    if (!autoPdfRequested) return;
    if (autoPdfRanRef.current) return;
    if (loading) return;
    if (!header) return;
    if (!lines || lines.length === 0) return;
    if (exporting) return;

    autoPdfRanRef.current = true;

    const run = async () => {
      await new Promise((r) => setTimeout(r, 150));
      await handlePdf();

      if (invoiceId) {
        router.replace(`/invoices/${encodeURIComponent(invoiceId)}`);
      }
    };

    run();
  }, [autoPdfRequested, loading, header, lines, exporting, invoiceId, router, handlePdf]);

  React.useEffect(() => {
    if (!autoExcelRequested) return;
    if (autoExcelRanRef.current) return;
    if (loading) return;
    if (!header) return;
    if (!lines || lines.length === 0) return;
    if (exporting) return;

    autoExcelRanRef.current = true;

    const run = async () => {
      await new Promise((r) => setTimeout(r, 150));
      await handleExcel();

      if (invoiceId) {
        router.replace(`/invoices/${encodeURIComponent(invoiceId)}`);
      }
    };

    run();
  }, [autoExcelRequested, loading, header, lines, exporting, invoiceId, router, handleExcel]);

  if (loading) {
    return (
      <AppShell role={role}>
        <div className="text-sm text-muted-foreground">Loading...</div>
      </AppShell>
    );
  }

  if (errorMsg || !header) {
    return (
      <AppShell role={role}>
        <div className="text-sm text-red-600">{errorMsg || "Failed to load invoice."}</div>
        <div className="mt-4">
          <Button variant="outline" onClick={() => router.push("/invoices")}>
            Back
          </Button>
        </div>
      </AppShell>
    );
  }

  const showMatHsUI = shouldShowMaterialHS(header, lines);
  const groupsUI = groupInvoiceLines(lines);

  return (
    <AppShell role={role}>
      <div className="flex items-center justify-between gap-2 mb-4">
        <h1 className="text-2xl font-bold">Invoice Detail</h1>
        <div className="flex items-center gap-2">
          {invoiceDateDirty ? (
            <span className="text-xs font-medium text-amber-600">Invoice Date changed</span>
          ) : null}
          {saveError ? (
            <span className="text-xs font-medium text-red-600">{saveError}</span>
          ) : savedAt ? (
            <span className="text-xs font-medium text-emerald-600">Saved {savedAt}</span>
          ) : null}
          <Button variant="outline" onClick={() => router.push("/invoices")}>
            Back
          </Button>
          <Button
            variant="outline"
            onClick={() => void loadInvoice({ silent: true })}
            disabled={loading || saving || refreshing}
          >
            {refreshing ? "Refreshing..." : "Refresh"}
          </Button>
          <Button onClick={handlePdf} disabled={exporting || saving}>
            {exporting ? "PDF..." : "PDF / Print"}
          </Button>
          <Button variant="outline" onClick={handleExcel} disabled={exporting || saving}>
            {exporting ? "Excel..." : "Excel"}
          </Button>
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Header</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="grid gap-2">
                <Label>Invoice No</Label>
                <Input
                  value={header.invoice_no ?? ""}
                  onChange={(e) => setHeaderField("invoice_no", e.target.value)}
                  placeholder="Invoice No"
                />
              </div>

              <div className="grid gap-2">
                <Label>Invoice Date</Label>
                <Input
                  type="date"
                  value={header.invoice_date ?? ""}
                  onChange={(e) => setHeaderField("invoice_date", e.target.value)}
                />
              </div>

              <div className="grid gap-2">
                <Label>Status</Label>
                <Input
                  value={header.status ?? ""}
                  onChange={(e) => setHeaderField("status", e.target.value)}
                  placeholder="DRAFT / CONFIRMED ..."
                />
              </div>

              <div className="grid gap-2">
                <Label>Amount</Label>
                <Input
                  value={`${currency} ${fmtMoney2(header.total_amount ?? recomputeTotal)}`}
                  readOnly
                />
              </div>
            </div>

            <Separator />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="grid gap-2">
                <Label>Currency</Label>
                <Input
                  value={header.currency ?? ""}
                  onChange={(e) => setHeaderField("currency", e.target.value)}
                  placeholder="USD"
                />
              </div>

              <div className="grid gap-2">
                <Label>Incoterm</Label>
                <Input
                  value={header.incoterm ?? ""}
                  onChange={(e) => setHeaderField("incoterm", e.target.value)}
                  placeholder="FOB"
                />
              </div>

              <div className="grid gap-2">
                <Label>Payment Term</Label>
                <Input
                  value={header.payment_term ?? ""}
                  onChange={(e) => setHeaderField("payment_term", e.target.value)}
                  placeholder="DA 45DAYS"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="grid gap-2 md:col-span-3">
                <Label>Destination</Label>
                <Input
                  value={header.destination ?? ""}
                  onChange={(e) => setHeaderField("destination", e.target.value)}
                  placeholder="East Providence, U.S.A"
                />
              </div>
            </div>

            <Separator />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="grid gap-2">
                <Label>Remarks</Label>
                <Textarea
                  value={header.remarks ?? ""}
                  onChange={(e) => setHeaderField("remarks", e.target.value)}
                  placeholder="Remarks"
                  className="min-h-[90px]"
                />
              </div>

              <div className="grid gap-2">
                <Label>Consignee</Label>
                <Textarea
                  value={header.consignee_text ?? ""}
                  onChange={(e) => setHeaderField("consignee_text", e.target.value)}
                  placeholder="Consignee"
                  className="min-h-[90px]"
                />
              </div>

              <div className="grid gap-2">
                <Label>Notify Party</Label>
                <Textarea
                  value={header.notify_party_text ?? ""}
                  onChange={(e) => setHeaderField("notify_party_text", e.target.value)}
                  placeholder="Notify Party"
                  className="min-h-[90px]"
                />
              </div>
            </div>

            <Separator />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Shipper / Exporter Name</Label>
                <Input
                  value={header.shipper_name ?? ""}
                  onChange={(e) => setHeaderField("shipper_name", e.target.value)}
                  placeholder="JM International Co.,Ltd"
                />
              </div>

              <div className="grid gap-2">
                <Label>Shipper / Exporter Address</Label>
                <Input
                  value={header.shipper_address ?? ""}
                  onChange={(e) => setHeaderField("shipper_address", e.target.value)}
                  placeholder="(optional)"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Lines</CardTitle>
            <div className="text-sm text-muted-foreground">{lines.length} line(s)</div>
          </CardHeader>

          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Invoice Total</div>
                <div className="mt-1 text-lg font-semibold">{currency} {fmtMoney2(invoiceTotalForPayment)}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Gross Received</div>
                <div className="mt-1 text-lg font-semibold">{currency} {fmtMoney2(grossReceivedTotal)}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Applied</div>
                <div className="mt-1 text-lg font-semibold text-blue-600">{currency} {fmtMoney2(receivedTotal)}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Balance</div>
                <div className="mt-1 text-lg font-semibold">{currency} {fmtMoney2(balance)}</div>
              </div>
            </div>

            <div className="rounded-md border">
              <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
                <div className="font-semibold">Receipt Trace</div>
                <div className="text-xs text-muted-foreground">
                  {traceLoading ? "Loading..." : `${traceSummary?.rows?.length || 0} item(s)`}
                </div>
              </div>
              <div className="w-full overflow-auto">
                <table className="w-full text-sm">
                  <colgroup>
                    <col style={{ width: "110px" }} />
                    <col style={{ width: "140px" }} />
                    <col style={{ width: "120px" }} />
                    <col style={{ width: "120px" }} />
                    <col style={{ width: "110px" }} />
                    <col style={{ width: "110px" }} />
                    <col style={{ width: "110px" }} />
                    <col style={{ width: "120px" }} />
                    <col style={{ width: "180px" }} />
                  </colgroup>
                  <thead className="bg-muted/20">
                    <tr className="[&>th]:px-3 [&>th]:py-0 [&>th]:h-14 [&>th]:text-left [&>th]:align-middle">
                      <th className="min-w-[110px]">Date</th>
                      <th className="min-w-[130px]">Receipt</th>
                      <th className="min-w-[120px] text-right">Gross</th>
                      <th className="min-w-[120px] text-right">Applied</th>
                      <th className="min-w-[110px] text-right">Our Fee</th>
                      <th className="min-w-[110px] text-right">Buyer Fee</th>
                      <th className="min-w-[110px] text-right">Claim</th>
                      <th className="min-w-[120px]">Method</th>
                      <th className="min-w-[180px]">Reference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(traceSummary?.rows || []).length === 0 ? (
                      <tr className="border-t">
                        <td className="px-3 py-6 text-sm text-muted-foreground" colSpan={9}>
                          No receipt trace.
                        </td>
                      </tr>
                    ) : (
                      (traceSummary?.rows || []).map((r) => (
                        <tr key={`${r.receipt_id}-${r.receipt_date || ""}`} className="border-t [&>td]:px-3 [&>td]:py-0 [&>td]:h-16 [&>td]:align-middle">
                          <td className="whitespace-nowrap">{fmtDate10(r.receipt_date)}</td>
                          <td className="break-all">
                            <button
                              type="button"
                              className="text-left font-medium text-blue-600 hover:underline"
                              onClick={() => openReceiptDetail(r.receipt_id)}
                              title={r.receipt_id}
                            >
                              {displayReceiptLabel(r)}
                            </button>
                          </td>
                          <td className="text-right whitespace-nowrap">{fmtMoney2(r.gross_amount)}</td>
                          <td className="text-right font-semibold text-blue-600 whitespace-nowrap">{fmtMoney2(r.applied_amount)}</td>
                          <td className="text-right whitespace-nowrap">{fmtMoney2(r.our_fee_amount)}</td>
                          <td className="text-right whitespace-nowrap">{fmtMoney2(r.buyer_fee_amount)}</td>
                          <td className="text-right whitespace-nowrap">{fmtMoney2(r.claim_amount)}</td>
                          <td className="whitespace-nowrap">{r.method || ""}</td>
                          <td>{r.reference_no || ""}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="w-full overflow-auto rounded-md border">
              <table className="w-full text-sm">
                <colgroup>
                  <col style={{ width: "150px" }} />
                  <col style={{ width: "120px" }} />
                  <col style={{ width: "240px" }} />
                  {showMatHsUI ? (
                    <>
                      <col style={{ width: "220px" }} />
                      <col style={{ width: "140px" }} />
                    </>
                  ) : null}
                  <col style={{ width: "100px" }} />
                  <col style={{ width: "110px" }} />
                  <col style={{ width: "120px" }} />
                </colgroup>
                <thead className="bg-muted/40">
                  <tr className="[&>th]:px-3 [&>th]:py-0 [&>th]:h-14 [&>th]:text-left [&>th]:align-middle">
                    <th className="min-w-[150px]">PO No</th>
                    <th className="min-w-[120px]">Style No</th>
                    <th className="min-w-[240px]">Description</th>

                    {showMatHsUI ? (
                      <>
                        <th className="min-w-[220px]">Material</th>
                        <th className="min-w-[140px]">HS Code</th>
                      </>
                    ) : null}

                    <th className="min-w-[100px] text-right">Qty</th>
                    <th className="min-w-[110px] text-right">Unit Price</th>
                    <th className="min-w-[120px] text-right">Amount</th>
                  </tr>
                </thead>

                <tbody>
                  {lines.length === 0 ? (
                    <tr className="border-t">
                      <td
                        className="px-3 py-6 text-sm text-muted-foreground"
                        colSpan={showMatHsUI ? 8 : 6}
                      >
                        No lines.
                      </td>
                    </tr>
                  ) : (
                    groupsUI.map((g) => (
                      <React.Fragment key={g.poNo}>
                        <tr className="border-t bg-muted/20">
                          <td className="px-3 py-2 font-semibold" colSpan={showMatHsUI ? 8 : 6}>
                            <div className="flex items-center justify-between gap-3">
                              <div>PO# {g.poNo}</div>
                              <div className="text-right">
                                PO Subtotal: {currency} {fmtMoney2(g.poSubtotal)}
                              </div>
                            </div>
                          </td>
                        </tr>

                        {g.lines.map((l) => {
                          const idx = lines.findIndex((x) => x.id === l.id);

                          return (
                            <tr key={l.id} className="border-t [&>td]:px-3 [&>td]:py-0 [&>td]:h-16 [&>td]:align-middle">
                              <td>{l.po_no ?? ""}</td>
                              <td>{l.style_no ?? ""}</td>
                              <td>
                                <Input
                                  value={l.description ?? ""}
                                  onChange={(e) => setLineField(idx, "description", e.target.value)}
                                  placeholder="Description"
                                />
                              </td>

                              {showMatHsUI ? (
                                <>
                                  <td>
                                    <Input
                                      value={l.material_content ?? ""}
                                      onChange={(e) =>
                                        setLineField(idx, "material_content", e.target.value)
                                      }
                                      placeholder="(optional)"
                                    />
                                  </td>
                                  <td>
                                    <Input
                                      value={l.hs_code ?? ""}
                                      onChange={(e) => setLineField(idx, "hs_code", e.target.value)}
                                      placeholder="(optional)"
                                    />
                                  </td>
                                </>
                              ) : null}

                              <td className="text-right">
                                <Input
                                  value={l.qty == null ? "" : String(l.qty)}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setLineField(
                                      idx,
                                      "qty",
                                      v === "" ? (null as any) : (Number(v) as any)
                                    );
                                  }}
                                  inputMode="decimal"
                                  className="text-right"
                                  placeholder="0"
                                />
                              </td>

                              <td className="text-right">
                                <Input
                                  value={l.unit_price == null ? "" : String(l.unit_price)}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setLineField(
                                      idx,
                                      "unit_price",
                                      v === "" ? (null as any) : (Number(v) as any)
                                    );
                                  }}
                                  inputMode="decimal"
                                  className="text-right"
                                  placeholder="0.00"
                                />
                              </td>

                              <td className="text-right">
                                {fmtMoney2(
                                  l.amount ?? (Number(l.qty || 0) * Number(l.unit_price || 0))
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end mt-3">
              <div className="min-w-[260px] rounded-md border px-4 py-3 flex items-center justify-between">
                <div className="font-semibold">Grand Total</div>
                <div className="font-semibold">
                  {currency} {fmtMoney2(recomputeTotal)}
                </div>
              </div>
            </div>

            <div className="mt-2 text-xs text-muted-foreground">
              * Material / HS Code는 LDC면 항상 표시되고, 다른 바이어는 값이 하나라도 있으면 자동 표시됩니다.
              (빈 값이어도 저장 가능)
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Receipts</CardTitle>
            <div className="flex items-center gap-2">
              <div className="text-sm text-muted-foreground">
                Gross: {currency} {fmtMoney2(grossReceivedTotal)}
              </div>
              <div className="text-sm text-muted-foreground">
                Applied: {currency} {fmtMoney2(receivedTotal)}
              </div>
              <div className="text-sm text-muted-foreground">
                Balance: {currency} {fmtMoney2(balance)}
              </div>
              <div
                className={[
                  "text-xs font-semibold px-2 py-1 rounded",
                  paymentStatus === "PAID"
                    ? "bg-emerald-100 text-emerald-700"
                    : paymentStatus === "PARTIALLY_PAID"
                    ? "bg-amber-100 text-amber-700"
                    : paymentStatus === "OVERPAID"
                    ? "bg-red-100 text-red-700"
                    : "bg-muted text-foreground",
                ].join(" ")}
                title={paymentStatus}
              >
                {paymentStatus.replace("_", " ")}
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  loadReceipts();
                  loadReceiptTrace();
                }}
                disabled={receiptsLoading || traceLoading}
              >
                {receiptsLoading || traceLoading ? "Loading..." : "Refresh"}
              </Button>
            </div>
          </CardHeader>

          <CardContent className="grid gap-4">
            <div className="rounded-md border p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="font-semibold">Add Receipt</div>
                <Button
                  onClick={handleCreateReceipt}
                  disabled={creatingReceipt || !invoiceId}
                >
                  {creatingReceipt ? "Saving..." : "Add"}
                </Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mt-3">
                <div className="grid gap-2">
                  <Label>Date</Label>
                  <Input
                    type="date"
                    value={newReceipt.receipt_date}
                    onChange={(e) =>
                      setNewReceipt((p) => ({ ...p, receipt_date: e.target.value }))
                    }
                  />
                </div>

                <div className="grid gap-2">
                  <Label>Amount</Label>
                  <Input
                    inputMode="decimal"
                    value={newReceipt.received_amount}
                    onChange={(e) =>
                      setNewReceipt((p) => ({ ...p, received_amount: e.target.value }))
                    }
                    placeholder="0.00"
                  />
                </div>

                <div className="grid gap-2">
                  <Label>Method</Label>
                  <Input
                    value={newReceipt.payment_method}
                    onChange={(e) =>
                      setNewReceipt((p) => ({ ...p, payment_method: e.target.value }))
                    }
                    placeholder="WIRE / CHECK / CASH / OTHER"
                  />
                </div>

                <div className="grid gap-2">
                  <Label>Reference No</Label>
                  <Input
                    value={newReceipt.reference_no}
                    onChange={(e) =>
                      setNewReceipt((p) => ({ ...p, reference_no: e.target.value }))
                    }
                    placeholder="Bank ref / transaction id"
                  />
                </div>

                <div className="grid gap-2 md:col-span-1">
                  <Label>Note</Label>
                  <Input
                    value={newReceipt.note}
                    onChange={(e) =>
                      setNewReceipt((p) => ({ ...p, note: e.target.value }))
                    }
                    placeholder="(optional)"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Invoice Total</div>
                <div className="mt-1 text-lg font-semibold">{currency} {fmtMoney2(invoiceTotalForPayment)}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Gross Received</div>
                <div className="mt-1 text-lg font-semibold">{currency} {fmtMoney2(grossReceivedTotal)}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Applied</div>
                <div className="mt-1 text-lg font-semibold text-blue-600">{currency} {fmtMoney2(receivedTotal)}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Balance</div>
                <div className="mt-1 text-lg font-semibold">{currency} {fmtMoney2(balance)}</div>
              </div>
            </div>

            <div className="rounded-md border">
              <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
                <div className="font-semibold">Receipt Trace</div>
                <div className="text-xs text-muted-foreground">
                  {traceLoading ? "Loading..." : `${traceSummary?.rows?.length || 0} item(s)`}
                </div>
              </div>
              <div className="w-full overflow-auto">
                <table className="w-full text-sm">
                  <colgroup>
                    <col style={{ width: "110px" }} />
                    <col style={{ width: "140px" }} />
                    <col style={{ width: "120px" }} />
                    <col style={{ width: "120px" }} />
                    <col style={{ width: "110px" }} />
                    <col style={{ width: "110px" }} />
                    <col style={{ width: "110px" }} />
                    <col style={{ width: "120px" }} />
                    <col style={{ width: "180px" }} />
                  </colgroup>
                  <thead className="bg-muted/20">
                    <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left">
                      <th className="min-w-[110px]">Date</th>
                      <th className="min-w-[130px]">Receipt</th>
                      <th className="min-w-[120px] text-right">Gross</th>
                      <th className="min-w-[120px] text-right">Applied</th>
                      <th className="min-w-[110px] text-right">Our Fee</th>
                      <th className="min-w-[110px] text-right">Buyer Fee</th>
                      <th className="min-w-[110px] text-right">Claim</th>
                      <th className="min-w-[120px]">Method</th>
                      <th className="min-w-[180px]">Reference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(traceSummary?.rows || []).length === 0 ? (
                      <tr className="border-t">
                        <td className="px-3 py-6 text-sm text-muted-foreground" colSpan={10}>
                          No receipt trace.
                        </td>
                      </tr>
                    ) : (
                      (traceSummary?.rows || []).map((r) => (
                        <tr key={`${r.receipt_id}-${r.receipt_date || ""}`} className="border-t [&>td]:px-3 [&>td]:py-0 [&>td]:h-16 [&>td]:align-middle">
                          <td>{fmtDate10(r.receipt_date)}</td>
                          <td>{displayReceiptLabel(r)}</td>
                          <td className="text-right">{fmtMoney2(r.gross_amount)}</td>
                          <td className="text-right font-semibold text-blue-600">{fmtMoney2(r.applied_amount)}</td>
                          <td className="text-right">{fmtMoney2(r.our_fee_amount)}</td>
                          <td className="text-right">{fmtMoney2(r.buyer_fee_amount)}</td>
                          <td className="text-right">{fmtMoney2(r.claim_amount)}</td>
                          <td>{r.method || ""}</td>
                          <td>{r.reference_no || ""}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="w-full overflow-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left">
                    <th className="min-w-[120px]">Date</th>
                    <th className="min-w-[140px] text-right">Amount</th>
                    <th className="min-w-[130px]">Method</th>
                    <th className="min-w-[200px]">Reference</th>
                    <th className="min-w-[260px]">Note</th>
                    <th className="min-w-[140px] text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {receipts.length === 0 ? (
                    <tr className="border-t">
                      <td className="px-3 py-6 text-sm text-muted-foreground" colSpan={6}>
                        No receipts.
                      </td>
                    </tr>
                  ) : (
                    receipts.map((r) => {
                      const isEditing = editingReceiptId === r.id;
                      return (
                        <tr key={r.id} className="border-t [&>td]:px-3 [&>td]:py-0 [&>td]:h-16 [&>td]:align-middle">
                          <td>
                            {isEditing ? (
                              <Input
                                type="date"
                                value={editReceipt.receipt_date}
                                onChange={(e) =>
                                  setEditReceipt((p) => ({
                                    ...p,
                                    receipt_date: e.target.value,
                                  }))
                                }
                              />
                            ) : (
                              fmtDate10(r.receipt_date)
                            )}
                          </td>

                          <td className="text-right">
                            {isEditing ? (
                              <Input
                                inputMode="decimal"
                                className="text-right"
                                value={editReceipt.received_amount}
                                onChange={(e) =>
                                  setEditReceipt((p) => ({
                                    ...p,
                                    received_amount: e.target.value,
                                  }))
                                }
                              />
                            ) : (
                              fmtMoney2(r.received_amount)
                            )}
                          </td>

                          <td>
                            {isEditing ? (
                              <Input
                                value={editReceipt.payment_method}
                                onChange={(e) =>
                                  setEditReceipt((p) => ({
                                    ...p,
                                    payment_method: e.target.value,
                                  }))
                                }
                              />
                            ) : (
                              r.payment_method || ""
                            )}
                          </td>

                          <td>
                            {isEditing ? (
                              <Input
                                value={editReceipt.reference_no}
                                onChange={(e) =>
                                  setEditReceipt((p) => ({
                                    ...p,
                                    reference_no: e.target.value,
                                  }))
                                }
                              />
                            ) : (
                              r.reference_no || ""
                            )}
                          </td>

                          <td>
                            {isEditing ? (
                              <Input
                                value={editReceipt.note}
                                onChange={(e) =>
                                  setEditReceipt((p) => ({ ...p, note: e.target.value }))
                                }
                              />
                            ) : (
                              r.note || ""
                            )}
                          </td>


                          <td className="text-right">
                            {isEditing ? (
                              <div className="flex justify-end gap-2">
                                <Button
                                  variant="outline"
                                  onClick={cancelEditReceipt}
                                  disabled={savingReceipt}
                                >
                                  Cancel
                                </Button>
                                <Button onClick={() => handleUpdateReceipt(r.id)} disabled={savingReceipt}>
                                  {savingReceipt ? "Saving..." : "Save"}
                                </Button>
                              </div>
                            ) : (
                              <div className="flex justify-end gap-2">
                                <Button
                                  variant="outline"
                                  onClick={() => startEditReceipt(r)}
                                >
                                  Edit
                                </Button>
                                <Button
                                  variant="destructive"
                                  onClick={() => handleDeleteReceipt(r.id)}
                                >
                                  Delete
                                </Button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="text-xs text-muted-foreground">
              * Receipt는 Invoice에만 연결됩니다. Method 추천: WIRE / CHECK / CASH / OTHER (직접 입력)
            </div>
          </CardContent>
        </Card>
      </div>

      {selectedReceipt ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-4xl rounded-2xl bg-background shadow-2xl border">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <div>
                <div className="text-lg font-semibold">Receipt Detail</div>
                {receiptDetailLoading ? <div className="text-xs text-muted-foreground">Loading...</div> : null}
                <div className="text-sm text-muted-foreground">
                  {displayReceiptLabel({ receipt_no: selectedReceipt.receipt_no, reference_no: selectedReceipt.reference_no, receipt_id: selectedReceipt.id })}
                </div>
              </div>
              <Button variant="outline" onClick={closeReceiptDetail}>Close</Button>
            </div>

            <div className="grid gap-4 p-5">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <InfoBox label="Deposit Date" value={fmtDate10(selectedReceipt.deposit_date || selectedReceipt.receipt_date)} />
                <InfoBox label="Gross Received" value={fmtMoney2(selectedReceipt.total_received ?? selectedReceipt.received_amount)} />
                <InfoBox label="Net Received" value={fmtMoney2(selectedReceipt.net_received_amount)} />
                <InfoBox label="Method" value={selectedReceipt.method || selectedReceipt.payment_method || "—"} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <InfoBox label="Our Fee" value={fmtMoney2(selectedReceipt.bank_fee_amount)} />
                <InfoBox label="Buyer Fee" value={fmtMoney2(selectedReceipt.buyer_bank_fee_amount)} />
                <InfoBox label="Claim" value={fmtMoney2(selectedReceipt.claim_deduction_amount)} />
                <InfoBox label="Writeoff" value={fmtMoney2(selectedReceipt.buyer_wire_fee_writeoff_amount)} />
              </div>

              <div className="rounded-md border">
                <div className="border-b px-4 py-3 font-semibold">Applied Invoices</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/30">
                      <tr className="border-b">
                        <th className="p-2 text-left">Invoice</th>
                        <th className="p-2 text-left">Invoice Date</th>
                        <th className="p-2 text-right">Invoice Total</th>
                        <th className="p-2 text-right">Applied</th>
                        <th className="p-2 text-right">Writeoff</th>
                        <th className="p-2 text-right">Our Fee</th>
                        <th className="p-2 text-right">Buyer Fee</th>
                        <th className="p-2 text-right">Claim</th>
                        <th className="p-2 text-right">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(selectedReceipt.details || []).length === 0 ? (
                        <tr>
                          <td className="p-4 text-muted-foreground" colSpan={9}>No applied invoices.</td>
                        </tr>
                      ) : (
                        (selectedReceipt.details || []).map((d: any, idx: number) => (
                          <tr key={`${d.invoice_id || d.invoice_no || "row"}-${idx}`} className="border-t">
                            <td className="p-2">
                              <button
                                type="button"
                                className="font-medium text-blue-600 hover:underline"
                                onClick={() => router.push(`/invoices/${encodeURIComponent(d.invoice_no || d.invoice_id)}`)}
                              >
                                {d.invoice_no || d.invoice_id || "—"}
                              </button>
                            </td>
                            <td className="p-2">{fmtDate10(d.invoice_date)}</td>
                            <td className="p-2 text-right">{fmtMoney2(d.invoice_total)}</td>
                            <td className="p-2 text-right">{fmtMoney2(d.applied_amount)}</td>
                            <td className="p-2 text-right">{fmtMoney2(d.writeoff_amount)}</td>
                            <td className="p-2 text-right">{fmtMoney2(d.allocated_our_fee)}</td>
                            <td className="p-2 text-right">{fmtMoney2(d.allocated_buyer_fee)}</td>
                            <td className="p-2 text-right">{fmtMoney2(d.allocated_claim_deduction)}</td>
                            <td className="p-2 text-right">{fmtMoney2(d.invoice_balance)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {selectedReceipt.note ? (
                <div className="rounded-md border p-4">
                  <div className="mb-1 font-semibold">Note</div>
                  <div className="text-sm text-muted-foreground whitespace-pre-wrap">{selectedReceipt.note}</div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}


      {selectedReceipt ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-4xl rounded-2xl bg-background shadow-2xl border">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <div>
                <div className="text-lg font-semibold">Receipt Detail</div>
                {receiptDetailLoading ? <div className="text-xs text-muted-foreground">Loading...</div> : null}
                <div className="text-sm text-muted-foreground">
                  {displayReceiptLabel({ receipt_no: selectedReceipt.receipt_no, reference_no: selectedReceipt.reference_no, receipt_id: selectedReceipt.id })}
                </div>
              </div>
              <Button variant="outline" onClick={closeReceiptDetail}>Close</Button>
            </div>

            <div className="grid gap-4 p-5">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <InfoBox label="Deposit Date" value={fmtDate10(selectedReceipt.deposit_date || selectedReceipt.receipt_date)} />
                <InfoBox label="Gross Received" value={fmtMoney2(selectedReceipt.total_received ?? selectedReceipt.received_amount)} />
                <InfoBox label="Net Received" value={fmtMoney2(selectedReceipt.net_received_amount)} />
                <InfoBox label="Method" value={selectedReceipt.method || selectedReceipt.payment_method || "—"} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <InfoBox label="Our Fee" value={fmtMoney2(selectedReceipt.bank_fee_amount)} />
                <InfoBox label="Buyer Fee" value={fmtMoney2(selectedReceipt.buyer_bank_fee_amount)} />
                <InfoBox label="Claim" value={fmtMoney2(selectedReceipt.claim_deduction_amount)} />
                <InfoBox label="Writeoff" value={fmtMoney2(selectedReceipt.buyer_wire_fee_writeoff_amount)} />
              </div>

              <div className="rounded-md border">
                <div className="border-b px-4 py-3 font-semibold">Applied Invoices</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/30">
                      <tr className="border-b">
                        <th className="p-2 text-left">Invoice</th>
                        <th className="p-2 text-left">Invoice Date</th>
                        <th className="p-2 text-right">Invoice Total</th>
                        <th className="p-2 text-right">Applied</th>
                        <th className="p-2 text-right">Writeoff</th>
                        <th className="p-2 text-right">Our Fee</th>
                        <th className="p-2 text-right">Buyer Fee</th>
                        <th className="p-2 text-right">Claim</th>
                        <th className="p-2 text-right">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(selectedReceipt.details || []).length === 0 ? (
                        <tr>
                          <td className="p-4 text-muted-foreground" colSpan={9}>No applied invoices.</td>
                        </tr>
                      ) : (
                        (selectedReceipt.details || []).map((d: any, idx: number) => (
                          <tr key={`${d.invoice_id || d.invoice_no || "row"}-${idx}`} className="border-t">
                            <td className="p-2">
                              <button
                                type="button"
                                className="font-medium text-blue-600 hover:underline"
                                onClick={() => router.push(`/invoices/${encodeURIComponent(d.invoice_id || d.invoice_no)}`)}
                              >
                                {d.invoice_no || d.invoice_id || "—"}
                              </button>
                            </td>
                            <td className="p-2">{fmtDate10(d.invoice_date)}</td>
                            <td className="p-2 text-right">{fmtMoney2(d.invoice_total)}</td>
                            <td className="p-2 text-right">{fmtMoney2(d.applied_amount)}</td>
                            <td className="p-2 text-right">{fmtMoney2(d.writeoff_amount)}</td>
                            <td className="p-2 text-right">{fmtMoney2(d.allocated_our_fee)}</td>
                            <td className="p-2 text-right">{fmtMoney2(d.allocated_buyer_fee)}</td>
                            <td className="p-2 text-right">{fmtMoney2(d.allocated_claim_deduction)}</td>
                            <td className="p-2 text-right">{fmtMoney2(d.invoice_balance)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {selectedReceipt.note ? (
                <div className="rounded-md border p-4">
                  <div className="mb-1 font-semibold">Note</div>
                  <div className="text-sm text-muted-foreground whitespace-pre-wrap">{selectedReceipt.note}</div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

    </AppShell>
  );
}
