// src/app/invoices/[id]/page.tsx
"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";

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
  const params = useParams<{ id: string }>();
  const invoiceId = params?.id;

  const [role, setRole] = React.useState<DevRole>("viewer");

  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);

  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const [header, setHeader] = React.useState<InvoiceHeader | null>(null);
  const [lines, setLines] = React.useState<InvoiceLine[]>([]);

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

  const recomputeTotal = React.useMemo(() => {
    const sum = (lines || []).reduce((acc, l) => acc + Number(l.amount || 0), 0);
    return sum;
  }, [lines]);

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

  // ====== PDF (jsPDF 유지) : ✅ PO별 블록 + ✅ PO Subtotal + ✅ Grand Total + ✅ 도장 하단 고정 + ✅ Page X of Y
  const handlePdf = React.useCallback(async () => {
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

      // ===== Table (Material/HS는 규칙에 따라 컬럼 ON/OFF)
      const showMatHs = shouldShowMaterialHS(header, lines);

      const headBase = ["PO No", "Style No", "Description"];
      const headMat = showMatHs ? ["Material", "HS Code"] : [];
      const headTail = ["Qty", "Unit Price", "Amount"];
      const head = [[...headBase, ...headMat, ...headTail]];

      const colCount = head[0].length;

      // ✅ PO별 블록 body + ✅ PO Subtotal row + ✅ Grand Total
      const groups = groupInvoiceLines(lines);
      const body: any[] = [];

      let grandTotalCalc = 0;

      for (const g of groups) {
        grandTotalCalc += Number(g.poSubtotal || 0);

        // ✅ PO 헤더: PO#만 표시 (위쪽 USD subtotal 완전 제거)
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

        // ✅ PO Subtotal row (밑에 1번만) + ✅ 금액에만 USD 붙이기
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

      // ===== Grand Total (테이블 아래)
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

      // ===== Signed by + Stamp (✅ 가능하면 같은 페이지에, Grand Total 아래에 배치)
      const stampWidth = 60;
      const stampHeight = 30;

      // "Signed by" + 회사명 텍스트까지 포함한 사인 블록 높이(여유 포함)
      const sigTextTopGap = 6;
      const sigBottomGap = 8;
      const sigBlockH = sigTextTopGap + stampHeight + sigBottomGap + 10;

      // 1) 같은 페이지 우선
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
                        {/* ✅ UI는 PO Subtotal을 헤더에 보여줘도 OK */}
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
      </div>
    </AppShell>
  );
}
