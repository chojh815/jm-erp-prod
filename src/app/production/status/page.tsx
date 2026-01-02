"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Role = "viewer" | "staff" | "manager" | "admin";

type Row = {
  po_line_id: string;
  po_header_id: string | null;
  po_no: string | null;
  buyer_id: string | null;
  buyer_name: string | null;
  brand: string | null;
  ship_mode: string | null; // SEA/AIR/COURIER
  courier_carrier?: string | null; // FEDEX/DHL/UPS/...
  order_date?: string | null; // YYYY-MM-DD
  requested_ship_date?: string | null; // YYYY-MM-DD
  status?: string | null;
  style_no?: string | null;
  style?: string | null; // fallback
  qty?: number | null;
  unit_price_usd?: number | null;

  vendor_id?: string | null;
  vendor_name?: string | null;
  vendor?: string | null; // fallback

  // ADMIN only (server may omit for non-admin)
  unit_cost_usd?: number | null;
  work_sheet_id?: string | null;
};

function n(v: any, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function fmtDate(v?: string | null) {
  if (!v) return "";
  return v;
}
function fmtQty(v?: number | null) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "";
  return Number(v).toLocaleString();
}
function fmtPrice2(v?: number | null) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "";
  return Number(v).toFixed(2);
}
function fmtPct1(v?: number | null) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "";
  return Number(v).toFixed(1);
}

function nowStamp() {
  const d = new Date();
  // YYYY-MM-DD HH:mm:ss
  const pad = (nn: number) => String(nn).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function calcAmount(r: Row) {
  return n(r.qty) * n(r.unit_price_usd);
}

function calcTotalCost(r: Row) {
  return n(r.qty) * n((r as any).unit_cost_usd);
}

function calcMargin(r: Row) {
  const amount = calcAmount(r);
  const totalCost = calcTotalCost(r);
  const margin = amount - totalCost;
  const marginPct = amount > 0 ? (margin / amount) * 100 : 0;
  return { amount, totalCost, margin, marginPct };
}

function vendorLabel(r: Row) {
  return (r.vendor_name ?? r.vendor ?? "Unassigned") as string;
}
function buyerLabel(r: Row) {
  return (r.buyer_name ?? "Unassigned") as string;
}
function brandLabel(r: Row) {
  return (r.brand ?? "Unassigned") as string;
}

function marginClass(marginPct: number, marginAmount: number) {
  // 음수=빨강, 20%↓=주황
  if (marginAmount < 0) return "text-red-600";
  if (marginPct < 20) return "text-orange-600";
  return "text-slate-700";
}

function PoLink({ r }: { r: Row }) {
  const poNo = (r.po_no ?? "").toString().trim();

  // ✅ 실제 PO 상세 화면: /src/app/po/[id]/samples/page.tsx
  // 여기서 [id]는 PO No 를 사용함 (uuid po_header_id로 가면 404)
  if (poNo) {
    return (
      <Button asChild size="sm" variant="outline">
        <Link href={`/po/${encodeURIComponent(poNo)}/samples`} target="_blank" rel="noopener noreferrer">PO</Link>
      </Button>
    );
  }

  // fallback (po_no가 없을 때만)
  if (r.po_header_id) {
    return (
      <Button asChild size="sm" variant="outline">
        <Link href={`/po/list?id=${encodeURIComponent(r.po_header_id)}`} target="_blank" rel="noopener noreferrer">PO</Link>
      </Button>
    );
  }

  return (
    <Button size="sm" variant="outline" disabled>
      PO
    </Button>
  );
}

function WorkSheetLink({ r }: { r: Row }) {
  // work_sheet_id가 있으면 바로 이동
  const wsId = (r as any).work_sheet_id ?? null;
  if (wsId) {
    return (
      <Button asChild size="sm" variant="outline">
        <Link href={`/work-sheets/${wsId}`} target="_blank" rel="noopener noreferrer">WS</Link>
      </Button>
    );
  }
  // 없으면 생성/연결 흐름으로 (po_line_id 기반)
  if (r.po_line_id) {
    return (
      <Button asChild size="sm" variant="outline">
        <Link href={`/work-sheets/new?po_line_id=${encodeURIComponent(r.po_line_id)}`} target="_blank" rel="noopener noreferrer">
          WS
        </Link>
      </Button>
    );
  }
  return (
    <Button size="sm" variant="outline" disabled>
      WS
    </Button>
  );
}

export default function ProductionStatusPage() {
  const [role, setRole] = useState<Role>("viewer");

  // filters
  const [q, setQ] = useState("");
  const [shipMode, setShipMode] = useState<string>("ALL");
  const [carrier, setCarrier] = useState<string>("ALL");
  const [dateFrom, setDateFrom] = useState<string>(""); // YYYY-MM-DD
  const [dateTo, setDateTo] = useState<string>(""); // YYYY-MM-DD

  // pdf options
  const [pdfGroup, setPdfGroup] = useState<"none" | "vendor" | "ship_mode">(
    "none"
  );

  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [selectedVendor, setSelectedVendor] = useState<string | null>(null);
  const [selectedBuyer, setSelectedBuyer] = useState<string | null>(null);
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null);
  const [rankingTab, setRankingTab] = useState<"vendor" | "buyer" | "brand">("vendor");
  const listRef = useRef<HTMLDivElement | null>(null);

  const visibleRows = useMemo(() => {
    let out = rows;
    if (selectedVendor) out = out.filter((r) => vendorLabel(r) === selectedVendor);
    if (selectedBuyer) out = out.filter((r) => buyerLabel(r) === selectedBuyer);
    if (selectedBrand) out = out.filter((r) => brandLabel(r) === selectedBrand);
    return out;
  }, [rows, selectedVendor, selectedBuyer, selectedBrand]);


  const pickVendor = (v: string) => {
    setSelectedVendor((prev) => (prev === v ? null : v));
    setTimeout(() => {
      listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  const pickBuyer = (v: string) => {
    setSelectedBuyer((prev) => (prev === v ? null : v));
    setTimeout(() => {
      listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  const pickBrand = (v: string) => {
    setSelectedBrand((prev) => (prev === v ? null : v));
    setTimeout(() => {
      listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  const showUnitPrice = role !== "viewer";
  const showMargin = role === "admin"; // 관리자 전용

  // load role
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/me", { cache: "no-store" });
        const j = await r.json();
        if (j?.success && j?.user?.role) setRole(j.user.role);
      } catch {}
    })();
  }, []);

  const buildQuery = () => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (shipMode && shipMode !== "ALL") params.set("ship_mode", shipMode);
    if (carrier && carrier !== "ALL") params.set("courier_carrier", carrier);

    // ✅ API는 from/to를 기대 (업로드된 API 기준) :contentReference[oaicite:2]{index=2}
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);

    return params.toString();
  };

  const buildFiltersText = () => {
    const parts: string[] = [];
    if (q.trim()) parts.push(`Search: ${q.trim()}`);
    if (shipMode !== "ALL") parts.push(`Ship Mode: ${shipMode}`);
    if (carrier !== "ALL") parts.push(`Carrier: ${carrier}`);
    if (dateFrom) parts.push(`From: ${dateFrom}`);
    if (dateTo) parts.push(`To: ${dateTo}`);
    return parts.join(" | ");
  };

  const fetchList = async () => {
    setLoading(true);
    try {
      const qs = buildQuery();
      const url = "/api/production/status/list" + (qs ? `?${qs}` : "");
      const r = await fetch(url, {
        cache: "no-store",
        headers: {
          // API에서 admin 여부 판단용
          "x-role": role,
        },
      });
      const j = await r.json();
      if (j?.success) setRows(j.rows || []);
      else setRows([]);
    } catch (e) {
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  // initial + role change refetch (admin margin 필드 받기 위함)
  useEffect(() => {
    fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  const shipModeOptions = ["SEA", "AIR", "COURIER"];

  const courierCarrierOptions = useMemo(() => {
    const base = ["FEDEX", "DHL", "UPS"];
    const s = new Set<string>(base);
    visibleRows.forEach((r) => {
      if (r.courier_carrier) s.add(String(r.courier_carrier).toUpperCase());
    });
    return Array.from(s);
  }, [visibleRows]);

  const grouped = useMemo(() => {
    const keyOf = (r: Row) => {
      if (pdfGroup === "vendor") {
        return r.vendor_name ?? r.vendor ?? "Unassigned";
      }
      if (pdfGroup === "ship_mode") {
        return r.ship_mode ?? "Unspecified";
      }
      return "All";
    };

    const m = new Map<string, Row[]>();
    visibleRows.forEach((r) => {
      const k = keyOf(r);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    });

    const keys = Array.from(m.keys()).sort((a, b) => a.localeCompare(b));

    return keys.map((k) => {
      const rr = m.get(k)!;
      const subtotalQty = rr.reduce((s, r) => s + n(r.qty), 0);
      const subtotalAmount = rr.reduce((s, r) => s + calcAmount(r), 0);
      const subtotalCost = rr.reduce((s, r) => s + calcTotalCost(r), 0);
      const subtotalMargin = subtotalAmount - subtotalCost;
      const subtotalMarginPct =
        subtotalAmount > 0 ? (subtotalMargin / subtotalAmount) * 100 : 0;

      return {
        key: k,
        rows: rr,
        subtotalQty,
        subtotalAmount,
        subtotalCost,
        subtotalMargin,
        subtotalMarginPct,
      };
    });
  }, [visibleRows, pdfGroup]);

  const grand = useMemo(() => {
    const qty = visibleRows.reduce((s, r) => s + n(r.qty), 0);
    const amount = visibleRows.reduce((s, r) => s + calcAmount(r), 0);
    const cost = visibleRows.reduce((s, r) => s + calcTotalCost(r), 0);
    const margin = amount - cost;
    const marginPct = amount > 0 ? (margin / amount) * 100 : 0;
    return { qty, amount, cost, margin, marginPct };
  }, [rows]);

  // Vendor Margin Ranking (ADMIN only)
  const vendorRanking = useMemo(() => {
    if (!showMargin) return [];
    const map = new Map<string, { vendor: string; qty: number; amount: number; cost: number }>();
    visibleRows.forEach((r) => {
      const vendor = r.vendor_name ?? r.vendor ?? "Unassigned";
      if (!map.has(vendor)) map.set(vendor, { vendor, qty: 0, amount: 0, cost: 0 });
      const it = map.get(vendor)!;
      it.qty += n(r.qty);
      it.amount += calcAmount(r);
      it.cost += calcTotalCost(r);
    });

    const arr = Array.from(map.values()).map((v) => {
      const margin = v.amount - v.cost;
      const marginPct = v.amount > 0 ? (margin / v.amount) * 100 : 0;
      return { ...v, margin, marginPct };
    });

    // 기본: margin% desc, 동률이면 margin$ desc
    arr.sort((a, b) => {
      if (b.marginPct !== a.marginPct) return b.marginPct - a.marginPct;
      return b.margin - a.margin;
    });

    return arr;
  }, [visibleRows, showMargin]);

  const buyerRanking = useMemo(() => {
    if (!showMargin) return [];
    const map = new Map<string, { key: string; qty: number; amount: number; cost: number }>();
    visibleRows.forEach((r) => {
      const key = buyerLabel(r);
      if (!map.has(key)) map.set(key, { key, qty: 0, amount: 0, cost: 0 });
      const it = map.get(key)!;
      it.qty += n(r.qty);
      it.amount += calcAmount(r);
      it.cost += calcTotalCost(r);
    });

    const arr = Array.from(map.values()).map((v) => {
      const margin = v.amount - v.cost;
      const marginPct = v.amount > 0 ? (margin / v.amount) * 100 : 0;
      return { ...v, buyer: v.key, margin, marginPct };
    });

    arr.sort((a, b) => {
      if (b.marginPct !== a.marginPct) return b.marginPct - a.marginPct;
      return b.margin - a.margin;
    });

    return arr;
  }, [visibleRows, showMargin]);

  const brandRanking = useMemo(() => {
    if (!showMargin) return [];
    const map = new Map<string, { key: string; qty: number; amount: number; cost: number }>();
    visibleRows.forEach((r) => {
      const key = brandLabel(r);
      if (!map.has(key)) map.set(key, { key, qty: 0, amount: 0, cost: 0 });
      const it = map.get(key)!;
      it.qty += n(r.qty);
      it.amount += calcAmount(r);
      it.cost += calcTotalCost(r);
    });

    const arr = Array.from(map.values()).map((v) => {
      const margin = v.amount - v.cost;
      const marginPct = v.amount > 0 ? (margin / v.amount) * 100 : 0;
      return { ...v, brand: v.key, margin, marginPct };
    });

    arr.sort((a, b) => {
      if (b.marginPct !== a.marginPct) return b.marginPct - a.marginPct;
      return b.margin - a.margin;
    });

    return arr;
  }, [visibleRows, showMargin]);


  const exportPDF = async () => {
    setExporting(true);
    try {
      const doc = new jsPDF({
        orientation: "landscape",
        unit: "pt",
        format: "a4",
      });

      const printed = nowStamp();
      const filtersText = buildFiltersText();

      const margin = 36;
      const pageWidth = doc.internal.pageSize.getWidth();
      const tableWidth = pageWidth - margin * 2;

      const head: string[] = [
        "PO No",
        "Buyer",
        "Brand",
        "Vendor",
        "Ship Mode",
        "Order Date",
        "Req Ship Date",
        "Status",
        "Style",
      ];
      if (showUnitPrice) head.push("Unit Price (USD)");
      head.push("Qty");
      head.push("Amount (USD)");
      if (showMargin) {
        head.push("Unit Cost (USD)");
        head.push("Margin (USD)");
        head.push("Margin %");
      }

      const styleGray = { fillColor: [240, 240, 240] as any, fontStyle: "bold" as any };
      const styleGray2 = { fillColor: [228, 228, 228] as any, fontStyle: "bold" as any };

      const makeBody = (rr: Row[], subtotalLabel = "Subtotal") => {
        const body: any[] = rr.map((r) => {
          const style = r.style_no ?? r.style ?? "";
          const vendor = r.vendor_name ?? r.vendor ?? "";
          const amount = calcAmount(r);

          const base: any[] = [
            r.po_no ?? "",
            r.buyer_name ?? "",
            r.brand ?? "",
            vendor,
            r.ship_mode ?? "",
            fmtDate(r.order_date ?? null),
            fmtDate(r.requested_ship_date ?? null),
            r.status ?? "",
            style,
          ];
          if (showUnitPrice) base.push(fmtPrice2(r.unit_price_usd ?? null));
          base.push(fmtQty(r.qty ?? null));
          base.push(fmtPrice2(amount));

          if (showMargin) {
            const { margin, marginPct } = calcMargin(r);
            base.push(fmtPrice2((r as any).unit_cost_usd ?? null));
            base.push(fmtPrice2(margin));
            base.push(fmtPct1(marginPct));
          }
          return base;
        });

        // subtotal row (회색 배경 + bold)
        const sq = rr.reduce((s, r) => s + n(r.qty), 0);
        const sa = rr.reduce((s, r) => s + calcAmount(r), 0);
        const sc = rr.reduce((s, r) => s + calcTotalCost(r), 0);
        const sm = sa - sc;
        const smp = sa > 0 ? (sm / sa) * 100 : 0;

        const cols = head.length;
        const row: any[] = [];
        for (let i = 0; i < cols; i++) {
          row.push({ content: "", styles: styleGray });
        }

        // label on Status column (index 7)
        row[7] = { content: subtotalLabel, styles: styleGray };
        // qty index
        const idxQty = head.indexOf("Qty");
        const idxAmt = head.indexOf("Amount (USD)");
        row[idxQty] = { content: fmtQty(sq), styles: styleGray };
        row[idxAmt] = { content: fmtPrice2(sa), styles: styleGray };

        if (showMargin) {
          const idxMargin = head.indexOf("Margin (USD)");
          const idxPct = head.indexOf("Margin %");
          row[idxMargin] = { content: fmtPrice2(sm), styles: styleGray };
          row[idxPct] = { content: fmtPct1(smp), styles: styleGray };
        }

        body.push(row);
        return body;
      };

      let firstPage = true;

      for (const g of grouped) {
        if (!firstPage) doc.addPage();
        firstPage = false;

        doc.setFont("helvetica", "bold");
        doc.setFontSize(22);
        doc.text("Production Status", margin, 48);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(11);
        doc.text(`Printed: ${printed}`, margin, 68);

        let y = 86;

        if (filtersText) {
          doc.setFontSize(10);
          doc.text(filtersText, margin, y);
          y += 14;
        }

        if (pdfGroup !== "none") {
          doc.setFont("helvetica", "bold");
          doc.setFontSize(12);
          doc.text(
            `${pdfGroup === "vendor" ? "Vendor" : "Ship Mode"}: ${g.key}`,
            margin,
            y
          );
          y += 14;
          doc.setFont("helvetica", "normal");
        }

        autoTable(doc, {
          startY: y,
          margin: { left: margin, right: margin },
          tableWidth,
          head: [head],
          body: makeBody(g.rows, "Subtotal"),
          styles: {
            font: "helvetica",
            fontSize: 9.5,
            cellPadding: 6,
            overflow: "linebreak",
            valign: "middle",
          },
          headStyles: {
            fillColor: [245, 247, 250],
            textColor: [0, 0, 0],
            fontStyle: "bold",
            halign: "center",
          },
          columnStyles: (() => {
            const cs: any = {};
            for (let i = 0; i < head.length; i++) cs[i] = { halign: "center" };
            cs[head.indexOf("Buyer")] = { halign: "left" };
            cs[head.indexOf("Vendor")] = { halign: "left" };

            const idxUnit = showUnitPrice ? head.indexOf("Unit Price (USD)") : -1;
            if (idxUnit >= 0) cs[idxUnit] = { halign: "right" };

            cs[head.indexOf("Qty")] = { halign: "right" };
            cs[head.indexOf("Amount (USD)")] = { halign: "right" };

            if (showMargin) {
              cs[head.indexOf("Unit Cost (USD)")] = { halign: "right" };
              cs[head.indexOf("Margin (USD)")] = { halign: "right" };
              cs[head.indexOf("Margin %")] = { halign: "right" };
            }
            return cs;
          })(),
          didParseCell: (data) => {
            // ✅ Margin 기준 색상 (음수=빨강, 20%↓=주황) - PDF
            if (!showMargin) return;
            const col = data.column.index;
            const idxMargin = head.indexOf("Margin (USD)");
            const idxPct = head.indexOf("Margin %");

            // subtotal row는 이미 회색/볼드로 처리했으므로 제외
            const isSubtotalRow =
              (data.row?.raw as any)?.[7]?.content === "Subtotal" ||
              (data.row?.raw as any)?.[7] === "Subtotal";
            if (isSubtotalRow) return;

            if (col === idxMargin || col === idxPct) {
              const rowIndex = data.row.index;
              // body rowIndex로 원본 row를 추정(autotable 내부 row와 sync되지만, subtotal 행이 있으므로 안전하게 숫자 파싱)
              const text = String(data.cell.text?.[0] ?? "").trim();
              const num = Number(text.replace(/,/g, ""));
              if (!Number.isFinite(num)) return;

              // margin amount column
              if (col === idxMargin) {
                if (num < 0) data.cell.styles.textColor = [220, 38, 38]; // red
              }
              // margin % column
              if (col === idxPct) {
                if (num < 0) data.cell.styles.textColor = [220, 38, 38];
                else if (num < 20) data.cell.styles.textColor = [234, 88, 12]; // orange
              }
            }
          },
        });
      }

      // ✅ Grand Total page footer row on last group page? (간단히 마지막 그룹에만 붙이면 혼동)
      // -> 대신 "Vendor Margin Ranking" 페이지에서 Grand Total 표시 + Ranking 제공 (ADMIN)
      if (showMargin) {
        doc.addPage();

        const dim = rankingTab === "vendor" ? "Vendor" : rankingTab === "buyer" ? "Buyer" : "Brand";
        const title = `${dim} Margin Ranking`;

        doc.setFont("helvetica", "bold");
        doc.setFontSize(20);
        doc.text(title, margin, 48);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(11);
        doc.text(`Printed: ${printed}`, margin, 68);

        const y = 86;

        const activeFilters = [
          selectedVendor ? `Vendor=${selectedVendor}` : "",
          selectedBuyer ? `Buyer=${selectedBuyer}` : "",
          selectedBrand ? `Brand=${selectedBrand}` : "",
        ].filter(Boolean);

        const label = activeFilters.length ? `Filtered Total (${activeFilters.join(" / ")}) —` : "Grand Total —";

        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.text(
          `${label} Qty: ${fmtQty(grand.qty)}   Amount: ${fmtPrice2(grand.amount)}   Margin: ${fmtPrice2(
            grand.margin
          )}   Margin%: ${fmtPct1(grand.marginPct)}`,
          margin,
          y
        );

        const head2 = ["Rank", dim, "Qty", "Amount (USD)", "Margin (USD)", "Margin %"];

        const data =
          rankingTab === "vendor" ? vendorRanking : rankingTab === "buyer" ? buyerRanking : brandRanking;

        const body2 = data.map((v: any, i: number) => [
          i + 1,
          rankingTab === "vendor" ? v.vendor : rankingTab === "buyer" ? v.buyer : v.brand,
          fmtQty(v.qty),
          fmtPrice2(v.amount),
          fmtPrice2(v.margin),
          fmtPct1(v.marginPct),
        ]);

        autoTable(doc, {
          startY: y + 18,
          margin: { left: margin, right: margin },
          tableWidth,
          head: [head2],
          body: body2,
          styles: {
            font: "helvetica",
            fontSize: 10,
            cellPadding: 6,
            valign: "middle",
            overflow: "linebreak",
          },
          headStyles: {
            fillColor: [245, 247, 250],
            textColor: [0, 0, 0],
            fontStyle: "bold",
          },
          columnStyles: {
            0: { halign: "center", cellWidth: 50 },
            1: { halign: "left", cellWidth: 300 },
            2: { halign: "right", cellWidth: 90 },
            3: { halign: "right", cellWidth: 120 },
            4: { halign: "right", cellWidth: 120 },
            5: { halign: "right", cellWidth: 90 },
          },
          didParseCell: (data) => {
            if (data.section === "head") {
              if (data.column.index === 0) data.cell.styles.halign = "center";
              if (data.column.index === 1) data.cell.styles.halign = "left";
              if (data.column.index >= 2) data.cell.styles.halign = "right";
              return;
            }
            if (data.section !== "body") return;

            if (data.column.index === 4 || data.column.index === 5) {
              // parse margin / margin%
              const raw = String(data.cell.text?.[0] ?? "").replace(/,/g, "");
              const num = Number(raw);
              if (!Number.isFinite(num)) return;

              if (data.column.index === 4) {
                if (num < 0) data.cell.styles.textColor = [220, 38, 38];
              }
              if (data.column.index === 5) {
                if (num < 0) data.cell.styles.textColor = [220, 38, 38];
                else if (num < 20) data.cell.styles.textColor = [234, 88, 12];
              }
            }
          },
        });
      }

      doc.save(`production-status-${printed.replace(/[: ]/g, "-")}.pdf`);
    } finally {
      setExporting(false);
    }
  };

  const exportExcel = () => {
    setExporting(true);
    try {
      // main sheet
      const headers = [
        "PO No",
        "Buyer",
        "Brand",
        "Vendor",
        "Ship Mode",
        "Order Date",
        "Req Ship Date",
        "Status",
        "Style",
        "Qty",
        "Amount (USD)",
      ];
      if (showUnitPrice) headers.splice(9, 0, "Unit Price (USD)"); // before Qty

      if (showMargin) {
        headers.push("Unit Cost (USD)");
        headers.push("Margin (USD)");
        headers.push("Margin %");
      }

      const data = visibleRows.map((r) => {
        const style = r.style_no ?? r.style ?? "";
        const vendor = r.vendor_name ?? r.vendor ?? "";
        const amount = calcAmount(r);

        const base: any[] = [
          r.po_no ?? "",
          r.buyer_name ?? "",
          r.brand ?? "",
          vendor,
          r.ship_mode ?? "",
          r.order_date ?? "",
          r.requested_ship_date ?? "",
          r.status ?? "",
          style,
        ];

        if (showUnitPrice) base.push(r.unit_price_usd == null ? "" : Number(r.unit_price_usd));
        base.push(r.qty == null ? "" : Number(r.qty));
        base.push(Number(amount));

        if (showMargin) {
          const { margin, marginPct } = calcMargin(r);
          base.push((r as any).unit_cost_usd == null ? "" : Number((r as any).unit_cost_usd));
          base.push(Number(margin));
          base.push(Number(marginPct));
        }

        return base;
      });

      const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);

      // number formats
      const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");
      const idxUnit = showUnitPrice ? headers.indexOf("Unit Price (USD)") : -1;
      const idxQty = headers.indexOf("Qty");
      const idxAmt = headers.indexOf("Amount (USD)");
      const idxUnitCost = showMargin ? headers.indexOf("Unit Cost (USD)") : -1;
      const idxMargin = showMargin ? headers.indexOf("Margin (USD)") : -1;
      const idxPct = showMargin ? headers.indexOf("Margin %") : -1;

      for (let R = 1; R <= range.e.r; R++) {
        const setNumFmt = (c: number, fmt: string) => {
          if (c < 0) return;
          const addr = XLSX.utils.encode_cell({ r: R, c });
          const cell: any = ws[addr];
          if (cell && typeof cell.v === "number") {
            cell.t = "n";
            cell.z = fmt;
          }
        };

        if (idxUnit >= 0) setNumFmt(idxUnit, "0.00");
        setNumFmt(idxQty, "#,##0");
        setNumFmt(idxAmt, "0.00");
        if (showMargin) {
          setNumFmt(idxUnitCost, "0.00");
          setNumFmt(idxMargin, "0.00");
          setNumFmt(idxPct, "0.0");
        }
      }

      ws["!cols"] = headers.map((h) => {
        if (h === "Buyer" || h === "Vendor") return { wch: 22 };
        if (h === "Style") return { wch: 12 };
        if (h.includes("Date")) return { wch: 12 };
        if (h.includes("Price") || h.includes("Amount") || h.includes("Cost") || h.includes("Margin"))
          return { wch: 14 };
        if (h === "PO No") return { wch: 14 };
        return { wch: 12 };
      });

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Production Status");

      // ✅ Vendor Margin Ranking sheet (ADMIN only)
      if (showMargin) {
        const dim = rankingTab === "vendor" ? "Vendor" : rankingTab === "buyer" ? "Buyer" : "Brand";
        const h2 = ["Rank", dim, "Qty", "Amount (USD)", "Margin (USD)", "Margin %"];

        const data =
          rankingTab === "vendor" ? vendorRanking : rankingTab === "buyer" ? buyerRanking : brandRanking;

        const d2 = data.map((v: any, i: number) => [
          i + 1,
          rankingTab === "vendor" ? v.vendor : rankingTab === "buyer" ? v.buyer : v.brand,
          Number(v.qty),
          Number(v.amount),
          Number(v.margin),
          Number(v.marginPct),
        ]);

        const ws2 = XLSX.utils.aoa_to_sheet([h2, ...d2]);

        // formats
        const r2 = XLSX.utils.decode_range(ws2["!ref"] || "A1:A1");
        const idxQty2 = h2.indexOf("Qty");
        const idxAmt2 = h2.indexOf("Amount (USD)");
        const idxMar2 = h2.indexOf("Margin (USD)");
        const idxPct2 = h2.indexOf("Margin %");
        for (let R = 1; R <= r2.e.r; R++) {
          const setNumFmt2 = (c: number, fmt: string) => {
            const addr = XLSX.utils.encode_cell({ r: R, c });
            const cell: any = ws2[addr];
            if (cell && typeof cell.v === "number") {
              cell.t = "n";
              cell.z = fmt;
            }
          };
          setNumFmt2(idxQty2, "#,##0");
          setNumFmt2(idxAmt2, "0.00");
          setNumFmt2(idxMar2, "0.00");
          setNumFmt2(idxPct2, "0.0");
        }

        // widths
        ws2["!cols"] = h2.map((h) => {
          if (h === dim) return { wch: 28 };
          if (h.includes("Amount") || h.includes("Margin")) return { wch: 14 };
          return { wch: 10 };
        });

        XLSX.utils.book_append_sheet(wb, ws2, `${dim} Margin Ranking`);
      }

      XLSX.writeFile(
        wb,
        `production-status-${nowStamp().replace(/[: ]/g, "-")}.xlsx`
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <div className="text-2xl font-semibold">Production Status</div>
          <div className="text-sm text-slate-500">
            Production list with Ship Mode (SEA/AIR/COURIER) and optional courier carrier.
          </div>
        </div>
        <div className="text-sm text-slate-500">
          Role: <span className="font-semibold text-slate-700">{role}</span>
        </div>
      </div>

      <div className="bg-white rounded-lg border p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
          <div className="md:col-span-2">
            <div className="text-xs text-slate-500 mb-1">Search</div>
            <Input
              placeholder="PO No / Buyer / Style..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>

          <div>
            <div className="text-xs text-slate-500 mb-1">Ship Mode</div>
            <Select value={shipMode} onValueChange={(v) => setShipMode(v)}>
              <SelectTrigger>
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All</SelectItem>
                {shipModeOptions.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <div className="text-xs text-slate-500 mb-1">Courier Carrier</div>
            <Select value={carrier} onValueChange={(v) => setCarrier(v)}>
              <SelectTrigger>
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All</SelectItem>
                {courierCarrierOptions.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <div className="text-xs text-slate-500 mb-1">Req Ship Date From</div>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>

          <div>
            <div className="text-xs text-slate-500 mb-1">To</div>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>

          <div className="flex gap-2">
            <Button onClick={fetchList} disabled={loading}>
              {loading ? "Loading..." : "Apply"}
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 mt-4 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="text-xs text-slate-500">PDF Group</div>
            <Select value={pdfGroup} onValueChange={(v) => setPdfGroup(v as any)}>
              <SelectTrigger className="w-[180px] h-10">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="vendor">Vendor</SelectItem>
                <SelectItem value="ship_mode">Ship Mode</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {(selectedVendor || selectedBuyer || selectedBrand) && (
            <div className="flex flex-wrap items-center gap-3">
              {selectedVendor && (
                <div className="flex items-center gap-2">
                  <div className="text-xs text-slate-500">Vendor</div>
                  <div className="inline-flex items-center gap-2 bg-slate-100 rounded-full px-3 py-1">
                    <span className="text-sm font-medium text-slate-700">{selectedVendor}</span>
                    <button
                      type="button"
                      className="text-slate-500 hover:text-slate-900"
                      onClick={() => setSelectedVendor(null)}
                      title="Clear vendor filter"
                    >
                      ×
                    </button>
                  </div>
                </div>
              )}

              {selectedBuyer && (
                <div className="flex items-center gap-2">
                  <div className="text-xs text-slate-500">Buyer</div>
                  <div className="inline-flex items-center gap-2 bg-slate-100 rounded-full px-3 py-1">
                    <span className="text-sm font-medium text-slate-700">{selectedBuyer}</span>
                    <button
                      type="button"
                      className="text-slate-500 hover:text-slate-900"
                      onClick={() => setSelectedBuyer(null)}
                      title="Clear buyer filter"
                    >
                      ×
                    </button>
                  </div>
                </div>
              )}

              {selectedBrand && (
                <div className="flex items-center gap-2">
                  <div className="text-xs text-slate-500">Brand</div>
                  <div className="inline-flex items-center gap-2 bg-slate-100 rounded-full px-3 py-1">
                    <span className="text-sm font-medium text-slate-700">{selectedBrand}</span>
                    <button
                      type="button"
                      className="text-slate-500 hover:text-slate-900"
                      onClick={() => setSelectedBrand(null)}
                      title="Clear brand filter"
                    >
                      ×
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={exportExcel}
              disabled={loading || exporting}
            >
              Export Excel
            </Button>
            <Button onClick={exportPDF} disabled={loading || exporting}>
              Export PDF
            </Button>
          </div>
        </div>
      </div>

      {/* ADMIN: Margin Ranking Report (on screen) */}
      {showMargin && (
        <div className="bg-white rounded-lg border p-4 mb-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-lg font-semibold">Margin Ranking</div>
              <div className="text-xs text-slate-500">
                Click a name to filter the list below. Sorted by Margin% desc, then Margin$ desc (negative=red, below 20%=orange).
              </div>

              <div className="mt-3 flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={rankingTab === "vendor" ? "default" : "outline"}
                  onClick={() => setRankingTab("vendor")}
                >
                  Vendor
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={rankingTab === "buyer" ? "default" : "outline"}
                  onClick={() => setRankingTab("buyer")}
                >
                  Buyer
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={rankingTab === "brand" ? "default" : "outline"}
                  onClick={() => setRankingTab("brand")}
                >
                  Brand
                </Button>
              </div>
            </div>

            <div className="text-xs text-slate-500 text-right">
              Grand — Qty: <span className="font-semibold">{fmtQty(grand.qty)}</span> | Amount:{" "}
              <span className="font-semibold">{fmtPrice2(grand.amount)}</span> | Margin:{" "}
              <span className="font-semibold">{fmtPrice2(grand.margin)}</span> | Margin%:{" "}
              <span className="font-semibold">{fmtPct1(grand.marginPct)}</span>
            </div>
          </div>

          <div className="mt-4 overflow-auto border rounded">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="p-2 text-center w-[70px]">Rank</th>
                  <th className="p-2 text-left min-w-[220px]">
                    {rankingTab === "vendor" ? "Vendor" : rankingTab === "buyer" ? "Buyer" : "Brand"}
                  </th>
                  <th className="p-2 text-right w-[110px]">Qty</th>
                  <th className="p-2 text-right w-[140px]">Amount (USD)</th>
                  <th className="p-2 text-right w-[140px]">Margin (USD)</th>
                  <th className="p-2 text-right w-[110px]">Margin %</th>
                </tr>
              </thead>
              <tbody>
                {(rankingTab === "vendor" ? vendorRanking : rankingTab === "buyer" ? buyerRanking : brandRanking).map(
                  (v: any, i: number) => {
                    const name =
                      rankingTab === "vendor" ? v.vendor : rankingTab === "buyer" ? v.buyer : v.brand;

                    const onPick =
                      rankingTab === "vendor"
                        ? () => pickVendor(name)
                        : rankingTab === "buyer"
                          ? () => pickBuyer(name)
                          : () => pickBrand(name);

                    return (
                      <tr key={name} className="border-t">
                        <td className="p-2 text-center">{i + 1}</td>
                        <td className="p-2">
                          <button
                            type="button"
                            className="text-blue-700 hover:underline"
                            onClick={onPick}
                            title="Filter the list below"
                          >
                            {name}
                          </button>
                        </td>
                        <td className="p-2 text-right">{fmtQty(v.qty)}</td>
                        <td className="p-2 text-right">{fmtPrice2(v.amount)}</td>
                        <td className={`p-2 text-right ${marginClass(v.marginPct, v.margin)}`}>
                          {fmtPrice2(v.margin)}
                        </td>
                        <td className={`p-2 text-right ${marginClass(v.marginPct, v.margin)}`}>
                          {fmtPct1(v.marginPct)}
                        </td>
                      </tr>
                    );
                  }
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

<div ref={listRef} className="bg-white rounded-lg border overflow-x-auto">
        <table className="min-w-[1400px] w-full text-sm">
          <thead className="bg-slate-50">
            <tr className="text-left">
              <th className="p-3 font-semibold text-center">PO</th>
              <th className="p-3 font-semibold text-center">WS</th>
              <th className="p-3 font-semibold">PO No</th>
              <th className="p-3 font-semibold">Buyer</th>
              <th className="p-3 font-semibold">Brand</th>
              <th className="p-3 font-semibold">Vendor</th>
              <th className="p-3 font-semibold">Ship Mode</th>
              <th className="p-3 font-semibold">Order Date</th>
              <th className="p-3 font-semibold">Req Ship Date</th>
              <th className="p-3 font-semibold">Status</th>
              <th className="p-3 font-semibold">Style</th>
              {showUnitPrice && (
                <th className="p-3 font-semibold text-right">Unit Price (USD)</th>
              )}
              <th className="p-3 font-semibold text-right">Qty</th>
              <th className="p-3 font-semibold text-right">Amount (USD)</th>

              {showMargin && (
                <>
                  <th className="p-3 font-semibold text-right">Unit Cost (USD)</th>
                  <th className="p-3 font-semibold text-right">Margin (USD)</th>
                  <th className="p-3 font-semibold text-right">Margin %</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td
                  colSpan={
                    14 +
                    (showUnitPrice ? 1 : 0) +
                    (showMargin ? 3 : 0)
                  }
                  className="p-6 text-center text-slate-500"
                >
                  {loading ? "Loading..." : "No data"}
                </td>
              </tr>
            ) : (
              <>
                {visibleRows.map((r) => {
                  const style = r.style_no ?? r.style ?? "";
                  const vendor = r.vendor_name ?? r.vendor ?? "";
                  const amount = calcAmount(r);

                  let marginInfo: any = null;
                  if (showMargin) marginInfo = calcMargin(r);

                  return (
                    <tr key={r.po_line_id} className="border-t">
                      <td className="p-3 text-center">
                        <PoLink r={r} />
                      </td>
                      <td className="p-3 text-center">
                        <WorkSheetLink r={r} />
                      </td>

                      <td className="p-3">{r.po_no ?? ""}</td>
                      <td className="p-3">{r.buyer_name ?? ""}</td>
                      <td className="p-3 text-center">{r.brand ?? ""}</td>
                      <td className="p-3">{vendor}</td>
                      <td className="p-3 text-center">{r.ship_mode ?? ""}</td>
                      <td className="p-3 text-center">{fmtDate(r.order_date ?? null)}</td>
                      <td className="p-3 text-center">
                        {fmtDate(r.requested_ship_date ?? null)}
                      </td>
                      <td className="p-3 text-center">{r.status ?? ""}</td>
                      <td className="p-3 text-center">{style}</td>

                      {showUnitPrice && (
                        <td className="p-3 text-right">
                          {fmtPrice2(r.unit_price_usd ?? null)}
                        </td>
                      )}
                      <td className="p-3 text-right">{fmtQty(r.qty ?? null)}</td>
                      <td className="p-3 text-right">{fmtPrice2(amount)}</td>

                      {showMargin && (
                        <>
                          <td className="p-3 text-right">
                            {fmtPrice2((r as any).unit_cost_usd ?? null)}
                          </td>
                          <td
                            className={`p-3 text-right ${marginClass(
                              marginInfo.marginPct,
                              marginInfo.margin
                            )}`}
                          >
                            {fmtPrice2(marginInfo.margin)}
                          </td>
                          <td
                            className={`p-3 text-right ${marginClass(
                              marginInfo.marginPct,
                              marginInfo.margin
                            )}`}
                          >
                            {fmtPct1(marginInfo.marginPct)}
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}

                {/* Grand Total row (회색 + bold) */}
                <tr className="border-t bg-slate-50 font-semibold">
                  <td
                    colSpan={
                      12 +
                      (showUnitPrice ? 1 : 0) +
                      (showMargin ? 3 : 0)
                    }
                    className="p-3 text-right"
                  >
                    Grand Total
                  </td>
                  <td className="p-3 text-right">{fmtQty(grand.qty)}</td>
                  <td className="p-3 text-right">{fmtPrice2(grand.amount)}</td>
                  {showMargin && (
                    <>
                      <td className="p-3 text-right">{/* Unit Cost total meaningless */}</td>
                      <td className={`p-3 text-right ${marginClass(grand.marginPct, grand.margin)}`}>
                        {fmtPrice2(grand.margin)}
                      </td>
                      <td className={`p-3 text-right ${marginClass(grand.marginPct, grand.margin)}`}>
                        {fmtPct1(grand.marginPct)}
                      </td>
                    </>
                  )}
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
