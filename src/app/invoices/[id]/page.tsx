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

import jsPDF from "jspdf";
// @ts-ignore
import autoTable from "jspdf-autotable";

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

  // (테이블에는 있지만, Invoice 화면/표에는 지금 안 쓰는 것들)
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

function todayISODate() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
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

/**
 * ✅ Material/HS 표시 규칙
 * - LDC면 무조건 ON
 * - 다른 바이어는 lines에서 material_content 또는 hs_code가 하나라도 있으면 ON
 * - 전부 비어있으면 컬럼 자체 OFF
 */
function shouldShowMaterialHS(header: InvoiceHeader, lines: InvoiceLine[]) {
  if (upperIncludesLDC(header)) return true;
  return (lines || []).some(
    (l) =>
      (l.material_content && l.material_content.trim() !== "") ||
      (l.hs_code && l.hs_code.trim() !== "")
  );
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

/**
 * ✅ PO별 블록 + 정렬 규칙 (UI/PDF 공통)
 * - 그룹: po_no
 * - 정렬: PO(자연정렬) → Style(문자) → line_no(숫자) → id(문자)
 * - is_deleted 라인은 제외
 * - ✅ group에 poSubtotal / poQty 계산 포함
 */
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

  const [header, setHeader] = React.useState<InvoiceHeader | null>(null);
  const [lines, setLines] = React.useState<InvoiceLine[]>([]);

  // ===== Receipts (Invoice-linked)
  const [receiptsLoading, setReceiptsLoading] = React.useState(false);
  const [receipts, setReceipts] = React.useState<ReceiptRow[]>([]);

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

  const recomputeTotal = React.useMemo(() => {
    const sum = (lines || []).reduce((acc, l) => acc + Number(l.amount || 0), 0);
    return sum;
  }, [lines]);


  const receivedTotal = React.useMemo(() => {
    return (receipts || []).reduce((sum, r) => sum + parseAmount(r.received_amount), 0);
  }, [receipts]);

  const invoiceTotalForPayment = React.useMemo(() => {
    const t =
      header?.total_amount != null && Number(header.total_amount) > 0
        ? Number(header.total_amount)
        : Number(recomputeTotal || 0);
    return Number.isFinite(t) ? t : 0;
  }, [header?.total_amount, recomputeTotal]);

  const balance = React.useMemo(() => {
    return invoiceTotalForPayment - receivedTotal;
  }, [invoiceTotalForPayment, receivedTotal]);

  const paymentStatus = React.useMemo(() => {
    const inv = Number(invoiceTotalForPayment || 0);
    const rec = Number(receivedTotal || 0);
    const tol = 0.005;

    if (rec <= tol) return "UNPAID";
    if (rec < inv - tol) return "PARTIALLY_PAID";
    if (Math.abs(rec - inv) <= tol) return "PAID";
    return "OVERPAID";
  }, [invoiceTotalForPayment, receivedTotal]);

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
    // balance가 바뀌면 amount 기본값을 맞춰줌(사용자 입력 있으면 유지하려면 여기서 더 복잡하게 하면 됨)
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
            payment_method: (newReceipt.payment_method || "WIRE").trim(),
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

      await loadReceipts();
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
        await loadReceipts();
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
        await loadReceipts();
      } catch (e) {
        console.error(e);
        alert("Delete failed.");
      }
    },
    [loadReceipts]
  );

  // ✅ autoPdf=1 처리 (PDF 버튼 의미 분리)
  // IMPORTANT FIX:
  // - router.replace()를 PDF 실행 "이후"에 호출해야 함.
  // - replace를 먼저 호출하면, App Router가 navigation/re-render를 하면서
  //   setTimeout이 취소되거나 effect가 꼬여 자동 실행이 안 될 수 있음.
  const autoPdfRequested = (searchParams?.get("autoPdf") || "") === "1";
  const autoPdfRanRef = React.useRef(false);

  React.useEffect(() => {
    setRole("admin");
  }, []);

  const loadInvoice = React.useCallback(async () => {
    if (!invoiceId) return;
    setLoading(true);
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
        return;
      }

      const h: InvoiceHeader | null =
        json?.header ?? json?.data?.header ?? json?.invoice?.header ?? null;

      const rawLines: InvoiceLine[] =
        json?.lines ?? json?.data?.lines ?? json?.invoice?.lines ?? [];

      if (!h) {
        setErrorMsg("Failed to load invoice.");
        setHeader(null);
        setLines([]);
        return;
      }

      const patchedHeader: InvoiceHeader = {
        ...h,
        invoice_date: h.invoice_date ? fmtDate10(h.invoice_date) : todayISODate(),
      };

      setHeader(patchedHeader);

      const filteredLines = (rawLines || []).filter((l) => !l?.is_deleted);
      setLines(filteredLines);
    } catch (e: any) {
      console.error(e);
      setErrorMsg("Failed to load invoice.");
      setHeader(null);
      setLines([]);
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  React.useEffect(() => {
    loadInvoice();
  }, [loadInvoice]);

  const currency = header?.currency || "USD";

  const setHeaderField = <K extends keyof InvoiceHeader>(
    key: K,
    value: InvoiceHeader[K]
  ) => {
    setHeader((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const setLineField = <K extends keyof InvoiceLine>(
    idx: number,
    key: K,
    value: InvoiceLine[K]
  ) => {
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

    setSaving(true);
    try {
      const safeDate =
        header.invoice_date && String(header.invoice_date).trim() !== ""
          ? String(header.invoice_date).slice(0, 10)
          : null;

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

          etd: header.etd ?? null,
          eta: header.eta ?? null,

          status: header.status ?? null,

          total_amount:
            header.total_amount != null
              ? Number(header.total_amount)
              : Number(recomputeTotal),
        },
        lines: (lines || []).map((l) => ({
          id: l.id,

          po_no: l.po_no ?? null,
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
        body: JSON.stringify(payload),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const msg =
          json?.error || json?.message || `Save failed (status ${res.status})`;
        alert(msg);
        return;
      }

      await loadInvoice();
    } catch (e: any) {
      console.error(e);
      alert("Save failed.");
    } finally {
      setSaving(false);
    }
  }, [invoiceId, header, lines, recomputeTotal, loadInvoice]);

  // ====== PDF (jsPDF 유지)
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

      // Title
      doc.setFontSize(20);
      doc.setFont("helvetica", "bold");
      doc.text("COMMERCIAL INVOICE", pageWidth / 2, y, { align: "center" });
      y += 12;

      // Buyer
      doc.setFontSize(13);
      doc.setFont("helvetica", "normal");
      doc.text(`Buyer: ${header.buyer_name || "-"}`, margin, y);
      y += 8;

      // ===== Top: Shipper/Exporter (left) + Invoice Info (right)
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");

      const shipperName = (header.shipper_name || "JM International Co.,Ltd").trim();
      const shipperAddress = (header.shipper_address || "").trim();

      const invoiceNo = header.invoice_no || "-";
      const invoiceDate = fmtDate10(header.invoice_date) || "-";
      const cur = header.currency || "USD";
      const incoterm = header.incoterm || "-";
      const payTerm = header.payment_term || "-";

      // Remarks (최대 2줄)
      const remarksText = (header.remarks || "").trim();
      const remarksLinesRaw = remarksText
        ? doc.splitTextToSize(`Remarks: ${remarksText}`, half - 4)
        : [];
      const remarksLines = remarksLinesRaw.slice(0, 2);

      // ✅ Remarks 줄수에 따라 박스 높이 증가 (겹침 방지)
      const topBoxH = 32 + remarksLines.length * 4.5;

      // left box
      doc.rect(margin, y, half, topBoxH);
      doc.setFont("helvetica", "bold");
      doc.text("Shipper / Exporter", margin + 2, y + 6);
      doc.setFont("helvetica", "normal");
      const shipperLines = doc.splitTextToSize(
        shipperAddress ? `${shipperName}\n${shipperAddress}` : `${shipperName}`,
        half - 4
      );
      doc.text(shipperLines, margin + 2, y + 12);

      // right box
      doc.rect(margin + half, y, half, topBoxH);
      doc.setFont("helvetica", "bold");
      doc.text("Invoice Info", margin + half + 2, y + 6);
      doc.setFont("helvetica", "normal");

      let infoY = y + 12;
      const infoBase = [
        `Invoice No: ${invoiceNo}`,
        `Date: ${invoiceDate}`,
        `Currency: ${cur}`,
        `Incoterm: ${incoterm}`,
        `Payment Term: ${payTerm}`,
      ];

      for (const line of infoBase) {
        doc.text(line, margin + half + 2, infoY);
        infoY += 4.2;
      }

      if (remarksLines.length > 0) {
        infoY += 1.5;
        doc.text(remarksLines, margin + half + 2, infoY);
      }

      y += topBoxH;

      // ===== Consignee / Notify Party
      const consignee = (header.consignee_text || "").trim() || "-";
      const notify = (header.notify_party_text || "").trim() || "-";

      const partyH = 30;
      doc.rect(margin, y, half, partyH);
      doc.rect(margin + half, y, half, partyH);

      doc.setFont("helvetica", "bold");
      doc.text("Consignee", margin + 2, y + 6);
      doc.text("Notify Party", margin + half + 2, y + 6);

      doc.setFont("helvetica", "normal");
      doc.text(doc.splitTextToSize(consignee, half - 4), margin + 2, y + 12);
      doc.text(doc.splitTextToSize(notify, half - 4), margin + half + 2, y + 12);

      y += partyH;

      // ===== COO / Certification
      const originCode = (header.shipping_origin_code || "").toUpperCase();
      const originDisplay = originCode.includes("VN")
        ? "MADE IN VIETNAM"
        : originCode.includes("KR")
        ? "MADE IN KOREA"
        : originCode.includes("CN")
        ? "MADE IN CHINA"
        : "-";

      const cooH = 22;
      doc.rect(margin, y, contentWidth, cooH);
      doc.setFont("helvetica", "bold");
      doc.text("COO / Certification", margin + 2, y + 6);
      doc.setFont("helvetica", "normal");

      const cooText = (header.coo_text || "").trim();
      doc.text(`COO: ${cooText || originDisplay || "-"}`, margin + 2, y + 12);
      doc.text(
        "WE CERTIFY THERE IS NO WOOD PACKING MATERIAL USED IN THIS SHIPMENT.",
        margin + 2,
        y + 17
      );

      y += cooH + 8;

      // ===== Table
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
          [colCount - 3]: { halign: "right" }, // Qty
          [colCount - 2]: { halign: "right" }, // Unit
          [colCount - 1]: { halign: "right" }, // Amount
        },
      });

      const lastTableY = (doc as any).lastAutoTable?.finalY ?? y + 40;

      // ===== Grand Total
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

      // ===== Signed by + Stamp
      const stampWidth = 60;
      const stampHeight = 30;

      const sigTextTopGap = 6;
      const sigBottomGap = 8;
      const sigBlockH = sigTextTopGap + stampHeight + sigBottomGap + 10;

      let stampY = y2 + 18;
      const fitsSamePage = stampY + sigBlockH <= pageHeight - 12;

      if (!fitsSamePage) {
        doc.addPage();
        stampY = 40;
      }

      const stampX = pageWidth - margin - stampWidth;

      const stampImg = new Image();
      stampImg.src = "/images/jm_stamp_vn.jpg";

      await new Promise<void>((resolve, reject) => {
        stampImg.onload = () => resolve();
        stampImg.onerror = () => reject(new Error("Stamp image load error"));
      });

      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      doc.text("Signed by", pageWidth - margin, stampY - 4, { align: "right" });

      doc.addImage(stampImg, "JPEG", stampX, stampY, stampWidth, stampHeight);

      doc.text("JM International Co.,Ltd", pageWidth - margin, stampY + stampHeight + 6, {
        align: "right",
      });

      // ===== Page Number
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

  // ✅ autoPdf=1이면 로드 완료 후 자동 PDF 실행 (1회)
  React.useEffect(() => {
    if (!autoPdfRequested) return;
    if (autoPdfRanRef.current) return;
    if (loading) return;
    if (!header) return;
    if (!lines || lines.length === 0) return;
    if (exporting) return;

    autoPdfRanRef.current = true;

    const run = async () => {
      // 약간 딜레이(렌더 안정)
      await new Promise((r) => setTimeout(r, 150));
      await handlePdf();

      // PDF 실행 후 URL에서 autoPdf 제거 (새로고침 반복 방지)
      if (invoiceId) {
        router.replace(`/invoices/${encodeURIComponent(invoiceId)}`);
      }
    };

    run();
  }, [autoPdfRequested, loading, header, lines, exporting, invoiceId, router, handlePdf]);

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
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => router.push("/invoices")}>
            Back
          </Button>
          <Button variant="outline" onClick={loadInvoice} disabled={loading || saving}>
            Refresh
          </Button>
          <Button onClick={handlePdf} disabled={exporting}>
            {exporting ? "PDF..." : "PDF / Print"}
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4">
        {/* Header */}
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
                  value={fmtDate10(header.invoice_date) || todayISODate()}
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

        {/* Lines */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Lines</CardTitle>
            <div className="text-sm text-muted-foreground">{lines.length} line(s)</div>
          </CardHeader>

          <CardContent>
            <div className="w-full overflow-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left">
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
                            <tr key={l.id} className="border-t [&>td]:px-3 [&>td]:py-2">
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

        {/* Receipts */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Receipts</CardTitle>
            <div className="flex items-center gap-2">
              <div className="text-sm text-muted-foreground">
                Received: {currency} {fmtMoney2(receivedTotal)}
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
                onClick={loadReceipts}
                disabled={receiptsLoading}
              >
                {receiptsLoading ? "Loading..." : "Refresh"}
              </Button>
            </div>
          </CardHeader>

          <CardContent className="grid gap-4">
            {/* Add Receipt */}
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

            {/* Receipts table */}
            <div className="w-full overflow-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left">
                    <th className="min-w-[120px]">Date</th>
                    <th className="min-w-[140px] text-right">Amount</th>
                    <th className="min-w-[130px]">Method</th>
                    <th className="min-w-[200px]">Reference</th>
                    <th className="min-w-[260px]">Note</th>
                    <th className="min-w-[140px]">Created By</th>
                    <th className="min-w-[140px] text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {receipts.length === 0 ? (
                    <tr className="border-t">
                      <td className="px-3 py-6 text-sm text-muted-foreground" colSpan={7}>
                        No receipts.
                      </td>
                    </tr>
                  ) : (
                    receipts.map((r) => {
                      const isEditing = editingReceiptId === r.id;
                      return (
                        <tr key={r.id} className="border-t [&>td]:px-3 [&>td]:py-2">
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

                          <td className="text-xs text-muted-foreground">
                            {r.created_by_email || ""}
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
    </AppShell>
  );
}
