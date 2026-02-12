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
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function addDaysYmd(ymd: any, deltaDays: number) {
  if (!ymd) return "-";
  const s = String(ymd).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "-";
  const [y, mo, d] = s.split("-").map((x) => Number(x));
  const dt = new Date(Date.UTC(y, mo - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
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

/**
 * ✅ 핵심: jsPDF에 한글 폰트(NotoSansKR) 임베드
 * - 전제: public/fonts/NotoSansKR-Regular.ttf 존재
 * - fetch → base64 → addFileToVFS/addFont → setFont
 */
async function registerNotoSansKR(doc: jsPDF) {
  // @ts-ignore
  if ((doc as any).__notoKRRegistered) {
    doc.setFont("NotoSansKR", "normal");
    return;
  }

  const res = await fetch("/fonts/NotoSansKR-Regular.ttf", { cache: "force-cache" });
  if (!res.ok) {
    throw new Error("Missing font: /public/fonts/NotoSansKR-Regular.ttf");
  }

  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);

  // ArrayBuffer -> base64 (large file safe)
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  const b64 = btoa(binary);

  doc.addFileToVFS("NotoSansKR-Regular.ttf", b64);
  doc.addFont("NotoSansKR-Regular.ttf", "NotoSansKR", "normal", "Identity-H");
  doc.setFont("NotoSansKR", "normal");

  // @ts-ignore
  (doc as any).__notoKRRegistered = true;
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

  const onPrint = async () => {
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

    // ✅ 한글 폰트 임베드 (autoTable 포함 전체 적용)
    await registerNotoSansKR(doc);

    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 10;

    const x0 = margin;
    let y = 12;

    // Title (Bold 폰트가 없으므로 크기/레이아웃으로 강조)
    doc.setFont("NotoSansKR", "normal");
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
    const colGap = 10;
    const colW = (boxW - colGap) / 2;
    const leftX = boxX + 8;
    const rightX = boxX + colW + colGap + 8;

    const row1Y = boxY + 10;
    const row2Y = boxY + 18;
    const row3Y = boxY + 26;
    const row4Y = boxY + 34;

    doc.setFont("NotoSansKR", "normal");
    doc.setFontSize(11);

    // 라벨 (강조 느낌만)
    doc.text("Work Sheet No:", leftX, row1Y);
    doc.text("PO No:", leftX, row2Y);
    doc.text("Brand / Dept:", leftX, row3Y);
    doc.text("Status:", leftX, row4Y);

    doc.text("Currency:", rightX, row1Y);
    doc.text("Ship Mode:", rightX, row2Y);
    doc.text(mode === "vendor" ? "Delivery Due:" : "Req Ship Date:", rightX, row3Y);
    doc.text("Date:", rightX, row4Y);

    // 값
    doc.text(wsNo, leftX + 36, row1Y);
    doc.text(poNo, leftX + 36, row2Y);
    doc.text(brandDept, leftX + 36, row3Y);
    doc.text(status, leftX + 36, row4Y);

    doc.text(currency, rightX + 24, row1Y);
    doc.text(shipMode, rightX + 24, row2Y);
    doc.text(
      mode === "vendor"
        ? addDaysYmd(header?.requested_ship_date || header?.req_ship_date, -7)
        : reqShipDate,
      rightX + 30,
      row3Y
    );
    doc.text(docDate, rightX + 16, row4Y);

    // sub boxes: sample dates + special instructions
    const subY = boxY + 40;
    const subH = 14;
    const subW = (boxW - 6) / 2;

    // left sub
    doc.setLineWidth(0.4);
    doc.rect(boxX + 3, subY, subW, subH);
    doc.setFontSize(10);
    doc.text("Sample Target Dates", boxX + 6, subY + 5);

    const ap = fmtDate(header?.approval_sample_target_date);
    const pp = fmtDate(header?.pp_sample_target_date);
    const top = fmtDate(header?.top_sample_target_date);
    const fin = fmtDate(header?.final_sample_target_date);
    doc.text(`Approval: ${ap}   PP: ${pp}   TOP: ${top}   Final: ${fin}`, boxX + 6, subY + 11);

    // right sub
    doc.rect(boxX + 3 + subW + 3, subY, subW, subH);
    doc.text("Special Instructions", boxX + 6 + subW + 3, subY + 5);

    const inst = safeText(header?.special_instructions || header?.instruction || header?.notes);
    doc.text(inst === "-" ? "-" : inst.slice(0, 110), boxX + 6 + subW + 3, subY + 11);

    y += boxH + 8;

    // ===== Line Head =====
    doc.setFont("NotoSansKR", "normal");
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
        doc.addImage(dataUrl, "JPEG", x0 + 2, y + 2, imgW - 4, imgH - 4, undefined, "FAST");
      } else {
        doc.setFont("NotoSansKR", "normal");
        doc.setFontSize(10);
        doc.text("No image", x0 + imgW / 2, y + imgH / 2, { align: "center" });
      }
    } else {
      doc.setFont("NotoSansKR", "normal");
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

      // ✅ 한글 폰트 강제
      styles: {
        font: "NotoSansKR",
        fontStyle: "normal",
        fontSize: 10,
        cellPadding: 2.2,
        valign: "top",
        lineColor: [0, 0, 0],
        lineWidth: 0.2,
      },
      headStyles: {
        fillColor: [135, 190, 253],
        textColor: [15, 23, 42],
        font: "NotoSansKR",
        fontStyle: "normal",
        halign: "center",
      },
      bodyStyles: {
        font: "NotoSansKR",
        fontStyle: "normal",
      },

      columnStyles: {
        0: { cellWidth: tableW * 0.40 },
        1: { cellWidth: tableW * 0.18 },
        2: { cellWidth: tableW * 0.14 },
        3: { cellWidth: tableW * 0.10, halign: "right" },
        4: { cellWidth: tableW * 0.18 },
      },
      didDrawPage: () => {},
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

      doc.setFont("NotoSansKR", "normal");
      doc.setFontSize(11);
      doc.text(title, x + 3, notesY + 6);

      doc.setFontSize(10);
      const txt = safeText(body);
      doc.text(txt === "-" ? "-" : txt.slice(0, 120), x + 3, notesY + 12);
    };

    drawNote(n1X, "Work Notes", safeText(line?.work_notes || header?.work_notes));
    drawNote(n2X, "QC Points", safeText(line?.qc_points || header?.qc_points));
    drawNote(n3X, "Packing Notes", safeText(line?.packing_notes || header?.packing_notes));

    // ===== output =====
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
