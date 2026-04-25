"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";

import AppShell from "@/components/layout/AppShell";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { toast } from "sonner";

type WorkSheetHeader = {
  id: string;
  po_header_id: string | null;
  po_no: string | null;
  work_sheet_no?: string | null;
  ws_no?: string | null;
  buyer_id: string | null;
  buyer_name: string | null;
  buyer_code: string | null;
  currency: string | null;
  status: string;

  // ✅ header notes
  // DB/route normalize가 여러 키를 내려줄 수 있어서(프로젝트 이력/호환성),
  // UI는 아래 우선순위로 읽고 저장 시에는 가능한 키를 함께 갱신한다.
  // - Special Instructions: special_instructions -> general_notes
  // - Internal Notes: internal_notes -> internal_memo -> notes
  special_instructions?: string | null;
  general_notes?: string | null;

  internal_notes?: string | null;
  internal_memo?: string | null;
  notes: string | null;

  created_at?: string | null;
  updated_at?: string | null;
};

type WorkSheetLine = {
  id: string;
  work_sheet_id: string;
  po_line_id: string | null;

  product_id: string | null;
  jm_style_no: string;

  buyer_style: string | null;
  description: string | null;

  qty: number;

  image_url_primary: string | null;
  image_urls: any | null;

  plating_color?: string | null;
  plating_spec?: string | null;
  spec_summary?: string | null;

  // ✅ Work/QC/Packing은 line에 존재
  work_notes?: string | null;
  qc_points?: string | null;
  packing_notes?: string | null;

  vendor_id?: string | null;
  vendor_currency?: string | null;
  vendor_unit_cost_local?: number | null;
  fx_rate?: number | null;
  fx_as_of?: string | null;
  fx_mode?: string | null;
  vendor_unit_cost_usd?: number | null;

  // ✅ Production cost mode & actual (post) cost
  production_mode?: "IN_HOUSE" | "OUTSOURCED" | null;
  outsourcing_type?: OutsourcingType | null;
  internal_material_cost?: number | null;
  inhouse_extra_material_actual?: number | null;
  inhouse_extra_processing_actual?: number | null;

  actual_vendor_unit_cost_local?: number | null;
  actual_vendor_unit_cost_usd?: number | null;
  actual_fx_rate?: number | null;
  actual_fx_as_of?: string | null;
  actual_fx_mode?: string | null;

  actual_cost_confirmed?: boolean;
  actual_cost_confirmed_at?: string | null;
  actual_cost_confirmed_by?: string | null;
  actual_cost_notes?: string | null;

  // synced actual summary fields used by profitability / downstream saves
  actual_unit?: number | null;
  actual_qty?: number | null;
  actual_amt?: number | null;

  // ✅ vendor delivery tracking
  vendor_ready_date?: string | null;
  vendor_delivery_status?: "PENDING" | "ON_TIME" | "LATE" | null;
  vendor_delay_days?: number | null;

  is_deleted?: boolean;
};

type CompanyOption = {
  id: string;
  company_name: string | null;
  code: string | null;
  company_type?: string | null;
};

type OutsourcingType = "FULL" | "PROCESSING";

type SourcePolicy = "MANDATORY" | "PREFERRED" | "FREE";

type WorkSheetMaterialSpec = {
  id: string;
  work_sheet_line_id: string;

  material_type: string | null;
  material_name: string;
  spec_text: string | null;
  color: string | null;

  source_policy: SourcePolicy;
  source_vendor_id: string | null;
  source_vendor_text: string | null;
  note: string | null;
  sort_order: number;
  is_deleted?: boolean;

  // ✅ IN_HOUSE internal-only post cost inputs
  actual_qty?: number | null;
  actual_unit_cost?: number | null;
  actual_note?: string | null;
};

type ApiGetResponse = {
  success: boolean;
  header?: WorkSheetHeader | null;
  lines?: WorkSheetLine[];
  materialsByLineId?: Record<string, WorkSheetMaterialSpec[]>;
  po?: any;
  error?: string;
};

type ApiSaveResponse = ApiGetResponse;

function nnum(v: any, fallback = 0) {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isNaN(n) ? fallback : n;
}
function toStr(v: any) {
  return v === null || v === undefined ? "" : String(v);
}

function nnumNullable(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

// ✅ decimal helpers (allow up to 4 decimals while typing)
const DEC4_RE = /^\d*(\.\d{0,4})?$/;
function normalizeDec4Input(raw: string): string {
  const v0 = (raw ?? "").trim();
  if (v0 === "") return "";

  // keep digits and dots only
  let v = v0.replace(/[^0-9.]/g, "");

  // allow leading dot: ".5" -> "0.5"
  if (v.startsWith(".")) v = "0" + v;

  // keep only the first dot
  const firstDot = v.indexOf(".");
  if (firstDot >= 0) {
    const intPart = v.slice(0, firstDot);
    const rest = v.slice(firstDot + 1).replace(/\./g, "");
    const decPart = rest.slice(0, 4);
    // if user is typing trailing dot, preserve it ("1.")
    if (v.endsWith(".") && rest.length === 0) return intPart + ".";
    return decPart.length ? `${intPart}.${decPart}` : `${intPart}.`;
  }

  // no dot
  return v;
}
function parseDec4ToNumber(raw: string): number | null {
  const v = (raw ?? "").trim();
  if (v === "" || v === "." || v === "-") return null;
  const n = Number(v);
  if (Number.isNaN(n)) return null;
  // round to 4 decimals max to keep consistent
  return Math.round(n * 10000) / 10000;
}

// ✅ decimal helpers (allow up to 2 decimals while typing) - for vendor subcontract price
const DEC2_RE = /^\d*(\.\d{0,2})?$/;
function normalizeDec2Input(raw: string): string {
  const v0 = (raw ?? "").trim();
  if (v0 === "") return "";

  let v = v0.replace(/[^0-9.]/g, "");
  if (v.startsWith(".")) v = "0" + v;

  const firstDot = v.indexOf(".");
  if (firstDot >= 0) {
    const intPart = v.slice(0, firstDot);
    const rest = v.slice(firstDot + 1).replace(/\./g, "");
    const decPart = rest.slice(0, 2);
    if (v.endsWith(".") && rest.length === 0) return intPart + ".";
    return decPart.length ? `${intPart}.${decPart}` : `${intPart}.`;
  }
  return v;
}
function parseDec2ToNumber(raw: string): number | null {
  const v = (raw ?? "").trim();
  if (v === "" || v === ".") return null;
  const n = Number(v);
  if (Number.isNaN(n)) return null;
  return Math.round(n * 100) / 100;
}

function safeArray(v: any): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String);
  try {
    const parsed = typeof v === "string" ? JSON.parse(v) : v;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
function fmtDate(d?: string | null) {
  if (!d) return "";
  return String(d).slice(0, 10);
}
function addDaysYmd(ymd?: string | null, deltaDays: number = 0) {
  if (!ymd) return "";
  const s = String(ymd).slice(0, 10);
  const m = /^\d{4}-\d{2}-\d{2}$/.exec(s);
  if (!m) return "";
  const [y, mo, d] = s.split("-").map((x) => Number(x));
  const dt = new Date(Date.UTC(y, mo - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function calcVendorDelivery(
  requestedShipDate?: string | null,
  vendorReadyDate?: string | null
): { dueDate: string | null; status: "PENDING" | "ON_TIME" | "LATE"; delayDays: number | null } {
  const req = (requestedShipDate ?? "").toString().slice(0, 10);
  if (!req) return { dueDate: null, status: "PENDING", delayDays: null };

  const dueDate = addDaysYmd(req, -7);
  const ready = (vendorReadyDate ?? "").toString().slice(0, 10);
  if (!ready) return { dueDate, status: "PENDING", delayDays: null };

  const due = new Date(`${dueDate}T00:00:00`);
  const actual = new Date(`${ready}T00:00:00`);
  const diff = Math.round((actual.getTime() - due.getTime()) / 86400000);

  return {
    dueDate,
    status: diff <= 0 ? "ON_TIME" : "LATE",
    delayDays: diff,
  };
}

function stableStringify(obj: any): string {
  const seen = new WeakSet();
  const replacer = (_k: string, v: any) => {
    if (v && typeof v === "object") {
      if (seen.has(v)) return;
      seen.add(v);

      if (Array.isArray(v)) return v;

      const keys = Object.keys(v).sort();
      const out: any = {};
      for (const k of keys) out[k] = v[k];
      return out;
    }
    return v;
  };
  return JSON.stringify(obj, replacer);
}

function extractQtyFromNote(note?: string | null): number | null {
  const s = (note ?? "").toString();
  const m = s.match(/\bQTY\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)\b/i);
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function extractUnitCostFromNote(note?: string | null): number | null {
  const s = (note ?? "").toString();
  const m = s.match(/\bUNIT[_\s-]*COST\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)\b/i);
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function stripQtyCostTokens(note?: string | null): string {
  let s = (note ?? "").toString();
  s = s.replace(/\bQTY\s*[:=]\s*[0-9]+(?:\.[0-9]+)?\b/gi, "");
  s = s.replace(/\bUNIT[_\s-]*COST\s*[:=]\s*[0-9]+(?:\.[0-9]+)?\b/gi, "");
  s = s.replace(/^[,\s]+|[,\s]+$/g, "");
  s = s.replace(/\s*,\s*/g, ", ");
  return s.trim();
}

function fmtMoney(v: any): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

function fmtWsRemarks(
  specText?: string | null,
  color?: string | null,
  note?: string | null
): string {
  const parts: string[] = [];
  const st = (specText ?? "").toString().trim();
  const c = (color ?? "").toString().trim();
  const n = stripQtyCostTokens(note);
  if (st) parts.push(`Spec: ${st}`);
  if (c) parts.push(`Color: ${c}`);
  if (n) parts.push(n);
  return parts.join(" / ");
}

function calcMaterialsPlannedAmt(specs: WorkSheetMaterialSpec[] = []): number {
  return (specs ?? [])
    .filter((s) => !s?.is_deleted)
    .reduce((acc, s) => {
      const q = extractQtyFromNote(s?.note) ?? 0;
      const u = extractUnitCostFromNote(s?.note) ?? 0;
      return acc + Number(q) * Number(u);
    }, 0);
}

function calcPlannedUnitUsd(localUnit: any, currency?: string | null, fxRate?: any): number | null {
  const local = Number(localUnit ?? 0);
  if (!Number.isFinite(local) || local <= 0) return null;
  const cur = String(currency ?? "USD").trim().toUpperCase();
  if (!cur || cur === "USD") return Math.round(local * 1000000) / 1000000;
  const fx = Number(fxRate ?? 0);
  if (!Number.isFinite(fx) || fx <= 0) return null;
  return Math.round((local / fx) * 1000000) / 1000000;
}

function calcActualVendorUnitUsd(localUnit: any, currency?: string | null, fxRate?: any): number | null {
  return calcPlannedUnitUsd(localUnit, currency, fxRate);
}

function fmtFxMeta(currency?: string | null, localUnit?: any, fxRate?: any): string {
  const cur = String(currency ?? "USD").trim().toUpperCase() || "USD";
  const local = Number(localUnit ?? 0);
  if (cur === "USD") return `Local ${fmtMoney(local)} USD`;
  const fx = Number(fxRate ?? 0);
  if (!Number.isFinite(fx) || fx <= 0) return `Local ${fmtMoney(local)} ${cur} / FX not set`;
  return `Local ${fmtMoney(local)} ${cur} / FX ${fmtMoney(fx)} ${cur} per 1 USD`;
}

function calcMaterialsActualAmt(specs: WorkSheetMaterialSpec[] = []): number {
  return (specs ?? [])
    .filter((s) => !s?.is_deleted)
    .reduce((acc, s) => {
      const plannedQty = extractQtyFromNote(s?.note);
      const actualQty = (s as any)?.actual_qty ?? null;
      const qtyForActual = actualQty ?? plannedQty ?? 1;
      const actualUnit = (s as any)?.actual_unit_cost ?? null;
      if (actualUnit === null || actualUnit === undefined) return acc;
      return acc + Number(qtyForActual) * Number(actualUnit);
    }, 0);
}

function calcOutsourcedActualAmt(
  qty: any,
  actualVendorUnitCostLocal: any
): number {
  const q = Number(qty ?? 0);
  const u = Number(actualVendorUnitCostLocal ?? 0);
  if (!Number.isFinite(q) || !Number.isFinite(u)) return 0;
  return q * u;
}

function resolveOutsourcingType(line: WorkSheetLine | null | undefined): OutsourcingType {
  return (((line as any)?.outsourcing_type ?? "FULL") as OutsourcingType);
}

function resolveProcessingMaterialLocal(
  line: WorkSheetLine | null | undefined,
  specs: WorkSheetMaterialSpec[] = []
): number {
  const override = nnumNullable((line as any)?.internal_material_cost);
  if (override !== null && override !== undefined) return override;
  return calcMaterialsPlannedAmt(specs);
}

function calcLineActualSync(
  line: WorkSheetLine,
  specs: WorkSheetMaterialSpec[] = [],
  vendorActualRaw?: string
) {
  const mode =
    (line as any)?.production_mode ?? (line?.vendor_id ? "OUTSOURCED" : "IN_HOUSE");

  const outsourcingType = resolveOutsourcingType(line);
  const materialLocalPlanned = resolveProcessingMaterialLocal(line, specs);
  const vendorLocalPlanned = nnumNullable((line as any)?.vendor_unit_cost_local) ?? 0;
  const plannedCurrency = (line as any)?.vendor_currency ?? "CNY";
  const plannedFxRate = nnumNullable((line as any)?.fx_rate) ?? null;
  const actualQty = nnumNullable((line as any)?.qty) ?? 0;

  if (mode === "OUTSOURCED") {
    const plannedLocalUnit =
      outsourcingType === "PROCESSING"
        ? materialLocalPlanned + vendorLocalPlanned
        : vendorLocalPlanned;
    const plannedUnitUsd = calcPlannedUnitUsd(
      plannedLocalUnit,
      plannedCurrency,
      plannedFxRate
    );

    const parsedVendorActual = parseDec2ToNumber(vendorActualRaw ?? "");
    const vendorActualLocal =
      parsedVendorActual ?? ((line as any)?.actual_vendor_unit_cost_local ?? null);
    const actualFxRate =
      nnumNullable((line as any)?.actual_fx_rate) ?? plannedFxRate ?? null;
    const actualCurrency = (line as any)?.vendor_currency ?? "USD";
    const vendorActualUnitUsd = calcActualVendorUnitUsd(
      vendorActualLocal,
      actualCurrency,
      actualFxRate
    );

    let actualUnitUsd: number | null = null;
    if (outsourcingType === "PROCESSING") {
      const actualMaterialLocal = calcMaterialsActualAmt(specs);
      const actualMaterialUsd = calcPlannedUnitUsd(
        actualMaterialLocal,
        plannedCurrency,
        actualFxRate ?? plannedFxRate
      );
      const totalActualUsd = (actualMaterialUsd ?? 0) + (vendorActualUnitUsd ?? 0);
      actualUnitUsd = totalActualUsd > 0 ? totalActualUsd : null;
    } else {
      actualUnitUsd = vendorActualUnitUsd;
    }

    const actualAmt =
      actualUnitUsd === null || actualUnitUsd === undefined
        ? 0
        : Math.round(Number(actualUnitUsd) * Number(actualQty) * 10000) / 10000;
    return {
      plannedUnit: plannedUnitUsd,
      plannedUnitLocal: plannedLocalUnit,
      plannedAmt: plannedUnitUsd,
      materialLocalPlanned,
      vendorLocalPlanned,
      outsourcingType,
      actualUnit: actualUnitUsd,
      actualUnitLocal: vendorActualLocal,
      actualFxRate,
      actualQty,
      actualAmt,
      mode,
    };
  }

  const plannedLocalUnit = calcMaterialsPlannedAmt(specs);
  const plannedUnitUsd = calcPlannedUnitUsd(
    plannedLocalUnit,
    "CNY",
    (line as any)?.fx_rate ?? null
  );
  const extraMaterialActual = nnumNullable((line as any)?.inhouse_extra_material_actual) ?? 0;
  const extraProcessingActual = nnumNullable((line as any)?.inhouse_extra_processing_actual) ?? 0;
  const actualUnit = calcMaterialsActualAmt(specs) + extraMaterialActual + extraProcessingActual;
  const actualAmt =
    actualUnit === null || actualUnit === undefined
      ? 0
      : Math.round(Number(actualUnit) * Number(actualQty) * 10000) / 10000;

  return {
    plannedUnit: plannedUnitUsd,
    plannedUnitLocal: plannedLocalUnit,
    plannedAmt: plannedUnitUsd,
    materialLocalPlanned: plannedLocalUnit,
    vendorLocalPlanned: 0,
    outsourcingType: "PROCESSING" as OutsourcingType,
    actualUnit,
    actualQty,
    actualAmt,
    mode,
  };
}

export default function WorkSheetDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  
  const id = params?.id;

  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [confirmingActual, setConfirmingActual] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [header, setHeader] = React.useState<WorkSheetHeader | null>(null);
  // ✅ Keep header notes in dedicated state to prevent race-condition overwrites
  const [specialInstructions, setSpecialInstructions] =
    React.useState<string>("");
  const [internalNotes, setInternalNotes] = React.useState<string>("");
  const [po, setPo] = React.useState<any>(null);

  const [uiView, setUiView] = React.useState<"vendor" | "internal">(() => {
    if (typeof window === "undefined") return "internal";
    const v = window.localStorage.getItem("ws_ui_view");
    return v === "vendor" || v === "internal" ? v : "internal";
  });
  const isInternalView = uiView === "internal";
  React.useEffect(() => {
    try {
      window.localStorage.setItem("ws_ui_view", uiView);
    } catch {}
  }, [uiView]);

  const [lines, setLines] = React.useState<WorkSheetLine[]>([]);
  const [materialsByLineId, setMaterialsByLineId] = React.useState<
    Record<string, WorkSheetMaterialSpec[]>
  >({});

  // ✅ Actual Unit input raw string map (to allow typing decimals like "0." without losing ".")
  const [actualUnitInputBySpecId, setActualUnitInputBySpecId] = React.useState<
    Record<string, string>
  >({});

  // ✅ vendor subcontract price raw input per line (keep string while typing)
  const [vendorUnitInputByLineId, setVendorUnitInputByLineId] = React.useState<
    Record<string, string>
  >({});

  // Vendor Actual Unit Cost input (keep raw string while typing)
  const [vendorActualUnitInputByLineId, setVendorActualUnitInputByLineId] = React.useState<
    Record<string, string>
  >({});

  const [vendorFxInputByLineId, setVendorFxInputByLineId] = React.useState<
    Record<string, string>
  >({});

  const [internalMaterialInputByLineId, setInternalMaterialInputByLineId] = React.useState<
    Record<string, string>
  >({});

  // Vendors (Subcontractors) for Work Sheet line
  const [vendors, setVendors] = React.useState<CompanyOption[]>([]);
  const [vendorSearch, setVendorSearch] = React.useState("");
  const [vendorsLoading, setVendorsLoading] = React.useState(false);
  const [vendorLoadError, setVendorLoadError] = React.useState<string | null>(
    null
  );

  const vendorMap = React.useMemo(() => {
    const m = new Map<string, CompanyOption>();
    for (const v of vendors) {
      if (v?.id) m.set(v.id, v);
    }
    return m;
  }, [vendors]);

  const filteredVendors = React.useMemo(() => {
    const t = vendorSearch.trim().toLowerCase();
    if (!t) return vendors;
    return vendors.filter((v) => {
      const name = (v.company_name ?? "").toLowerCase();
      const code = (v.code ?? "").toLowerCase();
      return name.includes(t) || code.includes(t);
    });
  }, [vendors, vendorSearch]);

  function vendorLabel(v: CompanyOption) {
    const n = (v.company_name ?? "").trim() || "Vendor";
    const c = (v.code ?? "").trim();
    return c ? `${n} (${c})` : n;
  }

  function openProductionOrderCreate() {
    if (!header) return;
    const params = new URLSearchParams();
    if (header.po_no) params.set("buyerPoRef", header.po_no);
    const workSheetRef = header.work_sheet_no || header.ws_no || id || "";
    if (workSheetRef) params.set("workSheetRef", workSheetRef);

    const activeLine = lines.find((row) => row.id === activeLineId) || null;
    const lineDescription = [
      activeLine?.buyer_style ?? "",
      activeLine?.jm_style_no ?? "",
      activeLine?.description ?? "",
    ]
      .map((value) => (value ?? "").toString().trim())
      .filter(Boolean)
      .join(" / ");
    if (lineDescription) params.set("lineDescription", lineDescription);

    router.push(`/production/purchase-orders/new?${params.toString()}`);
  }

  async function loadVendors() {
    try {
      setVendorLoadError(null);
      setVendorsLoading(true);
      const res = await fetch(`/api/work-sheets/vendors?limit=2000`, {
        cache: "no-store" as any,
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.success) {
        throw new Error(j?.error || "Failed to load vendors");
      }
      setVendors(Array.isArray(j.rows) ? j.rows : []);
    } catch (e: any) {
      console.error(e);
      setVendorLoadError(e?.message ?? "Failed to load vendors");
    } finally {
      setVendorsLoading(false);
    }
  }

  const [activeLineId, setActiveLineId] = React.useState<string | null>(null);

  /**
   * ✅ 1번 방식 핵심:
   * 하단 3박스(Work/QC/Packing)는 "공통 박스"로 보이지만,
   * 실제 저장은 work_sheet_lines 중 "고정된 1개 라인(masterLineId)"에 저장한다.
   *
   * 중요: masterLineId는 lines[0]처럼 매번 계산하지 않고 "상태로 고정"한다.
   */
  const [masterLineId, setMasterLineId] = React.useState<string | null>(null);

  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [previewImages, setPreviewImages] = React.useState<string[]>([]);
  const [previewIndex, setPreviewIndex] = React.useState(0);
  const [previewZoom, setPreviewZoom] = React.useState(1);
  const [previewOrigin, setPreviewOrigin] = React.useState("50% 50%");

  const masterLine = React.useMemo(() => {
    if (!masterLineId) return null;
    return lines.find((l) => l.id === masterLineId) ?? null;
  }, [lines, masterLineId]);

  const activeLine = React.useMemo(() => {
    if (!activeLineId) return null;
    return lines.find((l) => l.id === activeLineId) ?? null;
  }, [lines, activeLineId]);

  // ✅ resolved production mode (prevents Actual columns disappearing when production_mode is null)
  const resolvedProductionMode = React.useMemo(() => {
    if (!activeLine) return null;
    return (
      (activeLine.production_mode as any) ??
      (activeLine.vendor_id ? "OUTSOURCED" : "IN_HOUSE")
    );
  }, [activeLine]);

  // ✅ keep raw input strings in sync when switching lines / loading materials
  React.useEffect(() => {
    if (!activeLine?.id) return;
    const list = materialsByLineId[activeLine.id] ?? [];
    setActualUnitInputBySpecId((prev) => {
      const next = { ...prev };
      for (const s of list) {
        const id = (s as any)?.id;
        if (!id) continue;
        const n = (s as any).actual_unit_cost;
        // only seed if not already typed
        if (next[id] === undefined)
          next[id] = n === null || n === undefined ? "" : String(n);
      }
      return next;
    });
  }, [activeLine?.id, materialsByLineId]);

  // ✅ keep vendor subcontract price raw input in sync when switching lines
  React.useEffect(() => {
    if (!activeLine?.id) return;
    const id = activeLine.id;
    const n = (activeLine as any).vendor_unit_cost_local as number | null | undefined;
    setVendorUnitInputByLineId((prev) => {
      if (prev[id] !== undefined) return prev;
      return {
        ...prev,
        [id]: n === null || n === undefined ? "" : String(n),
      };
    });
  }, [activeLine?.id]);

  React.useEffect(() => {
    if (!activeLine?.id) return;
    const id = activeLine.id;
    const n = (activeLine as any).fx_rate as number | null | undefined;
    setVendorFxInputByLineId((prev) => {
      if (prev[id] !== undefined) return prev;
      return {
        ...prev,
        [id]: n === null || n === undefined ? "" : String(n),
      };
    });
  }, [activeLine?.id]);

  React.useEffect(() => {
    if (!activeLine?.id) return;
    const id = activeLine.id;
    const n = (activeLine as any).actual_vendor_unit_cost_local as number | null | undefined;
    setVendorActualUnitInputByLineId((prev) => {
      if (prev[id] !== undefined) return prev;
      return {
        ...prev,
        [id]: n === null || n === undefined ? "" : String(n),
      };
    });
  }, [activeLine?.id]);

  React.useEffect(() => {
    if (!activeLine?.id) return;
    const id = activeLine.id;
    const n = (activeLine as any).internal_material_cost as number | null | undefined;
    setInternalMaterialInputByLineId((prev) => {
      if (prev[id] !== undefined) return prev;
      return {
        ...prev,
        [id]: n === null || n === undefined ? "" : String(n),
      };
    });
  }, [activeLine?.id]);

  const lastSavedHashRef = React.useRef<string>("");
  const didInitRef = React.useRef(false);

  // ✅ Prevent race conditions: avoid overwriting local edits with late load() responses
  const savingRef = React.useRef(false);
  React.useEffect(() => {
    savingRef.current = saving;
  }, [saving]);

  const activeLineIdRef = React.useRef<string | null>(null);
  const masterLineIdRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    activeLineIdRef.current = activeLineId;
  }, [activeLineId]);
  React.useEffect(() => {
    masterLineIdRef.current = masterLineId;
  }, [masterLineId]);

  const loadSeqRef = React.useRef(0);

  const isDirty = React.useMemo(() => {
    if (!didInitRef.current) return false;
    const now = stableStringify({
      header,
      po,
      lines,
      materialsByLineId,
      activeLineId,
      masterLineId,
    });
    return now !== lastSavedHashRef.current;
  }, [header, po, lines, materialsByLineId, activeLineId, masterLineId]);

  function updateHeader(patch: Partial<WorkSheetHeader>) {
    setHeader((prev) => (prev ? { ...prev, ...patch } : prev));
  }
  function updateLine(lineId: string, patch: Partial<WorkSheetLine>) {
    setLines((prev) =>
      prev.map((l) => (l.id === lineId ? ({ ...l, ...patch } as any) : l))
    );
  }

  async function load() {
    if (!id) return;

    // Each call gets a sequence id; only the latest response may update state
    const seq = ++loadSeqRef.current;

    // If the user is saving, don't reload/overwrite state
    if (savingRef.current) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/work-sheets/${id}`, { cache: "no-store" });
      const json: ApiGetResponse = await res.json().catch(() => ({} as any));
      if (!res.ok || !json?.success)
        throw new Error(json?.error || "Load failed");

      const h = (json.header ?? null) as WorkSheetHeader | null;
      const l = (json.lines ?? []).filter((x) => !x.is_deleted) as WorkSheetLine[];
      const m = (json.materialsByLineId ??
        {}) as Record<string, WorkSheetMaterialSpec[]>;
      const p = (json.po ?? null) as any;

      // Ignore late/out-of-order responses
      if (seq !== loadSeqRef.current) return;
      if (savingRef.current) return;

      const prevActive = activeLineIdRef.current;
      const prevMaster = masterLineIdRef.current;

      setHeader(h);
      // ✅ Load notes from header (authoritative) into dedicated state
      setSpecialInstructions(
        (
          (h as any)?.special_instructions ??
          (h as any)?.general_notes ??
          ""
        ).toString()
      );
      setInternalNotes(
        (
          (h as any)?.internal_notes ??
          (h as any)?.internal_memo ??
          (h as any)?.notes ??
          ""
        ).toString()
      );
      setPo(p);
      setLines(l);
      setMaterialsByLineId(m);

      // ✅ init vendor input maps from loaded lines (so inputs show existing values)
      setVendorUnitInputByLineId(() => {
        const out: Record<string, string> = {};
        (l || []).forEach((ln: any) => {
          const v = ln?.vendor_unit_cost_local;
          out[ln.id] = v === null || v === undefined ? "" : String(v);
        });
        return out;
      });
      setVendorActualUnitInputByLineId(() => {
        const out: Record<string, string> = {};
        (l || []).forEach((ln: any) => {
          const v = ln?.actual_vendor_unit_cost_local;
          out[ln.id] = v === null || v === undefined ? "" : String(v);
        });
        return out;
      });
      setInternalMaterialInputByLineId(() => {
        const out: Record<string, string> = {};
        (l || []).forEach((ln: any) => {
          const v = (ln as any)?.internal_material_cost;
          out[ln.id] = v === null || v === undefined ? "" : String(v);
        });
        return out;
      });

      // ✅ activeLineId: 기존 유지, 없으면 첫 라인
      setActiveLineId((prev) => {
        if (prev && l.some((x) => x.id === prev)) return prev;
        return l?.[0]?.id ?? null;
      });

      // ✅ masterLineId: "고정" 유지가 핵심
      setMasterLineId((prev) => {
        if (prev && l.some((x) => x.id === prev)) return prev;
        return l?.[0]?.id ?? null;
      });

      const nextActive =
        prevActive && l.some((x) => x.id === prevActive)
          ? prevActive
          : l?.[0]?.id ?? null;

      const nextMaster =
        prevMaster && l.some((x) => x.id === prevMaster)
          ? prevMaster
          : l?.[0]?.id ?? null;

      lastSavedHashRef.current = stableStringify({
        header: h,
        po: p,
        lines: l,
        materialsByLineId: m,
        activeLineId: nextActive,
        masterLineId: nextMaster,
      });
      didInitRef.current = true;
    } catch (e: any) {
      setError(e?.message ?? "Load error");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  React.useEffect(() => {
    void loadVendors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function confirmIfDirty(actionLabel: string) {
    if (!isDirty) return true;
    return window.confirm(
      `저장되지 않은 변경사항이 있습니다(Unsaved).\n그래도 ${actionLabel} 하시겠습니까?`
    );
  }

  function openPdf(mode: "vendor" | "internal") {
    if (!confirmIfDirty("PDF 열기")) return;
    window.open(
      `/work-sheets/${id}/pdf?mode=${mode}`,
      "_blank",
      "noopener,noreferrer"
    );
  }

  async function onSave(showSuccessToast: boolean = true): Promise<boolean> {
    if (!header) return false;

    for (const l of lines) {
      const v = (l?.jm_style_no ?? "").trim();
      if (!v) {
        alert("JM Style No 는 필수입니다.");
        return false;
      }

      const mode = (l as any)?.production_mode ?? "OUTSOURCED";
      if (mode === "OUTSOURCED" && !(l as any)?.vendor_id) {
        alert(
          `OUTSOURCED 라인은 Vendor/Subcontractor가 필수입니다.\n(Style: ${(l as any)?.jm_style_no ?? "-"})`
        );
        return false;
      }
    }

    setSaving(true);
    setError(null);

    try {
      const materialsForSave: Record<string, WorkSheetMaterialSpec[]> = Object.fromEntries(
        Object.entries(materialsByLineId).map(([lineId, arr]) => [
          lineId,
          (arr ?? []).map((s) => {
            const raw = actualUnitInputBySpecId?.[s.id];
            if (raw == null || String(raw).trim() === "") return s;

            const normalized = normalizeDec4Input(String(raw));
            const parsed = DEC4_RE.test(normalized)
              ? parseDec4ToNumber(normalized)
              : parseDec4ToNumber(String(raw));

            if (parsed === null || parsed === undefined) return s;

            const seededQty =
              (s as any)?.actual_qty ?? extractQtyFromNote((s as any)?.note) ?? 1;

            return {
              ...(s as any),
              actual_unit_cost: parsed,
              actual_qty: seededQty,
            } as WorkSheetMaterialSpec;
          }),
        ])
      );

      const syncedLines = lines.map((l) => {
        const specs = materialsForSave[l.id] ?? [];
        const plannedLocalUnit = calcMaterialsPlannedAmt(specs);
        const fxRate = nnumNullable((l as any)?.fx_rate);
        const outsourcingType = resolveOutsourcingType(l);
        const sync = calcLineActualSync(
          l,
          specs,
          vendorActualUnitInputByLineId[l.id]
        );

        const manualVendorLocal =
          parseDec2ToNumber(l.id ? (vendorUnitInputByLineId[l.id] ?? "") : "") ??
          nnumNullable((l as any)?.vendor_unit_cost_local) ??
          null;
        const manualVendorUsd = calcPlannedUnitUsd(
          manualVendorLocal,
          "CNY",
          fxRate
        );

        return {
          ...l,
          vendor_unit_cost_local: manualVendorLocal,
          vendor_unit_cost_usd: manualVendorUsd,
          outsourcing_type: outsourcingType,
          internal_material_cost:
            outsourcingType === "PROCESSING"
              ? (
                  parseDec2ToNumber(l.id ? (internalMaterialInputByLineId[l.id] ?? "") : "") ??
                  nnumNullable((l as any)?.internal_material_cost) ??
                  plannedLocalUnit
                )
              : null,
          fx_rate: fxRate,
          fx_as_of: fxRate ? new Date().toISOString().slice(0, 10) : (l as any).fx_as_of ?? null,
          actual_unit: sync.actualUnit,
          actual_qty: sync.actualQty,
          actual_amt: sync.actualAmt,
          actual_vendor_unit_cost_local:
            sync.mode === "OUTSOURCED"
              ? (sync as any).actualUnitLocal ?? (l as any).actual_vendor_unit_cost_local ?? null
              : (l as any).actual_vendor_unit_cost_local ?? null,
          actual_vendor_unit_cost_usd:
            sync.mode === "OUTSOURCED"
              ? sync.actualUnit ?? null
              : (l as any).actual_vendor_unit_cost_usd ?? null,
          actual_fx_rate:
            sync.mode === "OUTSOURCED"
              ? ((sync as any).actualFxRate ?? fxRate ?? null)
              : (l as any).actual_fx_rate ?? null,
          actual_fx_as_of:
            sync.mode === "OUTSOURCED"
              ? (((sync as any).actualFxRate ?? fxRate) ? new Date().toISOString().slice(0, 10) : (l as any).actual_fx_as_of ?? null)
              : (l as any).actual_fx_as_of ?? null,
          actual_fx_mode:
            sync.mode === "OUTSOURCED"
              ? (((sync as any).actualFxRate ?? fxRate) ? "MANUAL" : (l as any).actual_fx_mode ?? null)
              : (l as any).actual_fx_mode ?? null,
        } as WorkSheetLine;
      });

      const payload = {
        header: {
          id: header.id,
          status: header.status,
          // Notes (호환성)
          special_instructions: specialInstructions || null,
          general_notes: specialInstructions || null,

          internal_notes: internalNotes || null,
          internal_memo: internalNotes || null,
          notes: internalNotes || null,
        },

        lines: syncedLines.map((l) => ({
          id: l.id,
          work_sheet_id: l.work_sheet_id,
          po_line_id: l.po_line_id ?? null,
          product_id: l.product_id ?? null,

          jm_style_no: (l.jm_style_no ?? "").trim(),
          qty: l.qty,

          buyer_style: l.buyer_style ?? null,
          description: l.description ?? null,

          plating_color: l.plating_color ?? null,
          plating_spec: l.plating_spec ?? null,
          spec_summary: l.spec_summary ?? null,

          work_notes: l.work_notes ?? null,
          qc_points: l.qc_points ?? null,
          packing_notes: l.packing_notes ?? null,

          image_url_primary: l.image_url_primary ?? null,
          image_urls: l.image_urls ?? null,

          vendor_id: l.vendor_id ?? null,
          vendor_currency: l.vendor_currency ?? null,
          vendor_unit_cost_local: l.vendor_unit_cost_local ?? null,
          vendor_unit_cost_usd: (l as any).vendor_unit_cost_usd ?? null,
          fx_rate: (l as any).fx_rate ?? null,
          fx_as_of: (l as any).fx_as_of ?? null,

          vendor_ready_date: (l as any).vendor_ready_date ?? null,
          vendor_delivery_status: (l as any).vendor_delivery_status ?? null,
          vendor_delay_days: (l as any).vendor_delay_days ?? null,

          production_mode: (l as any).production_mode ?? null,
          outsourcing_type: (l as any).outsourcing_type ?? null,
          internal_material_cost: (l as any).internal_material_cost ?? null,

          actual_vendor_unit_cost_local:
            (l as any).actual_vendor_unit_cost_local ?? null,
          actual_vendor_unit_cost_usd:
            (l as any).actual_vendor_unit_cost_usd ?? null,
          actual_fx_rate: (l as any).actual_fx_rate ?? null,
          actual_fx_as_of: (l as any).actual_fx_as_of ?? null,
          actual_fx_mode: (l as any).actual_fx_mode ?? null,

          actual_unit: (l as any).actual_unit ?? null,
          actual_qty: (l as any).actual_qty ?? null,
          actual_amt: (l as any).actual_amt ?? null,
        })),

        materialsByLineId: Object.fromEntries(
          Object.entries(materialsForSave).map(([lineId, arr]) => [
            lineId,
            (arr ?? []).map((s) => ({
              id: s.id,
              work_sheet_line_id: s.work_sheet_line_id ?? lineId,
              material_type: s.material_type ?? null,
              material_name: s.material_name ?? "",
              spec_text: s.spec_text ?? null,
              color: s.color ?? null,
              source_policy: s.source_policy,
              source_vendor_id: s.source_vendor_id ?? null,
              source_vendor_text: s.source_vendor_text ?? null,
              note: s.note ?? null,
              sort_order: nnum(s.sort_order, 0),
              is_deleted: !!s.is_deleted,
              actual_qty: (s as any).actual_qty ?? null,
              actual_unit_cost: (s as any).actual_unit_cost ?? null,
              actual_note: (s as any).actual_note ?? null,
            })),
          ])
        ),
      };

      const res = await fetch(`/api/work-sheets/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json: ApiSaveResponse = await res.json().catch(() => ({} as any));
      if (!res.ok || !json?.success)
        throw new Error(json?.error || "Save failed");

      const incomingHeader = (json.header ?? null) as WorkSheetHeader | null;
      const incomingLines = (json.lines ?? []).filter(
        (l: any) => !l.is_deleted
      ) as WorkSheetLine[];
      const incomingMaterials =
        (json.materialsByLineId ??
          {}) as Record<string, WorkSheetMaterialSpec[]>;
      const incomingPo = (json as any)?.po ?? null;

      const nextHeader = incomingHeader
        ? { ...(header as any), ...(incomingHeader as any) }
        : header;

      // ✅ Stabilize Special/Internal notes: keep in dedicated state + force onto header
      const resolvedSpecial = (
        (incomingHeader as any)?.special_instructions ??
        (incomingHeader as any)?.general_notes ??
        specialInstructions ??
        (nextHeader as any)?.special_instructions ??
        (nextHeader as any)?.general_notes ??
        ""
      ).toString();
      const resolvedInternal = (
        (incomingHeader as any)?.internal_notes ??
        (incomingHeader as any)?.internal_memo ??
        (incomingHeader as any)?.notes ??
        internalNotes ??
        (nextHeader as any)?.internal_notes ??
        (nextHeader as any)?.internal_memo ??
        (nextHeader as any)?.notes ??
        ""
      ).toString();
      setSpecialInstructions(resolvedSpecial);
      setInternalNotes(resolvedInternal);
      const nextHeaderFixed: any = nextHeader
        ? {
            ...(nextHeader as any),
            special_instructions: resolvedSpecial,
            general_notes: resolvedSpecial,
            internal_notes: resolvedInternal,
            internal_memo: resolvedInternal,
            notes: resolvedInternal,
          }
        : nextHeader;

      // ✅ lines merge: 로컬 값을 "우선" 유지하면서 서버값 덮기
      const incomingMap = new Map(incomingLines.map((x) => [x.id, x]));
      const nextLines =
        incomingLines.length > 0
          ? syncedLines.map((l) => {
              const saved = incomingMap.get(l.id);
              return saved ? ({ ...l, ...saved } as any) : l;
            })
          : lines;

      const nextMaterials = { ...materialsByLineId, ...incomingMaterials };

      setHeader(nextHeaderFixed as any);
      setPo(incomingPo ?? po);
      setLines(nextLines);
      setMaterialsByLineId(nextMaterials);

      setActiveLineId((prev) => {
        if (prev && nextLines.some((x) => x.id === prev)) return prev;
        return nextLines?.[0]?.id ?? null;
      });

      setMasterLineId((prev) => {
        if (prev && nextLines.some((x) => x.id === prev)) return prev;
        return nextLines?.[0]?.id ?? null;
      });

      const nextActive =
        activeLineId && nextLines.some((x) => x.id === activeLineId)
          ? activeLineId
          : nextLines?.[0]?.id ?? null;

      const nextMaster =
        masterLineId && nextLines.some((x) => x.id === masterLineId)
          ? masterLineId
          : nextLines?.[0]?.id ?? null;

      lastSavedHashRef.current = stableStringify({
        header: nextHeader,
        po: incomingPo ?? po,
        lines: nextLines,
        materialsByLineId: nextMaterials,
        activeLineId: nextActive,
        masterLineId: nextMaster,
      });
      didInitRef.current = true;

      await load();

      if (showSuccessToast) {
        toast.success("Saved successfully", {
          description: "Actual values were synchronized.",
        });
      }
      return true;
    } catch (e: any) {
      const msg = e?.message ?? "Save error";
      setError(msg);
      if (String(msg).includes("Actual cost is CONFIRMED")) {
        toast.error("Actual is locked", {
          description: "Unlock Actual을 눌러 Actual 필드를 수정하거나, 일반 필드만 다시 저장해 주세요.",
        });
      } else {
        toast.error("Save failed", { description: msg });
      }
      return false;
    } finally {
      setSaving(false);
    }
  }

  const anyActualLocked = React.useMemo(() => {
    try {
      return (lines || []).some((ln: any) => Boolean(ln?.actual_cost_confirmed));
    } catch {
      return false;
    }
  }, [lines])

  const activeActualLocked = React.useMemo(() => {
    try {
      return Boolean((activeLine as any)?.actual_cost_confirmed);
    } catch {
      return false;
    }
  }, [activeLine]);


  const hasAnyActualUnitInput = React.useMemo(() => {
    try {
      const lineId = activeLine?.id ?? null;
      const specs = (lineId ? materialsByLineId?.[lineId] : []) || [];
      return (specs as any[]).some((sp: any) => {
        const raw = (actualUnitInputBySpecId as any)?.[sp?.id];
        const saved = (sp as any)?.actual_unit_cost;
        return (raw != null && String(raw).trim() !== "") || (saved != null && saved !== "");
      });
    } catch {
      return false;
    }
  }, [materialsByLineId, activeLine?.id, actualUnitInputBySpecId]);

  const onConfirmActualCost = async (mode: "IN_HOUSE" | "OUTSOURCED") => {
    if (!id) return;

    try {
      // guards
      if (mode === "IN_HOUSE") {
        if (!hasAnyActualUnitInput) {
          toast.error("Enter Actual Unit first", {
            description:
              "Materials 탭에서 Actual Unit을 최소 1개 이상 입력한 뒤 Confirm Actual을 눌러주세요.",
          });
          return;
        }
      } else {
        if (!activeLine?.vendor_id) {
          toast.error("Select Vendor first", {
            description: "OUTSOURCED 모드에서는 Vendor를 먼저 선택해 주세요.",
          });
          return;
        }
      }

      setConfirmingActual(true);

      const saved = await onSave(false);
      if (!saved) return;

      const res = await fetch(`/api/work-sheets/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm_actual_cost: true }),
      });

      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error || "Failed to confirm actual cost");

      await load();
      toast.success("Actual confirmed", { description: "Actual cost is now locked." });
    } catch (e: any) {
      toast.error("Confirm failed", {
        description: e?.message ?? "Server error",
      });
    } finally {
      setConfirmingActual(false);
    }
  };

  const onUnlockActualCost = async () => {
    if (!id) return;

    try {
      setConfirmingActual(true);

      const res = await fetch(`/api/work-sheets/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unlock_actual_cost: true }),
      });

      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error || "Failed to unlock actual cost");

      await load();
      toast.success("Actual unlocked", {
        description: "Actual fields can be edited again.",
      });
    } catch (e: any) {
      toast.error("Unlock failed", {
        description: e?.message ?? "Server error",
      });
    } finally {
      setConfirmingActual(false);
    }
  };



  function openImagePreview(images: string[], startIndex: number = 0) {
    const clean = (images ?? []).map((x) => String(x || "").trim()).filter(Boolean);
    if (clean.length === 0) return;
    setPreviewImages(clean);
    setPreviewIndex(Math.max(0, Math.min(startIndex, clean.length - 1)));
    setPreviewZoom(1);
    setPreviewOrigin("50% 50%");
    setPreviewOpen(true);
  }

  function closeImagePreview() {
    setPreviewOpen(false);
    setPreviewZoom(1);
    setPreviewOrigin("50% 50%");
  }

  function showPrevImage() {
    setPreviewIndex((prev) => {
      if (!previewImages.length) return 0;
      return (prev - 1 + previewImages.length) % previewImages.length;
    });
    setPreviewZoom(1);
    setPreviewOrigin("50% 50%");
  }

  function showNextImage() {
    setPreviewIndex((prev) => {
      if (!previewImages.length) return 0;
      return (prev + 1) % previewImages.length;
    });
    setPreviewZoom(1);
    setPreviewOrigin("50% 50%");
  }

  function handlePreviewWheel(e: React.WheelEvent<HTMLDivElement>) {
    e.preventDefault();
    setPreviewZoom((prev) => {
      const next = e.deltaY < 0 ? prev + 0.25 : prev - 0.25;
      const clamped = Math.max(1, Math.min(4, Number(next.toFixed(2))));
      return clamped;
    });
  }

  function handlePreviewMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setPreviewOrigin(`${x.toFixed(2)}% ${y.toFixed(2)}%`);
  }

  const reqShipDate = fmtDate(po?.requested_ship_date ?? null);
  const deliveryDueDate = addDaysYmd(po?.requested_ship_date ?? null, -7);
  const brand = toStr(po?.buyer_brand_name ?? "").trim();
  const dept = toStr(po?.buyer_dept_name ?? "").trim();
  const brandDept = [brand, dept].filter(Boolean).join(" / ");

  // ✅ requiredRoles 제거 (AppShellProps에 없어서 빌드 에러)
  return (
    <AppShell title="Work Sheets">
      <div className="mx-auto w-full max-w-[1200px] space-y-4 p-4">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div>
              <CardTitle>Work Sheet Detail</CardTitle>

              <div className="mt-1 text-sm text-muted-foreground">
                PO:{" "}
                <span className="font-medium text-foreground">
                  {header?.po_no ?? "-"}
                </span>
                {" · "}
                Buyer:{" "}
                <span className="font-medium text-foreground">
                  {header?.buyer_name ?? "-"}
                </span>
                {" · "}
                Currency:{" "}
                <span className="font-medium text-foreground">
                  {header?.currency ?? "USD"}
                </span>
              </div>

              <div className="mt-1 text-xs text-muted-foreground">
                {brandDept ? (
                  <>
                    Brand/Dept:{" "}
                    <span className="text-foreground">{brandDept}</span>
                    {" · "}
                  </>
                ) : null}
                {po?.ship_mode ? (
                  <>
                    Ship Mode:{" "}
                    <span className="text-foreground">{po.ship_mode}</span>
                    {" · "}
                  </>
                ) : null}
                Req Ship Date:{" "}
                <span className="text-foreground">{reqShipDate || "-"}</span>
              </div>
            </div>

            <div className="grid grid-cols-[auto_max-content] items-start gap-x-3 gap-y-2 self-start">
              <div className="flex w-max items-center gap-2">
                {didInitRef.current ? (
                  isDirty ? (
                    <Badge variant="destructive">Unsaved</Badge>
                  ) : (
                    <Badge variant="secondary">Saved</Badge>
                  )
                ) : (
                  <Badge variant="outline">Loading...</Badge>
                )}

                <div className="min-w-[180px]">
                  <Select
                    value={header?.status ?? "DRAFT"}
                    onValueChange={(v) => updateHeader({ status: v })}
                    disabled={!header}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DRAFT">DRAFT</SelectItem>
                      <SelectItem value="SENT">SENT</SelectItem>
                      <SelectItem value="CLOSED">CLOSED</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="shrink-0">
                <Button onClick={() => void onSave()} disabled={saving || loading || !header}>
                {saving ? "Saving..." : "Save"}
                </Button>
                </div>

                <div className="flex w-max items-center gap-2">
                  <div className="shrink-0">
                  <Button
                    type="button"
                    size="sm"
                    variant={uiView === "vendor" ? "default" : "ghost"}
                    onClick={() => setUiView("vendor")}
                  >
                    Vendor View
                  </Button>
                  </div>
                  <div className="shrink-0">
                  <Button
                    type="button"
                    size="sm"
                    variant={uiView === "internal" ? "default" : "ghost"}
                    onClick={() => setUiView("internal")}
                  >
                    Internal View
                  </Button>
                  </div>
                </div>

                <div className="shrink-0">
                <Button
                  variant="outline"
                  onClick={() => openPdf("vendor")}
                  disabled={!header}
                >
                  PDF Vendor
                </Button>
                </div>
              </div>

              <div />

              <div className="flex w-max items-center gap-2">
                <div className="shrink-0">
                <Button
                  variant="outline"
                  onClick={() => openPdf("internal")}
                  disabled={!header}
                >
                  PDF Internal
                </Button>
                </div>

                <div className="shrink-0">
                <Button variant="outline" onClick={openProductionOrderCreate} disabled={!header}>
                  Create Production Order
                </Button>
                </div>

                <div className="shrink-0">
                <Button variant="outline" onClick={() => router.back()}>
                  Back
                </Button>
                </div>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            {/* Special / Internal */}
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Special Instructions (공통 주의사항)</Label>
                <Textarea
                  value={specialInstructions}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSpecialInstructions(v);
                    // ✅ keep header in sync for save payload/other UI
                    updateHeader({ special_instructions: v, general_notes: v });
                  }}
                  placeholder="Special instructions..."
                  rows={4}
                  disabled={!header}
                />
              </div>
              <div className="space-y-2">
                <Label>Internal Notes (내부 메모)</Label>
                <Textarea
                  value={internalNotes}
                  onChange={(e) => {
                    const v = e.target.value;
                    setInternalNotes(v);
                    // ✅ keep header in sync for save payload/other UI
                    updateHeader({
                      internal_notes: v,
                      internal_memo: v,
                      notes: v,
                    });
                  }}
                  placeholder="Internal memo..."
                  rows={4}
                  disabled={!header}
                />
              </div>
            </div>

            {/* ✅ Work/QC/Packing : "고정된 masterLineId"에 저장/표시 */}
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-2">
                <Label>Work</Label>
                <Textarea
                  value={masterLine?.work_notes ?? ""}
                  onChange={(e) =>
                    masterLineId &&
                    updateLine(masterLineId, { work_notes: e.target.value })
                  }
                  rows={5}
                  placeholder="Work instructions..."
                  disabled={!masterLineId}
                />
              </div>
              <div className="space-y-2">
                <Label>QC</Label>
                <Textarea
                  value={masterLine?.qc_points ?? ""}
                  onChange={(e) =>
                    masterLineId &&
                    updateLine(masterLineId, { qc_points: e.target.value })
                  }
                  rows={5}
                  placeholder="QC points..."
                  disabled={!masterLineId}
                />
              </div>
              <div className="space-y-2">
                <Label>Packing</Label>
                <Textarea
                  value={masterLine?.packing_notes ?? ""}
                  onChange={(e) =>
                    masterLineId &&
                    updateLine(masterLineId, { packing_notes: e.target.value })
                  }
                  rows={5}
                  placeholder="Packing notes..."
                  disabled={!masterLineId}
                />
              </div>
            </div>

            {error ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                {error}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-3">
          {/* Left: line list */}
          <Card className="h-full md:col-span-1">
            <CardHeader>
              <CardTitle className="text-base">Styles</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {lines.length === 0 ? (
                <div className="text-sm text-muted-foreground">No lines.</div>
              ) : (
                <div className="space-y-2">
                  {lines.map((l) => {
                    const active = l.id === activeLineId;
                    const thumb =
                      l.image_url_primary || safeArray(l.image_urls)[0] || null;

                    return (
                      <button
                        key={l.id}
                        type="button"
                        onClick={() => setActiveLineId(l.id)}
                        className={[
                          "w-full rounded-md border p-2 text-left transition",
                          active
                            ? "border-primary/60 bg-primary/5"
                            : "hover:bg-muted/50",
                        ].join(" ")}
                      >
                        <div className="flex gap-3">
                          <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-md border bg-muted">
                            {thumb ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={thumb}
                                alt={l.jm_style_no}
                                className="h-full w-full cursor-zoom-in object-cover transition hover:scale-105"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const imgs = [l.image_url_primary, ...safeArray(l.image_urls)]
                                    .map((x) => String(x || "").trim())
                                    .filter(Boolean);
                                  const uniqueImgs = Array.from(new Set(imgs));
                                  const startIndex = Math.max(0, uniqueImgs.indexOf(thumb));
                                  openImagePreview(uniqueImgs, startIndex);
                                }}
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                                No Image
                              </div>
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <div className="truncate font-medium">
                                {l.jm_style_no}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                Qty {nnum(l.qty, 0)}
                              </div>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                              {l.plating_color ? (
                                <span className="rounded-full border bg-background px-2 py-0.5">
                                  Plating: {l.plating_color}
                                </span>
                              ) : null}
                              {l.description ? (
                                <span className="truncate">
                                  {String(l.description).slice(0, 50)}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Right: line detail */}
          <Card className="h-full md:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">
                {activeLine?.jm_style_no ?? "(select style)"}
              </CardTitle>
            </CardHeader>

            <CardContent className="space-y-4">
              {!activeLine ? (
                <div className="text-sm text-muted-foreground">
                  Select a line.
                </div>
              ) : (
                <>
                  <Tabs defaultValue="spec" className="w-full">
                    <TabsList>
                      <TabsTrigger value="spec">Spec</TabsTrigger>
                      <TabsTrigger value="materials">Materials</TabsTrigger>
                      <TabsTrigger value="vendor">Vendor</TabsTrigger>
                    </TabsList>

                    <TabsContent value="spec" className="space-y-4">
            {(() => {
              const poSubtotal = Number(po?.subtotal ?? 0);
              const poCurrency = (po?.currency ?? header?.currency ?? "USD") as string;
              const totalQty = (lines || []).reduce((s: number, ln: any) => s + (Number(ln?.qty) || 0), 0) || 0;

              const lineQty = Number((activeLine as any)?.qty ?? 0) || 0;

              const directUnitPriceRaw =
                (activeLine as any)?.unit_price ??
                (activeLine as any)?.po_unit_price ??
                (activeLine as any)?.price ??
                null;
              const directUnitPrice =
                directUnitPriceRaw === null || directUnitPriceRaw === undefined || directUnitPriceRaw === ""
                  ? null
                  : Number(directUnitPriceRaw);

              const lineAmountRaw =
                (activeLine as any)?.amount ??
                (activeLine as any)?.line_amount ??
                (activeLine as any)?.total_amount ??
                null;
              const lineAmount =
                lineAmountRaw === null || lineAmountRaw === undefined || lineAmountRaw === ""
                  ? null
                  : Number(lineAmountRaw);

              const hasDirectUnitPrice = Number.isFinite(directUnitPrice as number);
              const hasLineAmount = Number.isFinite(lineAmount as number) && lineQty > 0;

              const unitPrice = hasDirectUnitPrice
                ? Number(directUnitPrice)
                : hasLineAmount
                ? Number(lineAmount) / lineQty
                : totalQty
                ? poSubtotal / totalQty
                : 0;

              const unitPriceMeta = hasDirectUnitPrice
                ? `PO Line Unit Price: ${Number(directUnitPrice).toFixed(4)}`
                : hasLineAmount
                ? `Line Amount: ${Number(lineAmount).toFixed(2)} / Qty: ${lineQty.toLocaleString()}`
                : `PO Subtotal: ${poSubtotal.toFixed(2)} / Qty: ${totalQty.toLocaleString()}`;

              // activeLineId can be typed as string | null, so guard before indexing
              const _lineId = (activeLineId ?? (activeLine as any)?.id ?? "") as string;
              const specs = _lineId ? (materialsByLineId?.[_lineId] || []) : [];
              const isOutsourced = (resolvedProductionMode ?? "IN_HOUSE") === "OUTSOURCED";
              const outsourcingType = resolveOutsourcingType(activeLine);

              const inhouseActualRows = specs.reduce(
                (acc: { hasActual: boolean; sum: number }, sp: any) => {
                  const specId = String(sp?.id ?? "");
                  const raw = specId ? actualUnitInputBySpecId?.[specId] : undefined;
                  const saved = (sp as any)?.actual_unit_cost;
                  const actualUnit =
                    raw != null && String(raw).trim() !== ""
                      ? parseDec4ToNumber(String(raw))
                      : saved ?? null;

                  if (actualUnit === null || actualUnit === undefined) return acc;

                  const q = extractQtyFromNote(sp?.note) ?? 0;
                  return {
                    hasActual: true,
                    sum: acc.sum + Number(q) * Number(actualUnit),
                  };
                },
                { hasActual: false, sum: 0 }
              );

              const vendorActualRaw = activeLine?.id
                ? vendorActualUnitInputByLineId?.[activeLine.id]
                : undefined;
              const vendorActualSaved = (activeLine as any)?.actual_vendor_unit_cost_local ?? null;
              const vendorActualUnit =
                vendorActualRaw != null && String(vendorActualRaw).trim() !== ""
                  ? parseDec2ToNumber(String(vendorActualRaw))
                  : vendorActualSaved;

              const processingMaterialPlannedLocal = resolveProcessingMaterialLocal(activeLine, specs);
              const processingMaterialActualLocal = inhouseActualRows.hasActual ? inhouseActualRows.sum : null;
              const sync = calcLineActualSync(activeLine, specs, vendorActualRaw);

              const hasActual = isOutsourced
                ? (outsourcingType === "PROCESSING"
                    ? ((processingMaterialActualLocal !== null && processingMaterialActualLocal !== undefined) ||
                       (vendorActualUnit !== null && vendorActualUnit !== undefined))
                    : (vendorActualUnit !== null && vendorActualUnit !== undefined))
                : inhouseActualRows.hasActual;

              const plannedUnitCostLocal: number = isOutsourced
                ? (outsourcingType === "PROCESSING"
                    ? processingMaterialPlannedLocal + (nnumNullable((activeLine as any)?.vendor_unit_cost_local) ?? 0)
                    : (nnumNullable((activeLine as any)?.vendor_unit_cost_local) ?? 0))
                : specs.reduce((s: number, sp: any) => {
                    const q = extractQtyFromNote(sp?.note) ?? 0;
                    const u = extractUnitCostFromNote(sp?.note) ?? 0;
                    return s + q * u;
                  }, 0);

              const actualUnitCostLocal: number | null = isOutsourced
                ? (outsourcingType === "PROCESSING"
                    ? ((processingMaterialActualLocal ?? 0) + (vendorActualUnit ?? 0))
                    : (vendorActualUnit ?? null))
                : (inhouseActualRows.hasActual ? inhouseActualRows.sum : null);

              const lineFxRate = nnumNullable((activeLine as any)?.fx_rate);
              const plannedUnitCost: number = isOutsourced
                ? ((sync as any)?.plannedUnit ?? 0)
                : (calcPlannedUnitUsd(plannedUnitCostLocal, "CNY", lineFxRate) ?? 0);
              const actualUnitCost: number | null = isOutsourced
                ? ((sync as any)?.actualUnit ?? null)
                : (actualUnitCostLocal === null ? null : calcPlannedUnitUsd(actualUnitCostLocal, "CNY", lineFxRate));

              const marginUnit: number | null =
                hasActual && actualUnitCost !== null ? unitPrice - actualUnitCost : null;
              const marginPct: number | null =
                hasActual && actualUnitCost !== null && unitPrice
                  ? (marginUnit! / unitPrice) * 100
                  : null;
              const variance: number | null =
                hasActual && actualUnitCost !== null ? actualUnitCost - plannedUnitCost : null;
              const totalMargin: number | null =
                marginUnit === null ? null : Math.round(marginUnit * lineQty * 10000) / 10000;
              const plannedSubtext = isOutsourced
                ? `${fmtMoney(plannedUnitCost)} USD (${fmtMoney(plannedUnitCostLocal)} ${(activeLine as any)?.vendor_currency ?? "CNY"})`
                : (lineFxRate && lineFxRate > 0
                    ? `Planned: ${fmtMoney(plannedUnitCost)} USD (${fmtMoney(plannedUnitCostLocal)} CNY / FX ${fmtMoney(lineFxRate)})`
                    : `Planned: ${fmtMoney(plannedUnitCostLocal)} CNY`);

              return (
                <div className="grid gap-3 md:grid-cols-5 xl:grid-cols-5">
                  <Card>
                    <CardContent className="p-4">
                      <div className="text-xs text-muted-foreground">Unit Price (PO Currency: {poCurrency})</div>
                      <div className="mt-1 text-2xl font-semibold tabular-nums">{unitPrice.toFixed(4)}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{unitPriceMeta}</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="text-xs text-muted-foreground">Actual Unit Cost (USD)</div>
                      <div className="mt-1 text-2xl font-semibold tabular-nums">{actualUnitCost === null ? "-" : actualUnitCost.toFixed(4)}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{plannedSubtext}</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="text-xs text-muted-foreground">Margin / Unit ({poCurrency})</div>
                      <div className="mt-1 text-2xl font-semibold tabular-nums">{marginUnit === null ? "-" : marginUnit.toFixed(4)}</div>
                      <div className="mt-1 text-xs text-muted-foreground">Variance: {variance === null ? "-" : `${variance >= 0 ? "+" : ""}${variance.toFixed(4)}`}</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="text-xs text-muted-foreground">Total Margin ({poCurrency})</div>
                      <div className="mt-1 text-2xl font-semibold tabular-nums">{totalMargin === null ? "-" : totalMargin.toFixed(4)}</div>
                      <div className="mt-1 text-xs text-muted-foreground">Unit Margin × Qty</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="text-xs text-muted-foreground">Margin %</div>
                      <div className="mt-1 text-2xl font-semibold tabular-nums">{marginPct === null ? "-" : `${marginPct.toFixed(2)}%`}</div>
                      <div className="mt-1 text-xs text-muted-foreground">Line Qty: {(lines || []).find((ln: any) => ln?.id === activeLineId)?.qty?.toLocaleString?.() ?? ""}</div>
                    </CardContent>
                  </Card>
                </div>
              );
            })()}
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label>JM Style No</Label>
                          <Input value={activeLine.jm_style_no} disabled />
                        </div>
                        <div className="space-y-2">
                          <Label>Buyer Style / SKU</Label>
                          <Input
                            value={activeLine.buyer_style ?? ""}
                            onChange={(e) =>
                              updateLine(activeLine.id, {
                                buyer_style: e.target.value,
                              })
                            }
                            placeholder="Optional"
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label>Description</Label>
                        <Input
                          value={activeLine.description ?? ""}
                          onChange={(e) =>
                            updateLine(activeLine.id, {
                              description: e.target.value,
                            })
                          }
                          placeholder="e.g. 5star bracelet"
                        />
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label>Qty</Label>
                          <Input
                            value={String(activeLine.qty ?? 0)}
                            onChange={(e) =>
                              updateLine(activeLine.id, {
                                qty: nnum(e.target.value, 0),
                              })
                            }
                            className="text-right"
                            inputMode="numeric"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Plating Color</Label>
                          <Input
                            value={activeLine.plating_color ?? ""}
                            onChange={(e) =>
                              updateLine(activeLine.id, {
                                plating_color: e.target.value,
                              })
                            }
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label>Plating Spec</Label>
                        <Input
                          value={activeLine.plating_spec ?? ""}
                          onChange={(e) =>
                            updateLine(activeLine.id, {
                              plating_spec: e.target.value,
                            })
                          }
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Spec Summary</Label>
                        <Textarea
                          value={activeLine.spec_summary ?? ""}
                          onChange={(e) =>
                            updateLine(activeLine.id, {
                              spec_summary: e.target.value,
                            })
                          }
                          rows={3}
                        />
                      </div>

                      <Separator />
                      <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
                        ✅ Work/QC/Packing은 공통 박스로 보이지만, DB 구조상
                        “고정된 1개 라인(masterLineId)”에 저장됩니다.
                        <br />
                        (Save 후에도 masterLineId가 유지되므로 입력값이 사라지지
                        않습니다.)
                      </div>
                    </TabsContent>

                    <TabsContent value="materials" className="space-y-3">
                      <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
                        Materials / Operations는{" "}
                        <span className="font-medium text-foreground">
                          Product Development
                        </span>
                        에서 자동으로 가져옵니다. (Work Sheet에서는
                        수정/추가하지 않습니다.)
                      </div>

                      <div className="space-y-2">
                        {(materialsByLineId[activeLine.id] ?? [])
                          .filter((s) => !s.is_deleted)
                          .sort(
                            (a, b) =>
                              nnum(a.sort_order, 0) - nnum(b.sort_order, 0)
                          ).length === 0 ? (
                          <div className="text-sm text-muted-foreground">
                            No material specs found for this style. (Check
                            Product Development)
                          </div>
                        ) : (
                          <div className="overflow-x-auto rounded-md border">
                            <table className="w-full text-sm">
                              <thead className="bg-muted/50">
                                <tr className="text-left">
                                  <th className="p-2">Material / Labor</th>
                                  <th className="p-2 text-right">Qty</th>
                                  <th className="p-2 text-right">
                                    Planned Unit
                                  </th>
                                  <th className="p-2 text-right">
                                    Planned Amt
                                  </th>

                                  {isInternalView &&
                                  (resolvedProductionMode === "IN_HOUSE" ||
                                    (resolvedProductionMode === "OUTSOURCED" &&
                                      resolveOutsourcingType(activeLine) === "PROCESSING")) ? (
                                    <>
                                      <th className="p-2 text-right">
                                        Actual Unit
                                      </th>
                                      <th className="p-2 text-right">
                                        Actual Amt
                                      </th>
                                    </>
                                  ) : null}

                                  <th className="p-2">Remarks</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(materialsByLineId[activeLine.id] ?? [])
                                  .filter((s) => !s.is_deleted)
                                  .sort(
                                    (a, b) =>
                                      nnum(a.sort_order, 0) -
                                      nnum(b.sort_order, 0)
                                  )
                                  .map((s) => (
                                    <tr key={s.id} className="border-t">
                                      <td className="p-2">
                                        {s.material_name ?? ""}
                                      </td>

                                      {(() => {
                                        const plannedQty = extractQtyFromNote(
                                          s.note
                                        );
                                        const plannedUnit =
                                          extractUnitCostFromNote(s.note);
                                        const actualQty =
                                          (s as any).actual_qty ?? null;
                                        const rawActualUnit =
                                          actualUnitInputBySpecId[s.id];
                                        const actualUnit =
                                          rawActualUnit !== undefined &&
                                          String(rawActualUnit).trim() !== ""
                                            ? parseDec4ToNumber(
                                                String(rawActualUnit)
                                              )
                                            : (s as any).actual_unit_cost ??
                                              null;

                                        // ✅ FIX: qtyForActual fallback prevents "0 after save"
                                        const qtyForActual =
                                          actualQty ?? plannedQty ?? 1;

                                        const isInhouseInternal =
                                          isInternalView &&
                                          (resolvedProductionMode === "IN_HOUSE" ||
                                            (resolvedProductionMode === "OUTSOURCED" &&
                                              resolveOutsourcingType(activeLine) === "PROCESSING"));
                                        const isLocked = !!(activeLine as any)
                                          ?.actual_cost_confirmed;

                                        return (
                                          <>
                                            <td className="p-2 text-right">
                                              {plannedQty === null
                                                ? ""
                                                : String(plannedQty)}
                                            </td>

                                            <td className="p-2 text-right">
                                              {plannedUnit === null
                                                ? ""
                                                : fmtMoney(plannedUnit)}
                                            </td>

                                            <td className="p-2 text-right">
                                              {plannedQty === null ||
                                              plannedUnit === null
                                                ? ""
                                                : fmtMoney(
                                                    plannedQty * plannedUnit
                                                  )}
                                            </td>

                                            {isInhouseInternal ? (
                                              <>
                                                <td className="p-2 text-right">
                                                  <Input
                                                    type="text"
                                                    inputMode="decimal"
                                                    value={
                                                      actualUnitInputBySpecId[
                                                        s.id
                                                      ] ??
                                                      (actualUnit === null ||
                                                      actualUnit === undefined
                                                        ? ""
                                                        : String(actualUnit))
                                                    }
                                                    onChange={(e) => {
                                                      const raw0 =
                                                        e.target.value;
                                                      const raw =
                                                        normalizeDec4Input(
                                                          raw0
                                                        );

                                                      // allow empty
                                                      if (raw === "") {
                                                        setActualUnitInputBySpecId(
                                                          (p) => ({
                                                            ...p,
                                                            [s.id]: "",
                                                          })
                                                        );
                                                        // keep numeric value null as well
                                                        setMaterialsByLineId(
                                                          (prev) => {
                                                            const arr =
                                                              prev[
                                                                activeLine.id
                                                              ] ?? [];
                                                            const next =
                                                              arr.map((x) =>
                                                                x.id === s.id
                                                                  ? {
                                                                      ...(x as any),
                                                                      actual_unit_cost:
                                                                        null,
                                                                    }
                                                                  : x
                                                              );
                                                            return {
                                                              ...prev,
                                                              [activeLine.id]:
                                                                next,
                                                            };
                                                          }
                                                        );
                                                        return;
                                                      }

                                                      // reject invalid formats (only up to 4 decimals)
                                                      if (
                                                        !DEC4_RE.test(raw)
                                                      )
                                                        return;

                                                      setActualUnitInputBySpecId(
                                                        (p) => ({
                                                          ...p,
                                                          [s.id]: raw,
                                                        })
                                                      );

                                                      const n =
                                                        parseDec4ToNumber(
                                                          raw
                                                        );

                                                      // ✅ FIX: if actual_qty is empty, seed it (prevents save->0)
                                                      setMaterialsByLineId(
                                                        (prev) => {
                                                          const arr =
                                                            prev[
                                                              activeLine.id
                                                            ] ?? [];
                                                          const next =
                                                            arr.map((x) => {
                                                              if (
                                                                x.id !== s.id
                                                              )
                                                                return x;
                                                              const seededQty =
                                                                (x as any)
                                                                  .actual_qty ??
                                                                extractQtyFromNote(
                                                                  (x as any)
                                                                    .note
                                                                ) ??
                                                                1;
                                                              return {
                                                                ...(x as any),
                                                                actual_unit_cost:
                                                                  n,
                                                                actual_qty:
                                                                  seededQty,
                                                              };
                                                            });
                                                          return {
                                                            ...prev,
                                                            [activeLine.id]:
                                                              next,
                                                          };
                                                        }
                                                      );
                                                    }}
                                                    onBlur={() => {
                                                      const raw = (
                                                        actualUnitInputBySpecId[
                                                          s.id
                                                        ] ?? ""
                                                      ).trim();
                                                      if (raw === "") return;
                                                      const normalized =
                                                        normalizeDec4Input(
                                                          raw
                                                        );
                                                      if (
                                                        !DEC4_RE.test(
                                                          normalized
                                                        )
                                                      ) {
                                                        // revert to numeric if user typed something weird
                                                        setActualUnitInputBySpecId(
                                                          (p) => ({
                                                            ...p,
                                                            [s.id]:
                                                              actualUnit ===
                                                                null ||
                                                              actualUnit ===
                                                                undefined
                                                                ? ""
                                                                : String(
                                                                    actualUnit
                                                                  ),
                                                          })
                                                        );
                                                        return;
                                                      }
                                                      const n =
                                                        parseDec4ToNumber(
                                                          normalized
                                                        );
                                                      setActualUnitInputBySpecId(
                                                        (p) => ({
                                                          ...p,
                                                          [s.id]: normalized,
                                                        })
                                                      );
                                                      setMaterialsByLineId(
                                                        (prev) => {
                                                          const arr =
                                                            prev[
                                                              activeLine.id
                                                            ] ?? [];
                                                          const next =
                                                            arr.map((x) =>
                                                              x.id === s.id
                                                                ? {
                                                                    ...(x as any),
                                                                    actual_unit_cost:
                                                                      n,
                                                                  }
                                                                : x
                                                            );
                                                          return {
                                                            ...prev,
                                                            [activeLine.id]:
                                                              next,
                                                          };
                                                        }
                                                      );
                                                    }}
                                                    placeholder="e.g. 0.1200"
                                                    className="h-8 text-right"
                                                    disabled={isLocked}
                                                  />
                                                </td>

                                                <td className="p-2 text-right">
                                                  {actualUnit === null ||
                                                  actualUnit === undefined
                                                    ? ""
                                                    : fmtMoney(
                                                        Number(qtyForActual) *
                                                          Number(actualUnit)
                                                      )}
                                                </td>
                                              </>
                                            ) : null}
                                          </>
                                        );
                                      })()}

                                      <td className="p-2">
                                        {fmtWsRemarks(
                                          s.spec_text,
                                          s.color,
                                          s.note
                                        ) || "-"}
                                      </td>
                                    </tr>
                                  ))}

                                {/* TOTAL row */}
                                <tr className="border-t bg-muted/30 font-semibold">
                                  <td className="p-2">TOTAL</td>
                                  <td className="p-2 text-right"></td>
                                  <td className="p-2 text-right"></td>
                                  <td className="p-2 text-right">
                                    {(() => {
                                      const list = (
                                        materialsByLineId[activeLine.id] ?? []
                                      ).filter((s) => !s.is_deleted);
                                      const totalPlanned = list.reduce(
                                        (acc, s) => {
                                          const q = extractQtyFromNote(s.note) ?? 0;
                                          const u =
                                            extractUnitCostFromNote(s.note);
                                          if (q === null || u === null)
                                            return acc;
                                          return acc + q * u;
                                        },
                                        0
                                      );
                                      return fmtMoney(totalPlanned);
                                    })()}
                                  </td>

                                  {isInternalView &&
                                  (resolvedProductionMode === "IN_HOUSE" ||
                                    (resolvedProductionMode === "OUTSOURCED" &&
                                      resolveOutsourcingType(activeLine) === "PROCESSING")) ? (
                                    <>
                                      <td className="p-2 text-right"></td>
                                      <td className="p-2 text-right">
                                        {(() => {
                                          const list = (
                                            materialsByLineId[activeLine.id] ??
                                            []
                                          ).filter((s) => !s.is_deleted);
                                          const totalActual = list.reduce(
                                            (acc, s) => {
                                              const plannedQty =
                                                extractQtyFromNote(s.note);
                                              const actualQty =
                                                (s as any).actual_qty ?? null;
                                              const qtyForActual =
                                                actualQty ?? plannedQty ?? 1;
                                              const rawActualUnit =
                                                actualUnitInputBySpecId[s.id];
                                              const actualUnit =
                                                rawActualUnit !== undefined &&
                                                String(rawActualUnit).trim() !==
                                                  ""
                                                  ? parseDec4ToNumber(
                                                      String(rawActualUnit)
                                                    )
                                                  : (s as any)
                                                      .actual_unit_cost ??
                                                    null;

                                              // ✅ FIX: do not drop row due to qty null
                                              if (
                                                actualUnit === null ||
                                                actualUnit === undefined
                                              )
                                                return acc;

                                              return (
                                                acc +
                                                Number(qtyForActual) *
                                                  Number(actualUnit)
                                              );
                                            },
                                            0
                                          );
                                          return fmtMoney(totalActual);
                                        })()}
                                      </td>
                                    </>
                                  ) : null}

                                  <td className="p-2"></td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </TabsContent>

                    {/* vendor tab ... (이하 네 원본 그대로) */}
          <TabsContent value="vendor" className="space-y-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Vendor / Margin Control</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 md:grid-cols-4">
                  {(() => {
                    const specs = materialsByLineId[activeLine.id] ?? [];
                    const sync = calcLineActualSync(
                      activeLine,
                      specs,
                      vendorActualUnitInputByLineId[activeLine.id]
                    );
                    const plannedUnitUsd = sync.plannedUnit ?? sync.plannedAmt ?? 0;
                    const plannedLocal = (sync as any).plannedUnitLocal ?? calcMaterialsPlannedAmt(specs);
                    const actualLocalInhouse = specs.reduce((acc: number, sp: any) => {
                      const specId = String(sp?.id ?? "");
                      const raw = specId ? actualUnitInputBySpecId?.[specId] : undefined;
                      const saved = (sp as any)?.actual_unit_cost;
                      const actualUnit = raw != null && String(raw).trim() !== ""
                        ? parseDec4ToNumber(String(raw))
                        : saved ?? null;
                      if (actualUnit === null || actualUnit === undefined) return acc;
                      const qtyForActual = (sp as any)?.actual_qty ?? extractQtyFromNote(sp?.note) ?? 1;
                      return acc + Number(qtyForActual) * Number(actualUnit);
                    }, 0);
                    const actualLocalOutsourced =
                      (parseDec2ToNumber(vendorActualUnitInputByLineId[activeLine.id] ?? "") ??
                        (activeLine as any)?.actual_vendor_unit_cost_local ?? null);
                    const actualFx = ((activeLine as any)?.actual_fx_rate ?? (activeLine as any)?.fx_rate ?? null);
                    const lineFx = nnumNullable((activeLine as any)?.fx_rate);
                    const plannedDisplay = resolvedProductionMode === "IN_HOUSE" ? plannedLocal : plannedUnitUsd;
                    const actualDisplay = resolvedProductionMode === "IN_HOUSE" ? actualLocalInhouse : (sync.actualUnit ?? 0);
                    const deltaUnit = actualDisplay - plannedDisplay;
                    const deltaPct = plannedDisplay ? (deltaUnit / plannedDisplay) * 100 : 0;

                    return (
                      <>
                        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">{resolvedProductionMode === "IN_HOUSE" ? "Planned Unit Cost (Local)" : ((sync as any).outsourcingType === "PROCESSING" ? "Planned Total Unit Cost (USD)" : "Planned Vendor Unit Cost (USD)")}</div><div className="mt-1 text-2xl font-semibold tabular-nums">{fmtMoney(plannedDisplay)}</div><div className="mt-1 text-xs text-muted-foreground">{resolvedProductionMode === "OUTSOURCED" ? (((sync as any).outsourcingType === "PROCESSING") ? `Material ${fmtMoney((sync as any).materialLocalPlanned ?? 0)} + Vendor ${fmtMoney((sync as any).vendorLocalPlanned ?? 0)} ${(activeLine as any)?.vendor_currency ?? "CNY"}` : fmtFxMeta((activeLine as any)?.vendor_currency ?? "CNY", plannedLocal, (activeLine as any)?.fx_rate ?? null)) : (lineFx && lineFx > 0 ? `USD ${fmtMoney(calcPlannedUnitUsd(plannedLocal, "CNY", lineFx) ?? 0)} @ FX ${fmtMoney(lineFx)}` : "IN_HOUSE planned sum")}</div></CardContent></Card>
                        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">{resolvedProductionMode === "IN_HOUSE" ? "Actual Unit Cost (Local)" : "Actual Unit Cost (USD)"}</div><div className="mt-1 text-2xl font-semibold tabular-nums">{fmtMoney(actualDisplay)}</div><div className="mt-1 text-xs text-muted-foreground">{resolvedProductionMode === "OUTSOURCED" ? fmtFxMeta((activeLine as any)?.vendor_currency ?? "USD", actualLocalOutsourced, actualFx) : (lineFx && lineFx > 0 ? `USD ${fmtMoney(calcPlannedUnitUsd(actualLocalInhouse, "CNY", lineFx) ?? 0)} @ FX ${fmtMoney(lineFx)}` : "IN_HOUSE actual sum")}</div></CardContent></Card>
                        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">{resolvedProductionMode === "IN_HOUSE" ? "Δ Unit Cost (Local)" : "Δ Unit Cost (USD)"}</div><div className="mt-1 text-2xl font-semibold tabular-nums">{`${deltaUnit >= 0 ? "+" : ""}${fmtMoney(deltaUnit)}`}</div></CardContent></Card>
                        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Δ %</div><div className="mt-1 text-2xl font-semibold tabular-nums">{`${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(2)}%`}</div></CardContent></Card>
                      </>
                    );
                  })()}
                </div>
                <div className="grid gap-3 md:grid-cols-4">
                  <div className="space-y-1">
                    <Label>Production Mode</Label>
                    <Select
                      value={(resolvedProductionMode ?? "IN_HOUSE") as any}
                      onValueChange={(v) => {
                        if (!activeLine) return;
                        const nextMode = v as "IN_HOUSE" | "OUTSOURCED";
                        setLines((prev) =>
                          (prev || []).map((ln) => {
                            if (ln.id !== activeLine.id) return ln;
                            // ✅ Mode -> Vendor auto linkage
                            if (nextMode === "IN_HOUSE") {
                              return {
                                ...ln,
                                production_mode: "IN_HOUSE",
                                outsourcing_type: null,
                                internal_material_cost: null,
                                vendor_id: null,
                                vendor_currency: null,
                                vendor_unit_cost_local: null,
                              };
                            }
                            return { ...ln, production_mode: "OUTSOURCED" };
                          })
                        );
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select mode" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="IN_HOUSE">IN_HOUSE</SelectItem>
                        <SelectItem value="OUTSOURCED">OUTSOURCED</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {resolvedProductionMode === "OUTSOURCED" ? (
                  <>
                  <div className="space-y-1"> 
                    <Label>Outsourcing Type</Label>
                    <Select
                      value={(resolveOutsourcingType(activeLine) ?? "FULL") as any}
                      onValueChange={(v) => {
                        if (!activeLine) return;
                        const nextType = v as OutsourcingType;
                        setLines((prev) =>
                          (prev || []).map((ln) => {
                            if (ln.id !== activeLine.id) return ln;
                            return {
                              ...ln,
                              outsourcing_type: nextType,
                              internal_material_cost:
                                nextType === "PROCESSING"
                                  ? (nnumNullable((ln as any)?.internal_material_cost) ?? calcMaterialsPlannedAmt(materialsByLineId[activeLine.id] ?? []))
                                  : null,
                            } as any;
                          })
                        );
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="FULL">FULL</SelectItem>
                        <SelectItem value="PROCESSING">PROCESSING</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="text-[11px] text-muted-foreground">
                      FULL = 완제품 외주 / PROCESSING = 사급자재 + 가공비 외주
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label>Vendor</Label>
                    <Select
                      value={(activeLine?.vendor_id ?? "NONE") as string}
                      onValueChange={(v) => {
                        if (!activeLine) return;
                        setLines((prev) =>
                          (prev || []).map((ln) => {
                            if (ln.id !== activeLine.id) return ln;

                            // ✅ Vendor -> Mode auto linkage
                            if (v === "NONE") {
                              return {
                                ...ln,
                                vendor_id: null,
                                production_mode: "IN_HOUSE",
                                outsourcing_type: null,
                                internal_material_cost: null,
                                vendor_currency: null,
                                vendor_unit_cost_local: null,
                              };
                            }
                            return {
                              ...ln,
                              vendor_id: v,
                              production_mode: "OUTSOURCED",
                            };
                          })
                        );
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select vendor" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NONE">(No Vendor)</SelectItem>
                        {(vendors || []).map((v: any) => (
                          <SelectItem key={v.id} value={v.id}>
                            {v.name || v.company_name || v.code || v.id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <Label>Vendor Currency</Label>
                    <Select
                      value={(activeLine?.vendor_currency ?? "USD") as string}
                      onValueChange={(v) => {
                        if (!activeLine) return;
                        const next = v as string;
                        setLines((prev) =>
                          (prev || []).map((ln) => {
                            if (ln.id !== activeLine.id) return ln;
                            const localUnit = nnumNullable((ln as any)?.vendor_unit_cost_local);
                            const fx = (ln as any)?.fx_rate ?? null;
                            const actualLocal = (ln as any)?.actual_vendor_unit_cost_local ?? null;
                            return ({
                              ...ln,
                              vendor_currency: next,
                              vendor_unit_cost_local: localUnit,
                              vendor_unit_cost_usd: calcPlannedUnitUsd(localUnit, next, fx),
                              actual_vendor_unit_cost_usd: calcActualVendorUnitUsd(actualLocal, next, (ln as any)?.actual_fx_rate ?? fx),
                            } as any);
                          })
                        );
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Currency" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="USD">USD</SelectItem>
                        <SelectItem value="CNY">CNY</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <Label>FX Rate ({(activeLine?.vendor_currency ?? "CNY")} per 1 USD)</Label>
                    <Input
                      inputMode="decimal"
                      placeholder={(activeLine?.vendor_currency ?? "CNY") === "USD" ? "1" : "7.20"}
                      value={
                        activeLine?.id
                          ? vendorFxInputByLineId[activeLine.id] ?? ""
                          : ""
                      }
                      onChange={(e) => {
                        if (!activeLine?.id) return;
                        const raw0 = e.target.value;
                        const raw = normalizeDec2Input(raw0);
                        if (raw !== "" && !DEC2_RE.test(raw)) return;

                        const lineId = activeLine.id;
                        setVendorFxInputByLineId((prev) => ({
                          ...prev,
                          [lineId]: raw,
                        }));

                        const n = parseDec2ToNumber(raw);
                        setLines((prev) =>
                          (prev || []).map((ln) => {
                            if (ln.id !== lineId) return ln;
                            const manualLocal =
                              parseDec2ToNumber(vendorUnitInputByLineId[lineId] ?? "") ??
                              nnumNullable((ln as any)?.vendor_unit_cost_local) ??
                              null;
                            const actualLocal = (ln as any)?.actual_vendor_unit_cost_local ?? null;
                            return {
                              ...(ln as any),
                              fx_rate: n,
                              fx_mode: "MANUAL",
                              fx_as_of: new Date().toISOString().slice(0, 10),
                              vendor_unit_cost_local: manualLocal,
                              vendor_unit_cost_usd: calcPlannedUnitUsd(manualLocal, ((ln as any)?.vendor_currency ?? "CNY"), n),
                              actual_fx_rate: n,
                              actual_fx_mode: "MANUAL",
                              actual_fx_as_of: new Date().toISOString().slice(0, 10),
                              actual_vendor_unit_cost_usd: calcActualVendorUnitUsd(actualLocal, ((ln as any)?.vendor_currency ?? "CNY"), n),
                            } as any;
                          })
                        );
                      }}
                    />
                    <div className="text-[11px] text-muted-foreground">기준: 1 USD = FX Rate local currency. 예: 1 USD = 7.20 CNY 이면 1.26 CNY ÷ 7.20 = 0.1750 USD</div>
                  </div>

                  <div className="space-y-1">
                    <Label>Internal Material Cost</Label>
                    <Input
                      inputMode="decimal"
                      placeholder="0.00"
                      value={activeLine?.id ? (internalMaterialInputByLineId[activeLine.id] ?? "") : ""}
                      onChange={(e) => {
                        if (!activeLine?.id) return;
                        const raw0 = e.target.value;
                        if (raw0 !== "" && !DEC2_RE.test(raw0)) return;
                        const raw = normalizeDec2Input(raw0);
                        const n = parseDec2ToNumber(raw);
                        const lineId = activeLine.id;

                        setInternalMaterialInputByLineId((prev) => ({
                          ...prev,
                          [lineId]: raw,
                        }));

                        setLines((prev) =>
                          (prev || []).map((ln) => {
                            if (ln.id !== lineId) return ln;
                            return {
                              ...(ln as any),
                              internal_material_cost: n,
                            } as any;
                          })
                        );
                      }}
                      disabled={resolveOutsourcingType(activeLine) !== "PROCESSING"}
                    />
                    <div className="text-[11px] text-muted-foreground">
                      PROCESSING일 때만 사용. 소숫점 이하 2자리까지 입력 가능합니다. 비워두면 Materials 탭 합계를 사용합니다.
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label>{resolveOutsourcingType(activeLine) === "PROCESSING" ? "Processing Unit Price" : "Vendor Unit Price"}</Label>
                    <Input
                      inputMode="decimal"
                      placeholder="0.00"
                      value={
                        activeLine?.id
                          ? vendorUnitInputByLineId[activeLine.id] ?? ""
                          : ""
                      }
                      onChange={(e) => {
                        if (!activeLine?.id) return;
                        const raw0 = e.target.value;
                        const raw = normalizeDec2Input(raw0);
                        // hard guard for non-matching patterns
                        if (raw !== "" && !DEC2_RE.test(raw)) return;

                        const lineId = activeLine.id;
                        setVendorUnitInputByLineId((prev) => ({
                          ...prev,
                          [lineId]: raw,
                        }));

                        const n = parseDec2ToNumber(raw);
                        setLines((prev) =>
                          (prev || []).map((ln) => {
                            if (ln.id !== lineId) return ln;
                            const fx = (ln as any)?.fx_rate ?? null;
                            const cur = (ln as any)?.vendor_currency ?? "CNY";
                            return ({
                              ...ln,
                              vendor_unit_cost_local: n,
                              vendor_unit_cost_usd: calcPlannedUnitUsd(n, cur, fx),
                            } as any);
                          })
                        );
                      }}
                      disabled={(resolvedProductionMode ?? "IN_HOUSE") !== "OUTSOURCED"}
                    />
                    <div className="text-[11px] text-muted-foreground">
                      {resolveOutsourcingType(activeLine) === "PROCESSING" ? "가공비 단가(로컬통화)입니다. 소수점 2자리까지 입력." : "완제품 외주 단가(로컬통화)입니다. 소수점 2자리까지 입력."}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      USD Preview: {fmtMoney(calcPlannedUnitUsd(activeLine?.vendor_unit_cost_local ?? null, activeLine?.vendor_currency ?? "CNY", (activeLine as any)?.fx_rate ?? null) ?? 0)}
                    </div>
                  </div>


                  <div className="space-y-1">
                    <Label>Vendor Actual Unit Cost (Local Currency)</Label>
                    <Input
                      inputMode="decimal"
                      placeholder="0.00"
                      value={
                        activeLine?.id
                          ? vendorActualUnitInputByLineId[activeLine.id] ?? ""
                          : ""
                      }
                      onChange={(e) => {
                        if (!activeLine?.id) return;
                        const raw0 = e.target.value;
                        const raw = normalizeDec2Input(raw0);
                        if (raw !== "" && !DEC2_RE.test(raw)) return;

                        const lineId = activeLine.id;
                        setVendorActualUnitInputByLineId((prev) => ({
                          ...prev,
                          [lineId]: raw,
                        }));

                        const n = parseDec2ToNumber(raw);
                        setLines((prev) =>
                          (prev || []).map((ln) => {
                            if (ln.id !== lineId) return ln;
                            const cur = (ln as any)?.vendor_currency ?? "CNY";
                            const fx = nnumNullable((ln as any)?.fx_rate) ?? null;
                            return ({
                              ...ln,
                              actual_vendor_unit_cost_local: n,
                              actual_vendor_unit_cost_usd: calcActualVendorUnitUsd(n, cur, fx),
                              actual_fx_rate: fx,
                              actual_fx_as_of: fx ? new Date().toISOString().slice(0, 10) : (ln as any)?.actual_fx_as_of ?? null,
                              actual_fx_mode: fx ? "MANUAL" : (ln as any)?.actual_fx_mode ?? null,
                            } as any);
                          })
                        );
                      }}
                      disabled={(resolvedProductionMode ?? "IN_HOUSE") !== "OUTSOURCED"}
                    />
                    <div className="text-[11px] text-muted-foreground">
                      실제 지급/정산된 하청 단가(로컬통화)입니다. 현재 통화: {(activeLine?.vendor_currency ?? "USD").toUpperCase()}.
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      USD Preview: {fmtMoney(calcActualVendorUnitUsd(parseDec2ToNumber(activeLine?.id ? vendorActualUnitInputByLineId[activeLine.id] ?? "" : "") ?? (activeLine as any)?.actual_vendor_unit_cost_local ?? null, activeLine?.vendor_currency ?? "CNY", (activeLine as any)?.actual_fx_rate ?? (activeLine as any)?.fx_rate ?? null) ?? 0)}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label>Actual Locked</Label>
                    <Input value={activeActualLocked ? "YES (Confirmed)" : "NO"} readOnly />
                  </div>
                  </>
                ) : (
                  <>
                    <div className="space-y-1">
                      <Label>FX Rate (CNY per 1 USD)</Label>
                      <Input
                        inputMode="decimal"
                        placeholder="7.20"
                        value={activeLine?.id ? (vendorFxInputByLineId[activeLine.id] ?? "") : ""}
                        onChange={(e) => {
                          if (!activeLine?.id) return;
                          const raw0 = e.target.value;
                          const raw = normalizeDec2Input(raw0);
                          if (raw !== "" && !DEC2_RE.test(raw)) return;
                          const lineId = activeLine.id;
                          setVendorFxInputByLineId((prev) => ({ ...prev, [lineId]: raw }));
                          const n = parseDec2ToNumber(raw);
                          setLines((prev) =>
                            (prev || []).map((ln) =>
                              ln.id !== lineId
                                ? ln
                                : ({ ...(ln as any), fx_rate: n, fx_mode: "MANUAL", fx_as_of: n ? new Date().toISOString().slice(0, 10) : (ln as any).fx_as_of ?? null } as any)
                            )
                          );
                        }}
                      />
                      <div className="text-[11px] text-muted-foreground">IN_HOUSE KPI의 USD 환산용입니다. 예: 1 USD = 7.20 CNY</div>
                    </div>
                    <div className="md:col-span-3 rounded-xl border border-dashed p-3 text-sm text-muted-foreground">
                      IN_HOUSE mode에서는 Vendor / Vendor Currency / Vendor Unit Price / Vendor Actual Unit Cost를 표시하지 않습니다. FX는 KPI USD 환산용으로만 사용합니다.
                    </div>
                  </>
                )}
                </div>

                {activeLine ? (
                  (() => {
                    const requestedShipDate =
                      (po as any)?.requested_ship_date ??
                      (po as any)?.requestedShipDate ??
                      (po as any)?.req_ship_date ??
                      null;

                    const vd = calcVendorDelivery(
                      requestedShipDate,
                      (activeLine as any)?.vendor_ready_date ?? null
                    );

                    return (
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-3">
                        <div className="space-y-1">
                          <Label>Vendor Due Date</Label>
                          <Input value={vd.dueDate ?? ""} readOnly />
                        </div>

                        <div className="space-y-1">
                          <Label>Vendor Ready Date</Label>
                          <Input
                            type="date"
                            value={((activeLine as any)?.vendor_ready_date ?? "").toString().slice(0, 10)}
                            onChange={(e) => {
                              if (!activeLine?.id) return;
                              const v = e.target.value || null;
                              const next = calcVendorDelivery(requestedShipDate, v);

                              updateLine(activeLine.id, {
                                vendor_ready_date: v,
                                vendor_delivery_status: next.status,
                                vendor_delay_days: next.delayDays,
                              } as any);
                            }}
                          />
                        </div>

                        <div className="space-y-1">
                          <Label>Delivery Status</Label>
                          <div className="h-10 flex items-center">
                            <Badge
                              variant={
                                vd.status === "LATE"
                                  ? "destructive"
                                  : vd.status === "ON_TIME"
                                  ? "default"
                                  : "secondary"
                              }
                            >
                              {vd.status}
                            </Badge>
                          </div>
                        </div>

                        <div className="space-y-1">
                          <Label>Delay Days</Label>
                          <Input
                            value={
                              vd.delayDays === null || vd.delayDays === undefined
                                ? ""
                                : String(vd.delayDays)
                            }
                            readOnly
                          />
                        </div>
                      </div>
                    );
                  })()
                ) : null}

                <div className="text-sm text-muted-foreground">
                  이 탭은 <span className="font-medium text-foreground">마진 관리용</span>
                  입니다. 여기서는 1pc 기준 Unit Cost를 비교합니다. Planned Unit Cost는 자재/임가공의 1pc 로컬통화 합계를 수동 FX로 USD 환산한 값이고,
                  Actual Unit Cost는 IN_HOUSE면 Materials 탭 Actual Unit 합계, OUTSOURCED면 Vendor Actual Unit Cost(로컬통화 입력 후 FX 환산 USD)입니다.
                  <br />
                  <span className="font-medium text-foreground">Vendor Unit Price</span> 는
                  벤더에게 지급하는 <span className="font-medium text-foreground">하청 단가</span>
                  (로컬통화)를 입력합니다. 이 항목은 <span className="font-medium text-foreground">OUTSOURCED</span> 에서만 사용됩니다.
                  <br />
                  <span className="font-medium text-foreground">연동 규칙:</span>{" "}
                  Vendor 선택 → 자동 OUTSOURCED, Mode를 IN_HOUSE로 변경 → Vendor 자동
                  해제(null).
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant={activeActualLocked ? "secondary" : "destructive"}
                    onClick={() => onConfirmActualCost("IN_HOUSE")}
                    disabled={
                      saving ||
                      loading ||
                      !header ||
                      activeActualLocked ||
                      confirmingActual ||
                      (resolvedProductionMode ?? "IN_HOUSE") !== "IN_HOUSE" ||
                      !hasAnyActualUnitInput
                    }
                  >
                    {activeActualLocked
                      ? "Actual Confirmed"
                      : confirmingActual && (resolvedProductionMode ?? "IN_HOUSE") === "IN_HOUSE"
                      ? "Confirming..."
                      : "Confirm Actual (IN_HOUSE)"}
                  </Button>

                  <Button
                    variant={activeActualLocked ? "secondary" : "destructive"}
                    onClick={() => onConfirmActualCost("OUTSOURCED")}
                    disabled={
                      saving ||
                      loading ||
                      !header ||
                      activeActualLocked ||
                      confirmingActual ||
                      (resolvedProductionMode ?? "IN_HOUSE") !== "OUTSOURCED" ||
                      !activeLine?.vendor_id
                    }
                  >
                    {activeActualLocked
                      ? "Actual Confirmed"
                      : confirmingActual && (resolvedProductionMode ?? "IN_HOUSE") === "OUTSOURCED"
                      ? "Confirming..."
                      : "Confirm Actual (OUTSOURCED)"}
                  </Button>

                  <Button
                    variant="outline"
                    onClick={onUnlockActualCost}
                    disabled={saving || loading || !header || !activeActualLocked || confirmingActual}
                  >
                    {confirmingActual && activeActualLocked ? "Unlocking..." : "Unlock Actual"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
                  </Tabs>
                </>
              )}
              </CardContent>
          </Card>
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground">Loading...</div>
        ) : null}
      </div>

      <Dialog open={previewOpen} onOpenChange={(open) => { if (!open) closeImagePreview(); else setPreviewOpen(true); }}>
        <DialogContent className="max-w-5xl p-3">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm text-muted-foreground">
                {previewImages.length > 0 ? `${previewIndex + 1} / ${previewImages.length}` : ""}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPreviewZoom((z) => Math.max(1, Number((z - 0.25).toFixed(2))))}
                  disabled={previewZoom <= 1}
                >
                  Zoom -
                </Button>
                <div className="min-w-[70px] text-center text-sm tabular-nums">
                  {Math.round(previewZoom * 100)}%
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPreviewZoom((z) => Math.min(4, Number((z + 0.25).toFixed(2))))}
                  disabled={previewZoom >= 4}
                >
                  Zoom +
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setPreviewZoom(1);
                    setPreviewOrigin("50% 50%");
                  }}
                >
                  Reset
                </Button>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={showPrevImage}
                disabled={previewImages.length <= 1}
              >
                ← Prev
              </Button>

              <div
                className="relative flex-1 overflow-hidden rounded-md border bg-black/5"
                style={{ height: "72vh" }}
                onWheel={handlePreviewWheel}
                onMouseMove={handlePreviewMouseMove}
              >
                {previewImages[previewIndex] ? (
                  <img
                    src={previewImages[previewIndex]}
                    alt={`Preview ${previewIndex + 1}`}
                    className="h-full w-full object-contain select-none"
                    draggable={false}
                    style={{
                      transform: `scale(${previewZoom})`,
                      transformOrigin: previewOrigin,
                      transition: "transform 0.12s ease-out",
                      cursor: previewZoom > 1 ? "zoom-out" : "zoom-in",
                    }}
                    onClick={() => {
                      if (previewZoom > 1) {
                        setPreviewZoom(1);
                        setPreviewOrigin("50% 50%");
                      } else {
                        setPreviewZoom(2);
                      }
                    }}
                  />
                ) : null}
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={showNextImage}
                disabled={previewImages.length <= 1}
              >
                Next →
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
