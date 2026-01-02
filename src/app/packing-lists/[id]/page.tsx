// src/app/packing-lists/[id]/page.tsx
"use client";

import * as React from "react";
import { useParams, useRouter, useSearchParams, } from "next/navigation";

import AppShell from "@/components/layout/AppShell";
import type { AppRole } from "@/config/menuConfig";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import jsPDF from "jspdf";
// @ts-ignore
import autoTable from "jspdf-autotable";

type DevRole = AppRole;

type PackingListHeader = {
  id: string;
  shipment_id: string | null;

  packing_list_no: string | null;
  packing_date: string | null;

  buyer_id: string | null;
  buyer_name: string | null;
  buyer_code: string | null;

  shipper_name: string | null;
  shipper_address: string | null;

  consignee_text: string | null;
  notify_party_text: string | null;

  shipping_origin_code: string | null;
  port_of_loading: string | null;

  destination: string | null; // legacy
  final_destination: string | null;

  etd: string | null;
  eta: string | null;

  memo: string | null;
  status: string | null;

  invoice_id?: string | null;
  invoice_no?: string | null;

  total_cartons: number | null;
  total_gw: number | null;
  total_nw: number | null;
  total_cbm?: number | null;

  is_deleted: boolean;
};

type PackingListLine = {
  id: string;
  packing_list_id: string;
  cbm_per_carton_text?: string; // CBM 입력용(소수점 입력 유지)

  po_no: string | null;
  style_no: string | null;
  description: string | null;

  carton_no_from: number | null;
  carton_no_to: number | null;

  cartons: number | null;
  qty: number | null; // Total Qty

  // per carton (USER INPUT)
  // ✅ UI는 기존대로 *_per_carton을 사용
  gw_per_carton: number | null;
  nw_per_carton: number | null;
  cbm_per_carton: number | null;

  // totals (computed)
  total_gw: number | null;
  total_nw: number | null;
  total_cbm: number | null;

  is_deleted: boolean;
};

type ShipmentLinkInvoice = {
  id: string;
  invoice_no: string | null;
  invoice_date: string | null;
  status: string | null;
};

function n(v: any, fallback = 0) {
  if (v === null || v === undefined || v === "") return fallback;
  const x = Number(v);
  return Number.isNaN(x) ? fallback : x;
}
function isDec4Input(s: string) {
  // 빈 값 허용, 정수/소수(소수점 이하 최대 4자리) 허용
  return /^(\d+(\.\d{0,4})?)?$/.test(s);
}

function toDec4Number(s: string): number | null {
  if (s === "" || s === ".") return null;
  const v = Number(s);
  if (Number.isNaN(v)) return null;
  return Math.round(v * 10000) / 10000;
}
function isEmptyNumber(v: any) {
  return v === null || v === undefined || v === "";
}
function s(v: any) {
  return (v ?? "").toString().trim();
}
function fmtDate10(d: string | null) {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d).slice(0, 10);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function fmt0(v: any) {
  const x = n(v, 0);
  const isInt = Math.abs(x - Math.round(x)) < 1e-9;
  return isInt
    ? Math.round(x).toLocaleString("en-US")
    : x.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
function fmt1(v: any) {
  return n(v, 0).toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}
function fmt3(v: any) {
  return n(v, 0).toLocaleString("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}
function fmtCbm(v: any) {
  const num = Number(v ?? 0);
  if (!Number.isFinite(num)) return "0";

  // 최대 4자리 반올림
  const rounded = Math.round(num * 10000) / 10000;

  // 불필요한 뒤 0 제거
  return String(rounded)
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
}

function keyOf(po?: string | null, style?: string | null) {
  return `${(po || "").trim()}|${(style || "").trim()}`.toUpperCase();
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

function fmtCartonRange(from?: any, to?: any) {
  const fRaw =
    from === null || from === undefined || from === "" ? "" : String(from).trim();
  const tRaw =
    to === null || to === undefined || to === "" ? "" : String(to).trim();
  if (!fRaw && !tRaw) return "";
  if (fRaw && !tRaw) return fRaw;
  if (!fRaw && tRaw) return tRaw;
  const f = Number(fRaw);
  const t = Number(tRaw);
  if (Number.isFinite(f) && Number.isFinite(t) && f === t) return String(f);
  return `${fRaw}-${tRaw}`;
}

// Shipment 전체 기준 C/T 자동 연속
function autoFillCartonNos(input: PackingListLine[]) {
  const next = input.map((l) => ({ ...l }));

  const idxs = next
    .map((_, i) => i)
    .filter((i) => !next[i].is_deleted)
    .sort((ia, ib) => {
      const a = next[ia];
      const b = next[ib];

      const apo = (a.po_no || "").trim();
      const bpo = (b.po_no || "").trim();
      const poCmp = apo.localeCompare(bpo, undefined, { numeric: true });
      if (poCmp !== 0) return poCmp;

      const af = isEmptyNumber(a.carton_no_from)
        ? Number.POSITIVE_INFINITY
        : n(a.carton_no_from, 0);
      const bf = isEmptyNumber(b.carton_no_from)
        ? Number.POSITIVE_INFINITY
        : n(b.carton_no_from, 0);
      if (af !== bf) return af - bf;

      const at = isEmptyNumber(a.carton_no_to)
        ? Number.POSITIVE_INFINITY
        : n(a.carton_no_to, 0);
      const bt = isEmptyNumber(b.carton_no_to)
        ? Number.POSITIVE_INFINITY
        : n(b.carton_no_to, 0);
      if (at !== bt) return at - bt;

      const asn = (a.style_no || "").toUpperCase();
      const bsn = (b.style_no || "").toUpperCase();
      if (asn !== bsn) return asn < bsn ? -1 : 1;

      const ad = (a.description || "").toUpperCase();
      const bd = (b.description || "").toUpperCase();
      if (ad !== bd) return ad < bd ? -1 : 1;

      return 0;
    });

  let cur = 1;
  for (const i of idxs) {
    const l = next[i];
    const cartons = Math.max(0, Math.floor(n(l.cartons, 0)));
    if (!cartons) continue;

    const hasFrom = !isEmptyNumber(l.carton_no_from);
    const hasTo = !isEmptyNumber(l.carton_no_to);

    if (!hasFrom && !hasTo) {
      l.carton_no_from = cur;
      l.carton_no_to = cur + cartons - 1;
      cur = (l.carton_no_to || cur) + 1;
      continue;
    }

    // 이미 입력되어 있으면 그 범위를 기준으로 다음 cur을 밀어줌
    const f = hasFrom ? n(l.carton_no_from, cur) : cur;
    const t = hasTo ? n(l.carton_no_to, f + cartons - 1) : f + cartons - 1;
    l.carton_no_from = f;
    l.carton_no_to = t;
    cur = t + 1;
  }

  return next;
}

function recomputeLine(l: PackingListLine): PackingListLine {
  const cartons = n(l.cartons, 0);
  const nwc = n(l.nw_per_carton, 0);
  const gwc = n(l.gw_per_carton, 0);
  const cbmc = n(l.cbm_per_carton, 0);

  return {
    ...l,
    total_nw: cartons * nwc,
    total_gw: cartons * gwc,
    total_cbm: cartons * cbmc,
  };
}

function groupByPoForPdf(lines: PackingListLine[]) {
  const map = new Map<string, PackingListLine[]>();
  for (const l of lines) {
    const po = s(l.po_no) || "-";
    if (!map.has(po)) map.set(po, []);
    map.get(po)!.push(l);
  }
  const poNos = Array.from(map.keys()).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  );
  return poNos.map((poNo) => {
    const ls = (map.get(poNo) || []).slice();
    ls.sort((a, b) => {
      // PO 안에서: carton_from → carton_to → style → desc
      const af = isEmptyNumber(a.carton_no_from)
        ? Number.POSITIVE_INFINITY
        : n(a.carton_no_from, 0);
      const bf = isEmptyNumber(b.carton_no_from)
        ? Number.POSITIVE_INFINITY
        : n(b.carton_no_from, 0);
      if (af !== bf) return af - bf;

      const at = isEmptyNumber(a.carton_no_to)
        ? Number.POSITIVE_INFINITY
        : n(a.carton_no_to, 0);
      const bt = isEmptyNumber(b.carton_no_to)
        ? Number.POSITIVE_INFINITY
        : n(b.carton_no_to, 0);
      if (at !== bt) return at - bt;

      const asn = s(a.style_no).toUpperCase();
      const bsn = s(b.style_no).toUpperCase();
      if (asn !== bsn) return asn < bsn ? -1 : 1;

      const ad = s(a.description).toUpperCase();
      const bd = s(b.description).toUpperCase();
      if (ad !== bd) return ad < bd ? -1 : 1;

      return 0;
    });

    return { poNo, lines: ls };
  });
}

/** ✅ 서버(GET)에서 per 키가 *_per_ctn 으로 와도 UI에 채우기 위한 헬퍼 */
function pickPerValue(r: any, base: "gw" | "nw" | "cbm"): number | null {
  const a = r?.[`${base}_per_carton`];
  if (a !== null && a !== undefined && a !== "") return n(a, 0);

  const b = r?.[`${base}_per_ctn`];
  if (b !== null && b !== undefined && b !== "") return n(b, 0);

  // 혹시 다른 이름 변형
  const c = r?.[`${base}_per_cartons`];
  if (c !== null && c !== undefined && c !== "") return n(c, 0);

  return null;
}

export default function PackingListDetailPage() {
  const role: DevRole = "dev";
  const params = useParams<{ id: string }>();
  const id = params?.id as string;
  const router = useRouter();

  const searchParams = useSearchParams();
  const printedRef = React.useRef(false);

  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const [header, setHeader] = React.useState<PackingListHeader | null>(null);
  const [lines, setLines] = React.useState<PackingListLine[]>([]);
  const [invoiceLink, setInvoiceLink] = React.useState<ShipmentLinkInvoice | null>(
    null
  );

  // split LAST CTN
  const [splitOpen, setSplitOpen] = React.useState(false);
  const [splitIndex, setSplitIndex] = React.useState<number | null>(null);
  const [splitLastQty, setSplitLastQty] = React.useState("");
  const [splitLastGW, setSplitLastGW] = React.useState("");
  const [splitLastNW, setSplitLastNW] = React.useState("");
  const [splitLastCBM, setSplitLastCBM] = React.useState("");

  const totals = React.useMemo(() => {
    const alive = lines.filter((l) => !l.is_deleted).map(recomputeLine);
    const totalCartons = alive.reduce((s, l) => s + n(l.cartons, 0), 0);
    const totalQty = alive.reduce((s, l) => s + n(l.qty, 0), 0);
    const totalNW = alive.reduce((s, l) => s + n(l.total_nw, 0), 0);
    const totalGW = alive.reduce((s, l) => s + n(l.total_gw, 0), 0);
    const totalCBM = alive.reduce((s, l) => s + n(l.total_cbm, 0), 0);
    return { totalCartons, totalQty, totalNW, totalGW, totalCBM };
  }, [lines]);

  const load = React.useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      // packing list
      const res = await fetch(`/api/packing-lists/${id}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json?.success)
        throw new Error(json?.error || "Failed to load packing list.");

      const h: PackingListHeader = json.header;

      // ✅ 핵심 수정: 서버가 *_per_ctn 으로 주더라도 UI의 *_per_carton 에 채워 넣는다
      const ls: PackingListLine[] = (json.lines || []).map((r: any) =>
        recomputeLine({
          id: r.id,
          packing_list_id: r.packing_list_id ?? id,

          po_no: r.po_no ?? null,
          style_no: r.style_no ?? null,
          description: r.description ?? null,

          carton_no_from: r.carton_no_from ?? r.ct_no_from ?? null,
          carton_no_to: r.carton_no_to ?? r.ct_no_to ?? null,

          cartons: r.cartons ?? null,
          qty: r.qty ?? null,

          // ✅ 여기!
          gw_per_carton: pickPerValue(r, "gw"),
          nw_per_carton: pickPerValue(r, "nw"),
          cbm_per_carton: pickPerValue(r, "cbm"),

          // totals (혹시 서버가 미리 줘도 recompute가 다시 계산)
          total_gw: r.total_gw ?? null,
          total_nw: r.total_nw ?? null,
          total_cbm: r.total_cbm ?? null,

          is_deleted: !!r.is_deleted,
        })
      );

      setHeader(h);
      setLines(ls);

      // shipment invoice link (for Invoice No/Date on header)
      if (h?.shipment_id) {
        const sres = await fetch(`/api/shipments/${h.shipment_id}`, {
          cache: "no-store",
        });
        const sjson = await sres.json();
        if (sres.ok && sjson?.success) {
          setInvoiceLink(sjson?.links?.invoice ?? null);
        } else {
          setInvoiceLink(null);
        }
      } else {
        setInvoiceLink(null);
      }
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e?.message || "Load failed");
    } finally {
      setLoading(false);
    }
  }, [id]);

  React.useEffect(() => {
    load();
  }, [load]);

  const onHeaderChange = (patch: Partial<PackingListHeader>) => {
    setHeader((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const onLineChange = (idx: number, patch: Partial<PackingListLine>) => {
    setLines((prev) => {
      const next = prev.slice();
      next[idx] = recomputeLine({ ...next[idx], ...patch });
      return next;
    });
  };

  const handleSave = React.useCallback(async () => {
    if (!header) return;
    setSaving(true);
    try {
      const normalized = lines
        .map((l) => recomputeLine(l))
        .map((l) => {
          const gw = l.gw_per_carton;
          const nw = l.nw_per_carton;
          const cbm = l.cbm_per_carton;

          return {
            ...l,
            cartons: n(l.cartons, 0),
            qty: n(l.qty, 0),

            // ✅ UI는 *_per_carton을 유지하지만,
            // ✅ 서버/DB는 *_per_ctn 을 기대하는 경우가 많아서 "둘 다" 보낸다.
            gw_per_carton: gw === null || gw === undefined || gw === "" ? null : n(gw, 0),
            nw_per_carton: nw === null || nw === undefined || nw === "" ? null : n(nw, 0),
            cbm_per_carton: cbm === null || cbm === undefined || cbm === "" ? null : n(cbm, 0),

            // ✅ 서버용 alias
            gw_per_ctn: gw === null || gw === undefined || gw === "" ? null : n(gw, 0),
            nw_per_ctn: nw === null || nw === undefined || nw === "" ? null : n(nw, 0),
            cbm_per_ctn: cbm === null || cbm === undefined || cbm === "" ? null : n(cbm, 0),

            total_gw: n(l.total_gw, 0),
            total_nw: n(l.total_nw, 0),
            total_cbm: n(l.total_cbm, 0),
          };
        });

      const body = {
        header: {
          ...header,
          total_cartons: totals.totalCartons,
          total_gw: totals.totalGW,
          total_nw: totals.totalNW,
          total_cbm: totals.totalCBM,
          // invoice_no/date는 화면표시용 링크에서 가져오고,
          // DB 저장은 기존 로직(Invoice→PackingList 생성 시 복사) 유지
        },
        lines: normalized,
      };

      const res = await fetch(`/api/packing-lists/${header.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.error || "Save failed.");

      setHeader(json.header);

      setLines((prev) => prev.map(recomputeLine));

      alert("Saved.");
    } catch (e: any) {
      console.error(e);
      alert(e?.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  }, [header, lines, totals]);

  const openSplitDialog = (idx: number) => {
    const l = lines[idx];
    if (!l) return;

    setSplitIndex(idx);
    setSplitLastQty(
      String(
        Math.max(
          0,
          Math.floor(n(l.qty, 0) / Math.max(1, Math.floor(n(l.cartons, 1))))
        )
      )
    );
    setSplitLastGW(String(n(l.gw_per_carton, 0)));
    setSplitLastNW(String(n(l.nw_per_carton, 0)));
    setSplitLastCBM(String(n(l.cbm_per_carton, 0)));
    setSplitOpen(true);
  };

  const applySplitLastCarton = () => {
    if (splitIndex === null) return;
    const base = lines[splitIndex];
    if (!base) return;

    const cartons = Math.max(1, Math.floor(n(base.cartons, 0)));
    if (cartons <= 1) {
      alert("Cartons must be >= 2 to split LAST CTN.");
      return;
    }

    const baseFrom = isEmptyNumber(base.carton_no_from) ? null : n(base.carton_no_from, 0);
    const baseTo = isEmptyNumber(base.carton_no_to) ? null : n(base.carton_no_to, 0);

    if (!baseFrom || !baseTo || baseTo - baseFrom + 1 !== cartons) {
      alert("Please set C/T No range correctly (Auto C/T No first), then split.");
      return;
    }

    const lastFrom = baseTo;
    const lastTo = baseTo;

    const firstFrom = baseFrom;
    const firstTo = baseTo - 1;

    const firstCartons = cartons - 1;
    const lastCartons = 1;

    const newLastQty = n(splitLastQty, 0);
    const newLastGW = n(splitLastGW, 0);
    const newLastNW = n(splitLastNW, 0);
    const newLastCBM = n(splitLastCBM, 0);

    const firstLine: PackingListLine = recomputeLine({
      ...base,
      carton_no_from: firstFrom,
      carton_no_to: firstTo,
      cartons: firstCartons,
      description: s(base.description),
    });

    const lastLine: PackingListLine = recomputeLine({
      ...base,
      id: `${base.id}__LAST`,
      carton_no_from: lastFrom,
      carton_no_to: lastTo,
      cartons: lastCartons,
      qty: newLastQty,
      gw_per_carton: newLastGW,
      nw_per_carton: newLastNW,
      cbm_per_carton: newLastCBM,
      description: `${s(base.description)} (LAST CTN)`.trim(),
    });

    setLines((prev) => {
      const next = prev.slice();
      next[splitIndex] = firstLine;
      next.splice(splitIndex + 1, 0, lastLine);
      return next;
    });

    setSplitOpen(false);
  };

  // ===== PDF (Commercial Invoice 헤더/서명과 “픽셀 1:1” 구조 유지)
  const handlePdf = React.useCallback(async (autoPrint: boolean = false) => {
    if (!header) return;

    setExporting(true);
    try {
      const doc = new jsPDF("p", "mm", "a4");
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();

      const marginX = 10;
      const fullW = pageW - marginX * 2;
      const halfW = fullW / 2;

      let y = 14;

      // Title
      doc.setFontSize(20);
      doc.setFont("helvetica", "bold");
      doc.text("PACKING LIST", pageW / 2, y, { align: "center" });
      y += 12;

      // Buyer line
      doc.setFontSize(13);
      doc.setFont("helvetica", "normal");
      doc.text(`Buyer: ${header.buyer_name || "-"}`, marginX, y);
      y += 8;

      // ===== Header Boxes helpers (Invoice 스타일)
      const bodyFont = 9;
      const padX = 2;
      const padY = 2;
      const lh = 4.2;

      function drawBox(x: number, y0: number, w: number, h: number) {
        doc.rect(x, y0, w, h);
      }
      function drawBoxTitle(x: number, y0: number, title: string) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(bodyFont);
        doc.text(title, x + padX, y0 + padY + lh);
      }
      function drawBoxText(x: number, y0: number, w: number, title: string, text: string) {
        drawBoxTitle(x, y0, title);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(bodyFont);
        const lines = doc.splitTextToSize(text || "-", w - padX * 2);
        doc.text(lines, x + padX, y0 + padY + lh * 2);
      }
      function drawKeyValues(
        x: number,
        y0: number,
        w: number,
        title: string,
        pairs: { k: string; v: string }[]
      ) {
        drawBoxTitle(x, y0, title);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(bodyFont);

        let yy = y0 + padY + lh * 2;
        for (const p of pairs) {
          doc.text(`${p.k}: ${p.v}`, x + padX, yy);
          yy += lh;
        }
      }

      const shipperName = s(header.shipper_name || "JM International Co.Ltd");
      const shipperAddr = s(header.shipper_address || "");
      const shipperText = shipperAddr ? `${shipperName}\n${shipperAddr}` : shipperName;

      const consigneeText = s(header.consignee_text || "-");
      const notifyText = s(header.notify_party_text || "-");

      const packingNo = header.packing_list_no || "-";
      const packingDate = fmtDate10(header.packing_date) || "-";

      const invNo = s((header as any).invoice_no) || s(invoiceLink?.invoice_no) || "-";
      const invDate =
        fmtDate10((header as any).invoice_date ?? null) ||
        fmtDate10(invoiceLink?.invoice_date || null) ||
        "-";

      const topH = 28;
      const row2H = 30;

      const originCode = s(header.shipping_origin_code || "");
      const cooText =
        (s((header as any).coo_text) || originCodeToCooText(originCode) || "-").trim();
      const pol = s(header.port_of_loading || "");
      const fd = s(header.final_destination || "");

      const cooTextLines = doc.splitTextToSize(
        [cooText, pol ? `Port of Loading: ${pol}` : "", fd ? `Final Destination: ${fd}` : ""]
          .filter(Boolean)
          .join("\n"),
        fullW - padX * 2
      );
      const minCooH = 26;
      const cooH = Math.max(minCooH, (cooTextLines.length + 0) * lh + 4);

      // --- Row 1
      drawBox(marginX, y, halfW, topH);
      drawBox(marginX + halfW, y, halfW, topH);
      drawBoxText(marginX, y, halfW, "Shipper / Exporter", shipperText || "-");
      drawKeyValues(marginX + halfW, y, halfW, "Packing List Info", [
        { k: "Packing List No", v: packingNo },
        { k: "Packing Date", v: packingDate },
        { k: "Invoice No", v: invNo },
        { k: "Invoice Date", v: invDate },
      ]);
      y += topH;

      // --- Row 2
      drawBox(marginX, y, halfW, row2H);
      drawBox(marginX + halfW, y, halfW, row2H);
      drawBoxText(marginX, y, halfW, "Consignee", consigneeText || "-");
      drawBoxText(marginX + halfW, y, halfW, "Notify Party", notifyText || "-");
      y += row2H;

      // --- Row 3
      drawBox(marginX, y, fullW, cooH);
      drawBoxTitle(marginX, y, "COO / Certification");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(bodyFont);
      doc.text(cooTextLines.length ? cooTextLines : ["-"], marginX + padX, y + padY + lh * 2);
      y += cooH + 6;

      const alive = lines.filter((l) => !l.is_deleted).map(recomputeLine);
      const groups = groupByPoForPdf(alive);

      const head = [[
        "C/T No",
        "PO #",
        "Style #",
        "Description",
        "Cartons",
        "Qty(Total)",
        "NW/CTN",
        "GW/CTN",
        "CBM/CTN",
        "Total NW",
        "Total GW",
        "Total CBM",
      ]];

      const body: any[] = [];
      for (const g of groups) {
        body.push([
          { content: `PO# ${g.poNo}`, colSpan: head[0].length, styles: { fontStyle: "bold", halign: "left" } },
        ]);

        for (const l of g.lines) {
          const cartons = n(l.cartons, 0);
          const nwc = n(l.nw_per_carton, 0);
          const gwc = n(l.gw_per_carton, 0);
          const cbmc = n(l.cbm_per_carton, 0);

          const ctNo = fmtCartonRange(l.carton_no_from, l.carton_no_to);

          const desc = s(l.description);
          const isLast = desc.toUpperCase().includes("LAST CTN");
          const cleanDesc = isLast ? desc.replace(/\s*\(LAST CTN\)\s*/i, "").trim() : desc;

          body.push([
            ctNo,
            s(l.po_no),
            s(l.style_no),
            cleanDesc,
            fmt0(cartons),
            fmt0(l.qty),
            fmt1(nwc),
            fmt1(gwc),
            fmt3(cbmc),
            fmt1(cartons * nwc),
            fmt1(cartons * gwc),
            fmt3(cartons * cbmc),
          ]);
        }
      }

      autoTable(doc, {
        startY: y,
        head,
        body,
        margin: { left: marginX, right: marginX },
        theme: "grid",
        styles: { fontSize: 8, cellPadding: 2, lineWidth: 0.1, valign: "middle" },
        headStyles: { fillColor: [240, 240, 240], textColor: 0, fontStyle: "bold" },
        columnStyles: {
          0: { halign: "center" },
          3: { halign: "left" },
          4: { halign: "right" },
          5: { halign: "right" },
          6: { halign: "right" },
          7: { halign: "right" },
          8: { halign: "right" },
          9: { halign: "right" },
          10: { halign: "right" },
          11: { halign: "right" },
        },
      });

      const lastY = ((doc as any).lastAutoTable?.finalY ?? y + 40) + 10;

      let tY = lastY;
      if (tY > pageH - 60) {
        doc.addPage();
        tY = marginX;
      }

      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text("Totals", marginX, tY);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      doc.text(`Total Cartons: ${fmt0(totals.totalCartons)}`, marginX, tY + 10);
      doc.text(`Total Qty: ${fmt0(totals.totalQty)}`, marginX + 70, tY + 10);
      doc.text(`Total N.W.: ${fmt1(totals.totalNW)}`, marginX, tY + 18);
      doc.text(`Total G.W.: ${fmt1(totals.totalGW)}`, marginX + 70, tY + 18);
      doc.text(`Total CBM: ${fmt3(totals.totalCBM)}`, marginX, tY + 26);

      const memo = s(header.memo);
      let afterTotalsY = tY + 34;

      if (memo) {
        if (afterTotalsY > pageH - 60) {
          doc.addPage();
          afterTotalsY = marginX;
        }
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.text("Remarks", marginX, afterTotalsY);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        const memoLines = doc.splitTextToSize(memo, fullW);
        doc.text(memoLines, marginX, afterTotalsY + 6);

        afterTotalsY += 6 + memoLines.length * 4 + 6;
      }

      let stampY = afterTotalsY + 18;
      if (stampY > pageH - 55) {
        doc.addPage();
        stampY = 40;
      }

      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      doc.text("Signed by", pageW - marginX, stampY - 4, { align: "right" });

      const stampImg = new Image();
      stampImg.src = "/images/jm_stamp_vn.jpg";

      await new Promise<void>((resolve, reject) => {
        stampImg.onload = () => resolve();
        stampImg.onerror = () => reject(new Error("Stamp image load error"));
      });

      const stampW = 60;
      const stampH = 30;
      const stampX = pageW - marginX - stampW;
      doc.addImage(stampImg, "JPEG", stampX, stampY, stampW, stampH);

      doc.setFontSize(11);
      doc.text("JM International Co.Ltd", pageW - marginX, stampY + stampH + 6, {
        align: "right",
      });

      const pageCount = doc.getNumberOfPages();
      doc.setFontSize(9);
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.text(`Page ${i} of ${pageCount}`, pageW / 2, pageH - 10, { align: "center" });
      }

      if (autoPrint) {
        // ✅ 새 탭에서 바로 열고 인쇄 다이얼로그 호출
        const url = doc.output("bloburl");
        const w = window.open(url, "_blank", "noopener,noreferrer");
        if (w) {
          // 일부 브라우저에서 load 타이밍 필요
          const tt = window.setInterval(() => {
            try {
              if (w.document?.readyState === "complete") {
                window.clearInterval(tt);
                w.focus();
                w.print();
              }
            } catch {
              // cross-origin일 수 있으니 안전하게 timeout fallback
              window.clearInterval(tt);
              w.focus();
              w.print();
            }
          }, 400);
          // 5초 후에도 안되면 그냥 print 호출
          window.setTimeout(() => {
            try {
              w.focus();
              w.print();
            } catch {}
          }, 2500);
        } else {
          // 팝업 차단 등: 다운로드로 fallback
          doc.save(`${packingNo}.pdf`);
        }
      } else {
        doc.save(`${packingNo}.pdf`);
      }
    } catch (e) {
      console.error(e);
      alert("Failed to export PDF.");
    } finally {
      setExporting(false);
    }
  }, [header, lines, totals, invoiceLink]);

  // ✅ Auto PDF/Print when opened with ?print=1 (open from list page)
  React.useEffect(() => {
    const p = searchParams?.get("print");
    if (p !== "1") return;
    if (loading) return;
    if (!header) return;
    if (printedRef.current) return;

    printedRef.current = true;

    const t = window.setTimeout(() => {
      handlePdf(true);
    }, 250);

    return () => window.clearTimeout(t);
  }, [searchParams, loading, header, lines, handlePdf]);

  if (loading) {
    return (
      <AppShell role={role}>
        <div className="p-6">Loading...</div>
      </AppShell>
    );
  }

  if (errorMsg || !header) {
    return (
      <AppShell role={role}>
        <div className="p-6 space-y-3">
          <div className="text-red-600">{errorMsg || "Failed to load packing list."}</div>
          <Button onClick={() => router.back()}>Back</Button>
        </div>
      </AppShell>
    );
  }

  const cooDisplay = originCodeToCooText(header.shipping_origin_code);

  return (
    <AppShell role={role}>
      <div className="p-6 space-y-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Packing List Detail</h1>
            <p className="text-muted-foreground text-sm">
              Default values (Qty / NW/CTN / GW/CTN) are imported from Shipment Lines.
            </p>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => router.back()}>
              Back
            </Button>
            <Button variant="outline" onClick={() => load()} disabled={saving || exporting}>
              Reload
            </Button>
            <Button
              variant="outline"
              onClick={() => setLines((prev) => autoFillCartonNos(prev))}
              disabled={saving || exporting || !!header.is_deleted}
            >
              Auto C/T No
            </Button>
            <Button onClick={handleSave} disabled={saving || exporting || !!header.is_deleted}>
              {saving ? "Saving..." : "Save"}
            </Button>
            <Button onClick={() => handlePdf(false)} disabled={exporting}>
              {exporting ? "PDF..." : "PDF / Print"}
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Header</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <Label>Packing List No</Label>
                <Input
                  value={header.packing_list_no || ""}
                  onChange={(e) => onHeaderChange({ packing_list_no: e.target.value })}
                />
              </div>
              <div>
                <Label>Packing Date</Label>
                <Input
                  type="date"
                  value={fmtDate10(header.packing_date)}
                  onChange={(e) => onHeaderChange({ packing_date: e.target.value || null })}
                />
              </div>
              <div>
                <Label>Buyer</Label>
                <Input
                  value={header.buyer_name || ""}
                  onChange={(e) => onHeaderChange({ buyer_name: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label>Shipper Name</Label>
                <Input
                  value={header.shipper_name || ""}
                  onChange={(e) => onHeaderChange({ shipper_name: e.target.value })}
                />
              </div>
              <div>
                <Label>Shipping Origin Code</Label>
                <Input
                  value={header.shipping_origin_code || ""}
                  onChange={(e) =>
                    onHeaderChange({ shipping_origin_code: e.target.value })
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label>Shipper Address</Label>
                <Textarea
                  value={header.shipper_address || ""}
                  onChange={(e) => onHeaderChange({ shipper_address: e.target.value })}
                  rows={4}
                />
              </div>
              <div className="space-y-3">
                <div>
                  <Label>Port of Loading</Label>
                  <Input
                    value={header.port_of_loading || ""}
                    onChange={(e) =>
                      onHeaderChange({ port_of_loading: e.target.value || null })
                    }
                  />
                </div>
                <div>
                  <Label>Final Destination</Label>
                  <Input
                    value={header.final_destination || ""}
                    onChange={(e) =>
                      onHeaderChange({ final_destination: e.target.value || null })
                    }
                  />
                </div>
                <div>
                  <Label>COO (display)</Label>
                  <Input value={cooDisplay} readOnly />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label>Consignee</Label>
                <Textarea
                  value={header.consignee_text || ""}
                  onChange={(e) => onHeaderChange({ consignee_text: e.target.value })}
                  rows={4}
                />
              </div>
              <div>
                <Label>Notify Party</Label>
                <Textarea
                  value={header.notify_party_text || ""}
                  onChange={(e) =>
                    onHeaderChange({ notify_party_text: e.target.value })
                  }
                  rows={4}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <Label>ETD</Label>
                <Input
                  type="date"
                  value={fmtDate10(header.etd)}
                  onChange={(e) => onHeaderChange({ etd: e.target.value || null })}
                />
              </div>
              <div>
                <Label>ETA</Label>
                <Input
                  type="date"
                  value={fmtDate10(header.eta)}
                  onChange={(e) => onHeaderChange({ eta: e.target.value || null })}
                />
              </div>
              <div className="md:col-span-2">
                <Label>Remarks</Label>
                <Input
                  value={header.memo || ""}
                  onChange={(e) => onHeaderChange({ memo: e.target.value })}
                />
              </div>
            </div>

            <Separator />

            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
              <div>
                <div className="text-muted-foreground">Total Cartons</div>
                <div className="font-semibold">{fmt0(totals.totalCartons)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Total Qty</div>
                <div className="font-semibold">{fmt0(totals.totalQty)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Total N.W.</div>
                <div className="font-semibold">{fmt1(totals.totalNW)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Total G.W.</div>
                <div className="font-semibold">{fmt1(totals.totalGW)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Total CBM</div>
                <div className="font-semibold">{fmt3(totals.totalCBM)}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Lines</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="overflow-auto border rounded-md">
              <table className="min-w-[1200px] w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-2 text-left">C/T No</th>
                    <th className="p-2 text-left">PO #</th>
                    <th className="p-2 text-left">Style #</th>
                    <th className="p-2 text-left">Description</th>
                    <th className="p-2 text-right">Cartons</th>
                    <th className="p-2 text-right">Qty</th>
                    <th className="p-2 text-right">NW/CTN</th>
                    <th className="p-2 text-right">GW/CTN</th>
                    <th className="p-2 text-right">CBM/CTN</th>
                    <th className="p-2 text-right">Total NW</th>
                    <th className="p-2 text-right">Total GW</th>
                    <th className="p-2 text-right">Total CBM</th>
                    <th className="p-2 text-center">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, idx) => {
                    const r = recomputeLine(l);
                    const ct = fmtCartonRange(r.carton_no_from, r.carton_no_to);
                    return (
                      <tr
                        key={`${l.id}_${idx}`}
                        className={l.is_deleted ? "opacity-40" : ""}
                      >
                        <td className="p-2">
                          <div className="flex gap-2">
                            <Input
                              className="w-[90px]"
                              value={isEmptyNumber(r.carton_no_from) ? "" : String(r.carton_no_from)}
                              onChange={(e) =>
                                onLineChange(idx, {
                                  carton_no_from: e.target.value === "" ? null : n(e.target.value, 0),
                                })
                              }
                            />
                            <Input
                              className="w-[90px]"
                              value={isEmptyNumber(r.carton_no_to) ? "" : String(r.carton_no_to)}
                              onChange={(e) =>
                                onLineChange(idx, {
                                  carton_no_to: e.target.value === "" ? null : n(e.target.value, 0),
                                })
                              }
                            />
                            <div className="text-xs text-muted-foreground self-center">
                              {ct}
                            </div>
                          </div>
                        </td>

                        <td className="p-2">{r.po_no}</td>
                        <td className="p-2">{r.style_no}</td>
                        <td className="p-2">{r.description}</td>

                        <td className="p-2 text-right">
                          <Input
                            className="w-[90px] text-right"
                            value={String(n(r.cartons, 0))}
                            onChange={(e) => onLineChange(idx, { cartons: n(e.target.value, 0) })}
                          />
                        </td>

                        <td className="p-2 text-right">
                          <Input
                            className="w-[90px] text-right"
                            value={String(n(r.qty, 0))}
                            onChange={(e) => onLineChange(idx, { qty: n(e.target.value, 0) })}
                          />
                        </td>

                        <td className="p-2 text-right">
                          <Input
                            className="w-[90px] text-right"
                            value={r.nw_per_carton === null ? "" : String(r.nw_per_carton)}
                            onChange={(e) =>
                              onLineChange(idx, {
                                nw_per_carton: e.target.value === "" ? null : n(e.target.value, 0),
                              })
                            }
                          />
                        </td>

                        <td className="p-2 text-right">
                          <Input
                            className="w-[90px] text-right"
                            value={r.gw_per_carton === null ? "" : String(r.gw_per_carton)}
                            onChange={(e) =>
                              onLineChange(idx, {
                                gw_per_carton: e.target.value === "" ? null : n(e.target.value, 0),
                              })
                            }
                          />
                        </td>

                        <td className="p-2 text-right">
                          <Input
                            className="w-[90px] text-right"
                            value={
                              r.cbm_per_carton_text ??
                              (r.cbm_per_carton === null ? "" : String(r.cbm_per_carton))
                            }
                            onChange={(e) => {
                              const v = e.target.value;

                              // 소수점 4자리까지 허용(입력 중간 상태 유지)
                              if (!/^(?:\d+(\.\d{0,4})?)?$/.test(v)) return;

                              const num =
                                v === "" || v === "."
                                  ? null
                                  : Number.isNaN(Number(v))
                                  ? null
                                  : Number(v);

                              onLineChange(idx, {
                                cbm_per_carton_text: v,
                                cbm_per_carton: num,
                              });
                            }}
                            onBlur={() => {
                              const v = (r.cbm_per_carton_text ?? "").trim();
                              const num =
                                v === "" || v === "."
                                  ? null
                                  : Number.isNaN(Number(v))
                                  ? null
                                  : Number(v);

                              if (num === null) {
                                onLineChange(idx, { cbm_per_carton: null, cbm_per_carton_text: "" });
                                return;
                              }

                              // ✅ 4자리 반올림 후 불필요한 뒤 0 제거 표시 (fmtCbm가 이미 위에 있음)
                              const normalized = fmtCbm(num);

                              onLineChange(idx, {
                                cbm_per_carton_text: normalized,
                                cbm_per_carton: Number(normalized), // 표시와 값 일치
                              });
                            }}
                          />
                        </td>

                        <td className="p-2 text-right">{fmt1(r.total_nw)}</td>
                        <td className="p-2 text-right">{fmt1(r.total_gw)}</td>
                        <td className="p-2 text-right">{fmtCbm(r.total_cbm)}</td>

                        <td className="p-2 text-center">
                          <div className="flex justify-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openSplitDialog(idx)}
                              disabled={saving || exporting || !!header.is_deleted}
                            >
                              Split LAST
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setLines((prev) => {
                                  const next = prev.slice();
                                  next[idx] = { ...next[idx], is_deleted: !next[idx].is_deleted };
                                  return next;
                                })
                              }
                              disabled={saving || exporting || !!header.is_deleted}
                            >
                              {l.is_deleted ? "Undo" : "Del"}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-muted-foreground">
              * CBM/CTN is user input. Total CBM is calculated as Cartons × CBM/CTN.
            </p>
          </CardContent>
        </Card>

        <Dialog open={splitOpen} onOpenChange={setSplitOpen}>
          <DialogContent className="sm:max-w-[520px]">
            <DialogHeader>
              <DialogTitle>Split Last Carton (LAST CTN)</DialogTitle>
              <DialogDescription>
                Use this only when the <b>last carton</b> has different quantity or
                weight/CBM. If it’s identical, you don’t need to split.
              </DialogDescription>
            </DialogHeader>

            {splitIndex !== null && lines[splitIndex] ? (
              <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <Label>Last Carton Qty</Label>
                    <Input value={splitLastQty} onChange={(e) => setSplitLastQty(e.target.value)} />
                  </div>
                  <div>
                    <Label>Last Carton GW/CTN</Label>
                    <Input value={splitLastGW} onChange={(e) => setSplitLastGW(e.target.value)} />
                  </div>
                  <div>
                    <Label>Last Carton NW/CTN</Label>
                    <Input value={splitLastNW} onChange={(e) => setSplitLastNW(e.target.value)} />
                  </div>
                  <div>
                    <Label>Last Carton CBM/CTN</Label>
                    <Input value={splitLastCBM} onChange={(e) => setSplitLastCBM(e.target.value)} />
                  </div>
                </div>
              </div>
            ) : null}

            <DialogFooter>
              <Button variant="outline" onClick={() => setSplitOpen(false)}>
                Cancel
              </Button>
              <Button onClick={applySplitLastCarton}>Apply</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
