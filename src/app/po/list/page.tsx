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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ✅ jsPDF (Client only)
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import ExcelJS from "exceljs";

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

type ListStateSnapshot = {
  q: string;
  status: string;
  vendorId: string;
  dateFrom: string;
  dateTo: string;
  shipDateFrom: string;
  shipDateTo: string;
  pendingOnly: boolean;
  lateOnly: boolean;
  s1Field: SortField;
  s1Dir: SortDir;
  s2Field: SortField;
  s2Dir: SortDir;
  s3Field: SortField;
  s3Dir: SortDir;
  page: number;
};

type DuplicateCandidate = {
  source_work_sheet_id: string;
  source_work_sheet_line_id: string;
  ws_no: string | null;
  po_no: string | null;
  buyer_name: string | null;
  jm_style_no: string | null;
  buyer_style: string | null;
  description: string | null;
  updated_at: string | null;
  score?: number | null;
};

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
  const imageCandidate = extractFirstImageLike(raw);
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
    imageUrl: imageCandidate,
    work_sheet_id: raw?.work_sheet_id ?? raw?.workSheetId ?? null,
  };
}

function isNonEmptyString(v: any): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

// --------- Image URL resolver (supports images[] / storage paths) ---------
const IMAGE_BUCKET_CANDIDATES = [
  "po-line-images",
  "po_line_images",
  "po-images",
  "po_images",
  "images",
];

function firstStringInArray(arr: any[]): string | null {
  for (const it of arr) {
    if (isNonEmptyString(it)) return it.trim();
    const u = it?.url ?? it?.publicUrl ?? it?.public_url ?? it?.imageUrl ?? it?.image_url;
    if (isNonEmptyString(u)) return u.trim();
  }
  return null;
}

function tryParseMaybeJsonArray(v: any): any[] | null {
  if (!isNonEmptyString(v)) return null;
  const s = v.trim();
  if (!(s.startsWith("[") && s.endsWith("]"))) return null;
  try {
    const j = JSON.parse(s);
    return Array.isArray(j) ? j : null;
  } catch {
    return null;
  }
}

function extractFirstImageLike(raw: any): string | null {
  const direct =
    raw?.mainImageUrl ??
    raw?.main_image_url ??
    raw?.main_image ??
    raw?.imageUrl ??
    raw?.image_url ??
    raw?.thumbnailUrl ??
    raw?.thumbnail_url ??
    raw?.thumbUrl ??
    raw?.thumb_url ??
    null;
  if (isNonEmptyString(direct)) return direct.trim();

  const arrLike =
    raw?.images ??
    raw?.imageUrls ??
    raw?.image_urls ??
    raw?.poLineImages ??
    raw?.po_line_images ??
    null;

  if (Array.isArray(arrLike)) {
    const s = firstStringInArray(arrLike);
    if (s) return s;
  }

  const maybeJsonArr = tryParseMaybeJsonArray(arrLike);
  if (maybeJsonArr) {
    const s = firstStringInArray(maybeJsonArr);
    if (s) return s;
  }

  if (isNonEmptyString(arrLike) && arrLike.includes(",")) {
    const first = arrLike
      .split(",")
      .map((x: string) => x.trim())
      .find((x: string) => x.length > 0);
    if (first) return first;
  }

  return null;
}

function looksLikeHttpUrl(v: string) {
  return /^https?:\/\//i.test(v);
}

function cleanStoragePath(p: string) {
  let s = p.trim();
  if (s.startsWith("/")) s = s.slice(1);
  s = s.replace(/^public\//i, "");
  return s;
}

function resolveImageUrlFromStorage(
  supabase: ReturnType<typeof createSupabaseBrowserClient>,
  maybeUrl: string | null
): string | null {
  if (!isNonEmptyString(maybeUrl)) return null;
  const raw = maybeUrl.trim();
  if (!raw) return null;
  if (looksLikeHttpUrl(raw)) return raw;

  const cleaned = cleanStoragePath(raw);
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length >= 2) {
    const maybeBucket = parts[0];
    const objectPath = parts.slice(1).join("/");
    if (IMAGE_BUCKET_CANDIDATES.includes(maybeBucket)) {
      const { data } = supabase.storage.from(maybeBucket).getPublicUrl(objectPath);
      return data?.publicUrl ?? null;
    }
  }

  const fallbackBucket = IMAGE_BUCKET_CANDIDATES[0];
  const { data } = supabase.storage.from(fallbackBucket).getPublicUrl(cleaned);
  return data?.publicUrl ?? null;
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
  return s;
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

function fmtTotalsByCurrency(totals: Record<string, number> | null | undefined) {
  if (!totals) return "";
  const entries = Object.entries(totals).filter(([cur, v]) => (cur ?? "").trim() !== "" || Number.isFinite(Number(v)));
  if (entries.length === 0) return "";
  const norm = entries.map(([cur, v]) => [ (cur ?? "").trim() || "N/A", Number(v ?? 0) ] as const);
  if (norm.length === 1) {
    const [c, v] = norm[0];
    return `${c} ${fmtMoney2(v)}`;
  }
  return norm.map(([c, v]) => `${c} ${fmtMoney2(v)}`).join(" | ");
}

function getStatusBadgeClass(status: string | null | undefined) {
  const s = (status ?? "").toString().trim().toUpperCase();

  switch (s) {
    case "OPEN":
      return "inline-flex items-center rounded-full border border-slate-300 bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700";
    case "PARTIAL":
      return "inline-flex items-center rounded-full border border-orange-300 bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-700";
    case "ALLOCATED":
      return "inline-flex items-center rounded-full border border-blue-300 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700";
    case "SHIPPED":
      return "inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700";
    case "CLOSED":
      return "inline-flex items-center rounded-full border border-violet-300 bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700";
    case "CANCELED":
    case "CANCELLED":
      return "inline-flex items-center rounded-full border border-rose-300 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700";
    case "DRAFT":
      return "inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700";
    case "CONFIRMED":
      return "inline-flex items-center rounded-full border border-cyan-300 bg-cyan-50 px-2.5 py-1 text-xs font-semibold text-cyan-700";
    default:
      return "inline-flex items-center rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700";
  }
}

function isCanceledPoStatus(status: string | null | undefined) {
  const s = (status ?? "").toString().trim().toUpperCase();
  return s === "CANCELED" || s === "CANCELLED";
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
  const [shipDateFrom, setShipDateFrom] = useState<string>("");
  const [shipDateTo, setShipDateTo] = useState<string>("");
  const [vendorFilter, setVendorFilter] = useState<string>("ALL");
  const [vendorOptions, setVendorOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [pendingOnly, setPendingOnly] = useState(false);
  const [lateOnly, setLateOnly] = useState(false);

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

  // totals (API-provided, filter-wide)
  const [grandTotal, setGrandTotal] = useState<number | null>(null);
  const [grandTotalsByCurrency, setGrandTotalsByCurrency] = useState<Record<string, number> | null>(null);
  const [pageTotalsByCurrency, setPageTotalsByCurrency] = useState<Record<string, number> | null>(null);

  // selected PO + lines
  const [selectedPo, setSelectedPo] = useState<PoHeaderItem | null>(null);
  const [lines, setLines] = useState<PoLineItem[]>([]);
  const [linesLoading, setLinesLoading] = useState(false);

  // Work Sheet creation loading (per line)
  const [creatingLineId, setCreatingLineId] = useState<string | null>(null);

  // po_line_id -> work_sheet_id
  const [wsMap, setWsMap] = useState<Record<string, string>>({});

  // Line detail drawer (Row click -> Right Drawer)
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedLine, setSelectedLine] = useState<PoLineItem | null>(null);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [duplicateLoading, setDuplicateLoading] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [duplicateCandidates, setDuplicateCandidates] = useState<DuplicateCandidate[]>([]);
  const [duplicateQuery, setDuplicateQuery] = useState("");
  const [duplicateTargetPo, setDuplicateTargetPo] = useState<PoHeaderItem | null>(null);
  const [duplicateTargetLine, setDuplicateTargetLine] = useState<PoLineItem | null>(null);

  const [urlReady, setUrlReady] = useState(false);
  const [initialSnapshot, setInitialSnapshot] = useState<ListStateSnapshot | null>(null);

  const defaultListSnapshot = React.useCallback((): ListStateSnapshot => ({
    q: "",
    status: "ALL",
    vendorId: "ALL",
    dateFrom: "",
    dateTo: "",
    shipDateFrom: "",
    shipDateTo: "",
    pendingOnly: false,
    lateOnly: false,
    s1Field: "REQ_SHIP_DATE",
    s1Dir: "ASC",
    s2Field: "BRAND",
    s2Dir: "ASC",
    s3Field: "ORDER_DATE",
    s3Dir: "ASC",
    page: 1,
  }), []);

  const parseSnapshotFromUrl = React.useCallback((): ListStateSnapshot => {
    if (typeof window === "undefined") return defaultListSnapshot();
    const qs = new URLSearchParams(window.location.search);
    const pageNum = Number(qs.get("page") ?? "1");
    return {
      q: qs.get("q") ?? "",
      status: qs.get("status") ?? "ALL",
      vendorId: qs.get("vendor_id") ?? "ALL",
      dateFrom: qs.get("dateFrom") ?? "",
      dateTo: qs.get("dateTo") ?? "",
      shipDateFrom: qs.get("shipDateFrom") ?? "",
      shipDateTo: qs.get("shipDateTo") ?? "",
      pendingOnly: qs.get("pending_only") === "true",
      lateOnly: qs.get("late_only") === "true",
      s1Field: ((qs.get("s1Field") as SortField) ?? "REQ_SHIP_DATE"),
      s1Dir: ((qs.get("s1Dir") as SortDir) ?? "ASC"),
      s2Field: ((qs.get("s2Field") as SortField) ?? "BRAND"),
      s2Dir: ((qs.get("s2Dir") as SortDir) ?? "ASC"),
      s3Field: ((qs.get("s3Field") as SortField) ?? "ORDER_DATE"),
      s3Dir: ((qs.get("s3Dir") as SortDir) ?? "ASC"),
      page: Number.isFinite(pageNum) && pageNum > 0 ? pageNum : 1,
    };
  }, [defaultListSnapshot]);

  const applySnapshotToState = React.useCallback((snap: ListStateSnapshot) => {
    setSearchText(snap.q);
    setStatusFilter(snap.status || "ALL");
    setVendorFilter(snap.vendorId || "ALL");
    setDateFrom(snap.dateFrom || "");
    setDateTo(snap.dateTo || "");
    setShipDateFrom(snap.shipDateFrom || "");
    setShipDateTo(snap.shipDateTo || "");
    setPendingOnly(!!snap.pendingOnly);
    setLateOnly(!!snap.lateOnly);
    setS1Field(snap.s1Field || "REQ_SHIP_DATE");
    setS1Dir(snap.s1Dir || "ASC");
    setS2Field(snap.s2Field || "BRAND");
    setS2Dir(snap.s2Dir || "ASC");
    setS3Field(snap.s3Field || "ORDER_DATE");
    setS3Dir(snap.s3Dir || "ASC");
    setPage(snap.page || 1);
  }, []);

  const getSnapshotFromState = React.useCallback((pageOverride?: number): ListStateSnapshot => ({
    q: searchText.trim(),
    status: statusFilter || "ALL",
    vendorId: vendorFilter || "ALL",
    dateFrom,
    dateTo,
    shipDateFrom,
    shipDateTo,
    pendingOnly,
    lateOnly,
    s1Field,
    s1Dir,
    s2Field,
    s2Dir,
    s3Field,
    s3Dir,
    page: pageOverride ?? page ?? 1,
  }), [searchText, statusFilter, vendorFilter, dateFrom, dateTo, shipDateFrom, shipDateTo, pendingOnly, lateOnly, s1Field, s1Dir, s2Field, s2Dir, s3Field, s3Dir, page]);

  const buildListUrl = React.useCallback((
    snap: ListStateSnapshot,
    extras?: { selectedPoId?: string | null; selectedLineId?: string | null; drawer?: boolean }
  ) => {
    const params = new URLSearchParams();
    if (snap.page && snap.page > 1) params.set("page", String(snap.page));
    if (snap.q) params.set("q", snap.q);
    if (snap.status && snap.status !== "ALL") params.set("status", snap.status);
    if (snap.vendorId && snap.vendorId !== "ALL") params.set("vendor_id", snap.vendorId);
    if (snap.dateFrom) params.set("dateFrom", snap.dateFrom);
    if (snap.dateTo) params.set("dateTo", snap.dateTo);
    if (snap.shipDateFrom) params.set("shipDateFrom", snap.shipDateFrom);
    if (snap.shipDateTo) params.set("shipDateTo", snap.shipDateTo);
    if (snap.pendingOnly) params.set("pending_only", "true");
    if (snap.lateOnly) params.set("late_only", "true");
    params.set("s1Field", snap.s1Field);
    params.set("s1Dir", snap.s1Dir);
    params.set("s2Field", snap.s2Field);
    params.set("s2Dir", snap.s2Dir);
    params.set("s3Field", snap.s3Field);
    params.set("s3Dir", snap.s3Dir);
    if (extras?.selectedPoId) params.set("selected_po_id", extras.selectedPoId);
    if (extras?.selectedLineId) params.set("selected_line_id", extras.selectedLineId);
    if (extras?.drawer) params.set("drawer", "1");
    const qs = params.toString();
    return qs ? `/po/list?${qs}` : "/po/list";
  }, []);

  const replaceListUrl = React.useCallback((
    snap: ListStateSnapshot,
    extras?: { selectedPoId?: string | null; selectedLineId?: string | null; drawer?: boolean }
  ) => {
    router.replace(buildListUrl(snap, extras));
  }, [router, buildListUrl]);

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

  useEffect(() => {
    const loadVendors = async () => {
      try {
        const res = await fetch("/api/work-sheets/vendors?limit=2000", { cache: "no-store" });
        const json = await safeJson<any>(res);
        const base = json?.rows ?? json?.items ?? json?.data ?? [];
        const arr = Array.isArray(base) ? base : [];
        const normalized = arr
          .map((v: any) => ({
            id: String(v?.id ?? "").trim(),
            name: String(v?.company_name ?? v?.name ?? "").trim(),
          }))
          .filter((v: any) => v.id && v.name)
          .sort((a: any, b: any) => a.name.localeCompare(b.name));
        setVendorOptions(normalized);
      } catch (err) {
        console.error("loadVendors error:", err);
      }
    };
    void loadVendors();
  }, []);

  // ---------- fetch list ----------
  const fetchList = async (
    snapshotOrPage?: ListStateSnapshot | number,
    opts?: { restoreSelection?: boolean }
  ) => {
    setLoading(true);
    try {
      const snapshot: ListStateSnapshot =
        typeof snapshotOrPage === "number"
          ? { ...getSnapshotFromState(snapshotOrPage), page: snapshotOrPage }
          : snapshotOrPage ?? getSnapshotFromState();

      const p = snapshot.page || 1;
      const params = new URLSearchParams();
      params.set("page", String(p));
      params.set("pageSize", String(pageSize));
      if (snapshot.q.trim()) params.set("q", snapshot.q.trim());
      if (snapshot.status && snapshot.status !== "ALL") params.set("status", snapshot.status);
      if (snapshot.dateFrom) params.set("dateFrom", snapshot.dateFrom);
      if (snapshot.dateTo) params.set("dateTo", snapshot.dateTo);
      if (snapshot.shipDateFrom) params.set("shipDateFrom", snapshot.shipDateFrom);
      if (snapshot.shipDateTo) params.set("shipDateTo", snapshot.shipDateTo);
      if (snapshot.vendorId && snapshot.vendorId !== "ALL") params.set("vendor_id", snapshot.vendorId);
      if (snapshot.pendingOnly) params.set("pending_only", "true");
      if (snapshot.lateOnly) params.set("late_only", "true");

      params.set("s1Field", snapshot.s1Field);
      params.set("s1Dir", snapshot.s1Dir);
      params.set("s2Field", snapshot.s2Field);
      params.set("s2Dir", snapshot.s2Dir);
      params.set("s3Field", snapshot.s3Field);
      params.set("s3Dir", snapshot.s3Dir);

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

      const gt = json?.grandTotal;
      const gtc = json?.grandTotalsByCurrency;
      const ptc = json?.pageTotalsByCurrency;
      setGrandTotal(typeof gt === "number" ? gt : gt !== null && gt !== undefined ? Number(gt) : null);
      setGrandTotalsByCurrency(gtc && typeof gtc === "object" ? gtc : null);
      setPageTotalsByCurrency(ptc && typeof ptc === "object" ? ptc : null);

      if (opts?.restoreSelection && typeof window !== "undefined") {
        const qs = new URLSearchParams(window.location.search);
        const selectedPoId = (qs.get("selected_po_id") ?? "").trim();
        const selectedLineId = (qs.get("selected_line_id") ?? "").trim();
        const shouldOpenDrawer = qs.get("drawer") === "1";

        if (selectedPoId) {
          const matched = normalized.find((x: PoHeaderItem) => x.id === selectedPoId) ?? null;
          if (matched) {
            await loadLinesForPo(matched, {
              syncUrl: false,
              restoreLineId: selectedLineId || null,
              openDrawer: shouldOpenDrawer,
            });
            return;
          }
        }
      }

      setSelectedPo(null);
      setLines([]);
      setWsMap({});
      setSelectedLine(null);
      setDrawerOpen(false);
    } catch (err: any) {
      console.error("fetchList error:", err);
      alert(err?.message ?? "Unexpected error while loading list.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const snap = parseSnapshotFromUrl();
    applySnapshotToState(snap);
    setInitialSnapshot(snap);
    setUrlReady(true);
  }, [applySnapshotToState, parseSnapshotFromUrl]);

  useEffect(() => {
    if (!authLoading && role && urlReady && initialSnapshot) {
      void fetchList(initialSnapshot, { restoreSelection: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, role, urlReady, initialSnapshot]);

  const handleApply = () => {
    const snapshot = getSnapshotFromState(1);
    replaceListUrl(snapshot, { selectedPoId: null, selectedLineId: null, drawer: false });
    void fetchList(snapshot, { restoreSelection: false });
  };

  const handleClearFilters = () => {
    const snapshot = defaultListSnapshot();
    setSearchText("");
    setStatusFilter("ALL");
    setDateFrom("");
    setDateTo("");
    setShipDateFrom("");
    setShipDateTo("");
    setVendorFilter("ALL");
    setPendingOnly(false);
    setLateOnly(false);
    setS1Field("REQ_SHIP_DATE");
    setS1Dir("ASC");
    setS2Field("BRAND");
    setS2Dir("ASC");
    setS3Field("ORDER_DATE");
    setS3Dir("ASC");
    replaceListUrl(snapshot, { selectedPoId: null, selectedLineId: null, drawer: false });
    void fetchList(snapshot, { restoreSelection: false });
  };

  // ---------- load lines ----------
  const loadLinesForPo = async (
    po: PoHeaderItem,
    options?: { syncUrl?: boolean; restoreLineId?: string | null; openDrawer?: boolean }
  ) => {
    const syncUrl = options?.syncUrl !== false;
    const restoreLineId = options?.restoreLineId ?? null;
    const openDrawer = !!options?.openDrawer;

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
      let nextWsMap: Record<string, string> = {};
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
          nextWsMap = m;
          setWsMap(m);
        }
      }

      let restoredLine: PoLineItem | null = null;
      if (restoreLineId) {
        restoredLine =
          loadedLines.find((ln) => ln.id === restoreLineId) ?? null;
      }

      if (restoredLine && openDrawer) {
        const existing = nextWsMap[restoredLine.id] || restoredLine.work_sheet_id || null;
        const hasWs = existing && isUuid(existing);
        const merged = {
          ...restoredLine,
          work_sheet_id: hasWs ? (existing as any) : restoredLine.work_sheet_id,
        } as PoLineItem;
        setSelectedLine(merged);
        setDrawerOpen(true);
      } else {
        setSelectedLine(null);
        setDrawerOpen(false);
      }

      if (syncUrl) {
        const snapshot = getSnapshotFromState();
        replaceListUrl(snapshot, {
          selectedPoId: po.id,
          selectedLineId: restoredLine?.id ?? null,
          drawer: !!(restoredLine && openDrawer),
        });
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
  const handlePrev = () => {
    if (page <= 1) return;
    const snapshot = getSnapshotFromState(page - 1);
    replaceListUrl(snapshot, {
      selectedPoId: selectedPo?.id ?? null,
      selectedLineId: selectedLine?.id ?? null,
      drawer: drawerOpen,
    });
    void fetchList(snapshot, { restoreSelection: true });
  };
  const handleNext = () => {
    if (page >= totalPages) return;
    const snapshot = getSnapshotFromState(page + 1);
    replaceListUrl(snapshot, {
      selectedPoId: selectedPo?.id ?? null,
      selectedLineId: selectedLine?.id ?? null,
      drawer: drawerOpen,
    });
    void fetchList(snapshot, { restoreSelection: true });
  };

  const sortedItems = useMemo(() => items, [items]);

  // ---------- fetch ALL headers for export (ignores pagination) ----------
  async function fetchAllHeadersForExport(): Promise<PoHeaderItem[]> {
    const all: PoHeaderItem[] = [];
    const EXPORT_PAGE_SIZE = 200;

    let p = 1;
    while (true) {
      const params = new URLSearchParams();
      params.set("page", String(p));
      params.set("pageSize", String(EXPORT_PAGE_SIZE));
      if (searchText.trim()) params.set("q", searchText.trim());
      if (statusFilter && statusFilter !== "ALL") params.set("status", statusFilter);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      if (shipDateFrom) params.set("shipDateFrom", shipDateFrom);
      if (shipDateTo) params.set("shipDateTo", shipDateTo);
      if (vendorFilter && vendorFilter !== "ALL") params.set("vendor_id", vendorFilter);
      if (pendingOnly) params.set("pending_only", "true");
      if (lateOnly) params.set("late_only", "true");

      params.set("s1Field", s1Field);
      params.set("s1Dir", s1Dir);
      params.set("s2Field", s2Field);
      params.set("s2Dir", s2Dir);
      params.set("s3Field", s3Field);
      params.set("s3Dir", s3Dir);

      const res = await fetch(`/api/orders/list?${params.toString()}`);
      const json = await safeJson<any>(res);
      if (!res.ok) throw new Error(json?.error ?? "Failed to load data for export.");

      const rawItems = json?.items ?? [];
      const batch = rawItems.map(normalizeHeader) as PoHeaderItem[];
      all.push(...batch);

      if (!batch.length || batch.length < EXPORT_PAGE_SIZE) break;

      p += 1;
      if (p > 500) break;
    }

    return all;
  }

  // ---------- export excel ----------
  const handleExportExcel = async () => {
    if (total === 0) return alert("No data to export.");

    async function fetchLinesForHeaderId(headerId: string): Promise<PoLineItem[]> {
      const params = new URLSearchParams();
      params.set("detailFor", headerId);

      const res = await fetch(`/api/orders/list?${params.toString()}`);
      const json = await safeJson<any>(res);

      if (!res.ok) {
        throw new Error(json?.error ?? "Failed to load PO lines.");
      }

      const rawLines = json?.lines ?? [];
      return rawLines.map(normalizeLine);
    }

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

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("PO List", { views: [{ state: "frozen", ySplit: 6 }] });
    const headerFill = "FF374151";
    const sectionFill = "FFF3F4F6";
    const subtotalFill = "FFE5E7EB";
    const border = { style: "thin", color: { argb: "FFD1D5DB" } } as const;
    const moneyFmt = '#,##0.00;[Red]-#,##0.00';
    const qtyFmt = '#,##0';

    sheet.columns = [
      { width: 18 }, { width: 24 }, { width: 18 }, { width: 22 },
      { width: 14 }, { width: 16 }, { width: 14 }, { width: 10 },
      { width: 12 }, { width: 14 }, { width: 16 }, { width: 14 },
    ];

    sheet.mergeCells("A1:L1");
    sheet.getCell("A1").value = "Purchase Order List";
    sheet.getCell("A1").font = { bold: true, size: 18, color: { argb: "FF111827" } };
    sheet.getRow(1).height = 26;

    const sortLabel = `1) ${s1Field} ${s1Dir}  2) ${s2Field} ${s2Dir}  3) ${s3Field} ${s3Dir}`;
    sheet.mergeCells("A2:L2");
    sheet.getCell("A2").value = `Sort: ${sortLabel}`;
    sheet.getCell("A2").font = { size: 11, color: { argb: "FF334155" } };

    function styleHeader(row: ExcelJS.Row) {
      row.height = 22;
      row.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: headerFill } };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border = { top: border, left: border, bottom: border, right: border };
      });
    }

    function styleBody(row: ExcelJS.Row, moneyCols: number[] = [], qtyCols: number[] = []) {
      row.eachCell((cell, col) => {
        cell.border = { top: border, left: border, bottom: border, right: border };
        cell.alignment = { vertical: "middle", horizontal: moneyCols.includes(col) || qtyCols.includes(col) ? "right" : "left" };
        if (moneyCols.includes(col)) cell.numFmt = moneyFmt;
        if (qtyCols.includes(col)) cell.numFmt = qtyFmt;
      });
    }

    function styleTotal(row: ExcelJS.Row) {
      row.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FF111827" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: subtotalFill } };
      });
      styleBody(row, [10, 11], [9]);
    }

    sheet.addRow([]);
    const headerRow = sheet.addRow(header);
    styleHeader(headerRow);

    try {
      let grandSum = 0;
      let totalLines = 0;

      const allHeaders = await fetchAllHeadersForExport();
      const allSorted = multiSortItems(allHeaders, s1Field, s1Dir, s2Field, s2Dir, s3Field, s3Dir);
      sheet.getCell("A2").value = `Sort: ${sortLabel} | Total: ${allSorted.length} POs`;

      for (const it of allSorted) {
        const lines = await fetchLinesForHeaderId(it.id);
        const includeInTotals = !isCanceledPoStatus(it.status);

        let poSum = 0;

        if (!lines || lines.length === 0) {
          const headerSubtotal = typeof it.subtotal === "number" ? it.subtotal : 0;
          poSum = includeInTotals ? headerSubtotal : 0;
          grandSum += poSum;
          totalLines += 1;

          const row = sheet.addRow([
            it.poNo,
            it.buyerName ?? "-",
            it.mainBuyerBrand ?? "-",
            "-",
            it.orderDate ?? "-",
            it.reqShipDate ?? "-",
            it.shipMode ?? "-",
            it.currency ?? "-",
            "-",
            "-",
            headerSubtotal,
            it.status ?? "-",
          ]);
          styleBody(row, [10, 11], [9]);

          const subtotalRow = sheet.addRow([
            it.poNo,
            "",
            "",
            "PO Subtotal",
            "",
            "",
            "",
            it.currency ?? "-",
            "",
            "",
            poSum,
            "",
          ]);
          styleTotal(subtotalRow);

          sheet.addRow([]);
          continue;
        }

        lines.forEach((ln) => {
          totalLines += 1;
          const style =
            (ln.buyerStyleNo ?? "").trim() ||
            (ln.jmStyleNo ?? "").trim() ||
            "-";

          const qtyNum = typeof ln.qty === "number" ? ln.qty : null;

          const priceNum =
            typeof ln.price === "number"
              ? ln.price
              : typeof ln.unitPrice === "number"
                ? ln.unitPrice
                : null;

          let amount: number | null = null;
          if (typeof ln.amount === "number") amount = ln.amount;
          else if (typeof qtyNum === "number" && typeof priceNum === "number")
            amount = qtyNum * priceNum;

          if (includeInTotals && typeof amount === "number") poSum += amount;

          const row = sheet.addRow([
            it.poNo,
            it.buyerName ?? "-",
            it.mainBuyerBrand ?? "-",
            style,
            it.orderDate ?? "-",
            it.reqShipDate ?? "-",
            it.shipMode ?? "-",
            it.currency ?? "-",
            typeof qtyNum === "number" ? qtyNum : "-",
            typeof priceNum === "number" ? priceNum : "-",
            typeof amount === "number" ? amount : "-",
            it.status ?? "-",
          ]);
          styleBody(row, [10, 11], [9]);
        });

        grandSum += poSum;

        const subtotalRow = sheet.addRow([
          it.poNo,
          "",
          "",
          "PO Subtotal",
          "",
          "",
          "",
          it.currency ?? "-",
          "",
          "",
          poSum,
          "",
        ]);
        styleTotal(subtotalRow);

        sheet.addRow([]);
      }

      const curSet = new Set(allHeaders.map((x) => (x.currency ?? "").trim()).filter(Boolean));
      const curLabel = curSet.size === 1 ? Array.from(curSet)[0] : curSet.size === 0 ? "" : "MIX";
      const grandRow = sheet.addRow([
        "",
        "",
        "",
        "Grand Total",
        "",
        "",
        "",
        curLabel,
        "",
        "",
        grandSum,
        "",
      ]);
      styleTotal(grandRow);
      sheet.getCell("A2").value = `Sort: ${sortLabel} | Total: ${allSorted.length} POs / ${totalLines} Lines`;
    } catch (e: any) {
      console.error(e);
      alert(e?.message ?? "Failed to export.");
      return;
    }

    sheet.autoFilter = { from: "A4", to: "L4" };
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `po-list-${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // ---------- export pdf ----------
  const handleExportPdf = async () => {
    if (total === 0) return alert("No data to export.");

    async function fetchLinesForHeaderId(headerId: string): Promise<PoLineItem[]> {
      const params = new URLSearchParams();
      params.set("detailFor", headerId);

      const res = await fetch(`/api/orders/list?${params.toString()}`);
      const json = await safeJson<any>(res);

      if (!res.ok) {
        throw new Error(json?.error ?? "Failed to load PO lines.");
      }

      const rawLines = json?.lines ?? [];
      return rawLines.map(normalizeLine);
    }

    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });

    doc.setFontSize(14);
    doc.text("Purchase Order List", 40, 40);

    const sortLabel = `1) ${s1Field} ${s1Dir}  2) ${s2Field} ${s2Dir}  3) ${s3Field} ${s3Dir}`;
    const body: any[] = [];

    const nf0 = new Intl.NumberFormat("en-US");
    const nf2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    let totalLines = 0;
    let totalPOs = 0;

    try {
      let grandSum = 0;

      const allHeaders = await fetchAllHeadersForExport();
      const allSorted = multiSortItems(allHeaders, s1Field, s1Dir, s2Field, s2Dir, s3Field, s3Dir);
      totalPOs = allSorted.length;

      for (const it of allSorted) {
        const lines = await fetchLinesForHeaderId(it.id);
        const includeInTotals = !isCanceledPoStatus(it.status);

        let poSum = 0;

        if (!lines || lines.length === 0) {
          totalLines += 1;
          const headerSubtotal = typeof it.subtotal === "number" ? it.subtotal : 0;
          poSum = includeInTotals ? headerSubtotal : 0;

          body.push([
            it.poNo,
            it.buyerName ?? "-",
            it.mainBuyerBrand ?? "-",
            "-",
            it.orderDate ?? "-",
            it.reqShipDate ?? "-",
            it.shipMode ?? "-",
            it.currency ?? "-",
            "-",
            "-",
            nf2.format(headerSubtotal),
            it.status ?? "-",
          ]);

          body.push([
            "__PO_SUBTOTAL__",
            it.poNo,
            "",
            "PO Subtotal",
            "",
            "",
            "",
            it.currency ?? "-",
            "",
            "",
            nf2.format(poSum),
            "",
          ]);

          grandSum += poSum;
          continue;
        }

        lines.forEach((ln, idx) => {
          totalLines += 1;

          const style =
            (ln.buyerStyleNo ?? "").trim() ||
            (ln.jmStyleNo ?? "").trim() ||
            "-";

          const qtyNum = typeof ln.qty === "number" ? ln.qty : null;
          const qty = typeof qtyNum === "number" ? nf0.format(qtyNum) : "-";

          const priceNum =
            typeof ln.price === "number"
              ? ln.price
              : typeof ln.unitPrice === "number"
                ? ln.unitPrice
                : null;

          const unitPrice = typeof priceNum === "number" ? nf2.format(priceNum) : "-";

          let amount: number | null = null;
          if (typeof ln.amount === "number") amount = ln.amount;
          else if (typeof qtyNum === "number" && typeof priceNum === "number")
            amount = qtyNum * priceNum;

          if (includeInTotals && typeof amount === "number") poSum += amount;

          const showHeaderCols = idx === 0;

          body.push([
            showHeaderCols ? it.poNo : "",
            showHeaderCols ? (it.buyerName ?? "-") : "",
            showHeaderCols ? (it.mainBuyerBrand ?? "-") : "",
            style,
            showHeaderCols ? (it.orderDate ?? "-") : "",
            showHeaderCols ? (it.reqShipDate ?? "-") : "",
            showHeaderCols ? (it.shipMode ?? "-") : "",
            showHeaderCols ? (it.currency ?? "-") : "",
            qty,
            unitPrice,
            typeof amount === "number" ? nf2.format(amount) : "-",
            showHeaderCols ? (it.status ?? "-") : "",
          ]);
        });

        body.push([
          "__PO_SUBTOTAL__",
          it.poNo,
          "",
          "PO Subtotal",
          "",
          "",
          "",
          it.currency ?? "-",
          "",
          "",
          nf2.format(poSum),
          "",
        ]);

        grandSum += poSum;
      }

      const curSet = new Set(allSorted.map((x) => (x.currency ?? "").trim()).filter(Boolean));
      const curLabel = curSet.size === 1 ? Array.from(curSet)[0] : curSet.size === 0 ? "" : "MIX";
      body.push([
        "__GRAND_TOTAL__",
        "",
        "",
        "Grand Total",
        "",
        "",
        "",
        curLabel,
        "",
        "",
        nf2.format(grandSum),
        "",
      ]);
    } catch (e: any) {
      console.error(e);
      alert(e?.message ?? "Failed to export.");
      return;
    }

    doc.setFontSize(9);
    doc.text(
      `Sort: ${sortLabel} | Total: ${totalPOs} POs / ${totalLines} Lines`,
      40,
      58
    );

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
      body,
      styles: { fontSize: 8, cellPadding: 3, overflow: "linebreak" },
      margin: { left: 24, right: 24 },
      headStyles: { fillColor: [40, 130, 180], textColor: 255 },
      columnStyles: {
        0: { cellWidth: 68 },
        1: { cellWidth: 95 },
        2: { cellWidth: 68 },
        3: { cellWidth: 95 },
        4: { cellWidth: 60 },
        5: { cellWidth: 66 },
        6: { cellWidth: 52 },
        7: { cellWidth: 34 },
        8: { cellWidth: 46, halign: "right" },
        9: { cellWidth: 52, halign: "right" },
        10: { cellWidth: 62, halign: "right" },
        11: { cellWidth: 60, halign: "center", overflow: "ellipsize" },
      },
      didParseCell: (data) => {
        const rawRow = (data.row as any)?.raw as any[];
        const marker = rawRow?.[0];
        if (data.section === "body" && (marker === "__PO_SUBTOTAL__" || marker === "__GRAND_TOTAL__")) {
          data.cell.text = [""];
          if (data.column.index === 3) data.cell.text = [marker === "__GRAND_TOTAL__" ? "Grand Total" : "PO Subtotal"];
          if (data.column.index === 10) data.cell.text = [String(rawRow?.[10] ?? "")];
          if (data.column.index === 7) data.cell.text = [String(rawRow?.[7] ?? "")];

          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = marker === "__GRAND_TOTAL__" ? [230, 230, 230] : [245, 245, 245];
        }

        if (data.section === "body" && data.column.index === 0) {
          const v = String((data.cell.raw as any) ?? "");
          if (v === "__PO_SUBTOTAL__" || v === "__GRAND_TOTAL__") data.cell.text = [""];
        }
      },
      didDrawPage: function () {
        const pageCount = (doc as any).internal.getNumberOfPages?.() || 1;
        const pageNum = (doc as any).internal.getCurrentPageInfo?.().pageNumber || 1;

        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();

        doc.setFontSize(9);
        const text = `Page ${pageNum} / ${pageCount}`;
        doc.text(text, pageW / 2, pageH - 20, { align: "center" });
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


  const loadDuplicateCandidates = async (
    po: PoHeaderItem,
    line: PoLineItem,
    qOverride?: string
  ) => {
    setDuplicateLoading(true);
    try {
      const sp = new URLSearchParams();
      sp.set("po_header_id", po.id);
      sp.set("po_line_id", line.id);
      const q = (qOverride ?? duplicateQuery).trim();
      if (q) sp.set("q", q);

      const res = await fetch(`/api/work-sheets/duplicate-from-existing?${sp.toString()}`, {
        cache: "no-store",
      });
      const json = await safeJson<any>(res);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error ?? "Failed to load duplicate candidates.");
      }
      setDuplicateCandidates(Array.isArray(json?.rows) ? json.rows : []);
    } catch (e: any) {
      console.error("loadDuplicateCandidates error:", e);
      alert(e?.message || "Failed to load duplicate candidates.");
      setDuplicateCandidates([]);
    } finally {
      setDuplicateLoading(false);
    }
  };

  const openDuplicateDialog = async (po: PoHeaderItem, line: PoLineItem) => {
    setDuplicateTargetPo(po);
    setDuplicateTargetLine(line);
    setDuplicateQuery("");
    setDuplicateCandidates([]);
    setDuplicateOpen(true);
    await loadDuplicateCandidates(po, line, "");
  };

  const runDuplicateFromExisting = async (candidate: DuplicateCandidate) => {
    if (!duplicateTargetPo || !duplicateTargetLine) return;
    try {
      setDuplicating(true);

      const res = await fetch("/api/work-sheets/duplicate-from-existing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_po_header_id: duplicateTargetPo.id,
          target_po_line_id: duplicateTargetLine.id,
          source_work_sheet_id: candidate.source_work_sheet_id,
          source_work_sheet_line_id: candidate.source_work_sheet_line_id,
        }),
      });

      const json = await safeJson<any>(res);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error ?? "Failed to duplicate from existing WS.");
      }

      const wsId = pickWsId(json);
      if (!wsId) throw new Error("work_sheet_id missing after duplicate.");

      setWsMap((prev) => ({ ...prev, [duplicateTargetLine.id]: wsId }));
      setDuplicateOpen(false);
      router.push(`/work-sheets/${wsId}`);
    } catch (e: any) {
      console.error("runDuplicateFromExisting error:", e);
      alert(e?.message || "Copy Previous WS failed");
    } finally {
      setDuplicating(false);
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
            </div>

            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={() => router.push("/po/create")}>
                New PO
              </Button>
              <Button type="button" onClick={() => { const snapshot = getSnapshotFromState(page); replaceListUrl(snapshot, { selectedPoId: selectedPo?.id ?? null, selectedLineId: selectedLine?.id ?? null, drawer: drawerOpen }); void fetchList(snapshot, { restoreSelection: true }); }} disabled={loading}>
                {loading ? "Refreshing..." : "Refresh"}
              </Button>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            {/* Filters + Sort */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-12 gap-4 items-end">
              <div className="space-y-1 xl:col-span-3">
                <Label>Search</Label>
                <Input
                  placeholder="PO No or Buyer Name"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleApply()}
                />
              </div>

              <div className="space-y-1 xl:col-span-3">
                <Label>Status</Label>
                <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Status" />
                  </SelectTrigger>
                  <SelectContent className="z-50">
                    <SelectItem value="ALL">All Status</SelectItem>
                    <SelectItem value="OPEN">OPEN</SelectItem>
                    <SelectItem value="PARTIAL">PARTIAL</SelectItem>
                    <SelectItem value="ALLOCATED">ALLOCATED</SelectItem>
                    <SelectItem value="SHIPPED">SHIPPED</SelectItem>
                    <SelectItem value="CLOSED">CLOSED</SelectItem>
                    <SelectItem value="CANCELLED">CANCELED</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1 xl:col-span-3">
                <Label>Vendor</Label>
                <Select value={vendorFilter} onValueChange={(v) => setVendorFilter(v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Vendors" />
                  </SelectTrigger>
                  <SelectContent className="z-50">
                    <SelectItem value="ALL">All Vendors</SelectItem>
                    {vendorOptions.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1 xl:col-span-3">
                <Label className="opacity-0">Options</Label>
                <div className="flex flex-col gap-2 rounded-md border px-2.5 py-2">
                  <label className="flex items-center gap-1.5 text-xs whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={pendingOnly}
                      onChange={(e) => setPendingOnly(e.target.checked)}
                    />
                    <span>Pending Only</span>
                  </label>
                  <label className="flex items-center gap-1.5 text-xs whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={lateOnly}
                      onChange={(e) => setLateOnly(e.target.checked)}
                    />
                    <span>Late Only</span>
                  </label>
                </div>
              </div>

              <div className="space-y-1 xl:col-span-3">
                <Label>Order Date (From)</Label>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>

              <div className="space-y-1 xl:col-span-3">
                <Label>Order Date (To)</Label>
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>

              <div className="space-y-1 xl:col-span-3">
                <Label>Ship Date (From)</Label>
                <Input type="date" value={shipDateFrom} onChange={(e) => setShipDateFrom(e.target.value)} />
              </div>

              <div className="space-y-1 xl:col-span-3">
                <Label>Ship Date (To)</Label>
                <Input type="date" value={shipDateTo} onChange={(e) => setShipDateTo(e.target.value)} />
              </div>

              <div className="flex gap-2 justify-end md:col-span-2 xl:col-span-12">
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
                    {items.length === 0 && !loading && (
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
                          onClick={() => void loadLinesForPo(it)}
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
                          <td className="px-4 py-2">
                            <span className={getStatusBadgeClass(it.status)}>{it.status ?? "-"}</span>
                          </td>

                          <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center gap-2">
                              <Button type="button" variant="outline" size="sm" onClick={() => handleView(it)}>
                                View
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
                <div className="text-sm text-slate-600">
                  Page Subtotal:{" "}
                  <span className="font-semibold">
                    {(() => {
                      const entries = Object.entries(pageTotalsByCurrency ?? {}).filter(
                        ([cur, val]) => !!cur && typeof val === "number" && Number.isFinite(val)
                      );

                      if (entries.length === 0) {
                        const sum = items.reduce(
                          (acc, it) =>
                            acc +
                            (typeof it.subtotal === "number" && Number.isFinite(it.subtotal)
                              ? it.subtotal
                              : 0),
                          0
                        );
                        const curLabel = items.length === 0 ? "" : "MIX";
                        return (curLabel ? `${curLabel} ` : "") + fmtMoney2(sum);
                      }

                      if (entries.length === 1) {
                        const [cur, val] = entries[0] as [string, number];
                        return `${cur} ${fmtMoney2(val)}`;
                      }

                      const shown = entries
                        .slice(0, 3)
                        .map(([cur, val]) => `${cur} ${fmtMoney2(val as number)}`)
                        .join(" / ");
                      const more = entries.length > 3 ? ` (+${entries.length - 3})` : "";
                      return `${shown}${more}`;
                    })()}
                  </span>
                </div>
                <div className="text-sm text-slate-600">
                  Grand Total (All Pages):{" "}
                  <span className="font-semibold">
                    {fmtTotalsByCurrency(grandTotalsByCurrency) || "-"}
                  </span>
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

            <div className="grid grid-cols-1 gap-4">
              <Card>
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
                              <th className="px-3 py-2 border-b">Img</th>
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
                                <td colSpan={11} className="px-3 py-4 text-center text-slate-400">
                                  Loading...
                                </td>
                              </tr>
                            )}
                            {!linesLoading && lines.length === 0 && (
                              <tr>
                                <td colSpan={11} className="px-3 py-4 text-center text-slate-400">
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

                              const imgSrc = resolveImageUrlFromStorage(supabase, ln.imageUrl);

                              return (
                                <tr
                                  key={ln.id}
                                  className="border-t hover:bg-sky-50 cursor-pointer"
                                  onClick={() => {
                                    const nextLine = { ...ln, work_sheet_id: hasWs ? (existing as any) : ln.work_sheet_id };
                                    setSelectedLine(nextLine);
                                    setDrawerOpen(true);
                                    const snapshot = getSnapshotFromState();
                                    replaceListUrl(snapshot, {
                                      selectedPoId: selectedPo?.id ?? null,
                                      selectedLineId: ln.id,
                                      drawer: true,
                                    });
                                  }}
                                >
                                  <td className="px-3 py-2">{ln.lineNo ?? "-"}</td>
                                  <td className="px-3 py-2">{ln.jmStyleNo ?? "-"}</td>
                                  <td className="px-3 py-2">{ln.buyerStyleNo ?? "-"}</td>
                                  <td className="px-3 py-2">
                                    <button
                                      type="button"
                                      className="w-10 h-10 rounded-md border bg-white overflow-hidden flex items-center justify-center hover:ring-2 hover:ring-sky-200"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const nextLine = { ...ln, work_sheet_id: hasWs ? (existing as any) : ln.work_sheet_id };
                                        setSelectedLine(nextLine);
                                        setDrawerOpen(true);
                                        const snapshot = getSnapshotFromState();
                                        replaceListUrl(snapshot, {
                                          selectedPoId: selectedPo?.id ?? null,
                                          selectedLineId: ln.id,
                                          drawer: true,
                                        });
                                      }}
                                      title={imgSrc ? imgSrc : "Open detail"}
                                    >
                                      {isNonEmptyString(imgSrc) ? (
                                        <img
                                          src={imgSrc}
                                          alt="Style"
                                          className="w-full h-full object-cover"
                                        />
                                      ) : (
                                        <span className="text-[10px] text-slate-400">No</span>
                                      )}
                                    </button>
                                  </td>
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
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onClickWorkSheet(selectedPo, ln);
                                      }}
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
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Right Drawer: Line Detail */}
      {drawerOpen && selectedPo && selectedLine && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => {
              setDrawerOpen(false);
              setSelectedLine(null);
              const snapshot = getSnapshotFromState();
              replaceListUrl(snapshot, { selectedPoId: selectedPo?.id ?? null, selectedLineId: null, drawer: false });
            }}
          />

          <div className="absolute right-0 top-0 h-full w-full sm:w-[420px] bg-white shadow-xl flex flex-col">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <div>
                <div className="text-sm text-slate-500">Line Detail</div>
                <div className="font-semibold text-slate-900">
                  {selectedLine.buyerStyleNo ?? selectedLine.jmStyleNo ?? "-"}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDrawerOpen(false);
                  setSelectedLine(null);
                  const snapshot = getSnapshotFromState();
                  replaceListUrl(snapshot, { selectedPoId: selectedPo?.id ?? null, selectedLineId: null, drawer: false });
                }}
              >
                Close
              </Button>
            </div>

            <div className="p-4 space-y-4 overflow-y-auto">
              <div className="text-xs text-slate-500">
                <span className="font-semibold">PO:</span> {selectedPo.poNo} / {selectedPo.buyerName ?? "-"}
              </div>

              <div className="border rounded-xl bg-slate-50 p-3">
                <div className="text-xs text-slate-500 mb-2">Style Image</div>
                {(() => {
                  const imgSrc = resolveImageUrlFromStorage(supabase, selectedLine.imageUrl);
                  return isNonEmptyString(imgSrc) ? (
                  <img
                    src={imgSrc}
                    alt="Style"
                    className="w-full h-64 object-contain bg-white rounded-lg"
                  />
                  ) : (
                  <div className="w-full h-64 flex items-center justify-center rounded-lg border bg-white">
                    <span className="text-xs text-slate-400">No image mapped yet</span>
                  </div>
                  );
                })()}
                <div className="text-[11px] text-slate-400 mt-2">
                  (이미지 URL 매핑은 다음 단계에서 연결)
                </div>
              </div>

              <div className="border rounded-xl p-3">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-xs text-slate-500">Line</div>
                    <div className="font-medium">{selectedLine.lineNo ?? "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Shipment</div>
                    <div className="font-medium">
                      {selectedLine.shipmentMode ?? selectedPo.shipMode ?? "-"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">JM No</div>
                    <div className="font-medium">{selectedLine.jmStyleNo ?? "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Buyer Style</div>
                    <div className="font-medium">{selectedLine.buyerStyleNo ?? "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Brand</div>
                    <div className="font-medium">
                      {selectedLine.buyerBrand ?? selectedPo.mainBuyerBrand ?? "-"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Delivery</div>
                    <div className="font-medium">
                      {selectedLine.deliveryDate ?? selectedPo.reqShipDate ?? "-"}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                {(() => {
                  const existing = wsMap[selectedLine.id] || selectedLine.work_sheet_id || null;
                  const hasWs = existing && isUuid(existing);
                  return (
                    <>
                      <Button
                        className="flex-1"
                        onClick={() => onClickWorkSheet(selectedPo, selectedLine)}
                        disabled={creatingLineId === selectedLine.id}
                      >
                        {creatingLineId === selectedLine.id
                          ? "Working..."
                          : hasWs
                            ? "Open WS"
                            : "Create WS"}
                      </Button>
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={() => openDuplicateDialog(selectedPo, selectedLine)}
                        disabled={duplicating}
                      >
                        Copy Previous WS
                      </Button>
                    </>
                  );
                })()}
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setDrawerOpen(false);
                    setSelectedLine(null);
                  }}
                >
                  Back
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <Dialog open={duplicateOpen} onOpenChange={setDuplicateOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Duplicate from Existing WS</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-lg border bg-slate-50 p-3 text-sm">
              <div>
                <span className="font-semibold">Target PO:</span>{" "}
                {duplicateTargetPo?.poNo ?? "-"} / {duplicateTargetPo?.buyerName ?? "-"}
              </div>
              <div className="mt-1">
                <span className="font-semibold">Target Style:</span>{" "}
                {duplicateTargetLine?.buyerStyleNo ?? duplicateTargetLine?.jmStyleNo ?? "-"}
              </div>
            </div>

            <div className="flex gap-2">
              <Input
                value={duplicateQuery}
                onChange={(e) => setDuplicateQuery(e.target.value)}
                placeholder="Search previous WS by WS No / PO / Buyer / Style"
              />
              <Button
                onClick={() => {
                  if (duplicateTargetPo && duplicateTargetLine) {
                    void loadDuplicateCandidates(duplicateTargetPo, duplicateTargetLine, duplicateQuery);
                  }
                }}
                disabled={duplicateLoading || !duplicateTargetPo || !duplicateTargetLine}
              >
                {duplicateLoading ? "Searching..." : "Search"}
              </Button>
            </div>

            <div className="max-h-[420px] overflow-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left">
                    <th>WS No</th>
                    <th>PO No</th>
                    <th>Buyer</th>
                    <th>JM No</th>
                    <th>Buyer Style</th>
                    <th>Updated</th>
                    <th className="text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {duplicateLoading ? (
                    <tr className="border-t">
                      <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                        Loading...
                      </td>
                    </tr>
                  ) : duplicateCandidates.length === 0 ? (
                    <tr className="border-t">
                      <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                        No previous WS found.
                      </td>
                    </tr>
                  ) : (
                    duplicateCandidates.map((c) => (
                      <tr key={`${c.source_work_sheet_id}-${c.source_work_sheet_line_id}`} className="border-t">
                        <td className="px-3 py-2 font-medium">{c.ws_no ?? "-"}</td>
                        <td className="px-3 py-2">{c.po_no ?? "-"}</td>
                        <td className="px-3 py-2">{c.buyer_name ?? "-"}</td>
                        <td className="px-3 py-2">{c.jm_style_no ?? "-"}</td>
                        <td className="px-3 py-2">{c.buyer_style ?? "-"}</td>
                        <td className="px-3 py-2">{c.updated_at ? String(c.updated_at).slice(0, 10) : "-"}</td>
                        <td className="px-3 py-2 text-right">
                          <Button
                            size="sm"
                            onClick={() => void runDuplicateFromExisting(c)}
                            disabled={duplicating}
                          >
                            {duplicating ? "Working..." : "Use This WS"}
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="text-xs text-slate-500">
              * Planned notes / materials / vendor setup are copied. Actual cost / confirm / vendor delivery tracking are reset.
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
