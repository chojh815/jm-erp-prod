"use client";

import React from "react";
import { useRouter } from "next/navigation";

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

type PdfMode = "internal" | "vendor";

type Props = {
  mode: PdfMode;
  header: any;
  line: any | null;
  materials: any[];
};

function fmtDate(d: any) {
  if (!d) return "-";
  const s = String(d);
  // 2025-12-19T... => 2025-12-19
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function fmtQty(n: any) {
  const v = Number(n ?? 0);
  if (Number.isNaN(v)) return "-";
  return new Intl.NumberFormat("en-US").format(v);
}

function safeText(v: any) {
  const s = String(v ?? "").trim();
  return s ? s : "-";
}

async function loadImageAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ""));
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export default function WorkSheetJsPdfClient({ mode, header, line, materials }: Props) {
  const router = useRouter();

  // 화면에서 “한눈에” 보이도록 축소 (인쇄/PDF에는 영향 없음: jsPDF)
  const SCREEN_SCALE = 0.86;

  const wsNo = safeText(header?.work_sheet_no);
  const poNo = safeText(header?.po_no);
  const currency = safeText(header?.currency);
  const shipMode = safeText(header?.ship_mode);
  const reqShipDate = fmtDate(header?.requested_ship_date || header?.req_ship_date);
  const status = safeText(header?.status);
  const docDate = fmtDate(header?.date || header?.created_at);

  const brandDept = (() => {
    const b = String(header?.buyer_brand_name ?? header?.brand_name ?? "").trim();
    const d = String(header?.buyer_dept_name ?? header?.dept_name ?? "").trim();
    const left = b || "-";
    const right = d || "-";
    return `${left} / ${right}`;
  })();

  // line 기반 표시 (1:1)
  const jmNo = safeText(line?.jm_style_no || line?.jm_no || line?.style_no);
  const buyerStyle = safeText(line?.buyer_style || line?.buyer_style_no);
  const desc = safeText(line?.description || line?.desc);
  const plating = safeText(line?.plating_color || line?.plating);
  const qty = fmtQty(line?.qty);

  // 이미지 후보
  const imageUrl =
    (line?.image_url_primary as string | null) ||
    (Array.isArray(line?.image_urls) ? line?.image_urls?.[0] : null) ||
    null;

  // (중요) Buyer full name 노출 금지 정책
  // -> 서버에서 buyer_name을 null로 내려주더라도, 혹시 남아있으면 여기서도 방어적으로 절대 출력 안 함.

  const onPrint = async () => {
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 10;

    const x0 = margin;
    let y = 12;

    // Title
    doc.setFont("helvetica", "bold");
    doc.setFontSize(24);
    doc.text(`WORK SHEET (${mode === "vendor" ? "Vendor" : "Internal"})`, pageW / 2, y, {
      align: "center",
    });

    y += 10;

    // ===== Header Big Box =====
    const boxX = x0;
    const boxY = y;
    const boxW = pageW - margin * 2;
    const boxH = 56;

    doc.setDrawColor(0);
    doc.setLineWidth(0.8);
    doc.rect(boxX, boxY, boxW, boxH);

    // Header rows (2 columns grid)
    // Left labels/values
    const colGap = 10;
    const colW = (boxW - colGap) / 2;
    const leftX = boxX + 8;
    const rightX = boxX + colW + colGap + 8;

    const row1Y = boxY + 10;
    const row2Y = boxY + 18;
    const row3Y = boxY + 26;
    const row4Y = boxY + 34;

    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("Work Sheet No:", leftX, row1Y);
    doc.text("PO No:", leftX, row2Y);
    doc.text("Brand / Dept:", leftX, row3Y);
    doc.text("Status:", leftX, row4Y);

    doc.text("Currency:", rightX, row1Y);
    doc.text("Ship Mode:", rightX, row2Y);
    doc.text("Req Ship Date:", rightX, row3Y);
    doc.text("Date:", rightX, row4Y);

    doc.setFont("helvetica", "normal");
    doc.text(wsNo, leftX + 36, row1Y);
    doc.text(poNo, leftX + 36, row2Y);
    doc.text(brandDept, leftX + 36, row3Y);
    doc.text(status, leftX + 36, row4Y);

    doc.text(currency, rightX + 24, row1Y);
    doc.text(shipMode, rightX + 24, row2Y);
    doc.text(reqShipDate, rightX + 30, row3Y);
    doc.text(docDate, rightX + 16, row4Y);

    // sub boxes: sample dates + special instructions
    const subY = boxY + 40;
    const subH = 14;
    const subW = (boxW - 6) / 2;

    // left sub
    doc.setLineWidth(0.4);
    doc.rect(boxX + 3, subY, subW, subH);
    doc.setFont("helvetica", "bold");
    doc.text("Sample Target Dates", boxX + 6, subY + 5);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    const ap = fmtDate(header?.approval_sample_target_date);
    const pp = fmtDate(header?.pp_sample_target_date);
    const top = fmtDate(header?.top_sample_target_date);
    const fin = fmtDate(header?.final_sample_target_date);
    doc.text(`Approval: ${ap}   PP: ${pp}   TOP: ${top}   Final: ${fin}`, boxX + 6, subY + 11);

    // right sub
    doc.rect(boxX + 3 + subW + 3, subY, subW, subH);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Special Instructions", boxX + 6 + subW + 3, subY + 5);
    doc.setFont("helvetica", "normal");
    const inst = safeText(header?.special_instructions || header?.instruction || header?.notes);
    doc.text(inst === "-" ? "-" : inst.slice(0, 110), boxX + 6 + subW + 3, subY + 11);

    y += boxH + 8;

    // ===== Line Head =====
    // Left: JM No / Buyer Style / Desc / Plating
    // Right: Qty big
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(`JM No: ${jmNo}`, x0, y);
    y += 6;
    doc.text(`Buyer Style: ${buyerStyle}`, x0, y);
    y += 6;
    doc.text(`Desc: ${desc}`, x0, y);
    y += 6;
    doc.text(`Plating: ${plating}`, x0, y);

    doc.setFontSize(18);
    doc.text(`Qty: ${qty}`, pageW - margin, y, { align: "right" });

    y += 8;

    // ===== Image box + Materials table =====
    const imgW = 58;
    const imgH = 62;

    // image box
    doc.setLineWidth(0.6);
    doc.rect(x0, y, imgW, imgH);

    if (imageUrl) {
      const dataUrl = await loadImageAsDataUrl(imageUrl);
      if (dataUrl) {
        // Fit image inside box
        doc.addImage(dataUrl, "JPEG", x0 + 2, y + 2, imgW - 4, imgH - 4, undefined, "FAST");
      } else {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.text("No image", x0 + imgW / 2, y + imgH / 2, { align: "center" });
      }
    } else {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text("No image", x0 + imgW / 2, y + imgH / 2, { align: "center" });
    }

    // table area
    const tableX = x0 + imgW + 6;
    const tableW = pageW - margin - tableX;

    const rows =
      (materials || []).length > 0
        ? (materials || []).map((m: any) => [
            safeText(m.item || m.material || m.item_name),
            safeText(m.spec),
            safeText(m.color),
            safeText(m.qty),
            safeText(m.note),
          ])
        : [["", "", "", "", "No material specs"]];

    autoTable(doc, {
      startY: y,
      margin: { left: tableX, right: margin },
      tableWidth: tableW,
      theme: "grid",
      head: [["Item / Material", "Spec", "Color", "Qty", "Note"]],
      body: rows,
      styles: {
        font: "helvetica",
        fontSize: 10,
        cellPadding: 2.2,
        valign: "top",
        lineColor: [0, 0, 0],
        lineWidth: 0.2,
      },
      headStyles: {
        fillColor: [135, 190, 253], // 연한 파랑 (요청)
        textColor: [15, 23, 42], // 네이비
        fontStyle: "bold",
        halign: "center",
      },
      columnStyles: {
        0: { cellWidth: tableW * 0.40 },
        1: { cellWidth: tableW * 0.18 },
        2: { cellWidth: tableW * 0.14 },
        3: { cellWidth: tableW * 0.10, halign: "right" },
        4: { cellWidth: tableW * 0.18 },
      },
      didDrawPage: () => {
        // (필요하면 페이지 번호 등 추가 가능)
      },
    });

    const afterTableY = (doc as any).lastAutoTable?.finalY ?? y + imgH;

    // ===== Notes 3 boxes =====
    const notesY = Math.max(y + imgH + 6, afterTableY + 6);
    const noteH = 28;
    const gap = 6;
    const noteW = (pageW - margin * 2 - gap * 2) / 3;

    const n1X = x0;
    const n2X = x0 + noteW + gap;
    const n3X = x0 + (noteW + gap) * 2;

    const drawNote = (x: number, title: string, body: string) => {
      doc.setLineWidth(0.6);
      doc.rect(x, notesY, noteW, noteH);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(title, x + 3, notesY + 6);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      const txt = safeText(body);
      doc.text(txt === "-" ? "-" : txt.slice(0, 120), x + 3, notesY + 12);
    };

    drawNote(n1X, "Work Notes", safeText(line?.work_notes || header?.work_notes));
    drawNote(n2X, "QC Points", safeText(line?.qc_points || header?.qc_points));
    drawNote(n3X, "Packing Notes", safeText(line?.packing_notes || header?.packing_notes));

    // ===== output =====
    // 자동으로 새 탭 PDF + 프린트 유도 (브라우저 헤더/푸터 없이)
    const blobUrl = doc.output("bloburl");
    window.open(blobUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div style={{ padding: 16 }}>
      {/* 상단 버튼: Sign out 영역과 겹치지 않게 우측 하단 고정 */}
      <div
        style={{
          position: "fixed",
          right: 14,
          bottom: 14,
          display: "flex",
          gap: 8,
          zIndex: 50,
        }}
      >
        <button
          onClick={onPrint}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #1d4ed8",
            background: "#2563eb",
            color: "white",
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          Print / PDF
        </button>
        <button
          onClick={() => router.back()}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #94a3b8",
            background: "#f1f5f9",
            color: "#0f172a",
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          Close
        </button>
      </div>

      {/* 화면 미리보기(스케일) */}
      <div
        style={{
          transform: `scale(${SCREEN_SCALE})`,
          transformOrigin: "top center",
          width: "100%",
        }}
      >
        {/* 미리보기는 간단히 안내만 (실제 출력은 jsPDF가 담당) */}
        <div style={{ textAlign: "center", fontSize: 18, fontWeight: 900, marginTop: 12 }}>
          WORK SHEET ({mode === "vendor" ? "Vendor" : "Internal"})
        </div>
        <div style={{ textAlign: "center", marginTop: 8, color: "#334155" }}>
          이 화면은 미리보기이며, <b>Print / PDF</b> 버튼을 누르면 jsPDF로 “정교한” 출력물이 생성됩니다.
        </div>
      </div>
    </div>
  );
}
