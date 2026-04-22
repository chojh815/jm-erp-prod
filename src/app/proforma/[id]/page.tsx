
"use client";

import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { getCompanyStampByOrigin } from "@/lib/companyStamp";
import jsPDF from "jspdf";
// @ts-ignore
import autoTable from "jspdf-autotable";

function safe(v: any) {
  return (v ?? "").toString().trim();
}
function normalizeOriginCode(v: any) {
  return safe(v).toUpperCase();
}
function resolveStampConfig(originCode: any) {
  const stamp = getCompanyStampByOrigin(safe(originCode));
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
function formatQty(v: any) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Number(v || 0));
}
function formatAmount(v: any) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(v || 0));
}
function formatUnitPrice(v: any) {
  const n = Number(v || 0);
  const intPart = Math.trunc(n).toString();
  const dec = Math.round((n - Math.trunc(n)) * 100);
  const decStr = dec.toString().padStart(2, "0");
  const intWithComma = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${intWithComma}.${decStr}`;
}
function cooFromOriginCode(v: any) {
  const s = normalizeOriginCode(v);
  if (!s) return "-";
  if (s.startsWith("CN") || s.includes("CHINA") || s.includes("QINGDAO")) return "MADE IN CHINA";
  if (s.startsWith("VN") || s.includes("VIETNAM") || s.includes("BACNINH")) return "MADE IN VIETNAM";
  if (s.startsWith("KR") || s.includes("KOREA")) return "MADE IN KOREA";
  return `MADE IN ${s.replace(/_/g, " ")}`;
}

export default function PIViewPage({ params }: any) {
  const supabase = createSupabaseBrowserClient();
  const { id } = params;

  const [header, setHeader] = useState<any>(null);
  const [lines, setLines] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [poOriginCode, setPoOriginCode] = useState<string>("");

  useEffect(() => {
    const load = async () => {
      const { data: h } = await supabase
        .from("proforma_headers")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (!h) {
        const { data: h2 } = await supabase
          .from("proforma_invoices")
          .select("*")
          .eq("id", id)
          .maybeSingle();

        setHeader(h2 || null);

        if (h2) {
          const fkId = h2.id;
          const { data: l2 } = await supabase
            .from("proforma_invoice_lines")
            .select("*")
            .eq("proforma_invoice_id", fkId)
            .order("line_no", { ascending: true });
          setLines(l2 || []);
        } else {
          setLines([]);
        }

        setLoading(false);
        return;
      }

      setHeader(h);

      const { data: l } = await supabase
        .from("proforma_lines")
        .select("*")
        .eq("proforma_header_id", id)
        .order("line_no", { ascending: true });

      setLines(l || []);

      const poNo = safe(h.po_no);
      if (poNo) {
        const { data: po } = await supabase
          .from("po_headers")
          .select("shipping_origin_code, origin_code")
          .eq("po_no", poNo)
          .eq("is_deleted", false)
          .maybeSingle();

        setPoOriginCode(
          safe(po?.shipping_origin_code) || safe(po?.origin_code) || ""
        );
      }

      setLoading(false);
    };

    load();
  }, [id, supabase]);

  const totalDisplay = formatAmount(header?.total_amount || 0);
  const resolvedOriginCode = useMemo(() => {
    return (
      safe(header?.shipping_origin_code) ||
      poOriginCode ||
      safe(header?.origin_code) ||
      ""
    );
  }, [header, poOriginCode]);

  const handleDownloadPdf = async () => {
    if (!header) return;

    const doc = new jsPDF("p", "mm", "a4");
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const marginLeft = 15;
    let cursorY = 15;

    doc.setFontSize(16);
    doc.text("Proforma Invoice", pageWidth / 2, cursorY, { align: "center" });

    cursorY += 8;
    doc.setFontSize(10);
    const invoiceNo = header.invoice_no || "";
    const dateText = header.issue_date
      ? String(header.issue_date).slice(0, 10)
      : header.created_at
      ? String(header.created_at).slice(0, 10)
      : "-";
    const totalText = `${formatAmount(header.total_amount || 0)} ${header.currency || "USD"}`;

    doc.text(`Invoice No: ${invoiceNo}`, marginLeft, cursorY);
    doc.text(`Date: ${dateText}`, pageWidth - marginLeft, cursorY, { align: "right" });

    cursorY += 6;
    doc.text(`Total: ${totalText}`, marginLeft, cursorY);
    doc.text(`COO: ${cooFromOriginCode(resolvedOriginCode)}`, pageWidth - marginLeft, cursorY, {
      align: "right",
    });

    cursorY += 10;

    const tableHead = [[
      "Line",
      "Style",
      "Description",
      "Color",
      "Size",
      "Qty",
      "Unit Price",
      "Amount",
    ]];

    const tableBody = lines.map((l) => {
      const styleNo = l.style_no || l.buyer_style_no || l.jm_style_no || "";
      return [
        l.line_no ?? "",
        styleNo,
        l.description || "",
        l.color || "",
        l.size || "",
        formatQty(l.qty),
        formatUnitPrice(l.unit_price),
        formatAmount(l.amount),
      ];
    });

    autoTable(doc, {
      startY: cursorY,
      head: tableHead,
      body: tableBody,
      styles: { fontSize: 8 },
      headStyles: { fontStyle: "bold" },
      columnStyles: {
        0: { cellWidth: 10 },
        1: { cellWidth: 25 },
        2: { cellWidth: 60 },
        3: { cellWidth: 18 },
        4: { cellWidth: 15 },
        5: { cellWidth: 15 },
        6: { cellWidth: 22 },
        7: { cellWidth: 25 },
      },
    });

    const lastY = (doc as any).lastAutoTable?.finalY || cursorY + 20;
    const stampCfg = resolveStampConfig(resolvedOriginCode);
    const stampImg = await loadImage(stampCfg.src);

    let signTextY = Math.max(lastY + 18, pageHeight - 58);
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

    const fileName = invoiceNo ? `${invoiceNo}.pdf` : "proforma.pdf";
    doc.save(fileName);
  };

  if (loading) return <div className="p-6">Loading...</div>;
  if (!header) return <div className="p-6 text-red-500">PI Not Found</div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Proforma Invoice: {header.invoice_no}</h1>
        <Button onClick={() => void handleDownloadPdf()}>Download PDF</Button>
      </div>

      <div className="border p-4 rounded-md bg-gray-50 space-y-1">
        <p>
          <b>Total:</b> {totalDisplay} {header.currency || "USD"}
        </p>
        <p>
          <b>Date:</b> {header.issue_date ? String(header.issue_date).slice(0, 10) : "-"}
        </p>
        <p>
          <b>Shipping Origin:</b> {resolvedOriginCode || "-"}
        </p>
        <p>
          <b>COO:</b> {cooFromOriginCode(resolvedOriginCode)}
        </p>
      </div>

      <table className="w-full border text-sm">
        <thead className="bg-gray-100">
          <tr>
            <th className="p-3 text-left w-[6%]">Line</th>
            <th className="p-3 text-left w-[14%]">Style</th>
            <th className="p-3 text-left w-[30%]">Description</th>
            <th className="p-3 text-left w-[10%]">Color</th>
            <th className="p-3 text-left w-[8%]">Size</th>
            <th className="p-3 text-right w-[10%]">Qty</th>
            <th className="p-3 text-right w-[11%]">Unit Price</th>
            <th className="p-3 text-right w-[11%]">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const styleNo = l.style_no || l.buyer_style_no || l.jm_style_no || "";
            return (
              <tr key={l.id} className="border-b">
                <td className="p-3">{l.line_no}</td>
                <td className="p-3">{styleNo}</td>
                <td className="p-3">{l.description}</td>
                <td className="p-3">{l.color}</td>
                <td className="p-3">{l.size}</td>
                <td className="p-3 text-right">{formatQty(l.qty)}</td>
                <td className="p-3 text-right">{formatUnitPrice(l.unit_price)}</td>
                <td className="p-3 text-right">{formatAmount(l.amount)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
