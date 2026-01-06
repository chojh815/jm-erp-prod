// src/app/po/list/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabaseClient";
import AppShell from "@/components/layout/AppShell";
import type { AppRole } from "@/config/menuConfig";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

// ✅ jsPDF (Client only)
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

interface PoHeaderItem {
  id: string;
  poNo: string;
  buyerName: string | null;

  mainBuyerStyleNo: string | null;
  mainBuyerBrand: string | null;

  lineCount: number;
  orderDate: string | null;

  reqShipDate: string | null;
  shipMode: string | null;

  currency: string | null;
  subtotal: number | null;
  status: string | null;

  mainQty: number | null;
  mainUnitPrice: number | null;

  brand?: string | null;
  requestedShipDate?: string | null;
}

interface PoLineItem {
  id: string;
  headerId: string;
  lineNo: number | null;
  jmStyleNo: string | null;
  buyerStyleNo: string | null;

  buyerBrand: string | null;
  qty: number | null;
  unit: string | null;
  price: number | null;
  amount: number | null;

  deliveryDate: string | null;
  shipmentMode: string | null;

  unitPrice?: number | null;
  uom?: string | null;

  shipMode?: string | null;
  brand?: string | null;

  shipment_mode?: string | null;
  delivery_date?: string | null;

  imageUrl: string | null;

  work_sheet_id?: string | null;
}

type CreateWsOk = { success: true; work_sheet_id?: string; id?: string; data?: any };
type CreateWsFail = { success: false; error: string };
type CreateWsResult = CreateWsOk | CreateWsFail;

function safeJson<T>(res: Response): Promise<T | null> {
  return res
    .json()
    .then((j) => j as T)
    .catch(() => null);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isUuid(v: any) {
  return typeof v === "string" && UUID_RE.test(v);
}

function pickWsId(json: any): string | null {
  const wsId =
    json?.work_sheet_id ||
    json?.id ||
    json?.data?.work_sheet_id ||
    json?.data?.id ||
    null;
  return isUuid(wsId) ? wsId : null;
}

function normalizeHeader(raw: any): PoHeaderItem {
  const mainBuyerBrand =
    raw?.mainBuyerBrand ??
    raw?.buyerBrandName ??
    raw?.buyer_brand_name ??
    raw?.brand ??
    raw?.buyer_brand ??
    null;

  const reqShipDate =
    raw?.reqShipDate ??
    raw?.requestedShipDate ??
    raw?.requested_ship_date ??
    raw?.requestedShipdate ??
    null;

  const shipMode =
    raw?.shipMode ??
    raw?.ship_mode ??
    raw?.shipmentMode ??
    null;

  return {
    id: raw?.id,
    poNo: raw?.poNo ?? raw?.po_no ?? "",
    buyerName: raw?.buyerName ?? raw?.buyer_name ?? null,
    mainBuyerStyleNo: raw?.mainBuyerStyleNo ?? raw?.main_buyer_style_no ?? null,
    mainBuyerBrand,
    lineCount: Number(raw?.lineCount ?? raw?.line_count ?? 0),
    orderDate: raw?.orderDate ?? raw?.order_date ?? null,
    reqShipDate,
    shipMode,
    currency: raw?.currency ?? null,
    subtotal:
      typeof raw?.subtotal === "number"
        ? raw.subtotal
        : raw?.subtotal !== null && raw?.subtotal !== undefined
          ? Number(raw.subtotal)
          : null,
    status: raw?.status ?? null,
    mainQty:
      typeof raw?.mainQty === "number"
        ? raw.mainQty
        : raw?.main_qty !== null && raw?.main_qty !== undefined
          ? Number(raw.main_qty)
          : null,
    mainUnitPrice:
      typeof raw?.mainUnitPrice === "number"
        ? raw.mainUnitPrice
        : raw?.main_unit_price !== null && raw?.main_unit_price !== undefined
          ? Number(raw.main_unit_price)
          : null,

    brand: raw?.brand ?? null,
    requestedShipDate: raw?.requestedShipDate ?? null,
  };
}

function normalizeLine(raw: any): PoLineItem {
  return {
    id: raw?.id,
    headerId: raw?.headerId ?? raw?.poHeaderId ?? raw?.po_header_id ?? "",
    lineNo: raw?.lineNo ?? raw?.line_no ?? null,
    jmStyleNo: raw?.jmStyleNo ?? raw?.jm_style_no ?? null,
    buyerStyleNo: raw?.buyerStyleNo ?? raw?.buyer_style_no ?? null,

    buyerBrand:
      raw?.buyerBrand ??
      raw?.buyer_brand ??
      raw?.brand ??
      null,

    qty: raw?.qty ?? null,
    unit: raw?.unit ?? raw?.uom ?? raw?.unit_of_measure ?? null,
    price: raw?.price ?? raw?.unitPrice ?? raw?.unit_price ?? null,
    amount: raw?.amount ?? null,

    deliveryDate:
      raw?.deliveryDate ??
      raw?.delivery_date ??
      null,

    shipmentMode:
      raw?.shipmentMode ??
      raw?.shipMode ??
      raw?.ship_mode ??
      raw?.shipment_mode ??
      null,

    unitPrice: raw?.unitPrice ?? null,
    uom: raw?.uom ?? null,
    shipMode: raw?.shipMode ?? null,
    brand: raw?.brand ?? null,
    shipment_mode: raw?.shipment_mode ?? null,
    delivery_date: raw?.delivery_date ?? null,
    imageUrl: raw?.imageUrl ?? raw?.image_url ?? null,
    work_sheet_id: raw?.work_sheet_id ?? raw?.workSheetId ?? null,
  };
}

/** ------------------ ✅ Multi-sort ------------------ */
type SortField =
  | "NONE"
  | "REQ_SHIP_DATE"
  | "BRAND"
  | "ORDER_DATE"
  | "PO_NO"
  | "BUYER"
  | "SHIP_MODE"
  | "SUBTOTAL";

type SortDir = "ASC" | "DESC";

function normStr(v: any) {
  return (v ?? "").toString().trim().toUpperCase();
}
function normDate(v: any, dir: SortDir) {
  const s = (v ?? "").toString().trim();
  if (!s) return dir === "ASC" ? "9999-12-31" : "0000-01-01";
  return s; // YYYY-MM-DD string compare OK
}
function normNum(v: any) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}
function cmp(a: any, b: any) {
  return a < b ? -1 : a > b ? 1 : 0;
}
function cmpWithDir<T>(a: T, b: T, dir: SortDir) {
  const c = cmp(a, b);
  return dir === "ASC" ? c : -c;
}

function getSortValue(it: PoHeaderItem, field: SortField, dir: SortDir) {
  switch (field) {
    case "REQ_SHIP_DATE":
      return normDate(it.reqShipDate, dir);
    case "ORDER_DATE":
      return normDate(it.orderDate, dir);
    case "BRAND":
      return normStr(it.mainBuyerBrand);
    case "BUYER":
      return normStr(it.buyerName);
    case "PO_NO":
      return normStr(it.poNo);
    case "SHIP_MODE":
      return normStr(it.shipMode);
    case "SUBTOTAL":
      return normNum(it.subtotal);
    case "NONE":
    default:
      return null;
  }
}

function multiSortItems(
  items: PoHeaderItem[],
  s1f: SortField, s1d: SortDir,
  s2f: SortField, s2d: SortDir,
  s3f: SortField, s3d: SortDir
) {
  const arr = [...items];
  arr.sort((A, B) => {
    const fields: Array<[SortField, SortDir]> = [
      [s1f, s1d],
      [s2f, s2d],
      [s3f, s3d],
      // 항상 마지막 tie-breaker로 PO_NO 고정(안정성)
      ["PO_NO", "ASC"],
    ];

    for (const [f, d] of fields) {
      if (f === "NONE") continue;
      const av = getSortValue(A, f, d);
      const bv = getSortValue(B, f, d);

      if (f === "SUBTOTAL") {
        const c = cmpWithDir(Number(av ?? 0), Number(bv ?? 0), d);
        if (c !== 0) return c;
      } else {
        const c = cmpWithDir(String(av ?? ""), String(bv ?? ""), d);
        if (c !== 0) return c;
      }
    }
    return 0;
  });
  return arr;
}

/** ------------------ ✅ Formatting helpers ------------------ */
function fmtMoney2(v: any) {
  const n = Number(v ?? 0);
  const ok = Number.isFinite(n) ? n : 0;
  return ok.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function PurchaseOrderListPage() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [role, setRole] = useState<AppRole | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // filters
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  // ✅ Multi Sort (기본: Ship Date -> Brand -> Order Date)
  const [s1Field, setS1Field] = useState<SortField>("REQ_SHIP_DATE");
  const [s1Dir, setS1Dir] = useState<SortDir>("ASC");

  const [s2Field, setS2Field] = useState<SortField>("BRAND");
  const [s2Dir, setS2Dir] = useState<SortDir>("ASC");

  const [s3Field, setS3Field] = useState<SortField>("ORDER_DATE");
  const [s3Dir, setS3Dir] = useState<SortDir>("ASC");

  // list
  const [items, setItems] = useState<PoHeaderItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [total, setTotal] = useState(0);

  // selected PO + lines
  const [selectedPo, setSelectedPo] = useState<PoHeaderItem | null>(null);
  const [lines, setLines] = useState<PoLineItem[]>([]);
  const [linesLoading, setLinesLoading] = useState(false);

  // Work Sheet creation loading (per line)
  const [creatingLineId, setCreatingLineId] = useState<string | null>(null);

  // po_line_id -> work_sheet_id
  const [wsMap, setWsMap] = useState<Record<string, string>>({});

  // ---------- Auth ----------
  useEffect(() => {
    const init = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.replace("/login?redirectTo=/po/list");
        return;
      }

      const meta = (session.user.user_metadata || {}) as any;
      const r: AppRole = meta.role || "staff";
      setRole(r);
      setAuthLoading(false);
    };

    init();
  }, [router, supabase]);

  // ---------- fetch list ----------
  const fetchList = async (newPage?: number) => {
    setLoading(true);
    try {
      const p = newPage ?? page;
      const params = new URLSearchParams();
      params.set("page", String(p));
      params.set("pageSize", String(pageSize));
      if (searchText.trim()) params.set("q", searchText.trim());
      if (statusFilter && statusFilter !== "ALL") params.set("status", statusFilter);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);

      const res = await fetch(`/api/orders/list?${params.toString()}`);
      const json = await safeJson<any>(res);

      if (!res.ok) {
        alert(json?.error ?? "Failed to load PO list.");
        return;
      }

      const rawItems = json?.items ?? [];
      const normalized = rawItems.map(normalizeHeader);

      setItems(normalized);
      setTotal(json?.total ?? 0);
      setPage(json?.page ?? p);

      setSelectedPo(null);
      setLines([]);
      setWsMap({});
    } catch (err: any) {
      console.error("fetchList error:", err);
      alert(err?.message ?? "Unexpected error while loading list.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && role) fetchList(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, role]);

  const handleApply = () => fetchList(1);

  const handleClearFilters = () => {
    setSearchText("");
    setStatusFilter("ALL");
    setDateFrom("");
    setDateTo("");
    fetchList(1);
  };

  // ---------- load lines ----------
  const loadLinesForPo = async (po: PoHeaderItem) => {
    setSelectedPo(po);
    setLines([]);
    setWsMap({});
    setLinesLoading(true);

    try {
      const params = new URLSearchParams();
      params.set("detailFor", po.id);

      const res = await fetch(`/api/orders/list?${params.toString()}`);
      const json = await safeJson<any>(res);

      if (!res.ok) {
        alert(json?.error ?? "Failed to load PO lines.");
        return;
      }

      const loadedLinesRaw: any[] = json?.lines ?? [];
      const loadedLines = loadedLinesRaw.map(normalizeLine);

      setLines(loadedLines);

      const lineIds = loadedLines.map((l) => l.id).filter(isUuid);
      if (lineIds.length > 0) {
        const { data, error } = await supabase
          .from("work_sheet_headers")
          .select("id, po_line_id")
          .in("po_line_id", lineIds)
          .eq("is_deleted", false);

        if (!error && data) {
          const m: Record<string, string> = {};
          for (const row of data as any[]) {
            const poLineId = row?.po_line_id;
            const wsId = row?.id;
            if (isUuid(poLineId) && isUuid(wsId)) m[poLineId] = wsId;
          }
          setWsMap(m);
        }
      }
    } catch (err: any) {
      console.error("loadLinesForPo error:", err);
      alert(err?.message ?? "Unexpected error while loading PO lines.");
    } finally {
      setLinesLoading(false);
    }
  };

  // ---------- pagination ----------
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const handlePrev = () => page > 1 && fetchList(page - 1);
  const handleNext = () => page < totalPages && fetchList(page + 1);

  // ✅ Multi Sorted view
  const sortedItems = useMemo(() => {
    return multiSortItems(items, s1Field, s1Dir, s2Field, s2Dir, s3Field, s3Dir);
  }, [items, s1Field, s1Dir, s2Field, s2Dir, s3Field, s3Dir]);

  // ---------- export excel ----------
  const handleExportExcel = () => {
    if (sortedItems.length === 0) return alert("No data to export.");

    const header = [
      "PO No",
      "Buyer",
      "Brand",
      "Buyer Style No",
      "Order Date",
      "Req. Ship Date",
      "Ship Mode",
      "Cur.",
      "Qty",
      "Unit Price",
      "Subtotal",
      "Status",
    ];

    const rows = sortedItems.map((it) => {
      const styleLabel = it.mainBuyerStyleNo
        ? it.lineCount > 1
          ? `${it.mainBuyerStyleNo} 외 ${it.lineCount - 1}건`
          : it.mainBuyerStyleNo
        : "-";

      const qtyLabel = typeof it.mainQty === "number" ? String(it.mainQty) : "-";
      const unitPriceLabel =
        typeof it.mainUnitPrice === "number" ? it.mainUnitPrice.toFixed(2) : "-";
      const subtotalLabel =
        typeof it.subtotal === "number" ? it.subtotal.toFixed(2) : "-";

      return [
        it.poNo,
        it.buyerName ?? "-",
        it.mainBuyerBrand ?? "-",
        styleLabel,
        it.orderDate ?? "-",
        it.reqShipDate ?? "-",
        it.shipMode ?? "-",
        it.currency ?? "-",
        qtyLabel,
        unitPriceLabel,
        subtotalLabel,
        it.status ?? "-",
      ];
    });

    const csvLines = [header, ...rows]
      .map((r) =>
        r
          .map((c) => {
            const v = String(c ?? "");
            if (v.includes(",") || v.includes('"')) return `"${v.replace(/"/g, '""')}"`;
            return v;
          })
          .join(",")
      )
      .join("\r\n");

    const blob = new Blob(["\uFEFF" + csvLines], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "po_list.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  // ---------- export pdf (jsPDF + autoTable + print) ----------
  const handleExportPdf = () => {
    if (sortedItems.length === 0) return alert("No data to export.");

    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });

    doc.setFontSize(14);
    doc.text("Purchase Order List", 40, 40);

    const sortLabel = `1) ${s1Field} ${s1Dir}  2) ${s2Field} ${s2Dir}  3) ${s3Field} ${s3Dir}`;
    doc.setFontSize(9);
    doc.text(`Sort: ${sortLabel} | Total: ${sortedItems.length} POs`, 40, 58);

    autoTable(doc, {
  startY: 70,
  head: [[
    "PO No",
    "Buyer",
    "Brand",
    "Buyer Style No",
    "Order Date",
    "Req. Ship Date",
    "Ship Mode",
    "Cur.",
    "Qty",
    "Unit Price",
    "Subtotal",
    "Status",
  ]],
  body: sortedItems.map((it) => {
    const styleLabel = it.mainBuyerStyleNo
      ? it.lineCount > 1
        ? `${it.mainBuyerStyleNo} (+${it.lineCount - 1})`
        : it.mainBuyerStyleNo
      : "-";

    return [
      it.poNo ?? "",
      it.buyerName ?? "",
      it.mainBuyerBrand ?? "",
      styleLabel,
      it.orderDate ?? "",
      it.reqShipDate ?? "",
      it.shipMode ?? "",
      it.currency ?? "",
      typeof it.mainQty === "number" ? String(it.mainQty) : "",
      typeof it.mainUnitPrice === "number" ? Number(it.mainUnitPrice).toFixed(2) : "",
      typeof it.subtotal === "number" ? Number(it.subtotal).toFixed(2) : "0.00",
      it.status ?? "",
    ];
  }),
  styles: { fontSize: 9, cellPadding: 4, overflow: "linebreak" },
  columnStyles: {
    8: { halign: "right" },
    9: { halign: "right" },
    10: { halign: "right" },
  },
  margin: { left: 40, right: 40, top: 70, bottom: 50 }, // ✅ bottom 여유(페이지번호 자리)
  didDrawPage: function () {
    // ✅ 하단 중앙 페이지 번호
    const pageCount = (doc as any).internal.getNumberOfPages?.() || 1;
    const pageNum = (doc as any).internal.getCurrentPageInfo?.().pageNumber || 1;

    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();

    doc.setFontSize(9);
    const text = `Page ${pageNum} / ${pageCount}`;
    doc.text(text, pageW / 2, pageH - 20, { align: "center" }); // ✅ 하단 중앙
  },
});

       const blobUrl = doc.output("bloburl");
    window.open(blobUrl, "_blank");
  };

  const handleView = (po: PoHeaderItem) => {
    if (!po.poNo) return alert("PO No is missing.");
    router.push(`/po/create?poNo=${encodeURIComponent(po.poNo)}`);
  };

  const onClickWorkSheet = async (po: PoHeaderItem, line: PoLineItem) => {
    try {
      const existing = wsMap[line.id] || line.work_sheet_id || null;

      if (existing && isUuid(existing)) {
        router.push(`/work-sheets/${existing}`);
        return;
      }

      setCreatingLineId(line.id);

      const res = await fetch("/api/work-sheets/create-from-po", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          po_header_id: po.id,
          po_no: po.poNo,
          po_line_id: line.id,
        }),
      });

      if (res.status === 405) {
        throw new Error(
          "405 Method Not Allowed: /api/work-sheets/create-from-po 에 POST route.ts가 없거나 method가 GET만 열려 있습니다."
        );
      }

      const json = await safeJson<CreateWsResult>(res);

      if (!res.ok || !json || (json as any).success !== true) {
        const msg = (json as any)?.error || "Failed to create Work Sheet.";
        throw new Error(msg);
      }

      const wsId = pickWsId(json);
      if (!wsId) throw new Error("work_sheet_id missing (API 응답 키: work_sheet_id)");

      setWsMap((prev) => ({ ...prev, [line.id]: wsId }));
      router.push(`/work-sheets/${wsId}`);
    } catch (e: any) {
      console.error("onClickWorkSheet error:", e);
      alert(e?.message || "Work Sheet action failed");
    } finally {
      setCreatingLineId(null);
    }
  };

  if (authLoading || !role) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <span className="text-sm text-slate-500">Loading...</span>
      </div>
    );
  }

  const SortFieldSelect = ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: SortField;
    onChange: (v: SortField) => void;
  }) => (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Select value={value} onValueChange={(v) => onChange(v as SortField)}>
        <SelectTrigger>
          <SelectValue placeholder="Sort field" />
        </SelectTrigger>
        <SelectContent className="z-50">
          <SelectItem value="NONE">None</SelectItem>
          <SelectItem value="REQ_SHIP_DATE">Ship Date</SelectItem>
          <SelectItem value="BRAND">Brand</SelectItem>
          <SelectItem value="ORDER_DATE">Order Date</SelectItem>
          <SelectItem value="PO_NO">PO No</SelectItem>
          <SelectItem value="BUYER">Buyer</SelectItem>
          <SelectItem value="SHIP_MODE">Ship Mode</SelectItem>
          <SelectItem value="SUBTOTAL">Subtotal</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );

  const SortDirSelect = ({
    value,
    onChange,
  }: {
    value: SortDir;
    onChange: (v: SortDir) => void;
  }) => (
    <div className="space-y-1">
      <Label>Dir</Label>
      <Select value={value} onValueChange={(v) => onChange(v as SortDir)}>
        <SelectTrigger>
          <SelectValue placeholder="ASC/DESC" />
        </SelectTrigger>
        <SelectContent className="z-50">
          <SelectItem value="ASC">ASC</SelectItem>
          <SelectItem value="DESC">DESC</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <AppShell
      role={role}
      title="PO / Orders – List"
      description="Search, filter and manage purchase orders."
    >
      <div className="p-4 space-y-4">
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <div>
              <CardTitle className="text-2xl">Purchase Order List</CardTitle>
              <div className="text-xs text-red-500 mt-1">PO_LIST_PAGE_ACTIVE</div>
            </div>

            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={() => router.push("/po/create")}>
                New PO
              </Button>
              <Button type="button" onClick={() => fetchList(page)} disabled={loading}>
                {loading ? "Refreshing..." : "Refresh"}
              </Button>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            {/* Filters + Sort */}
            <div className="grid grid-cols-1 lg:grid-cols-6 gap-4 items-end">
              <div className="space-y-1 lg:col-span-2">
                <Label>Search</Label>
                <Input
                  placeholder="PO No or Buyer Name"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleApply()}
                />
              </div>

              <div className="space-y-1">
                <Label>Status</Label>
                <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Status" />
                  </SelectTrigger>
                  <SelectContent className="z-50">
                    <SelectItem value="ALL">All Status</SelectItem>
                    <SelectItem value="DRAFT">DRAFT</SelectItem>
                    <SelectItem value="CONFIRMED">CONFIRMED</SelectItem>
                    <SelectItem value="IN_PRODUCTION">IN PRODUCTION</SelectItem>
                    <SelectItem value="SHIPPED">SHIPPED</SelectItem>
                    <SelectItem value="CLOSED">CLOSED</SelectItem>
                    <SelectItem value="CANCELED">CANCELED</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label>Order Date (From)</Label>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>

              <div className="space-y-1">
                <Label>Order Date (To)</Label>
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>

              <div className="flex gap-2 justify-end lg:col-span-6">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleClearFilters}
                  className="min-w-[80px]"
                >
                  Clear
                </Button>
                <Button
                  type="button"
                  onClick={handleApply}
                  className="min-w-[80px]"
                  disabled={loading}
                >
                  Apply
                </Button>
              </div>
            </div>

            {/* ✅ Multi Sort controls */}
            <div className="grid grid-cols-1 lg:grid-cols-6 gap-4 items-end border rounded-xl p-4 bg-slate-50">
              <div className="lg:col-span-2 grid grid-cols-3 gap-3">
                <SortFieldSelect label="Sort #1" value={s1Field} onChange={setS1Field} />
                <SortDirSelect value={s1Dir} onChange={setS1Dir} />
                <div className="hidden lg:block" />
              </div>

              <div className="lg:col-span-2 grid grid-cols-3 gap-3">
                <SortFieldSelect label="Sort #2" value={s2Field} onChange={setS2Field} />
                <SortDirSelect value={s2Dir} onChange={setS2Dir} />
                <div className="hidden lg:block" />
              </div>

              <div className="lg:col-span-2 grid grid-cols-3 gap-3">
                <SortFieldSelect label="Sort #3" value={s3Field} onChange={setS3Field} />
                <SortDirSelect value={s3Dir} onChange={setS3Dir} />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setS1Field("REQ_SHIP_DATE");
                    setS1Dir("ASC");
                    setS2Field("BRAND");
                    setS2Dir("ASC");
                    setS3Field("ORDER_DATE");
                    setS3Dir("ASC");
                  }}
                >
                  Reset Sort
                </Button>
              </div>

              <div className="lg:col-span-6 text-xs text-slate-600">
                Current: <span className="font-semibold">
                  1) {s1Field} {s1Dir} / 2) {s2Field} {s2Dir} / 3) {s3Field} {s3Dir}
                </span>
              </div>
            </div>

            {/* List table */}
            <div className="mt-2 border rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr className="text-left">
                      <th className="px-4 py-2 border-b">PO No</th>
                      <th className="px-4 py-2 border-b">Buyer</th>
                      <th className="px-4 py-2 border-b">Brand</th>
                      <th className="px-4 py-2 border-b">Buyer Style No</th>
                      <th className="px-4 py-2 border-b">Order Date</th>
                      <th className="px-4 py-2 border-b">Req. Ship Date</th>
                      <th className="px-4 py-2 border-b">Ship Mode</th>
                      <th className="px-4 py-2 border-b">Cur.</th>
                      <th className="px-4 py-2 border-b text-right">Subtotal</th>
                      <th className="px-4 py-2 border-b">Status</th>
                      <th className="px-4 py-2 border-b">Action</th>
                    </tr>
                  </thead>

                  <tbody>
                    {sortedItems.length === 0 && !loading && (
                      <tr>
                        <td colSpan={11} className="px-4 py-6 text-center text-slate-400">
                          No purchase orders found.
                        </td>
                      </tr>
                    )}

                    {loading && (
                      <tr>
                        <td colSpan={11} className="px-4 py-6 text-center text-slate-400">
                          Loading...
                        </td>
                      </tr>
                    )}

                    {sortedItems.map((it) => {
                      const isSelected = selectedPo?.id === it.id;

                      const styleLabel = it.mainBuyerStyleNo
                        ? it.lineCount > 1
                          ? `${it.mainBuyerStyleNo} 외 ${it.lineCount - 1}건`
                          : it.mainBuyerStyleNo
                        : "-";

                      return (
                        <tr
                          key={it.id}
                          className={`border-t hover:bg-sky-50 cursor-pointer ${isSelected ? "bg-sky-50" : ""}`}
                          onClick={() => loadLinesForPo(it)}
                        >
                          <td className="px-4 py-2">{it.poNo}</td>
                          <td className="px-4 py-2">{it.buyerName ?? "-"}</td>
                          <td className="px-4 py-2">{it.mainBuyerBrand ?? "-"}</td>
                          <td className="px-4 py-2">{styleLabel}</td>
                          <td className="px-4 py-2">{it.orderDate ?? "-"}</td>
                          <td className="px-4 py-2">{it.reqShipDate ?? "-"}</td>
                          <td className="px-4 py-2">{it.shipMode ?? "-"}</td>
                          <td className="px-4 py-2">{it.currency ?? "-"}</td>
                          <td className="px-4 py-2 text-right">
                            {typeof it.subtotal === "number" ? fmtMoney2(it.subtotal) : "0.00"}
                          </td>
                          <td className="px-4 py-2">{it.status ?? "-"}</td>

                          <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center gap-2">
                              <Button type="button" variant="outline" size="sm" onClick={() => handleView(it)}>
                                View
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => {
                                  loadLinesForPo(it);
                                  alert("아래 Line Details에서 라인(스타일)별로 Create/Open WS를 눌러주세요.");
                                }}
                              >
                                Work Sheets
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Footer */}
              <div className="flex flex-col md:flex-row items-center justify-between gap-3 px-4 py-3 border-t bg-slate-50">
                <div className="text-sm text-slate-600">
                  Total: <span className="font-semibold">{total}</span> POs
                </div>

                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={handleExportExcel}>
                    Export Excel
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleExportPdf}>
                    Export PDF (jsPDF)
                  </Button>
                </div>

                <div className="flex items-center gap-3">
                  <Button variant="outline" size="sm" onClick={handlePrev} disabled={page <= 1}>
                    Previous
                  </Button>
                  <span className="text-sm text-slate-600">
                    Page {page} / {totalPages}
                  </span>
                  <Button variant="outline" size="sm" onClick={handleNext} disabled={page >= totalPages}>
                    Next
                  </Button>
                </div>
              </div>
            </div>

            {/* Lines */}
            <Separator className="my-4" />

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              <Card className="xl:col-span-2">
                <CardHeader>
                  <CardTitle className="text-lg">Line Details (Styles in selected PO)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {!selectedPo && (
                    <div className="text-sm text-slate-500">위 PO 리스트에서 PO를 클릭하면 라인이 나옵니다.</div>
                  )}

                  {selectedPo && (
                    <>
                      <div className="text-sm text-slate-600 mb-2">
                        <span className="font-semibold">PO:</span> {selectedPo.poNo} / {selectedPo.buyerName ?? "-"}
                      </div>

                      <div className="border rounded-lg overflow-auto max-h-[360px]">
                        <table className="min-w-full text-xs">
                          <thead className="bg-slate-50">
                            <tr className="text-left">
                              <th className="px-3 py-2 border-b">Line</th>
                              <th className="px-3 py-2 border-b">JM No</th>
                              <th className="px-3 py-2 border-b">Buyer Style</th>
                              <th className="px-3 py-2 border-b">Brand</th>
                              <th className="px-3 py-2 border-b text-right">Qty</th>
                              <th className="px-3 py-2 border-b text-right">Price</th>
                              <th className="px-3 py-2 border-b text-right">Amount</th>
                              <th className="px-3 py-2 border-b">Delivery</th>
                              <th className="px-3 py-2 border-b">Shipment</th>
                              <th className="px-3 py-2 border-b">Work Sheet</th>
                            </tr>
                          </thead>
                          <tbody>
                            {linesLoading && (
                              <tr>
                                <td colSpan={10} className="px-3 py-4 text-center text-slate-400">
                                  Loading...
                                </td>
                              </tr>
                            )}
                            {!linesLoading && lines.length === 0 && (
                              <tr>
                                <td colSpan={10} className="px-3 py-4 text-center text-slate-400">
                                  No lines for this PO.
                                </td>
                              </tr>
                            )}

                            {lines.map((ln) => {
                              const existing = wsMap[ln.id] || ln.work_sheet_id || null;
                              const hasWs = existing && isUuid(existing);

                              const brandLabel = ln.buyerBrand ?? selectedPo?.mainBuyerBrand ?? "-";
                              const deliveryLabel = ln.deliveryDate ?? selectedPo?.reqShipDate ?? "-";
                              const shipModeLabel = ln.shipmentMode ?? selectedPo?.shipMode ?? "-";

                              const priceVal =
                                typeof ln.price === "number"
                                  ? ln.price
                                  : typeof (ln as any).unitPrice === "number"
                                    ? (ln as any).unitPrice
                                    : typeof (ln as any).unit_price === "number"
                                      ? (ln as any).unit_price
                                      : null;

                              const amountVal =
                                typeof ln.amount === "number"
                                  ? ln.amount
                                  : typeof ln.qty === "number" && typeof priceVal === "number"
                                    ? (ln.qty || 0) * priceVal
                                    : null;

                              return (
                                <tr key={ln.id} className="border-t">
                                  <td className="px-3 py-2">{ln.lineNo ?? "-"}</td>
                                  <td className="px-3 py-2">{ln.jmStyleNo ?? "-"}</td>
                                  <td className="px-3 py-2">{ln.buyerStyleNo ?? "-"}</td>
                                  <td className="px-3 py-2">{brandLabel}</td>
                                  <td className="px-3 py-2 text-right">
                                    {ln.qty ?? "-"} {ln.unit ?? ""}
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    {typeof priceVal === "number" ? priceVal.toFixed(2) : "-"}
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    {typeof amountVal === "number" ? amountVal.toFixed(2) : "-"}
                                  </td>
                                  <td className="px-3 py-2">{deliveryLabel}</td>
                                  <td className="px-3 py-2">{shipModeLabel}</td>
                                  <td className="px-3 py-2">
                                    <Button
                                      size="sm"
                                      onClick={() => onClickWorkSheet(selectedPo, ln)}
                                      disabled={creatingLineId === ln.id}
                                    >
                                      {creatingLineId === ln.id ? "Working..." : hasWs ? "Open WS" : "Create WS"}
                                    </Button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      <div className="text-xs text-slate-500 mt-2">
                        * Work Sheet는 “라인(스타일)별”로 생성/관리합니다. (1by1 분리)
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Style Image Preview</CardTitle>
                </CardHeader>
                <CardContent className="flex items-center justify-center h-[360px]">
                  {selectedPo && lines.length > 0 ? (
                    <div className="text-center text-sm text-slate-500">
                      <div className="mb-2">(이미지 URL 매핑은 다음 단계에서 연결 가능)</div>
                      <div className="border rounded-lg w-60 h-60 flex items-center justify-center bg-slate-50">
                        <span className="text-xs text-slate-400">No image mapped yet</span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-slate-500">Select a PO and line to preview.</div>
                  )}
                </CardContent>
              </Card>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
