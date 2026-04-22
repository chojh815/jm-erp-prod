
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import type { AppRole } from "@/config/menuConfig";
import { createSupabaseBrowserClient } from "@/lib/supabaseClient";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { getCompanyStampByOrigin } from "@/lib/companyStamp";

import jsPDF from "jspdf";
// @ts-ignore
import autoTable from "jspdf-autotable";
import ExcelJS from "exceljs";

type DevRole = AppRole;

interface ProformaListItem {
  id: string;
  invoiceNo: string;
  poNo?: string | null;
  buyerName?: string | null;
  currency?: string | null;
  createdAt?: string | null;
  subtotal: number;
}

function safeTrim(v: any) {
  return (v ?? "").toString().trim();
}

function firstNonEmpty(obj: any, keys: string[]) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== null && v !== undefined && safeTrim(v) !== "") return v;
  }
  return null;
}

function escapeIlikePattern(v: string) {
  return v.replace(/[%_]/g, (m) => `\\${m}`);
}

function resolveStampConfig(originCode: any) {
  const stamp = getCompanyStampByOrigin(safeTrim(originCode));
  return {
    src: stamp.publicPath,
    format: stamp.format,
    boxW: stamp.boxW,
    boxH: stamp.boxH,
    label: stamp.companyName,
  };
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Image load error: ${src}`));
    img.src = src;
  });
}

function drawStampContain(
  doc: jsPDF,
  img: HTMLImageElement,
  format: "PNG" | "JPEG",
  boxX: number,
  boxY: number,
  boxW: number,
  boxH: number
) {
  const naturalW = Number((img as any).naturalWidth || img.width || boxW);
  const naturalH = Number((img as any).naturalHeight || img.height || boxH);
  const scale = Math.min(boxW / naturalW, boxH / naturalH);
  const drawW = naturalW * scale;
  const drawH = naturalH * scale;
  const drawX = boxX + (boxW - drawW) / 2;
  const drawY = boxY + (boxH - drawH) / 2;
  doc.addImage(img, format, drawX, drawY, drawW, drawH);
}

export default function ProformaListPage() {
  const router = useRouter();
  const supabase = React.useMemo(() => createSupabaseBrowserClient(), []);

  const [loading, setLoading] = React.useState(true);
  const [role, setRole] = React.useState<DevRole | null>(null);

  const [keyword, setKeyword] = React.useState("");
  const [searching, setSearching] = React.useState(false);
  const [items, setItems] = React.useState<ProformaListItem[]>([]);
  const [exportingId, setExportingId] = React.useState<string | null>(null);

  React.useEffect(() => {
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.replace("/login?redirectTo=/proforma/list");
        return;
      }

      const meta = (session.user.user_metadata || {}) as any;
      const r: AppRole = meta.role || "viewer";

      setRole(r as DevRole);
      setLoading(false);

      if (r === "viewer") {
        alert("You do not have permission to view Proforma Invoices.");
        router.replace("/");
      }
    })();
  }, [router, supabase]);

  const fetchList = React.useCallback(async (kw: string) => {
    setSearching(true);
    try {
      const params = new URLSearchParams();
      if (kw.trim()) params.set("keyword", kw.trim());

      const res = await fetch(`/api/proforma/list?${params.toString()}`, { cache: "no-store" });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        console.error("Failed to load proforma list:", data);
        alert((data && (data.error || data.message)) || `Failed to load list (status ${res.status}).`);
        return;
      }

      setItems((data?.items as ProformaListItem[]) || []);
    } catch (err) {
      console.error("Unexpected error loading proforma list:", err);
      alert("Unexpected error while loading proforma list.");
    } finally {
      setSearching(false);
    }
  }, []);

  React.useEffect(() => {
    if (!loading && role && role !== "viewer") fetchList("");
  }, [loading, role, fetchList]);

  async function loadBuyerCompanyById(companyId: string) {
    const select1 = [
      "id",
      "company_name",
      "code",
      "buyer_consignee",
      "buyer_notify_party",
      "buyer_final_destination",
      "buyer_payment_term",
      "buyer_default_incoterm",
      "buyer_default_ship_mode",
      "origin_mark",
      "factory_sea_port",
      "factory_air_port",
    ].join(",");

    const r1 = await supabase.from("companies").select(select1).eq("id", companyId).maybeSingle();
    if (!r1.error) return r1.data;

    console.warn("Failed to load buyer company:", r1.error);
    return null;
  }

  async function loadBuyerCompanyByName(companyName: string) {
    const name = safeTrim(companyName);
    if (!name) return null;

    const pattern = `%${escapeIlikePattern(name)}%`;

    const select = [
      "id",
      "company_name",
      "code",
      "buyer_consignee",
      "buyer_notify_party",
      "buyer_final_destination",
      "buyer_payment_term",
      "buyer_default_incoterm",
      "buyer_default_ship_mode",
      "origin_mark",
      "factory_sea_port",
      "factory_air_port",
    ].join(",");

    const r = await supabase.from("companies").select(select).ilike("company_name", pattern).maybeSingle();
    if (!r.error) return r.data;

    console.warn("Failed to load buyer company by name:", r.error);
    return null;
  }

  const handleExportExcel = async (pi: ProformaListItem) => {
    try {
      setExportingId(pi.id);

      const params = new URLSearchParams();
      params.set("invoiceNo", pi.invoiceNo);

      const res = await fetch(`/api/proforma/detail?${params.toString()}`, { cache: "no-store" });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        console.error("Failed to load proforma detail:", data);
        alert((data && (data.error || data.message)) || `Failed to load detail (status ${res.status}).`);
        return;
      }

      const header = data?.header || {};
      const lines = (data?.lines || []) as Array<any>;

      const buyerCompanyId =
        firstNonEmpty(header, ["buyerCompanyId", "buyer_company_id", "buyerId", "buyer_id"]) || null;

      const buyerName =
        safeTrim(firstNonEmpty(header, ["buyerName", "buyer_name"])) ||
        safeTrim(pi.buyerName) ||
        "";

      let buyerCompany: any | null = null;
      if (buyerCompanyId) buyerCompany = await loadBuyerCompanyById(String(buyerCompanyId));
      if (!buyerCompany && buyerName) buyerCompany = await loadBuyerCompanyByName(buyerName);

      const consigneeText =
        safeTrim(firstNonEmpty(header, ["consigneeText", "consignee_text"])) ||
        safeTrim(buyerCompany?.buyer_consignee) ||
        buyerName ||
        "-";

      const notifyPartyText =
        safeTrim(firstNonEmpty(header, ["notifyPartyText", "notify_party_text"])) ||
        safeTrim(buyerCompany?.buyer_notify_party) ||
        consigneeText ||
        "-";

      const finalDestinationText =
        safeTrim(firstNonEmpty(header, ["finalDestinationText", "final_destination", "destination"])) ||
        safeTrim(buyerCompany?.buyer_final_destination) ||
        "-";

      const paymentTerm =
        safeTrim(firstNonEmpty(header, ["paymentTerm", "payment_term"])) ||
        safeTrim(buyerCompany?.buyer_payment_term) ||
        "-";

      const incoterm =
        safeTrim(firstNonEmpty(header, ["incoterm"])) ||
        safeTrim(buyerCompany?.buyer_default_incoterm) ||
        "-";

      const shipMode =
        safeTrim(firstNonEmpty(header, ["shipMode", "ship_mode"])) ||
        safeTrim(buyerCompany?.buyer_default_ship_mode) ||
        "-";

      const invoiceNo =
        safeTrim(firstNonEmpty(header, ["invoiceNo", "invoice_no"])) || pi.invoiceNo;

      const poNo =
        safeTrim(firstNonEmpty(header, ["poNo", "po_no", "po_reference"])) ||
        safeTrim(pi.poNo) ||
        "";

      const createdAt = firstNonEmpty(header, ["createdAt", "created_at"]) as any;
      const dateText = createdAt ? new Date(createdAt).toLocaleDateString() : "-";

      const currencyCode =
        safeTrim(firstNonEmpty(header, ["currency"])) ||
        safeTrim(pi.currency) ||
        "USD";

      let originCode = firstNonEmpty(header, ["shipping_origin_code"]) || "";

      if (!originCode && poNo) {
        const { data: po } = await supabase
          .from("po_headers")
          .select("shipping_origin_code, origin_code")
          .eq("po_no", poNo)
          .eq("is_deleted", false)
          .maybeSingle();

        originCode =
          safeTrim(po?.shipping_origin_code) ||
          safeTrim(po?.origin_code) ||
          originCode;
      }

      if (!originCode) {
        originCode =
          firstNonEmpty(header, ["origin_code", "origin_mark", "country_of_origin"]) ||
          safeTrim(buyerCompany?.origin_mark) ||
          "";
      }

      const subtotal = lines.reduce((sum: number, l: any) => sum + Number(l?.amount ?? 0), 0);
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "JM ERP";
      workbook.created = new Date();
      const sheet = workbook.addWorksheet("Proforma Invoice", {
        pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
        views: [{ showGridLines: false }],
      });

      sheet.columns = [
        { width: 14 }, { width: 18 }, { width: 22 }, { width: 14 },
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

      sheet.mergeCells("A1:H1");
      sheet.getCell("A1").value = "Proforma Invoice";
      sheet.getCell("A1").font = { bold: true, size: 18 };
      sheet.getCell("A1").alignment = { horizontal: "center" };
      sheet.getRow(1).height = 28;

      sheet.mergeCells("A2:D2");
      sheet.mergeCells("E2:H2");
      sheet.mergeCells("A3:D3");
      sheet.mergeCells("E3:H3");
      sheet.getCell("A2").value = `Buyer: ${buyerName || "-"}`;
      sheet.getCell("E2").value = `Invoice No: ${invoiceNo}`;
      sheet.getCell("A3").value = `PO No: ${poNo || "-"}`;
      sheet.getCell("E3").value = `Date: ${dateText}`;
      sheet.getCell("E2").alignment = { horizontal: "right" };
      sheet.getCell("E3").alignment = { horizontal: "right" };

      sheet.mergeCells("A5:D5");
      sheet.mergeCells("E5:H5");
      sheet.mergeCells("A6:D7");
      sheet.mergeCells("E6:H7");
      sheet.getCell("A5").value = "Shipper / Exporter";
      sheet.getCell("E5").value = "Invoice & Terms";
      sheet.getCell("A6").value = "JM INTERNATIONAL CO.,LTD";
      sheet.getCell("E6").value = `Terms: ${paymentTerm}\nIncoterm: ${incoterm}\nShip Mode: ${shipMode}`;
      boxRange("A5", "H7");

      sheet.mergeCells("A9:D9");
      sheet.mergeCells("E9:H9");
      sheet.mergeCells("A10:D12");
      sheet.mergeCells("E10:H12");
      sheet.getCell("A9").value = "Consignee";
      sheet.getCell("E9").value = "Notify Party";
      sheet.getCell("A10").value = consigneeText;
      sheet.getCell("E10").value = notifyPartyText;
      boxRange("A9", "H12");

      sheet.mergeCells("A14:H14");
      sheet.mergeCells("A15:H15");
      sheet.getCell("A14").value = "Final Destination";
      sheet.getCell("A15").value = finalDestinationText || "-";
      boxRange("A14", "H15");

      for (const addr of ["A5", "E5", "A9", "E9", "A14"]) {
        sheet.getCell(addr).font = { bold: true };
        sheet.getCell(addr).fill = headerFill;
      }

      const tableStart = 17;
      const headerRow = sheet.getRow(tableStart);
      headerRow.values = ["PO #", "Buyer Style", "Description", "HS Code", "Qty", "UOM", "Unit Price", "Amount"];
      headerRow.eachCell((cell) => {
        cell.fill = headerFill;
        cell.font = { bold: true };
        cell.border = { top: lightBorder, left: lightBorder, bottom: lightBorder, right: lightBorder };
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      });

      lines.forEach((l: any, idx: number) => {
        const rowNo = tableStart + idx + 1;
        const qty = Number(l?.qty ?? 0);
        const up = Number(l?.unit_price ?? 0);
        const amt = Number(l?.amount ?? qty * up);
        const row = sheet.getRow(rowNo);
        row.values = [
          poNo || "",
          l?.buyer_style_no || "",
          l?.description || "",
          l?.hs_code || "",
          qty || "",
          l?.uom || "",
          up,
          amt,
        ];
        row.eachCell((cell, colNumber) => {
          cell.border = { top: lightBorder, left: lightBorder, bottom: lightBorder, right: lightBorder };
          cell.alignment = { vertical: "middle", wrapText: true };
          if ([5, 7, 8].includes(colNumber)) cell.alignment = { horizontal: "right", vertical: "middle", wrapText: true };
          if (colNumber === 5) cell.numFmt = "#,##0";
          if ([7, 8].includes(colNumber)) cell.numFmt = "#,##0.00";
        });
      });

      const subtotalRowNo = tableStart + lines.length + 2;
      sheet.mergeCells(`A${subtotalRowNo}:G${subtotalRowNo}`);
      sheet.getCell(`A${subtotalRowNo}`).value = "Subtotal";
      sheet.getCell(`A${subtotalRowNo}`).font = { bold: true };
      sheet.getCell(`A${subtotalRowNo}`).alignment = { horizontal: "right" };
      sheet.getCell(`H${subtotalRowNo}`).value = subtotal;
      sheet.getCell(`H${subtotalRowNo}`).font = { bold: true };
      sheet.getCell(`H${subtotalRowNo}`).numFmt = `"${currencyCode} "#,##0.00`;

      const signRowNo = subtotalRowNo + 4;
      sheet.mergeCells(`F${signRowNo}:H${signRowNo}`);
      sheet.getCell(`F${signRowNo}`).value = "Signed by";
      sheet.getCell(`F${signRowNo}`).alignment = { horizontal: "center" };

      const stampCfg = resolveStampConfig(originCode);
      try {
        const stampRes = await fetch(stampCfg.src);
        const stampBuffer = await stampRes.arrayBuffer();
        const imageId = workbook.addImage({
          buffer: stampBuffer as any,
          extension: stampCfg.format === "JPEG" ? "jpeg" : "png",
        });
        sheet.addImage(imageId, {
          tl: { col: 5.7, row: signRowNo },
          ext: { width: stampCfg.boxW * 3.5, height: stampCfg.boxH * 3.5 },
        });
      } catch (e) {
        console.warn("Failed to add proforma stamp to Excel:", e);
      }

      sheet.mergeCells(`F${signRowNo + 8}:H${signRowNo + 8}`);
      sheet.getCell(`F${signRowNo + 8}`).value = stampCfg.label;
      sheet.getCell(`F${signRowNo + 8}`).alignment = { horizontal: "center" };

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${invoiceNo || "proforma"}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Unexpected error exporting proforma Excel:", err);
      alert("Unexpected error while exporting Proforma Invoice Excel.");
    } finally {
      setExportingId(null);
    }
  };

  const handleExportPdf = async (pi: ProformaListItem) => {
    try {
      setExportingId(pi.id);

      const params = new URLSearchParams();
      params.set("invoiceNo", pi.invoiceNo);

      const res = await fetch(`/api/proforma/detail?${params.toString()}`, { cache: "no-store" });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        console.error("Failed to load proforma detail:", data);
        alert((data && (data.error || data.message)) || `Failed to load detail (status ${res.status}).`);
        return;
      }

      const header = data?.header || {};
      const lines = (data?.lines || []) as Array<any>;

      const buyerCompanyId =
        firstNonEmpty(header, ["buyerCompanyId", "buyer_company_id", "buyerId", "buyer_id"]) || null;

      const buyerName =
        safeTrim(firstNonEmpty(header, ["buyerName", "buyer_name"])) ||
        safeTrim(pi.buyerName) ||
        "";

      let buyerCompany: any | null = null;
      if (buyerCompanyId) buyerCompany = await loadBuyerCompanyById(String(buyerCompanyId));
      if (!buyerCompany && buyerName) buyerCompany = await loadBuyerCompanyByName(buyerName);

      const consigneeText =
        safeTrim(firstNonEmpty(header, ["consigneeText", "consignee_text"])) ||
        safeTrim(buyerCompany?.buyer_consignee) ||
        buyerName ||
        "-";

      const notifyPartyText =
        safeTrim(firstNonEmpty(header, ["notifyPartyText", "notify_party_text"])) ||
        safeTrim(buyerCompany?.buyer_notify_party) ||
        consigneeText ||
        "-";

      const finalDestinationText =
        safeTrim(firstNonEmpty(header, ["finalDestinationText", "final_destination", "destination"])) ||
        safeTrim(buyerCompany?.buyer_final_destination) ||
        "-";

      const paymentTerm =
        safeTrim(firstNonEmpty(header, ["paymentTerm", "payment_term"])) ||
        safeTrim(buyerCompany?.buyer_payment_term) ||
        "-";

      const incoterm =
        safeTrim(firstNonEmpty(header, ["incoterm"])) ||
        safeTrim(buyerCompany?.buyer_default_incoterm) ||
        "-";

      const shipMode =
        safeTrim(firstNonEmpty(header, ["shipMode", "ship_mode"])) ||
        safeTrim(buyerCompany?.buyer_default_ship_mode) ||
        "-";

      const invoiceNo =
        safeTrim(firstNonEmpty(header, ["invoiceNo", "invoice_no"])) || pi.invoiceNo;

      const poNo =
        safeTrim(firstNonEmpty(header, ["poNo", "po_no", "po_reference"])) ||
        safeTrim(pi.poNo) ||
        "";

      const createdAt = firstNonEmpty(header, ["createdAt", "created_at"]) as any;
      const dateText = createdAt ? new Date(createdAt).toLocaleDateString() : "-";

      const currencyCode =
        safeTrim(firstNonEmpty(header, ["currency"])) ||
        safeTrim(pi.currency) ||
        "USD";

      let originCode = firstNonEmpty(header, ["shipping_origin_code"]) || "";

      if (!originCode && poNo) {
        const { data: po } = await supabase
          .from("po_headers")
          .select("shipping_origin_code, origin_code")
          .eq("po_no", poNo)
          .eq("is_deleted", false)
          .maybeSingle();

        originCode =
          safeTrim(po?.shipping_origin_code) ||
          safeTrim(po?.origin_code) ||
          originCode;
      }

      if (!originCode) {
        originCode =
          firstNonEmpty(header, ["origin_code", "origin_mark", "country_of_origin"]) ||
          safeTrim(buyerCompany?.origin_mark) ||
          "";
      }

      const subtotal = lines.reduce((sum: number, l: any) => sum + Number(l?.amount ?? 0), 0);

      const toPlainLines = (txt?: string | null) =>
        (txt || "")
          .replace(/\r\n/g, "\n")
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);

      const doc = new jsPDF("p", "mm", "a4");
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const marginLeft = 8;
      const contentWidth = pageWidth - marginLeft * 2;
      const halfWidth = contentWidth / 2;

      let y = 15;

      doc.setFontSize(20);
      doc.setFont("helvetica", "bold");
      doc.text("Proforma Invoice", pageWidth / 2, y, { align: "center" });
      y += 12;

      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.text(`Buyer: ${buyerName || "-"}`, marginLeft, y);
      doc.text(`Invoice No: ${invoiceNo}`, pageWidth - marginLeft, y, { align: "right" });
      y += 6;
      doc.text(`PO No: ${poNo || "-"}`, marginLeft, y);
      doc.text(`Date: ${dateText}`, pageWidth - marginLeft, y, { align: "right" });
      y += 10;

      const shipperBlock = "JM INTERNATIONAL CO.,LTD";
      const shipperLines = doc.splitTextToSize(shipperBlock, halfWidth - 4);
      const termsLines = doc.splitTextToSize(
        [`Terms: ${paymentTerm}`, `Incoterm: ${incoterm}`, `Ship Mode: ${shipMode}`].join("\n"),
        halfWidth - 4
      );

      const lh = 4;
      const boxH = Math.max(shipperLines.length, termsLines.length) * lh + 10;

      doc.rect(marginLeft, y, halfWidth, boxH);
      doc.rect(marginLeft + halfWidth, y, halfWidth, boxH);

      doc.setFont("helvetica", "bold");
      doc.text("Shipper / Exporter", marginLeft + 2, y + 5);
      doc.text("Invoice & Terms", marginLeft + halfWidth + 2, y + 5);
      doc.setFont("helvetica", "normal");

      doc.text(shipperLines, marginLeft + 2, y + 10);
      doc.text(termsLines, marginLeft + halfWidth + 2, y + 10);

      y += boxH + 4;

      const consLines = doc.splitTextToSize(toPlainLines(consigneeText).join("\n") || "-", halfWidth - 4);
      const notiLines = doc.splitTextToSize(toPlainLines(notifyPartyText).join("\n") || "-", halfWidth - 4);
      const boxH2 = Math.max(consLines.length, notiLines.length) * lh + 10;

      doc.rect(marginLeft, y, halfWidth, boxH2);
      doc.rect(marginLeft + halfWidth, y, halfWidth, boxH2);

      doc.setFont("helvetica", "bold");
      doc.text("Consignee", marginLeft + 2, y + 5);
      doc.text("Notify Party", marginLeft + halfWidth + 2, y + 5);
      doc.setFont("helvetica", "normal");

      doc.text(consLines, marginLeft + 2, y + 10);
      doc.text(notiLines, marginLeft + halfWidth + 2, y + 10);

      y += boxH2 + 4;

      doc.rect(marginLeft, y, contentWidth, 14);
      doc.setFont("helvetica", "bold");
      doc.text("Final Destination", marginLeft + 2, y + 5);
      doc.setFont("helvetica", "normal");
      doc.text(finalDestinationText || "-", marginLeft + 2, y + 10);
      y += 20;

      const head = [["PO #", "Buyer Style", "Description", "HS Code", "Qty", "UOM", "Unit Price", "Amount"]];
      const body = lines.map((l: any) => {
        const qty = Number(l?.qty ?? 0);
        const up = Number(l?.unit_price ?? 0);
        const amt = Number(l?.amount ?? qty * up);

        return [
          poNo || "",
          l?.buyer_style_no || "",
          l?.description || "",
          l?.hs_code || "",
          qty ? qty.toLocaleString("en-US") : "",
          l?.uom || "",
          up ? up.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00",
          amt ? amt.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00",
        ];
      });

      (autoTable as any)(doc, {
        startY: y,
        margin: { left: marginLeft, right: marginLeft },
        head,
        body,
        theme: "grid",
        styles: { fontSize: 8, cellPadding: 1.8, halign: "center", valign: "middle" },
        headStyles: { fontStyle: "bold", halign: "center" },
        columnStyles: {
          4: { halign: "right" },
          6: { halign: "right" },
          7: { halign: "right" },
        },
      });

      const lastY = (doc as any).lastAutoTable?.finalY || y + 20;

      doc.setFontSize(10);
      doc.text("Subtotal", marginLeft, lastY + 8);
      doc.text(
        `${currencyCode} ${subtotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        pageWidth - marginLeft,
        lastY + 8,
        { align: "right" }
      );

      const stampCfg = resolveStampConfig(originCode);
      const stampImg = await loadImage(stampCfg.src);

      let signTextY = Math.max(lastY + 22, pageHeight - 58);
      const neededBottom = stampCfg.boxH + 16;
      if (signTextY + neededBottom > pageHeight - 10) {
        doc.addPage();
        signTextY = Math.max(30, pageHeight - 58);
      }

      doc.setFontSize(11);
      doc.text("Signed by", pageWidth - marginLeft, signTextY, { align: "right" });

      const stampBoxX = pageWidth - marginLeft - stampCfg.boxW;
      const stampBoxY = signTextY + 4;
      drawStampContain(doc, stampImg, stampCfg.format, stampBoxX, stampBoxY, stampCfg.boxW, stampCfg.boxH);

      doc.text(stampCfg.label, pageWidth - marginLeft, stampBoxY + stampCfg.boxH + 6, {
        align: "right",
      });

      doc.save(`${invoiceNo || "proforma"}.pdf`);
    } catch (err) {
      console.error("Unexpected error exporting proforma PDF:", err);
      alert("Unexpected error while exporting Proforma Invoice.");
    } finally {
      setExportingId(null);
    }
  };

  if (loading || !role) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="text-sm text-slate-500">Loading...</div>
      </div>
    );
  }

  return (
    <AppShell role={role} title="Proforma Invoices" description="List of Proforma Invoices">
      <div className="p-4">
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <CardTitle className="text-xl">Proforma Invoices</CardTitle>
              <p className="text-xs text-zinc-500 mt-1">
                Search and export Proforma Invoices (PDF).
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 px-3 text-xs"
                onClick={() => router.push("/proforma")}
              >
                Go to /proforma
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 px-3 text-xs"
                onClick={() => router.push("/po/create")}
              >
                Go to PO Create
              </Button>
            </div>
          </CardHeader>

          <CardContent>
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <Input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="Search by Invoice No, PO No, Buyer..."
                className="max-w-xs text-sm"
              />
              <Button
                type="button"
                size="sm"
                onClick={() => fetchList(keyword)}
                disabled={searching}
                className="h-8 px-3 text-xs"
              >
                {searching ? "Searching..." : "Search"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setKeyword("");
                  fetchList("");
                }}
                className="h-8 px-3 text-xs"
              >
                Reset
              </Button>
            </div>

            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-zinc-50 border-b">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Invoice No</th>
                    <th className="px-3 py-2 text-left font-medium">PO No</th>
                    <th className="px-3 py-2 text-left font-medium">Buyer</th>
                    <th className="px-3 py-2 text-left font-medium">Created At</th>
                    <th className="px-3 py-2 text-right font-medium">Subtotal</th>
                    <th className="px-3 py-2 text-center font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-zinc-500">
                        No Proforma Invoice found.
                      </td>
                    </tr>
                  )}

                  {items.map((pi) => (
                    <tr key={pi.id} className="border-b last:border-0">
                      <td className="px-3 py-2">{pi.invoiceNo}</td>
                      <td className="px-3 py-2">
                        {pi.poNo ? pi.poNo : <span className="text-zinc-400">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        {pi.buyerName ? pi.buyerName : <span className="text-zinc-400">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        {pi.createdAt ? (
                          new Date(pi.createdAt).toLocaleString()
                        ) : (
                          <span className="text-zinc-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {(pi.currency || "USD") + " "}
                        {Number(pi.subtotal || 0).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 px-3 text-[11px]"
                            onClick={() =>
                              pi.poNo
                                ? router.push(`/po/create?poNo=${encodeURIComponent(pi.poNo)}`)
                                : alert("This Proforma has no linked PO No.")
                            }
                          >
                            Open PO
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            className="h-7 px-3 text-[11px]"
                            onClick={() => handleExportPdf(pi)}
                            disabled={exportingId === pi.id}
                          >
                            {exportingId === pi.id ? "Making PDF..." : "PDF"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 px-3 text-[11px]"
                            onClick={() => handleExportExcel(pi)}
                            disabled={exportingId === pi.id}
                          >
                            {exportingId === pi.id ? "Making..." : "Excel"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
