// src/app/work-sheets/[id]/pdf/page.tsx
"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

type MaterialRow = {
  item?: string | null;
  spec?: string | null;
  color?: string | null;
  qty?: string | number | null;
  remark?: string | null;
};

type PdfData = {
  wsNo?: string | null;
  poNo?: string | null;
  date?: string | null;

  brandDept?: string | null;
  shipMode?: string | null;

  /** ✅ Requested ship date from po_headers */
  requestedShipDate?: string | null;

  jmNo?: string | null;
  buyerStyle?: string | null;
  desc?: string | null;
  plating?: string | null;

  approval?: string | null;
  pp?: string | null;
  top?: string | null;
  final?: string | null;

  qty?: number | string | null;
  uom?: string | null;

  instructions?: string | null;

  imageUrl?: string | null;
  materials?: MaterialRow[] | null;

  /** ✅ Bottom notes from Work Sheet LINE(첫 라인) */
  workNotes?: string | null;
  qcPoints?: string | null;
  packingNotes?: string | null;
};

/** ---------- utils ---------- */
const isObj = (v: any) => v && typeof v === "object" && !Array.isArray(v);

const toStr = (v: any) => {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    if (isObj(v)) {
      if (typeof (v as any).po_no === "string") return (v as any).po_no;
      if (typeof (v as any).work_sheet_no === "string") return (v as any).work_sheet_no;
      if (typeof (v as any).id === "string") return (v as any).id;
    }
    return JSON.stringify(v);
  } catch {
    return "";
  }
};

const safe = (v: any, fb = "-") => toStr(v).trim() || fb;

const fmtDate = (v?: string | null) => {
  const s = toStr(v).trim();
  if (!s) return "-";
  return s.length >= 10 ? s.slice(0, 10) : s;
};

const fmtQty = (v: any) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return safe(v, "-");
  return n.toLocaleString("en-US");
};

const fmtUom = (v?: string | null) => {
  const s = toStr(v).trim().toUpperCase();
  return s || "PCS";
};

function todayYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** ✅ note("QTY=1, UNIT_COST=0.2") 에서 QTY만 추출 */
function extractQtyFromNote(note: any): string | null {
  const s = toStr(note).trim();
  if (!s) return null;

  // QTY=1 / QTY = 1 / QTY: 1 등 허용
  const m = s.match(/QTY\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (m && m[1]) return m[1];

  return null;
}

/** ---------- API mapping ---------- */
function mapApiToPdfData(json: any): PdfData {
  const header = isObj(json?.header) ? json.header : {};
  const po = isObj(json?.po) ? json.po : {};
  const lines = Array.isArray(json?.lines) ? json.lines : [];
  const line0 = isObj(lines?.[0]) ? lines[0] : {};

  const wsNo = header?.work_sheet_no ?? header?.wsNo ?? header?.workSheetNo ?? null;
  const poNo = header?.po_no ?? po?.po_no ?? line0?.po_no ?? null;

  const brand = po?.buyer_brand_name ?? null;
  const dept = po?.buyer_dept_name ?? null;
  const brandDept =
    [toStr(brand).trim(), toStr(dept).trim()].filter(Boolean).join(" / ") || null;

  const shipMode = po?.ship_mode ?? null;

  /** ✅ requested ship date (po_headers) */
  const requestedShipDate =
    po?.requested_ship_date ??
    po?.requestedShipDate ??
    po?.req_ship_date ??
    null;

  const approval = po?.sample_target_approval ?? po?.approval_sample_target_date ?? null;
  const pp = po?.sample_target_pp ?? po?.pp_sample_target_date ?? null;
  const top = po?.sample_target_top ?? po?.top_sample_target_date ?? null;
  const final = po?.sample_target_final ?? po?.final_sample_target_date ?? null;

  const jmNo = line0?.jm_style_no ?? null;
  const buyerStyle = line0?.buyer_style ?? null;
  const desc = line0?.description ?? null;
  const plating = line0?.plating_color ?? null;

  const qty = line0?.qty ?? null;
  const uom = header?.uom ?? line0?.uom ?? "PCS";

  // Special instructions: header.general_notes 우선 (기존 로직 유지)
  const instructions = header?.general_notes ?? header?.notes ?? null;

  /** ✅ bottom notes: 반드시 line0에서 읽어야 함 (work_sheet_headers에 없음) */
  const workNotes = line0?.work_notes ?? line0?.workNotes ?? null;
  const qcPoints = line0?.qc_points ?? line0?.qcPoints ?? null;
  const packingNotes = line0?.packing_notes ?? line0?.packingNotes ?? null;

  let imageUrl: string | null = line0?.image_url_primary ?? null;
  if (!imageUrl && line0?.image_urls) {
    try {
      const arr = Array.isArray(line0.image_urls)
        ? line0.image_urls
        : typeof line0.image_urls === "string"
          ? JSON.parse(line0.image_urls)
          : [];
      if (Array.isArray(arr) && arr[0]) imageUrl = String(arr[0]);
    } catch {}
  }

  const mb = isObj(json?.materialsByLineId) ? json.materialsByLineId : {};
  const lineId = line0?.id;
  const materialsRaw = lineId && (mb as any)[lineId] ? (mb as any)[lineId] : [];

  /**
   * ✅ 핵심 변경:
   * - work_sheet_material_specs에는 qty/unit_cost 컬럼이 없으니 note에서 QTY만 추출
   * - PDF 표에서는 Material/Labor + Qty만 의미 있게 표시
   * - Remarks는 비움(UNIT_COST 등은 출력하지 않음)
   */
  const materials: MaterialRow[] = Array.isArray(materialsRaw)
    ? materialsRaw
        .filter((m: any) => !m?.is_deleted)
        .map((m: any) => {
          const noteText =
            m?.note ?? m?.remark ?? m?.remarks ?? null;

          const qtyFromNote = extractQtyFromNote(noteText);

          return {
            item:
              m?.material_name ??
              m?.item ??
              m?.material ??
              m?.name ??
              null,

            // Spec/Color 컬럼이 실제로 없으면 '-' 처리될 것
            spec: m?.spec_text ?? m?.spec ?? null,
            color: m?.color ?? null,

            // qty는 note에서 우선 추출
            qty: qtyFromNote ?? m?.qty ?? null,

            // ✅ remarks는 출력하지 않음 (UNIT_COST 등 몰림 방지)
            remark: null,
          };
        })
    : [];

  return {
    wsNo,
    poNo,
    date: fmtDate(header?.updated_at ?? header?.created_at ?? todayYmd()),
    brandDept,
    shipMode,
    requestedShipDate,

    jmNo,
    buyerStyle,
    desc: desc ? String(desc) : null,
    plating: plating ? String(plating) : null,

    approval,
    pp,
    top,
    final,

    qty,
    uom,

    instructions,
    imageUrl,
    materials,

    workNotes,
    qcPoints,
    packingNotes,
  };
}

async function fetchPdfData(id?: string): Promise<PdfData> {
  if (!id) return { date: todayYmd(), uom: "PCS", materials: [] };
  const res = await fetch(`/api/work-sheets/${id}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`API /api/work-sheets/${id} failed: ${res.status}`);
  const json = await res.json();
  return mapApiToPdfData(json);
}

/** image -> dataUrl */
async function toDataUrl(url: string): Promise<{ dataUrl: string; fmt: "PNG" | "JPEG" }> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Image fetch failed: ${res.status}`);
  const blob = await res.blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error("Image read failed"));
    fr.readAsDataURL(blob);
  });
  const fmt: "PNG" | "JPEG" = dataUrl.startsWith("data:image/png") ? "PNG" : "JPEG";
  return { dataUrl, fmt };
}

/** ---------- jsPDF font embed (핵심) ---------- */
async function loadAndRegisterFont(doc: jsPDF, fontName: string, fontUrl: string) {
  const res = await fetch(fontUrl, { cache: "no-store" });
  if (!res.ok) throw new Error(`Font fetch failed: ${res.status} ${fontUrl}`);

  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);

  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const base64 = btoa(binary);

  const vfsFileName = `${fontName}.ttf`;
  (doc as any).addFileToVFS(vfsFileName, base64);
  (doc as any).addFont(vfsFileName, fontName, "normal");
}

/** colors */
const COLORS = {
  blue: [65, 130, 210] as [number, number, number],
  blueLightTop: [196, 220, 250] as [number, number, number],
  blueLightBot: [228, 240, 255] as [number, number, number],
  grayFill: [245, 245, 245] as [number, number, number],
  lineSoft: [120, 120, 120] as [number, number, number],
  label: [140, 140, 140] as [number, number, number],
};

function rrect(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  r = 2.2,
  style?: "S" | "F" | "DF"
) {
  const anyDoc = doc as any;
  if (typeof anyDoc.roundedRect === "function") anyDoc.roundedRect(x, y, w, h, r, r, style ?? "S");
  else doc.rect(x, y, w, h, style as any);
}

function drawMiniCard(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  rows: Array<[string, string]>,
  radius = 2.2
) {
  const topBarH = 2.0;
  const headerH = 8.0;
  const padX = 4;

  doc.setDrawColor(...COLORS.lineSoft);
  doc.setLineWidth(0.25);
  rrect(doc, x, y, w, h, radius, "S");

  doc.setFillColor(...COLORS.blue);
  rrect(doc, x, y, w, topBarH, radius, "F");
  doc.rect(x, y + topBarH, w, 0.01, "F");

  doc.setFillColor(...COLORS.grayFill);
  doc.rect(x, y + topBarH, w, headerH, "F");

  doc.setFontSize(10.6);
  doc.setTextColor(0);
  doc.text(title, x + padX, y + topBarH + 5.6);

  doc.setFontSize(9.6);
  const labelW = 22;
  const lineH = 4.9;

  let cy = y + topBarH + headerH + 6.4;
  const maxBodyY = y + h - 3;

  for (const [lab, valRaw] of rows) {
    const val = safe(valRaw);

    doc.setTextColor(...COLORS.label);
    doc.text(lab, x + padX, cy);

    doc.setTextColor(0);
    const maxW = w - padX - padX - labelW;
    const lines = doc.splitTextToSize(val, maxW);
    doc.text(lines, x + padX + labelW, cy);

    cy += lineH * Math.max(1, lines.length);
    if (cy > maxBodyY) break;
  }

  doc.setTextColor(0);
}

/** ---------- language ---------- */
type Lang = "en" | "cn" | "vn";

function normalizeLang(raw: string | null | undefined): Lang {
  const v = String(raw || "").toLowerCase().trim();
  if (v === "cn" || v === "zh" || v === "zh-cn") return "cn";
  if (v === "vn" || v === "vi") return "vn";
  return "en";
}
function getLangFromUrl(): Lang {
  try {
    const sp = new URLSearchParams(window.location.search);
    return normalizeLang(sp.get("lang"));
  } catch {
    return "en";
  }
}

function t(lang: Lang) {
  const dict = {
    en: {
      WORK_SHEET: "WORK SHEET",
      QTY_PREFIX: "Qty",
      PO: "PO",
      WS: "WS",
      DATE: "DATE",
      ORDER: "Order",
      BRAND: "Brand:",
      SHIP: "Ship:",
      REQ_SHIP: "Req Ship:",
      PRODUCT: "Product",
      JM: "JM:",
      STYLE: "Style:",
      DESC: "Desc:",
      PLATING: "Plating:",
      SCHEDULE: "Schedule",
      APPR: "Appr:",
      PP: "PP:",
      TOP: "TOP:",
      FINAL: "Final:",
      SPECIAL_INSTR: "Special Instructions",
      PRODUCT_IMAGE: "PRODUCT IMAGE",
      TABLE_HEAD: ["Material / Labor", "Spec", "Color", "Qty", "Remarks"] as string[],
      NO_MATS: "No material specs",
      BOTTOM_TITLES: ["Work", "QC", "Packing"] as string[],
    },
    cn: {
      WORK_SHEET: "工作单",
      QTY_PREFIX: "数量",
      PO: "PO",
      WS: "WS",
      DATE: "日期",
      ORDER: "订单",
      BRAND: "品牌:",
      SHIP: "运输:",
      REQ_SHIP: "要求出货:",
      PRODUCT: "产品",
      JM: "JM:",
      STYLE: "款号:",
      DESC: "描述:",
      PLATING: "电镀:",
      SCHEDULE: "进度",
      APPR: "批准:",
      PP: "PP:",
      TOP: "TOP:",
      FINAL: "最终:",
      SPECIAL_INSTR: "特别说明",
      PRODUCT_IMAGE: "产品图片",
      TABLE_HEAD: ["材料/工序", "规格", "颜色", "数量", "备注"] as string[],
      NO_MATS: "无材料明细",
      BOTTOM_TITLES: ["生产", "质检", "包装"] as string[],
    },
    vn: {
      WORK_SHEET: "PHIẾU CÔNG VIỆC",
      QTY_PREFIX: "Số lượng",
      PO: "PO",
      WS: "WS",
      DATE: "Ngày",
      ORDER: "Đơn hàng",
      BRAND: "Thương hiệu:",
      SHIP: "Vận chuyển:",
      REQ_SHIP: "Ngày ship yêu cầu:",
      PRODUCT: "Sản phẩm",
      JM: "JM:",
      STYLE: "Style:",
      DESC: "Mô tả:",
      PLATING: "Màu mạ:",
      SCHEDULE: "Lịch",
      APPR: "Duyệt:",
      PP: "PP:",
      TOP: "TOP:",
      FINAL: "Final:",
      SPECIAL_INSTR: "Hướng dẫn đặc biệt",
      PRODUCT_IMAGE: "HÌNH ẢNH SẢN PHẨM",
      TABLE_HEAD: ["Vật liệu / Công đoạn", "Quy cách", "Màu", "Số lượng", "Ghi chú"] as string[],
      NO_MATS: "Không có danh mục vật liệu",
      BOTTOM_TITLES: ["Work", "QC", "Packing"] as string[],
    },
  } as const;

  return dict[lang];
}

function normalizeMultiline(v: any): string {
  const s = toStr(v).replace(/\r\n/g, "\n").trim();
  return s;
}

async function buildPdf(d: PdfData, lang: Lang) {
  const L = t(lang);

  const doc = new jsPDF({ unit: "mm", format: "a4" });

  // ✅ 폰트 내장 + 전체 텍스트 적용
  await loadAndRegisterFont(doc, "NotoSansSC", "/fonts/NotoSansSC-Regular.ttf");
  doc.setFont("NotoSansSC", "normal");

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  const margin = 12;
  const contentW = pageW - margin * 2;

  const ensure = (y: number, needH: number) => {
    if (y + needH > pageH - margin) {
      doc.addPage();
      return margin;
    }
    return y;
  };

  /* ===== HEADER ===== */
  doc.setFontSize(21);
  doc.text(L.WORK_SHEET, margin, 16);

  doc.setFontSize(21);
  doc.text(`${L.QTY_PREFIX}: ${fmtQty(d.qty)} ${fmtUom(d.uom)}`, pageW - margin, 16, {
    align: "right",
  });

  doc.setDrawColor(65, 130, 210);
  doc.setLineWidth(0.6);
  doc.line(margin, 18.8, pageW - margin, 18.8);

  doc.setDrawColor(0, 0, 0);
  doc.setFontSize(10.2);
  doc.text(
    `${L.PO}: ${safe(d.poNo)}   |   ${L.WS}: ${safe(d.wsNo)}   |   ${L.DATE}: ${fmtDate(d.date)}`,
    margin,
    23.5
  );

  let y = 28;

  /* ===== OUTER INFO BOX ===== */
  const outerPad = 6;
  const outerH = 48;
  y = ensure(y, outerH);

  doc.setLineWidth(0.25);
  doc.setDrawColor(...COLORS.lineSoft);
  rrect(doc, margin, y, contentW, outerH, 3.0, "S");

  const cardGap = 10;
  const cardW = (contentW - outerPad * 2 - cardGap * 2) / 3;
  const cardH = outerH - outerPad * 2;
  const cardY = y + outerPad;
  const x1 = margin + outerPad;
  const x2 = x1 + cardW + cardGap;
  const x3 = x2 + cardW + cardGap;

  drawMiniCard(doc, x1, cardY, cardW, cardH, L.ORDER, [
    ["PO:", safe(d.poNo)],
    [L.BRAND, safe(d.brandDept)],
    [L.SHIP, safe(d.shipMode)],
    [L.REQ_SHIP, fmtDate(d.requestedShipDate)],
  ]);

  drawMiniCard(doc, x2, cardY, cardW, cardH, L.PRODUCT, [
    [L.JM, safe(d.jmNo)],
    [L.STYLE, safe(d.buyerStyle)],
    [L.DESC, safe(d.desc)],
    [L.PLATING, safe(d.plating)],
  ]);

  drawMiniCard(doc, x3, cardY, cardW, cardH, L.SCHEDULE, [
    [L.APPR, fmtDate(d.approval)],
    [L.PP, fmtDate(d.pp)],
    [L.TOP, fmtDate(d.top)],
    [L.FINAL, fmtDate(d.final)],
  ]);

  y += outerH + 10;

  /* ===== Special Instructions ===== */
  const instrText = safe(d.instructions, "-");
  doc.setFontSize(9.6);

  const instrPad = 5;
  const instrLines = doc.splitTextToSize(instrText, contentW - instrPad * 2);
  const instrH = Math.max(23, 11.5 + instrLines.length * 5.0);

  y = ensure(y, instrH);

  doc.setLineWidth(0.25);
  doc.setDrawColor(...COLORS.lineSoft);
  rrect(doc, margin, y, contentW, instrH, 3.0, "S");

  doc.setFillColor(...COLORS.grayFill);
  doc.rect(margin, y, contentW, 8.2, "F");

  doc.setFontSize(10.6);
  doc.text(L.SPECIAL_INSTR, margin + instrPad, y + 6.0);

  doc.setFontSize(9.6);
  doc.text(instrLines, margin + instrPad, y + 13.6);

  y += instrH + 10;

  /* ===== Body: Image + Materials Table ===== */
  const imgW = 72;
  const imgH = 82;

  y = ensure(y, Math.max(imgH, 60));

  // Image box
  doc.setLineWidth(0.25);
  doc.setDrawColor(...COLORS.lineSoft);
  rrect(doc, margin, y, imgW, imgH, 3.0, "S");

  const imgLabelH = 8.2;
  doc.setFillColor(...COLORS.grayFill);
  doc.rect(margin, y, imgW, imgLabelH, "F");

  doc.setFontSize(10);
  doc.text(L.PRODUCT_IMAGE, margin + 4, y + 5.8);

  let imgDrawn = false;
  const url = toStr(d.imageUrl).trim();
  if (url) {
    try {
      const { dataUrl, fmt } = await toDataUrl(url);
      const pad = 3;
      const boxX = margin;
      const boxY = y + imgLabelH;
      const boxW = imgW;
      const boxH = imgH - imgLabelH;

      const maxW = boxW - pad * 2;
      const maxH = boxH - pad * 2;
      doc.addImage(dataUrl, fmt as any, boxX + pad, boxY + pad, maxW, maxH);
      imgDrawn = true;
    } catch {}
  }

  if (!imgDrawn) {
    doc.setFontSize(12);
    doc.setTextColor(150);
    doc.text("No image", margin + imgW / 2, y + imgLabelH + (imgH - imgLabelH) / 2, {
      align: "center",
    });
    doc.setTextColor(0);
  }

  // Materials table
  const gap = 8;
  const tableX = margin + imgW + gap;
  const tableW = pageW - margin - tableX;

  const mats = Array.isArray(d.materials) ? d.materials : [];

  // ✅ 여기서도 한 번 더 강제: Remarks 비움, Qty만
  const bodyRows =
    mats.length > 0
      ? mats.map((m) => [
          safe(m.item),
          "-", // spec은 DB에 없으니 출력 안함
          "-", // color도 출력 안함
          safe(m.qty ?? "-"),
          "-", // remarks 출력 안함
        ])
      : [[L.NO_MATS, "-", "-", "-", "-"]];

  const w0 = tableW * 0.44; // 이름 조금 넓힘
  const w1 = tableW * 0.17;
  const w2 = tableW * 0.12;
  const w3 = tableW * 0.10;
  const w4 = tableW * 0.17;

  autoTable(doc, {
    startY: y,
    margin: { left: tableX, right: margin, top: margin, bottom: margin },
    tableWidth: tableW,
    head: [L.TABLE_HEAD],
    body: bodyRows,
    showHead: "everyPage",
    theme: "grid",
    columnStyles: {
      0: { cellWidth: w0 },
      1: { cellWidth: w1 },
      2: { cellWidth: w2 },
      3: { cellWidth: w3, halign: "right" },
      4: { cellWidth: w4 },
    },
    styles: {
      font: "NotoSansSC",
      fontSize: 9.6,
      cellPadding: 1.9,
      lineWidth: 0.1,
      valign: "top",
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: 20,
      fontStyle: "normal",
      lineWidth: 0.1,
    },
  });

  const tableEndY = (doc as any).lastAutoTable?.finalY ?? y;
  y = Math.max(y + imgH, tableEndY) + 12;

  /* ===== Bottom 3 boxes (✅ 입력값 그대로 출력) ===== */
  const bottomH = 44;
  y = ensure(y, bottomH);

  const bGap = 8;
  const bW = (contentW - bGap * 2) / 3;
  const titles = L.BOTTOM_TITLES;

  const bottomValues = [
    normalizeMultiline(d.workNotes),
    normalizeMultiline(d.qcPoints),
    normalizeMultiline(d.packingNotes),
  ];

  for (let i = 0; i < 3; i++) {
    const bx = margin + i * (bW + bGap);

    doc.setLineWidth(0.25);
    doc.setDrawColor(...COLORS.lineSoft);
    rrect(doc, bx, y, bW, bottomH, 3.0, "S");

    doc.setFillColor(...COLORS.grayFill);
    doc.rect(bx, y, bW, 10, "F");

    doc.setFontSize(11.2);
    doc.setTextColor(0);
    doc.text(titles[i], bx + 4, y + 7.1);

    doc.setDrawColor(140, 140, 140);
    doc.setLineWidth(0.15);
    for (let k = 0; k < 5; k++) {
      const ly = y + 16 + k * 6;
      doc.line(bx + 5, ly, bx + bW - 5, ly);
    }
    doc.setDrawColor(...COLORS.lineSoft);

    const raw = String(bottomValues[i] ?? "").trim();
    const textToPrint = raw || "-";

    doc.setFontSize(8.6);
    doc.setTextColor(60);

    const padX = 5;
    const textX = bx + padX;
    const textY = y + 15.8;
    const maxW = bW - padX * 2;

    const parts = textToPrint.split("\n");
    let lines: string[] = [];
    for (const p of parts) {
      const chunk = doc.splitTextToSize(p, maxW) as string[];
      lines = lines.concat(chunk.length ? chunk : [""]);
    }

    const maxLines = 6;
    if (lines.length > maxLines) lines = lines.slice(0, maxLines);

    doc.text(lines, textX, textY);
    doc.setTextColor(0);
  }

  return doc;
}

/** ---------- UI (언어 선택 버튼) ---------- */
function btnStyle(active: boolean): React.CSSProperties {
  return {
    padding: "8px 12px",
    borderRadius: 10,
    border: "1px solid rgba(0,0,0,0.12)",
    background: active ? "rgba(0,0,0,0.08)" : "white",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
  };
}

export default function WorkSheetPdfPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;

  const [lang, setLang] = React.useState<Lang>("en");
  const [msg, setMsg] = React.useState("Select language and generate PDF.");
  const [isWorking, setIsWorking] = React.useState(false);

  React.useEffect(() => {
    setLang(getLangFromUrl());
  }, []);

  async function generate(selected: Lang) {
    if (!id) return;

    try {
      setIsWorking(true);
      setMsg("Loading data...");
      const data = await fetchPdfData(id);

      setMsg("Building PDF...");
      const doc = await buildPdf(data, selected);

      const blob = doc.output("blob");
      const url = URL.createObjectURL(blob);
      window.location.href = url;
    } catch (e: any) {
      console.error(e);
      setMsg(`PDF ERROR: ${e?.message ?? String(e)}`);
    } finally {
      setIsWorking(false);
    }
  }

  function applyLang(next: Lang) {
    setLang(next);
    const base = window.location.pathname;
    router.replace(`${base}?lang=${next}`);
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto" }}>
      <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 10 }}>Work Sheet PDF</div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <button style={btnStyle(lang === "en")} onClick={() => applyLang("en")} disabled={isWorking}>
          EN
        </button>
        <button style={btnStyle(lang === "cn")} onClick={() => applyLang("cn")} disabled={isWorking}>
          中文
        </button>
        <button style={btnStyle(lang === "vn")} onClick={() => applyLang("vn")} disabled={isWorking}>
          VN
        </button>

        <div style={{ flex: 1 }} />

        <button
          style={{
            padding: "9px 14px",
            borderRadius: 12,
            border: "1px solid rgba(0,0,0,0.18)",
            background: isWorking ? "rgba(0,0,0,0.06)" : "black",
            color: isWorking ? "black" : "white",
            fontWeight: 800,
            fontSize: 13,
            cursor: isWorking ? "default" : "pointer",
          }}
          onClick={() => generate(lang)}
          disabled={isWorking}
        >
          {isWorking ? "Generating..." : "Generate PDF"}
        </button>
      </div>

      <div style={{ fontSize: 13, opacity: 0.8 }}>{msg}</div>

      <div style={{ marginTop: 10, fontSize: 12, opacity: 0.55 }}>
        Tip: You can also open directly with <b>?lang=en</b>, <b>?lang=cn</b>, <b>?lang=vn</b>
      </div>
    </div>
  );
}
