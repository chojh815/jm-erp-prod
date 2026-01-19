// src/app/work-sheets/[id]/pdf/page.tsx
"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import NotoSansKRRegular from "@/pdf/fonts/NotoSansKR-Regular.base64";
import NotoSansSCRegular from "@/pdf/fonts/NotoSansSC-Regular.base64";

/**
 * ✅ A안: 기본은 vendor(가격 숨김)
 * - ?mode=vendor  (default)
 * - ?mode=internal  (Unit Cost / Amount 표시)
 *
 * ✅ 컬럼 정책
 * - Spec/Color 컬럼은 제거
 * - Color는 remarks에서 구분(사용자 요청)
 * - 표 헤더
 *   vendor  : Material / Labor | Qty | Remarks
 *   internal: Material / Labor | Qty | Unit Cost | Amount | Remarks
 */

type Mode = "vendor" | "internal";

type MaterialRow = {
  item?: string | null;
  qty?: string | number | null;
  unitCost?: string | number | null;
  amount?: string | number | null;
  remark?: string | null;
};

type PdfData = {
  wsNo?: string | null;
  poNo?: string | null;
  date?: string | null;

  brandDept?: string | null;
  shipMode?: string | null;

  /** Requested ship date from po_headers */
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

  // ✅ 협력사 공유용(완제품 단가 박스)
  vendorCurrency?: string | null;
  vendorUnitCostLocal?: number | string | null;

  /** Bottom notes from Work Sheet LINE(대표 라인 1개) */
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

const fmtMoney = (v: any) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return safe(v, "-");
  // WS 단가/금액은 소수점 4자리까지(필요시 조정)
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 4 });
};

function todayYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/**
 * ✅ note에서 QTY / UNIT_COST 추출 (예: "QTY=8.97, UNIT_COST=0.2, COLOR=GOLD")
 * - DB 구조가 흔들리는 구간을 note로 흡수
 */
function extractQtyFromNote(note: any): string | null {
  const s = toStr(note).trim();
  if (!s) return null;
  const m = s.match(/QTY\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)/i);
  return m?.[1] ?? null;
}
function extractUnitCostFromNote(note: any): string | null {
  const s = toStr(note).trim();
  if (!s) return null;
  const m = s.match(/UNIT[_\s-]*COST\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)/i);
  return m?.[1] ?? null;
}

/** note에서 QTY/UNIT_COST 토큰을 제거하고 remarks로 사용 */
function extractRemarksFromNote(note: any): string | null {
  let s = toStr(note).trim();
  if (!s) return null;

  // 토큰 제거
  s = s.replace(/QTY\s*[:=]\s*[0-9]+(?:\.[0-9]+)?/gi, "");
  s = s.replace(/UNIT[_\s-]*COST\s*[:=]\s*[0-9]+(?:\.[0-9]+)?/gi, "");

  // 잔여 구분자 정리
  s = s.replace(/[,\|;]+/g, " ").replace(/\s+/g, " ").trim();

  return s || null;
}

/** ---------- mode / lang from URL ---------- */
type Lang = "en" | "cn" | "vn";

function normalizeLang(raw: string | null | undefined): Lang {
  const v = String(raw || "").toLowerCase().trim();
  if (v === "cn" || v === "zh" || v === "zh-cn") return "cn";
  if (v === "vn" || v === "vi") return "vn";
  return "en";
}
function normalizeMode(raw: string | null | undefined): Mode {
  const v = String(raw || "").toLowerCase().trim();
  if (v === "internal") return "internal";
  return "vendor";
}
function getParamsFromUrl(): { lang: Lang; mode: Mode } {
  try {
    const sp = new URLSearchParams(window.location.search);
    return { lang: normalizeLang(sp.get("lang")), mode: normalizeMode(sp.get("mode")) };
  } catch {
    return { lang: "en", mode: "vendor" };
  }
}

/** ---------- API mapping ---------- */
function mapApiToPdfData(json: any): PdfData {
  const header = isObj(json?.header) ? json.header : {};
  const po = isObj(json?.po) ? json.po : {};
  const lines = Array.isArray(json?.lines) ? json.lines : [];

  // ✅ 대표 라인 선택: header.master_line_id(또는 유사 키) 우선
  const masterLineId =
    header?.master_line_id ??
    header?.masterLineId ??
    header?.master_line ??
    header?.masterLine ??
    null;

  const line0 =
    (masterLineId ? (lines ?? []).find((l: any) => l?.id === masterLineId) : null) ??
    (isObj(lines?.[0]) ? lines[0] : {});

  const wsNo = header?.work_sheet_no ?? header?.wsNo ?? header?.workSheetNo ?? null;
  const poNo = header?.po_no ?? po?.po_no ?? line0?.po_no ?? null;

  const brand = po?.buyer_brand_name ?? null;
  const dept = po?.buyer_dept_name ?? null;
  const brandDept = [toStr(brand).trim(), toStr(dept).trim()].filter(Boolean).join(" / ") || null;

  const shipMode = po?.ship_mode ?? null;

  const requestedShipDate =
    po?.requested_ship_date ?? po?.requestedShipDate ?? po?.req_ship_date ?? null;

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

  // ✅ 협력사 공유용(완제품 단가)
  // - 대표라인(line0)에 값이 없을 수 있으니, lines 전체에서 먼저 찾는다.
  const vendorLine =
    (lines ?? []).find((l: any) => {
      const cur = toStr(l?.vendor_currency ?? l?.vendorCurrency).trim();
      const cost = l?.vendor_unit_cost_local ?? l?.vendorUnitCostLocal;
      return cur !== "" || (cost !== null && cost !== undefined && toStr(cost).trim() !== "");
    }) ?? line0;

  const vendorCurrency =
    vendorLine?.vendor_currency ??
    vendorLine?.vendorCurrency ??
    line0?.vendor_currency ??
    line0?.vendorCurrency ??
    header?.vendor_currency ??
    header?.vendorCurrency ??
    null;

  const vendorUnitCostLocal =
    vendorLine?.vendor_unit_cost_local ??
    vendorLine?.vendorUnitCostLocal ??
    line0?.vendor_unit_cost_local ??
    line0?.vendorUnitCostLocal ??
    header?.vendor_unit_cost_local ??
    header?.vendorUnitCostLocal ??
    null;

  // ✅ Special Instructions(공통 주의사항)
  // - DB: work_sheet_headers.special_instructions
  // - 일부 구버전/alias는 general_notes/notes 로도 들어올 수 있으니 fallback 유지
  const instructions =
    header?.special_instructions ??
    header?.specialInstructions ??
    header?.general_notes ??
    header?.generalNotes ??
    header?.notes ??
    null;

  // ✅ bottom notes: 반드시 line0에서 읽어야 함
  const workNotes =
    line0?.work_notes ??
    line0?.workNotes ??
    line0?.work_note ??
    line0?.workNote ??
    header?.work_notes ??
    header?.work_note ??
    header?.workNotes ??
    null;

  const qcPoints =
    line0?.qc_points ??
    line0?.qcPoints ??
    line0?.qc_note ??
    line0?.qcNote ??
    header?.qc_points ??
    header?.qc_note ??
    header?.qcPoints ??
    null;

  const packingNotes =
    line0?.packing_notes ??
    line0?.packingNotes ??
    line0?.packing_note ??
    line0?.packingNote ??
    header?.packing_notes ??
    header?.packing_note ??
    header?.packingNotes ??
    null;

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

  // ✅ Material/Labor: API 형태 흔들림 대비 fallback
  const mb = isObj(json?.materialsByLineId) ? json.materialsByLineId : {};
  const lineId = line0?.id;

  let materialsRaw: any[] = [];
  if (lineId && (mb as any)[lineId]) materialsRaw = (mb as any)[lineId];
  if ((!materialsRaw || materialsRaw.length === 0) && lineId && (mb as any)[String(lineId)]) {
    materialsRaw = (mb as any)[String(lineId)];
  }
  if ((!materialsRaw || materialsRaw.length === 0) && Array.isArray(json?.materials)) {
    materialsRaw = (json.materials as any[]).filter(
      (m: any) =>
        m?.work_sheet_line_id === lineId || m?.ws_line_id === lineId || m?.line_id === lineId
    );
  }
  if ((!materialsRaw || materialsRaw.length === 0) && Array.isArray(json?.material_specs)) {
    materialsRaw = (json.material_specs as any[]).filter(
      (m: any) =>
        m?.work_sheet_line_id === lineId || m?.ws_line_id === lineId || m?.line_id === lineId
    );
  }
  if ((!materialsRaw || materialsRaw.length === 0) && isObj(mb)) {
    const firstKey = Object.keys(mb as any).find(
      (k) => Array.isArray((mb as any)[k]) && (mb as any)[k].length > 0
    );
    if (firstKey) materialsRaw = (mb as any)[firstKey];
  }

  /**
   * ✅ 핵심:
   * - work_sheet_material_specs에 qty/unit_cost가 없을 수 있으니 note에서 추출
   * - amount = qty * unitCost (둘 다 숫자일 때만)
   * - remarks = note에서 QTY/UNIT_COST 제거한 나머지(색상 포함)
   */
  const materials: MaterialRow[] = Array.isArray(materialsRaw)
    ? materialsRaw
        .filter((m: any) => !m?.is_deleted)
        .map((m: any) => {
          const noteText = m?.note ?? m?.remark ?? m?.remarks ?? null;

          const qtyFromNote = extractQtyFromNote(noteText);
          const unitCostFromNote = extractUnitCostFromNote(noteText);
          const remarksFromNote = extractRemarksFromNote(noteText);

          const q = qtyFromNote ?? m?.qty ?? null;
          const u = unitCostFromNote ?? m?.unit_cost ?? m?.unitCost ?? null;

          const qn = Number(q);
          const un = Number(u);
          const amount = Number.isFinite(qn) && Number.isFinite(un) ? qn * un : null;

          return {
            item: m?.material_name ?? m?.item ?? m?.material ?? m?.name ?? null,
            qty: q,
            unitCost: u,
            amount,
            remark: remarksFromNote ?? m?.remark_text ?? m?.remark ?? m?.remarks ?? null,
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

    vendorCurrency,
    vendorUnitCostLocal,

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

/** ---------- jsPDF font embed ---------- */
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
  grayFill: [245, 245, 245] as [number, number, number],
  lineSoft: [120, 120, 120] as [number, number, number],
  label: [140, 140, 140] as [number, number, number],
};

function rrect(doc: jsPDF, x: number, y: number, w: number, h: number, r = 2.2, style?: "S" | "F" | "DF") {
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

  const labelW = Math.min(16, Math.max(9.5, ...rows.map(([lab]) => doc.getTextWidth(String(lab || "")) + 1.8)));
  const lineH = 4.9;
  let cy = y + topBarH + headerH + 6.4;
  const maxBodyY = y + h - 3;

  const PO_SHIFT = -8;

  const ellipsize = (s: string, maxW: number) => {
    const ell = "…";
    if (doc.getTextWidth(s) <= maxW) return s;
    let t = s;
    while (t.length > 0 && doc.getTextWidth(t + ell) > maxW) t = t.slice(0, -1);
    return (t || "").trim() ? t + ell : ell;
  };

  for (const [lab, valRaw] of rows) {
    const val = safe(valRaw);

    const isPoRow = String(lab || "").trim().toLowerCase() === "po:";

    doc.setTextColor(...COLORS.label);
    doc.text(lab, x + padX, cy);

    doc.setTextColor(0);

    const valueX = x + padX + labelW + (isPoRow ? PO_SHIFT : 0);
    const baseMaxW = w - padX - padX - labelW;
    const maxW = isPoRow ? baseMaxW + Math.max(0, -PO_SHIFT) : baseMaxW;

    let lines: string[] = [];
    if (isPoRow) {
      const raw = String(val || "");
      lines = [doc.getTextWidth(raw) > maxW ? ellipsize(raw, maxW) : raw];
    } else {
      lines = doc.splitTextToSize(val, maxW) as string[];
    }

    const remainH = maxBodyY - cy;
    const allowLines = Math.max(1, Math.floor(remainH / lineH));
    if (lines.length > allowLines) {
      lines = lines.slice(0, allowLines);
      lines[allowLines - 1] = ellipsize(lines[allowLines - 1], maxW);
    }

    doc.text(lines, valueX, cy);

    cy += lineH * Math.max(1, lines.length);
    if (cy > maxBodyY) break;
  }

  doc.setTextColor(0);
}

function t(lang: Lang, mode: Mode) {
  const vendorHead = {
    en: ["Material / Labor", "Qty", "Remarks"],
    cn: ["材料/工序", "数量", "备注"],
    vn: ["Vật liệu / Công đoạn", "Số lượng", "Ghi chú"],
  } as const;

  const internalHead = {
    en: ["Material / Labor", "Qty", "Unit Cost", "Amount", "Remarks"],
    cn: ["材料/工序", "数量", "单价", "金额", "备注"],
    vn: ["Vật liệu / Công đoạn", "Số lượng", "Đơn giá", "Thành tiền", "Ghi chú"],
  } as const;

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
      // NOTE: internalHead/vendorHead are defined as readonly tuples (as const).
      // jsPDF/autoTable wants a mutable string[] at runtime, so we materialize a new array.
      TABLE_HEAD: [...(mode === "internal" ? internalHead.en : vendorHead.en)],
      NO_MATS: "No material specs",
      BOTTOM_TITLES: ["Work", "QC", "Packing"],
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
      TABLE_HEAD: [...(mode === "internal" ? internalHead.cn : vendorHead.cn)],
      NO_MATS: "无材料明细",
      BOTTOM_TITLES: ["生产", "质检", "包装"],
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
      TABLE_HEAD: [...(mode === "internal" ? internalHead.vn : vendorHead.vn)],
      NO_MATS: "Không có danh mục vật liệu",
      BOTTOM_TITLES: ["Work", "QC", "Packing"],
    },
  } as const;

  return dict[lang];
}

function normalizeMultiline(v: any): string {
  return toStr(v).replace(/\r\n/g, "\n").trim();
}

async function buildPdf(d: PdfData, lang: Lang, mode: Mode) {
  const L = t(lang, mode);

  // jspdf-autotable head expects a mutable RowInput; i18n literals are readonly tuples.
  const tableHead: string[] = Array.isArray((L as any).TABLE_HEAD)
    ? Array.from((L as any).TABLE_HEAD as any[]).map((x) => String(x))
    : [];

  const doc = new jsPDF({ unit: "mm", format: "a4" });

  // ✅ CJK 폰트 내장(외부 fetch 의존 제거)
  // - Korean: NotoSansKR (한글)
  // - Chinese: NotoSansSC (중국어 간체)
  // 주의: jsPDF는 자동 폰트 fallback이 없어서, 섹션별로 setFont를 바꿔서 사용한다.
  (doc as any).addFileToVFS("NotoSansKR-Regular.ttf", String(NotoSansKRRegular).replace(/^\s+|\s+$/g, ""));
  (doc as any).addFont("NotoSansKR-Regular.ttf", "NotoSansKR", "normal");

  (doc as any).addFileToVFS("NotoSansSC-Regular.ttf", String(NotoSansSCRegular).replace(/^\s+|\s+$/g, ""));
  (doc as any).addFont("NotoSansSC-Regular.ttf", "NotoSansSC", "normal");

  // 기본은 한글 폰트로 (노트/라벨/헤더 대부분)
  doc.setFont(lang === "cn" ? "NotoSansSC" : "NotoSansKR", "normal");

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
  doc.text(`${L.QTY_PREFIX}: ${fmtQty(d.qty)} ${fmtUom(d.uom)}`, pageW - margin, 16, { align: "right" });

  doc.setDrawColor(65, 130, 210);
  doc.setLineWidth(0.6);
  doc.line(margin, 18.8, pageW - margin, 18.8);

  doc.setDrawColor(0, 0, 0);
  doc.setFontSize(10.2);
  doc.text(`${L.PO}: ${safe(d.poNo)}   |   ${L.WS}: ${safe(d.wsNo)}   |   ${L.DATE}: ${fmtDate(d.date)}`, margin, 23.5);

  // L.P (Local Price) - top right (avoid extra box pushing content)
  const lpCur = toStr(d.vendorCurrency).trim();
  const lpUnit = toStr(d.vendorUnitCostLocal).trim();
  if (lpCur && lpUnit) {
    const lpText = `L.P : ${lpCur} ${lpUnit}`;
    doc.text(lpText, pageW - margin, 23.5, { align: "right" });
  }

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

  y += outerH + 8;


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
    doc.text("No image", margin + imgW / 2, y + imgLabelH + (imgH - imgLabelH) / 2, { align: "center" });
    doc.setTextColor(0);
  }

  // Materials table
  const gap = 8;
  const tableX = margin + imgW + gap;
  const tableW = pageW - margin - tableX;

  const mats = Array.isArray(d.materials) ? d.materials : [];

  const bodyRows =
    mats.length > 0
      ? mats.map((m) => {
          const item = safe(m.item);
          const qty = safe(m.qty ?? "-");
          const remark = safe(m.remark ?? "-", "-");

          if (mode === "internal") {
            const unit = safe(m.unitCost ?? "-", "-");
            const amount = safe(m.amount ?? "-", "-");
            return [item, qty, fmtMoney(unit), fmtMoney(amount), remark];
          }

          // vendor default: 가격 숨김
          return [item, qty, remark];
        })
      : [
          mode === "internal"
            ? [L.NO_MATS, "-", "-", "-", "-"]
            : [L.NO_MATS, "-", "-"],
        ];

  // ✅ Total (internal only)
  const totalAmount =
    mode === "internal"
      ? mats.reduce((acc, m) => {
          const n = Number((m as any)?.amount);
          return Number.isFinite(n) ? acc + n : acc;
        }, 0)
      : 0;

  // Append TOTAL row for internal mode
  if (mode === "internal") {
    (bodyRows as any).push(["TOTAL", "", "", fmtMoney(totalAmount), ""]);
  }

  // column widths
  let colStyles: any = {};
  if (mode === "internal") {
    // ✅ widen Amount/Remarks so headers stay on one line
    const w0 = tableW * 0.40; // Material / Labor
    const w1 = tableW * 0.10; // Qty
    const w2 = tableW * 0.14; // Unit Cost
    const w3 = tableW * 0.16; // Amount
    const w4 = tableW * 0.20; // Remarks
    colStyles = {
      0: { cellWidth: w0 },
      1: { cellWidth: w1, halign: "right" },
      2: { cellWidth: w2, halign: "right" },
      3: { cellWidth: w3, halign: "right" },
      4: { cellWidth: w4 },
    };
  } else {
    const w0 = tableW * 0.62;
    const w1 = tableW * 0.13;
    const w2 = tableW * 0.25;
    colStyles = {
      0: { cellWidth: w0 },
      1: { cellWidth: w1, halign: "right" },
      2: { cellWidth: w2 },
    };
  }

  // Material / Labor 테이블은 중국어가 들어가는 경우가 많아서 중국어 폰트로 출력
  // ⚠️ jsPDF는 "bold" 스타일에 대해 별도 폰트(굵기)를 등록하지 않으면 내부적으로 다른 폰트로 fallback될 수 있고,
  // 그 과정에서 CJK(특히 중국어) 헤더 텍스트가 깨져 보일 수 있다.
  // 그래서 lang=cn에서는 테이블 헤더(headStyles)의 fontStyle을 "normal"로 강제해 깨짐을 방지한다.
  doc.setFont(lang === "cn" ? "NotoSansSC" : "NotoSansKR", "normal");
  autoTable(doc, {
    startY: y,
    margin: { left: tableX, right: margin, top: margin, bottom: margin },
    tableWidth: tableW,
    head: [tableHead],
    body: bodyRows,
    showHead: "everyPage",
    theme: "grid",
    columnStyles: colStyles,
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
      // 중국어 헤더는 bold 폰트 미등록 시 글자가 깨질 수 있어 normal로 고정
      fontStyle: lang === "cn" ? "normal" : "bold",
      fontSize: 9.2,
      halign: "center",
      valign: "middle",
      lineWidth: 0.1,
    },
    didParseCell: (data) => {
      // Highlight TOTAL row (internal only)
      if (mode === "internal" && data.section === "body") {
        const row = data.row?.raw as any[] | undefined;
        if (row && row[0] === "TOTAL") {
          // 중국어 모드에서는 bold가 깨질 수 있어 TOTAL도 normal 유지
          data.cell.styles.fontStyle = lang === "cn" ? "normal" : "bold";
          data.cell.styles.fillColor = [245, 245, 245];
          if (data.column.index === 0) data.cell.styles.halign = "left";
          if (data.column.index === 3) data.cell.styles.halign = "right";
        }
      }
    },

  });

  // 이후 섹션(노트/라벨)은 한글 폰트로 복귀
  doc.setFont(lang === "cn" ? "NotoSansSC" : "NotoSansKR", "normal");

  const tableEndY = (doc as any).lastAutoTable?.finalY ?? y;
  // ✅ pack bottom boxes closer to table (reduce page break risk)
  y = Math.max(y + imgH, tableEndY) + 4;

  /* ===== Bottom 3 boxes ===== */
  const bottomH = 44;
  // Try to keep bottom boxes on the same page if there is visually enough room.
  // 최소 간격(2mm)까지 줄여보고 그래도 안되면 다음 페이지로 넘김
  const minY = Math.max(y, (doc as any).lastAutoTable?.finalY ? ((doc as any).lastAutoTable.finalY + 2) : y);
  y = minY;
  if (y + bottomH > pageH - margin) {
    // still doesn't fit -> new page
    y = ensure(y, bottomH);
  }

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

/** ---------- UI ---------- */
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

  const [{ lang, mode }, setState] = React.useState<{ lang: Lang; mode: Mode }>({ lang: "en", mode: "vendor" });
  const [msg, setMsg] = React.useState("Select language and generate PDF.");
  const [isWorking, setIsWorking] = React.useState(false);

  React.useEffect(() => {
    setState(getParamsFromUrl());
  }, []);

  function apply(next: Partial<{ lang: Lang; mode: Mode }>) {
    const nextLang = next.lang ?? lang;
    const nextMode = next.mode ?? mode;
    setState({ lang: nextLang, mode: nextMode });
    const base = window.location.pathname;
    router.replace(`${base}?lang=${nextLang}&mode=${nextMode}`);
  }

  async function generate() {
    if (!id) return;

    try {
      setIsWorking(true);
      setMsg("Loading data...");
      const data = await fetchPdfData(id);

      setMsg("Building PDF...");
      const doc = await buildPdf(data, lang, mode);

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

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto" }}>
      <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 10 }}>Work Sheet PDF</div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <button style={btnStyle(lang === "en")} onClick={() => apply({ lang: "en" })} disabled={isWorking}>
          EN
        </button>
        <button style={btnStyle(lang === "cn")} onClick={() => apply({ lang: "cn" })} disabled={isWorking}>
          中文
        </button>
        <button style={btnStyle(lang === "vn")} onClick={() => apply({ lang: "vn" })} disabled={isWorking}>
          VN
        </button>

        <div style={{ width: 10 }} />

        <button style={btnStyle(mode === "vendor")} onClick={() => apply({ mode: "vendor" })} disabled={isWorking}>
          Vendor (Hide Price)
        </button>
        <button style={btnStyle(mode === "internal")} onClick={() => apply({ mode: "internal" })} disabled={isWorking}>
          Internal (Show Price)
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
          onClick={generate}
          disabled={isWorking}
        >
          {isWorking ? "Generating..." : "Generate PDF"}
        </button>
      </div>

      <div style={{ fontSize: 13, opacity: 0.8 }}>{msg}</div>

      </div>
  );
}
