/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import * as React from "react";
import { useRouter, useParams } from "next/navigation";

import AppShell from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { createClient } from "@/lib/supabaseClient";

type AnyRow = Record<string, any>;

type QuotationHeader = {
  id: string;

  quotation_no?: string | null;
  status?: string | null;

  costing_id?: string | null;

  buyer_id?: string | null;
  buyer_code?: string | null;
  buyer_name?: string | null;

  brand_name?: string | null;

  received_date?: string | null;
  notes?: string | null;
  remarks?: string | null;

  created_at?: string | null;
  updated_at?: string | null;
  is_deleted?: boolean | null;
};

type QuotationLine = {
  id: string;
  quotation_id: string;

  line_no?: number | null;

  style_no?: string | null;
  costing_line_id?: string | null;

  remarks?: string | null;
  files?: any[] | null;

  // Legacy columns (nullable)
  qty?: number | null;
  target_price?: number | null;
  status?: string | null;

  created_at?: string | null;
  updated_at?: string | null;
  is_deleted?: boolean | null;

  // UI-only fields
  __dirty?: boolean;
  __remove?: boolean;
};

type QuotationVariant = {
  id: string;
  quotation_id: string;
  label?: string | null;
  ship_from_site_id?: string | null;
  incoterm?: string | null;

  currency?: string | null;
  fx_rate?: number | null;

  status?: string | null;

  created_at?: string | null;
  updated_at?: string | null;
  is_deleted?: boolean | null;

  // UI-only
  __dirty?: boolean;
  __remove?: boolean;
};

type VariantLine = {
  id: string;
  variant_id: string; // UI key (normalized)
  quotation_line_id: string;

  moq?: number | null;
  qty?: number | null;

  target_price?: number | null;
  offer_price?: number | null;

  notes?: string | null;
  status?: string | null;

  created_at?: string | null;
  updated_at?: string | null;
  is_deleted?: boolean | null;

  // UI-only
  __dirty?: boolean;
  __remove?: boolean;
};

type VariantLineText = {
  moq: string;
  qty: string;
  target_price: string;
  offer_price: string;
  margin_pct: string;
};

function s(v: any) {
  if (v === null || v === undefined) return "";
  return String(v);
}

function buyerLabel(b: AnyRow): string {
  const name =
    s((b as any)?.company_name) ||
    s((b as any)?.name) ||
    s((b as any)?.buyer_name) ||
    s((b as any)?.legal_name) ||
    s((b as any)?.display_name);
  const code = s((b as any)?.code) || s((b as any)?.buyer_code);
  if (code && name) return `${code} - ${name}`;
  return name || code || s((b as any)?.id) || "";
}

function parseBuyerBrands(b: AnyRow): string[] {
  const raw =
    (b as any)?.buyer_brand ?? (b as any)?.buyer_brands ?? (b as any)?.brands;
  if (!raw) return [];
  if (Array.isArray(raw))
    return raw.map((x) => String(x).trim()).filter(Boolean);
  return String(raw)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function toNumberOrNull(v: any): number | null {
  const t = String(v ?? "").trim();
  if (t === "") return null;
  const x = Number(t);
  if (!Number.isFinite(x)) return null;
  return x;
}

/** Allows allowing "7.", "7.2", ".5" */
function sanitizeDecimalInput(raw: string) {
  let t = raw.replace(/[^\d.]/g, "");
  const firstDot = t.indexOf(".");
  if (firstDot >= 0) {
    t = t.slice(0, firstDot + 1) + t.slice(firstDot + 1).replace(/\./g, "");
  }
  return t;
}

function sanitizeNumberInput(raw: string, allowDecimal: boolean) {
  if (allowDecimal) return sanitizeDecimalInput(raw);
  return raw.replace(/[^\d]/g, "");
}

function fmt(nv?: number | null, digits = 2) {
  if (nv === null || nv === undefined) return "";
  const x = Number(nv);
  if (!Number.isFinite(x)) return "";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(
    x
  );
}

function fmtDateTime(sv?: string | null) {
  if (!sv) return "";
  const d = new Date(sv);
  if (Number.isNaN(d.getTime())) return sv;
  return d.toLocaleString();
}

function nextNo<T extends Record<string, any>>(rows: T[], key: keyof T): number {
  const nums = rows
    .map((r) => Number((r as any)[key] ?? 0))
    .filter((n) => Number.isFinite(n));
  const max = nums.length ? Math.max(...nums) : 0;
  return max + 1;
}

const NONE_SITE = "__none__";
type VariantLinesFkCol = "variant_id" | "quotation_variant_id";

export default function QuotationDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();

  const quotationId = React.useMemo(() => {
    const raw: any = (params as any)?.id;
    return raw ? String(Array.isArray(raw) ? raw[0] : raw) : "";
  }, [params]);

  const isUuid = (v: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

  const exportEnabled = !!quotationId && isUuid(quotationId);

  const downloadExcel = async () => {
    if (!exportEnabled) return;
    try {
      const res = await fetch(`/api/quotations/${quotationId}/excel`, { method: "GET" });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `quotation_${quotationId}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.message || "Failed to export Excel");
    }
  };

  const id = quotationId;
  const supabase = React.useMemo(() => createClient(), []);

  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [header, setHeader] = React.useState<QuotationHeader>({ id });
  const [lines, setLines] = React.useState<QuotationLine[]>([]);
  const [variants, setVariants] = React.useState<QuotationVariant[]>([]);
  const [buyers, setBuyers] = React.useState<AnyRow[]>([]);
  const [buyerBrands, setBuyerBrands] = React.useState<string[]>([]);
  const [costingByStyle, setCostingByStyle] = React.useState<
    Record<string, { cost_cny: number; fx_cny_per_usd: number | null }>
  >({});
  const [shipFromSites, setShipFromSites] = React.useState<AnyRow[]>([]);
  const [activeVariantId, setActiveVariantId] = React.useState<string>("");

  const [variantLines, setVariantLines] = React.useState<
    Record<string, Record<string, VariantLine>>
  >({});
  const [variantLinesLoading, setVariantLinesLoading] = React.useState(false);

  // ✅ Fix: detect which FK column actually contains data
  const [variantLinesFkCol, setVariantLinesFkCol] =
    React.useState<VariantLinesFkCol | null>(null);

  const [fxRateText, setFxRateText] = React.useState<Record<string, string>>({});
  const [variantLineText, setVariantLineText] = React.useState<
    Record<string, VariantLineText>
  >({});

  async function loadBuyers() {
    const { data, error } = await supabase.from("companies").select("*").limit(500);
    if (error) throw error;

    const rows = (data ?? []) as AnyRow[];
    const filtered = rows.filter((r) => {
      const t = String(
        (r as any).company_type ??
          (r as any).type ??
          (r as any).company_type_code ??
          ""
      ).toUpperCase();
      const isBuyerFlag = Boolean((r as any).is_buyer);
      if (isBuyerFlag) return true;
      if (t) return t.includes("BUYER") || t === "CUSTOMER";

      const code = String((r as any).code ?? "").trim();
      if (!code) return false;
      if (code.startsWith("JMI")) return false;
      if (code !== code.toUpperCase()) return false;
      if (code.length > 6) return false;
      return true;
    });

    setBuyers(filtered);
  }

  async function loadShipFromSites() {
    try {
      const { data, error } = await supabase
        .from("company_sites")
        .select("*")
        .eq("is_deleted", false);

      if (error) throw error;

      const rows = ((data as AnyRow[]) || []).slice();
      rows.sort((a: AnyRow, b: AnyRow) => {
        const ak = s(
          a.code ??
            a.site_code ??
            a.origin_code ??
            a.name ??
            a.site_name ??
            a.display_name ??
            ""
        );
        const bk = s(
          b.code ??
            b.site_code ??
            b.origin_code ??
            b.name ??
            b.site_name ??
            b.display_name ??
            ""
        );
        return ak.localeCompare(bk);
      });

      setShipFromSites(rows);
    } catch (e: any) {
      console.warn("loadShipFromSites failed", e?.message || e);
      setShipFromSites([]);
    }
  }

  function shipFromLabel(siteId?: string | null) {
    if (!siteId) return "";
    const site = shipFromSites.find((x) => String(x.id) === String(siteId));
    if (!site) return "";
    const code = s((site as AnyRow).code) || s((site as AnyRow).site_code);
    const name =
      s((site as AnyRow).site_name) ||
      s((site as AnyRow).name) ||
      s((site as AnyRow).display_name);
    const country = s((site as AnyRow).country) || s((site as AnyRow).country_code);
    const city = s((site as AnyRow).city);
    const parts = [code, name, [city, country].filter(Boolean).join(", ")].filter(Boolean);
    return parts.join(" — ");
  }

  async function loadCostingsForStyles(styleNos: string[]) {
    const uniq = Array.from(
      new Set(styleNos.map((x) => String(x).trim()).filter(Boolean))
    );
    if (uniq.length === 0) return;

    try {
      const { data, error } = await supabase
        .from("costing_headers")
        .select(
          "style_no,total_cost_local,materials_total_local,operations_total_local,total_cost_usd,fx_cny_per_usd,fx_rate_per_usd,updated_at,is_deleted"
        )
        .in("style_no", uniq)
        .eq("is_deleted", false)
        .order("updated_at", { ascending: false });

      if (error) throw error;

      const rows = (data as AnyRow[]) || [];
      const map: Record<string, { cost_cny: number; fx_cny_per_usd: number | null }> = {};

      for (const r of rows) {
        const sn = s(r.style_no);
        if (!sn || map[sn]) continue;
        const c1 = Number(r.total_cost_local ?? 0);
        const c2 = Number(r.materials_total_local ?? 0) + Number(r.operations_total_local ?? 0);
        let costCny = c1 > 0 ? c1 : c2 > 0 ? c2 : 0;

        const fx = r.fx_cny_per_usd ?? r.fx_rate_per_usd ?? null;
        const fxNum = fx === null || fx === undefined ? null : Number(fx);

        if (costCny <= 0) {
          const usd = Number(r.total_cost_usd ?? 0);
          if (usd > 0 && fxNum && fxNum > 0) costCny = usd * fxNum;
        }

        map[sn] = { cost_cny: costCny, fx_cny_per_usd: fxNum && fxNum > 0 ? fxNum : null };
      }

      setCostingByStyle(map);
    } catch (e: any) {
      console.warn("loadCostingsForStyles failed", e?.message || e);
    }
  }

  async function loadAll() {
    setLoading(true);
    setError(null);

    try {
      await loadBuyers();
      await loadShipFromSites();

      const { data: h, error: he } = await supabase
        .from("quotation_headers")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (he) throw he;

      const headerRow = (h as AnyRow) || { id };
      (headerRow as any).brand_name =
        (headerRow as any).brand_name ??
        (headerRow as any).buyer_brand_name ??
        (headerRow as any).buyer_brand ??
        "";
      setHeader(headerRow);

      const { data: ls, error: le } = await supabase
        .from("quotation_lines")
        .select("*")
        .eq("quotation_id", id)
        .eq("is_deleted", false)
        .order("line_no", { ascending: true });
      if (le) throw le;

      const baseLines = ((ls as AnyRow[]) || []).map((r) => ({
        ...r,
        __dirty: false,
        __remove: false,
      })) as QuotationLine[];

      setLines(baseLines);

      await loadCostingsForStyles(baseLines.map((x) => s(x.style_no)));

      // Variants
      const r1 = await supabase
        .from("quotation_variants")
        .select("*")
        .eq("quotation_id", id)
        .order("created_at", { ascending: true });

      if (r1.error) throw r1.error;

      let vs = (r1.data as AnyRow[]) || [];
      vs = vs.filter((x: any) => (x as any)?.is_deleted !== true);

      const vrows = vs.map((r) => ({
        ...r,
        __dirty: false,
        __remove: false,
      })) as QuotationVariant[];

      setVariants(vrows);

      setFxRateText((prev) => {
        const next = { ...prev };
        for (const v of vrows) {
          const key = String(v.id);
          if (next[key] === undefined) {
            next[key] = v.fx_rate === null || v.fx_rate === undefined ? "" : String(v.fx_rate);
          }
        }
        for (const k of Object.keys(next)) {
          if (!vrows.some((v) => String(v.id) === k)) delete next[k];
        }
        return next;
      });

      const keep = activeVariantId && vrows.some((v) => v.id === activeVariantId);
      const next = keep ? activeVariantId : vrows[0]?.id || "";
      setActiveVariantId(next);

      if (next) {
        await loadVariantLines(next, baseLines);
      } else {
        setVariantLines({});
        setVariantLineText({});
      }
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function fetchVariantLinesWithFk(
    fk: VariantLinesFkCol,
    variantId: string
  ): Promise<AnyRow[]> {
    let r = await supabase
      .from("quotation_variant_lines")
      .select("*")
      .eq(fk as any, variantId)
      .eq("is_deleted", false);

    let data = (r.data as AnyRow[]) || [];
    const err: any = r.error as any;

    if (err) {
      const msg = String(err?.message || "");
      if ((msg.includes("schema cache") || msg.includes("Could not find")) && msg.includes("is_deleted")) {
        const r2 = await supabase
          .from("quotation_variant_lines")
          .select("*")
          .eq(fk as any, variantId);
        if (r2.error) throw r2.error;
        data = ((r2.data as AnyRow[]) || []).filter((x: any) => (x as any)?.is_deleted !== true);
        return data;
      }
      throw err;
    }

    return data;
  }

  async function loadVariantLines(variantId: string, currentLines?: QuotationLine[]) {
    if (!variantId) return;

    setVariantLinesLoading(true);
    setError(null);

    try {
      const lineIds = (currentLines ?? lines)
        .filter((x) => !x.__remove)
        .map((x) => x.id);

      if (lineIds.length === 0) {
        setVariantLines((prev) => ({ ...prev, [variantId]: {} }));
        setVariantLineText({});
        return;
      }

      // tmp variant id (client-only)
      if (!isUuid(variantId)) {
        const map: Record<string, VariantLine> = {};
        for (const qlId of lineIds) {
          map[qlId] = {
            id: "",
            variant_id: variantId,
            quotation_line_id: qlId,
            moq: null,
            qty: null,
            target_price: null,
            offer_price: null,
            notes: null,
            status: null,
            __dirty: true,
          } as VariantLine;
        }
        setVariantLines((prev) => ({ ...prev, [variantId]: map }));
        setVariantLineText((prev) => {
          const next: Record<string, VariantLineText> = { ...prev };
          for (const qlId of lineIds) {
            const cur = next[qlId];
            next[qlId] = {
              moq: cur?.moq ?? "",
              qty: cur?.qty ?? "",
              target_price: cur?.target_price ?? "",
              offer_price: cur?.offer_price ?? "",
              margin_pct: cur?.margin_pct ?? "",
            };
          }
          for (const k of Object.keys(next)) {
            if (!lineIds.includes(k)) delete next[k];
          }
          return next;
        });
        return;
      }

      // Decide FK column
      let fk: VariantLinesFkCol | null = variantLinesFkCol;
      let rows: AnyRow[] = [];

      if (fk) {
        rows = await fetchVariantLinesWithFk(fk, variantId);
      } else {
        // try variant_id first
        rows = await fetchVariantLinesWithFk("variant_id", variantId).catch(async (e) => {
          const msg = String((e as any)?.message || e);
          if (
            msg.includes("schema cache") ||
            msg.includes("Could not find") ||
            msg.includes("does not exist") ||
            // when the table uses the OTHER fk column and enforces NOT NULL
            (msg.includes("null value") && msg.includes(alt)) ||
            (msg.includes("violates not-null") && msg.includes(alt))
          ) {
            return await fetchVariantLinesWithFk("quotation_variant_id", variantId);
          }
          throw e;
        });

        // ✅ 핵심: 에러 없이 0 rows면 다른 FK도 조회
        if ((rows?.length ?? 0) === 0) {
          const alt = await fetchVariantLinesWithFk("quotation_variant_id", variantId).catch(() => []);
          if (alt.length > 0) {
            rows = alt;
            fk = "quotation_variant_id";
          } else {
            fk = "variant_id";
          }
        } else {
          fk = "variant_id";
        }
      }

      if (fk && fk !== variantLinesFkCol) setVariantLinesFkCol(fk);

      const map: Record<string, VariantLine> = {};
      for (const row of rows || []) {
        map[String(row.quotation_line_id)] = {
          ...row,
          variant_id: variantId,
          __dirty: false,
          __remove: false,
        } as VariantLine;
      }

      for (const qlId of lineIds) {
        if (!map[qlId]) {
          map[qlId] = {
            id: "",
            variant_id: variantId,
            quotation_line_id: qlId,
            moq: null,
            qty: null,
            target_price: null,
            offer_price: null,
            notes: null,
            status: null,
            __dirty: true,
          } as VariantLine;
        }
      }

      setVariantLines((prev) => ({ ...prev, [variantId]: map }));

      setVariantLineText((prev) => {
        const next: Record<string, VariantLineText> = { ...prev };
        for (const qlId of lineIds) {
          const row = map[qlId];
          next[qlId] = {
            moq: row.moq === null || row.moq === undefined ? "" : String(row.moq),
            qty: row.qty === null || row.qty === undefined ? "" : String(row.qty),
            target_price:
              row.target_price === null || row.target_price === undefined ? "" : String(row.target_price),
            offer_price:
              row.offer_price === null || row.offer_price === undefined
                ? ""
                : Number.isFinite(Number(row.offer_price))
                  ? Number(row.offer_price).toFixed(2)
                  : String(row.offer_price),
            margin_pct: "",
          };
        }
        for (const k of Object.keys(next)) {
          if (!lineIds.includes(k)) delete next[k];
        }
        return next;
      });
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setVariantLinesLoading(false);
    }
  }

  React.useEffect(() => {
    if (!id) return;
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function addLine() {
    const nextLineNo = nextNo(lines, "line_no");
    const newLine: QuotationLine = {
      id: `tmp_${Math.random().toString(16).slice(2)}`,
      quotation_id: id,
      line_no: nextLineNo,
      style_no: "",
      remarks: "",
      files: [],
      __dirty: true,
    };
    setLines((prev) => [...prev, newLine]);

    if (activeVariantId) {
      setVariantLines((prev) => ({
        ...prev,
        [activeVariantId]: {
          ...(prev[activeVariantId] || {}),
          [newLine.id]: {
            id: "",
            variant_id: activeVariantId,
            quotation_line_id: newLine.id,
            moq: null,
            qty: null,
            target_price: null,
            offer_price: null,
            notes: null,
            status: null,
            __dirty: true,
          },
        },
      }));
      setVariantLineText((prev) => ({
        ...prev,
        [newLine.id]: { moq: "", qty: "", target_price: "", offer_price: "", margin_pct: "" },
      }));
    }
  }

  function markRemoveLine(lineId: string) {
    setLines((prev) =>
      prev.map((x) => (x.id === lineId ? { ...x, __remove: true, __dirty: true } : x))
    );

    setVariantLines((m) => {
      const cur = m[activeVariantId]?.[lineId];
      if (!cur) return m;
      return {
        ...m,
        [activeVariantId]: {
          ...(m[activeVariantId] || {}),
          [lineId]: { ...cur, __remove: true, __dirty: true },
        },
      };
    });
  }

  function addVariant() {
    const tmpId = `tmpv_${Math.random().toString(16).slice(2)}`;
    const nextIndex = variants.filter((x) => !x.__remove).length + 1;
    const v: QuotationVariant = {
      id: tmpId,
      quotation_id: id,
      label: `Variant ${nextIndex}`,
      ship_from_site_id: null,
      incoterm: "FOB",
      currency: "USD",
      fx_rate: null,
      status: "DRAFT",
      __dirty: true,
    };
    setVariants((prev) => [...prev, v]);
    setActiveVariantId(tmpId);

    setFxRateText((prev) => ({ ...prev, [tmpId]: "" }));

    const map: Record<string, VariantLine> = {};
    const textMap: Record<string, VariantLineText> = {};
    for (const ln of lines.filter((x) => !x.__remove)) {
      map[ln.id] = {
        id: "",
        variant_id: tmpId,
        quotation_line_id: ln.id,
        moq: null,
        qty: null,
        target_price: null,
        offer_price: null,
        notes: null,
        status: null,
        __dirty: true,
      } as VariantLine;
      textMap[ln.id] = { moq: "", qty: "", target_price: "", offer_price: "", margin_pct: "" };
    }
    setVariantLines((prev) => ({ ...prev, [tmpId]: map }));
    setVariantLineText(textMap);
  }

  function markRemoveVariant(variantId: string) {
    setVariants((prev) =>
      prev.map((v) => (v.id === variantId ? { ...v, __remove: true, __dirty: true } : v))
    );

    if (activeVariantId === variantId) {
      const remain = variants.filter((v) => v.id !== variantId && !v.__remove);
      const next = remain[0]?.id || "";
      setActiveVariantId(next);
      if (next) loadVariantLines(next);
      else {
        setVariantLines({});
        setVariantLineText({});
      }
    }
  }

  async function saveAll() {
    setSaving(true);
    setError(null);

    try {
      // 1) Header
      const headerPayload: AnyRow = { ...header };
      headerPayload.id = id;
      delete headerPayload.created_at;
      delete headerPayload.updated_at;

      const brandVal =
        (headerPayload as any).buyer_brand_name ??
        (headerPayload as any).buyer_brand ??
        (headerPayload as any).brand_name ??
        null;

      delete (headerPayload as any).brand_name;
      if (brandVal) (headerPayload as any).buyer_brand_name = brandVal;

      let he: any = null;
      {
        const { error } = await supabase.from("quotation_headers").upsert(headerPayload);
        he = error;
      }
      if (he && String((he as any)?.message || he).includes("buyer_brand_name")) {
        delete (headerPayload as any).buyer_brand_name;
        if (brandVal) (headerPayload as any).buyer_brand = brandVal;
        const { error } = await supabase.from("quotation_headers").upsert(headerPayload);
        he = error;
      }
      if (
        he &&
        (String((he as any)?.message || he).includes("buyer_brand") ||
          String((he as any)?.message || he).includes("brand_name"))
      ) {
        delete (headerPayload as any).buyer_brand_name;
        delete (headerPayload as any).buyer_brand;
        const { error } = await supabase.from("quotation_headers").upsert(headerPayload);
        he = error;
      }
      if (he) throw he;

      // 2) Lines
      const toInsert = lines.filter((l) => l.id.startsWith("tmp_") && !l.__remove);
      const toUpdate = lines.filter((l) => !l.id.startsWith("tmp_") && l.__dirty && !l.__remove);
      const toDelete = lines.filter((l) => !l.id.startsWith("tmp_") && l.__remove);

      let insertedLineIdMap: Record<string, string> = {};

      if (toInsert.length) {
        const insPayload = toInsert.map((l) => ({
          quotation_id: id,
          line_no: Number(l.line_no ?? 1),
          style_no: s(l.style_no),
          remarks: s(l.remarks),
          files: Array.isArray(l.files) ? l.files : [],
          is_deleted: false,
        }));
        const { data: insRows, error: ie } = await supabase
          .from("quotation_lines")
          .insert(insPayload)
          .select("id,line_no");
        if (ie) throw ie;

        const arr = (insRows as AnyRow[]) || [];
        for (let i = 0; i < toInsert.length; i++) {
          const tmp = toInsert[i];
          const row = arr[i];
          if (row?.id) insertedLineIdMap[tmp.id] = String(row.id);
        }
      }

      if (toUpdate.length) {
        for (const l of toUpdate) {
          const payload: AnyRow = {
            line_no: Number(l.line_no ?? 1),
            style_no: s(l.style_no),
            remarks: s(l.remarks),
            files: Array.isArray(l.files) ? l.files : [],
          };
          const { error: ue } = await supabase.from("quotation_lines").update(payload).eq("id", l.id);
          if (ue) throw ue;
        }
      }

      if (toDelete.length) {
        const ids = toDelete.map((x) => x.id);
        const { error: de } = await supabase.from("quotation_lines").update({ is_deleted: true }).in("id", ids);
        if (de) throw de;
      }

      // 3) Variants
      const vInsert = variants.filter((v) => v.id.startsWith("tmpv_") && !v.__remove);

      let insertedVariantIdMap: Record<string, string> = {};
      const vUpdate = variants.filter((v) => !v.id.startsWith("tmpv_") && v.__dirty && !v.__remove);
      const vDelete = variants.filter((v) => !v.id.startsWith("tmpv_") && v.__remove);

      if (vInsert.length) {
        const insPayload = vInsert.map((v) => ({
          quotation_id: id,
          label: s(v.label),
          // Save BOTH:
          // - ship_from_site_id: FK to company_sites
          // - ship_from: human-readable snapshot for PDFs/exports
          ship_from: v.ship_from_site_id ? shipFromLabel(v.ship_from_site_id) : null,
          ship_from_site_id: v.ship_from_site_id ? String(v.ship_from_site_id) : null,
          incoterm: s(v.incoterm),
          currency: s(v.currency) || "USD",
          fx_rate: v.fx_rate ?? null,
          status: s(v.status) || "DRAFT",
          is_deleted: false,
        }));

        // IMPORTANT: fetch inserted IDs so tmp variant ids can be mapped to real UUIDs
        const { data: insRows, error: ie } = await supabase
          .from("quotation_variants")
          .insert(insPayload)
          .select("id,label,created_at");
        if (ie) throw ie;

        const rows = (insRows as AnyRow[]) || [];
        // map by index first (Supabase preserves order for insert payloads)
        for (let i = 0; i < vInsert.length; i++) {
          const tmp = vInsert[i];
          const row = rows[i];
          if (row?.id) insertedVariantIdMap[tmp.id] = String(row.id);
        }

        // if index mapping failed for some reason, try label+created_at heuristic
        if (Object.keys(insertedVariantIdMap).length < vInsert.length) {
          for (const tmp of vInsert) {
            if (insertedVariantIdMap[tmp.id]) continue;
            const found = rows.find((r) => s(r.label) === s(tmp.label));
            if (found?.id) insertedVariantIdMap[tmp.id] = String(found.id);
          }
        }
      }

      if (vUpdate.length) {
        for (const v of vUpdate) {
          const payload: AnyRow = {
            label: s(v.label),
            ship_from: v.ship_from_site_id ? shipFromLabel(v.ship_from_site_id) : null,
            ship_from_site_id: v.ship_from_site_id ? String(v.ship_from_site_id) : null,
            incoterm: s(v.incoterm),
            currency: s(v.currency) || "USD",
            fx_rate: v.fx_rate ?? null,
            status: s(v.status) || "DRAFT",
          };
          const { error: ue } = await supabase.from("quotation_variants").update(payload).eq("id", v.id);
          if (ue) throw ue;
        }
      }

      if (vDelete.length) {
        const ids = vDelete.map((x) => x.id);
        const { error: de } = await supabase.from("quotation_variants").update({ is_deleted: true }).in("id", ids);
        if (de) throw de;
      }

      // 4) Variant Lines
      const fkCol: VariantLinesFkCol = variantLinesFkCol || "variant_id";

      const allVariantLines: AnyRow[] = [];
      for (const v of variants) {
        if (v.__remove) continue;

        const realVariantId = insertedVariantIdMap[v.id] ?? v.id;
        const vMap = variantLines[v.id] || variantLines[realVariantId] || {};
        const rows = Object.values(vMap);

        for (const r of rows) {
          if ((r as any).__remove) continue;

          const realLineId =
            insertedLineIdMap[(r as any).quotation_line_id] ?? (r as any).quotation_line_id;

          if (!isUuid(realVariantId) || !isUuid(realLineId)) continue;

          const row: AnyRow = {
            ...(r as any),
            quotation_line_id: realLineId,
            [fkCol]: realVariantId,
            is_deleted: false,
          };

          if (typeof row.id === "string" && row.id.startsWith("tmp_")) delete row.id;
          if (row.id === "") delete row.id;

          delete row.__remove;
          delete row.__dirty;
          delete row.created_at;
          delete row.updated_at;

          if (fkCol === "variant_id") delete (row as any).quotation_variant_id;
          if (fkCol === "quotation_variant_id") delete (row as any).variant_id;

          allVariantLines.push(row);
        }
      }

      if (allVariantLines.length) {
        let upsertErr: any = null;
        const { error } = await supabase.from("quotation_variant_lines").upsert(allVariantLines);
        upsertErr = error;

        if (upsertErr) {
          const msg = String((upsertErr as any)?.message || upsertErr);
          const alt: VariantLinesFkCol = fkCol === "variant_id" ? "quotation_variant_id" : "variant_id";

          if (
            msg.includes("schema cache") ||
            msg.includes("Could not find") ||
            msg.includes("does not exist") ||
            // when the table uses the OTHER fk column and enforces NOT NULL
            (msg.includes("null value") && msg.includes(alt)) ||
            (msg.includes("violates not-null") && msg.includes(alt))
          ) {
            const altRows = allVariantLines.map((r) => {
              const rr: AnyRow = { ...r };
              rr[alt] = rr[fkCol];
              delete rr[fkCol];
              return rr;
            });
            const { error: e2 } = await supabase.from("quotation_variant_lines").upsert(altRows);
            upsertErr = e2;
            if (!upsertErr) setVariantLinesFkCol(alt);
          }
        }

        if (upsertErr) throw upsertErr;
      }

      await loadAll();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  const status = s(header.status) || "DRAFT";
  const activeVariant = variants.find((v) => v.id === activeVariantId);
  const activeVariantRealId = activeVariantId;

  function onPickVariant(vId: string) {
    setActiveVariantId(vId);

    setFxRateText((prev) => {
      if (prev[vId] !== undefined) return prev;
      const v = variants.find((x) => x.id === vId);
      return {
        ...prev,
        [vId]:
          v?.fx_rate === null || v?.fx_rate === undefined ? "" : String(v.fx_rate),
      };
    });

    loadVariantLines(vId);
  }

  function ensureTextRow(lineId: string): VariantLineText {
    const cur = variantLineText[lineId];
    if (cur) return cur;
    return { moq: "", qty: "", target_price: "", offer_price: "", margin_pct: "" };
  }

  function setLineText(lineId: string, patch: Partial<VariantLineText>) {
    setVariantLineText((prev) => ({
      ...prev,
      [lineId]: { ...ensureTextRow(lineId), ...patch },
    }));
  }

  function setLineNumber(
    lineId: string,
    field: keyof VariantLine,
    text: string,
    allowDecimal: boolean
  ) {
    const cleaned = sanitizeNumberInput(text, allowDecimal);

    const keyMap: Record<string, keyof VariantLineText> = {
      moq: "moq",
      qty: "qty",
      target_price: "target_price",
      offer_price: "offer_price",
    };
    const tKey = keyMap[String(field)];
    if (tKey) setLineText(lineId, { [tKey]: cleaned } as any);

    const num = cleaned === "" ? null : Number(cleaned);

    setVariantLines((prev) => ({
      ...prev,
      [activeVariantRealId]: {
        ...(prev[activeVariantRealId] || {}),
        [lineId]: {
          ...((prev[activeVariantRealId] || {})[lineId] || ({} as any)),
          [field]: cleaned === "" ? null : num,
          __dirty: true,
        },
      },
    }));
  }

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto p-4 space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <div className="text-2xl font-semibold flex items-center gap-2">
              Quotation{" "}
              <Badge variant={status === "SENT" ? "default" : "secondary"}>
                {status}
              </Badge>
            </div>
            <div className="text-sm text-muted-foreground">ID: {id}</div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => router.push("/quotations")}>
              Back
            </Button>
            <Button variant="outline" onClick={loadAll} disabled={loading || saving}>
              Refresh
            </Button>
            <Button
              variant="outline"
              onClick={() => exportEnabled && window.open(`/quotations/${quotationId}/pdf`, "_blank")}
              disabled={!exportEnabled || loading || saving}
            >
              PDF
            </Button>
            <Button variant="outline" onClick={downloadExcel} disabled={!exportEnabled || loading || saving}>
              Excel
            </Button>
            <Button onClick={saveAll} disabled={loading || saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>

        {error ? (
          <div className="border border-red-300 bg-red-50 text-red-700 rounded-md p-3 text-sm">
            {error}
          </div>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Header</CardTitle>
          </CardHeader>

          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Quotation No</Label>
              <Input
                value={s(header.quotation_no)}
                onChange={(e) => setHeader((p) => ({ ...p, quotation_no: e.target.value }))}
                placeholder="QT-ACCOUNT-YYMMDD-SEQ"
              />
            </div>

            <div>
              <Label>Costing ID (snapshot source)</Label>
              <Input value={s(header.costing_id)} readOnly placeholder="UUID" />
            </div>

            <div>
              <Label>Buyer</Label>
              <Select
                value={s(header.buyer_id)}
                onValueChange={(val) => {
                  const bid = String(val || "");
                  const b = buyers.find((x) => String((x as any)?.id) === bid);
                  setHeader((h) => ({
                    ...h,
                    buyer_id: bid || null,
                    buyer_code: s((b as any)?.code) || s((b as any)?.buyer_code) || null,
                    buyer_name:
                      s((b as any)?.company_name) ||
                      s((b as any)?.name) ||
                      s((b as any)?.buyer_name) ||
                      s((b as any)?.legal_name) ||
                      null,
                    brand_name: null,
                  }));
                  setBuyerBrands(parseBuyerBrands(b || {}));
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select buyer" />
                </SelectTrigger>
                <SelectContent>
                  {buyers.map((b) => (
                    <SelectItem key={String((b as any).id)} value={String((b as any).id)}>
                      {buyerLabel(b)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Brand</Label>
              {buyerBrands.length > 0 ? (
                <Select
                  value={s(header.brand_name)}
                  onValueChange={(val) =>
                    setHeader((h) => ({
                      ...h,
                      brand_name: String(val || "") || null,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select brand" />
                  </SelectTrigger>
                  <SelectContent>
                    {buyerBrands.map((bn) => (
                      <SelectItem key={bn} value={bn}>
                        {bn}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  placeholder="Brand (optional)"
                  value={s(header.brand_name)}
                  onChange={(e) => setHeader((h) => ({ ...h, brand_name: e.target.value }))}
                />
              )}
            </div>

            <div>
              <Label>Received Date</Label>
              <Input
                type="date"
                value={s(header.received_date)}
                onChange={(e) => setHeader((p) => ({ ...p, received_date: e.target.value }))}
              />
            </div>

            <div>
              <Label>Status</Label>
              <Input value={status} readOnly />
            </div>

            <div className="md:col-span-2">
              <Label>Remarks</Label>
              <Textarea
                value={s(header.remarks)}
                onChange={(e) => setHeader((p) => ({ ...p, remarks: e.target.value }))}
                placeholder="Header remarks / mail summary"
                rows={4}
              />
            </div>

            <div className="md:col-span-2 text-xs text-muted-foreground">
              Snapshot principle: Quotation stores a copy of Costing totals/lines at creation time. Variants (Qty / Ship-From)
              live under this quotation.
              <div className="mt-1">Updated: {fmtDateTime(header.updated_at)}</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Lines</CardTitle>
            <Button onClick={addLine} disabled={loading || saving}>
              + Add line
            </Button>
          </CardHeader>

          <CardContent>
            <div className="text-xs text-muted-foreground mb-3">
              Lines are the base style rows. Variant-specific Qty / Prices are stored per Variant (below).
            </div>

            <div className="border rounded-md overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[70px]">#</TableHead>
                    <TableHead className="min-w-[180px]">Style No</TableHead>
                    <TableHead className="min-w-[240px]">Line Remarks</TableHead>
                    <TableHead className="w-[140px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {lines.filter((x) => !x.__remove).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground">
                        No lines
                      </TableCell>
                    </TableRow>
                  ) : null}

                  {lines
                    .filter((x) => !x.__remove)
                    .sort((a, b) => Number(a.line_no ?? 0) - Number(b.line_no ?? 0))
                    .map((ln) => (
                      <TableRow key={ln.id}>
                        <TableCell>{ln.line_no ?? ""}</TableCell>
                        <TableCell>
                          <Input
                            value={s(ln.style_no)}
                            onChange={(e) =>
                              setLines((prev) =>
                                prev.map((x) =>
                                  x.id === ln.id ? { ...x, style_no: e.target.value, __dirty: true } : x
                                )
                              )
                            }
                            placeholder="e.g. JK260001"
                          />
                        </TableCell>

                        <TableCell>
                          <Input
                            value={s(ln.remarks)}
                            onChange={(e) =>
                              setLines((prev) =>
                                prev.map((x) =>
                                  x.id === ln.id ? { ...x, remarks: e.target.value, __dirty: true } : x
                                )
                              )
                            }
                            placeholder="Short line memo"
                          />
                          <div className="text-[11px] text-muted-foreground mt-1">
                            Files: (coming next)
                          </div>
                        </TableCell>

                        <TableCell>
                          <Button variant="outline" onClick={() => markRemoveLine(ln.id)} disabled={saving}>
                            Remove
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Variants (Qty / Ship-From)</CardTitle>
            <Button onClick={addVariant} disabled={loading || saving}>
              + Add variant
            </Button>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="text-xs text-muted-foreground">
              Use Variants when the same quotation needs different Qty tiers and/or Ship-From origins.
              <br />
              Example: Variant 1 = 1000pcs / Ship-From CN-QINGDAO, Variant 2 = 3000pcs / Ship-From VN-BACNINH.
            </div>

            {variants.filter((v) => !v.__remove).length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No variants. Add one to start.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-1 border rounded-md p-3 space-y-2">
                  {variants
                    .filter((v) => !v.__remove)
                    .map((v, idx) => {
                      const active = v.id === activeVariantId;
                      return (
                        <button
                          type="button"
                          key={v.id}
                          onClick={() => onPickVariant(v.id)}
                          className={[
                            "w-full text-left rounded-md border px-3 py-2",
                            active ? "bg-blue-50 border-blue-300" : "bg-white hover:bg-muted",
                          ].join(" ")}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-medium">
                              #{idx + 1} {s(v.label) || "Variant"}
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant={s(v.status) === "SENT" ? "default" : "secondary"}>
                                {s(v.status) || "DRAFT"}
                              </Badge>
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            Ship-From: {shipFromLabel(v.ship_from_site_id) || "-"} • {s(v.incoterm) || "-"} •{" "}
                            {s(v.currency) || "USD"}
                          </div>

                          <div className="mt-2 flex items-center gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                markRemoveVariant(v.id);
                              }}
                              className="h-7 px-2 text-xs"
                            >
                              Remove
                            </Button>
                          </div>
                        </button>
                      );
                    })}
                </div>

                <div className="md:col-span-2 border rounded-md p-3 space-y-3">
                  {!activeVariant ? (
                    <div className="text-sm text-muted-foreground">Select a variant.</div>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <Label>Label</Label>
                          <Input
                            value={s(activeVariant.label)}
                            onChange={(e) =>
                              setVariants((prev) =>
                                prev.map((x) =>
                                  x.id === activeVariant.id ? { ...x, label: e.target.value, __dirty: true } : x
                                )
                              )
                            }
                            placeholder="e.g. MOQ 1000 / LA"
                          />
                        </div>

                        <div>
                          <Label>Incoterm</Label>
                          <Input
                            value={s(activeVariant.incoterm)}
                            onChange={(e) =>
                              setVariants((prev) =>
                                prev.map((x) =>
                                  x.id === activeVariant.id ? { ...x, incoterm: e.target.value, __dirty: true } : x
                                )
                              )
                            }
                            placeholder="FOB"
                          />
                        </div>

                        <div>
                          <Label>Ship-From</Label>
                          <Select
                            value={activeVariant.ship_from_site_id ? String(activeVariant.ship_from_site_id) : NONE_SITE}
                            onValueChange={(val) =>
                              setVariants((prev) =>
                                prev.map((x) =>
                                  x.id === activeVariant.id
                                    ? {
                                        ...x,
                                        ship_from_site_id: val === NONE_SITE ? null : String(val),
                                        __dirty: true,
                                      }
                                    : x
                                )
                              )
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select Ship-From (Factory/Origin)" />
                            </SelectTrigger>
                            <SelectContent className="z-[9999]">
                              <SelectItem value={NONE_SITE}>-</SelectItem>
                              {shipFromSites.length === 0 ? (
                                <SelectItem value="__no_data" disabled>
                                  No Ship-From sites
                                </SelectItem>
                              ) : (
                                shipFromSites.map((site) => (
                                  <SelectItem key={String(site.id)} value={String(site.id)}>
                                    {shipFromLabel(String(site.id))}
                                  </SelectItem>
                                ))
                              )}
                            </SelectContent>
                          </Select>
                        </div>

                        <div>
                          <Label>Currency</Label>
                          <Input
                            value={s(activeVariant.currency) || "USD"}
                            onChange={(e) =>
                              setVariants((prev) =>
                                prev.map((x) =>
                                  x.id === activeVariant.id ? { ...x, currency: e.target.value, __dirty: true } : x
                                )
                              )
                            }
                            placeholder="USD"
                          />
                        </div>

                        <div>
                          <Label>FX Rate (optional)</Label>
                          <Input
                            inputMode="decimal"
                            value={
                              fxRateText[activeVariant.id] ??
                              (activeVariant.fx_rate === null || activeVariant.fx_rate === undefined ? "" : String(activeVariant.fx_rate))
                            }
                            onChange={(e) => {
                              const cleaned = sanitizeDecimalInput(e.target.value);
                              setFxRateText((prev) => ({ ...prev, [activeVariant.id]: cleaned }));
                              const num = cleaned === "" ? null : Number(cleaned);
                              if (cleaned === "" || Number.isFinite(num)) {
                                setVariants((prev) =>
                                  prev.map((x) =>
                                    x.id === activeVariant.id
                                      ? { ...x, fx_rate: cleaned === "" ? null : num, __dirty: true }
                                      : x
                                  )
                                );
                              }
                            }}
                            onBlur={() => {
                              const raw = (fxRateText[activeVariant.id] ?? "").trim();
                              const num = raw === "" ? null : Number(raw);
                              setVariants((prev) =>
                                prev.map((x) =>
                                  x.id === activeVariant.id
                                    ? { ...x, fx_rate: num !== null && Number.isFinite(num) ? num : null, __dirty: true }
                                    : x
                                )
                              );
                            }}
                            placeholder="e.g. 7.2"
                          />
                        </div>

                        <div>
                          <Label>Status</Label>
                          <Input
                            value={s(activeVariant.status) || "DRAFT"}
                            onChange={(e) =>
                              setVariants((prev) =>
                                prev.map((x) =>
                                  x.id === activeVariant.id ? { ...x, status: e.target.value, __dirty: true } : x
                                )
                              )
                            }
                            placeholder="DRAFT / SENT"
                          />
                        </div>
                      </div>

                      <div className="border-t pt-3">
                        <div className="flex items-center justify-between">
                          <div className="font-medium">Per-line Qty / Prices</div>
                          <div className="text-xs text-muted-foreground">
                            {variantLinesLoading ? "Loading..." : "Edit then Save"}
                          </div>
                        </div>

                        <div className="mt-2 border rounded-md overflow-x-auto">
                          <Table className="min-w-[1180px]">
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-[70px]">#</TableHead>
                                <TableHead className="min-w-[160px]">Style</TableHead>
                                <TableHead className="w-[140px] text-right">Cost (CNY)</TableHead>
                                <TableHead className="w-[140px] text-right">Cost (USD)</TableHead>
                                <TableHead className="w-[160px]">Margin %</TableHead>
                                <TableHead className="w-[140px]">MOQ</TableHead>
                                <TableHead className="w-[140px]">Qty</TableHead>
                                <TableHead className="w-[160px]">Target</TableHead>
                                <TableHead className="w-[160px]">Offer</TableHead>
                                <TableHead className="min-w-[280px]">Notes</TableHead>
                              </TableRow>
                            </TableHeader>

                            <TableBody>
                              {lines.filter((x) => !x.__remove).length === 0 ? (
                                <TableRow>
                                  <TableCell colSpan={10} className="text-center text-muted-foreground">
                                    Add lines first.
                                  </TableCell>
                                </TableRow>
                              ) : null}

                              {lines
                                .filter((x) => !x.__remove)
                                .sort((a, b) => Number(a.line_no ?? 0) - Number(b.line_no ?? 0))
                                .map((ln) => {
                                  const lineId = ln.id;
                                  const row = activeVariantRealId ? variantLines[activeVariantRealId]?.[lineId] : undefined;
                                  const r =
                                    row ||
                                    ({
                                      id: "",
                                      variant_id: activeVariantRealId,
                                      quotation_line_id: ln.id,
                                      moq: null,
                                      qty: null,
                                      target_price: null,
                                      offer_price: null,
                                      notes: null,
                                    } as any);

                                  const txt = ensureTextRow(ln.id);

                                  const style = s(ln.style_no);
                                  const cny = costingByStyle[style]?.cost_cny ?? null;
                                  const fx = (activeVariant.fx_rate ?? costingByStyle[style]?.fx_cny_per_usd) as any;
                                  const fxNum = fx === null || fx === undefined ? null : Number(fx);
                                  const costUsd = cny && fxNum && fxNum > 0 ? cny / fxNum : null;

                                  const offerNum = r.offer_price === null || r.offer_price === undefined ? null : Number(r.offer_price);
                                  const marginDerived =
                                    offerNum && offerNum > 0 && costUsd !== null ? ((offerNum - costUsd) / offerNum) * 100 : null;

                                  return (
                                    <TableRow key={ln.id}>
                                      <TableCell>{ln.line_no ?? ""}</TableCell>
                                      <TableCell className="font-medium">{s(ln.style_no) || "-"}</TableCell>

                                      <TableCell className="text-right tabular-nums">
                                        <div className="text-sm">{fmt(cny)}</div>
                                      </TableCell>

                                      <TableCell className="text-right tabular-nums">
                                        <div className="text-sm">{fmt(costUsd)}</div>
                                      </TableCell>

                                      <TableCell>
                                        <Input
                                          inputMode="decimal"
                                          className="w-[140px] text-right tabular-nums"
                                          value={txt.margin_pct}
                                          placeholder={marginDerived === null ? "e.g. 45" : `now ${fmt(marginDerived, 1)}%`}
                                          onChange={(e) => {
                                            const cleaned = sanitizeNumberInput(e.target.value, true);
                                            setLineText(lineId, { margin_pct: cleaned });
                                          }}
                                          onBlur={() => {
                                            const mp = toNumberOrNull(txt.margin_pct);
                                            if (mp === null) return;
                                            const mpNum = Number(mp);
                                            if (!Number.isFinite(mpNum)) return;
                                            if (costUsd === null) return;
                                            const denom = 1 - mpNum / 100;
                                            if (denom <= 0) return;

                                            const newOfferRaw = costUsd / denom;
                                            const newOffer = Math.round(newOfferRaw * 100) / 100;

                                            setLineText(lineId, { offer_price: newOffer.toFixed(2) });
                                            setVariantLines((prev) => ({
                                              ...prev,
                                              [activeVariantRealId]: {
                                                ...(prev[activeVariantRealId] || {}),
                                                [lineId]: { ...((prev[activeVariantRealId] || {})[lineId] || r), offer_price: newOffer, __dirty: true },
                                              },
                                            }));
                                          }}
                                        />
                                        <div className="mt-1 text-[11px] text-muted-foreground">Offer auto-updates when margin is entered.</div>
                                      </TableCell>

                                      <TableCell>
                                        <Input
                                          inputMode="numeric"
                                          className="w-[120px] text-right tabular-nums"
                                          value={txt.moq}
                                          onChange={(e) => setLineNumber(lineId, "moq", e.target.value, false)}
                                          onBlur={() => {
                                            const num = toNumberOrNull(txt.moq);
                                            setVariantLines((prev) => ({
                                              ...prev,
                                              [activeVariantRealId]: {
                                                ...(prev[activeVariantRealId] || {}),
                                                [lineId]: { ...((prev[activeVariantRealId] || {})[lineId] || r), moq: num, __dirty: true },
                                              },
                                            }));
                                          }}
                                        />
                                      </TableCell>

                                      <TableCell>
                                        <Input
                                          inputMode="numeric"
                                          className="w-[120px] text-right tabular-nums"
                                          value={txt.qty}
                                          onChange={(e) => setLineNumber(lineId, "qty", e.target.value, false)}
                                          onBlur={() => {
                                            const num = toNumberOrNull(txt.qty);
                                            setVariantLines((prev) => ({
                                              ...prev,
                                              [activeVariantRealId]: {
                                                ...(prev[activeVariantRealId] || {}),
                                                [lineId]: { ...((prev[activeVariantRealId] || {})[lineId] || r), qty: num, __dirty: true },
                                              },
                                            }));
                                          }}
                                        />
                                      </TableCell>

                                      <TableCell>
                                        <Input
                                          inputMode="decimal"
                                          className="w-[140px] text-right tabular-nums"
                                          value={txt.target_price}
                                          onChange={(e) => setLineNumber(lineId, "target_price", e.target.value, true)}
                                          onBlur={() => {
                                            const num = toNumberOrNull(txt.target_price);
                                            setVariantLines((prev) => ({
                                              ...prev,
                                              [activeVariantRealId]: {
                                                ...(prev[activeVariantRealId] || {}),
                                                [lineId]: { ...((prev[activeVariantRealId] || {})[lineId] || r), target_price: num, __dirty: true },
                                              },
                                            }));
                                          }}
                                        />
                                      </TableCell>

                                      <TableCell>
                                        <Input
                                          inputMode="decimal"
                                          className="w-[140px] text-right tabular-nums"
                                          value={txt.offer_price}
                                          onChange={(e) => setLineNumber(lineId, "offer_price", e.target.value, true)}
                                          onBlur={(e) => {
                                            const raw = (e?.currentTarget?.value ?? "").toString();
                                            const num0 = toNumberOrNull(raw);
                                            const num = num0 !== null ? Math.round(num0 * 100) / 100 : null;

                                            if (num === null) {
                                              setLineText(lineId, { offer_price: raw });
                                            } else {
                                              setLineText(lineId, { offer_price: num.toFixed(2) });
                                            }

                                            setVariantLines((prev) => ({
                                              ...prev,
                                              [activeVariantRealId]: {
                                                ...(prev[activeVariantRealId] || {}),
                                                [lineId]: { ...((prev[activeVariantRealId] || {})[lineId] || r), offer_price: num, __dirty: true },
                                              },
                                            }));
                                          }}
                                        />
                                        <div className="mt-1 text-[11px] text-muted-foreground">
                                          {marginDerived === null ? " " : `Margin: ${fmt(marginDerived, 1)}%`}
                                        </div>
                                      </TableCell>

                                      <TableCell>
                                        <Input
                                          className="min-w-[260px]"
                                          value={s(r.notes)}
                                          onChange={(e) =>
                                            setVariantLines((prev) => ({
                                              ...prev,
                                              [activeVariantRealId]: {
                                                ...(prev[activeVariantRealId] || {}),
                                                [lineId]: {
                                                  ...((prev[activeVariantRealId] || {})[lineId] || r),
                                                  notes: e.target.value,
                                                  __dirty: true,
                                                },
                                              },
                                            }))
                                          }
                                          placeholder="optional"
                                        />
                                      </TableCell>
                                    </TableRow>
                                  );
                                })}
                            </TableBody>
                          </Table>
                        </div>

                        <div className="text-xs text-muted-foreground mt-2">
                          Tip: If you need to send separate emails for different destinations/quantities, create multiple variants under the same quotation.
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
