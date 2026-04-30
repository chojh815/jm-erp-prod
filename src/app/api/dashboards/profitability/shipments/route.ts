import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ShipmentProfitRow = {
  shipment_id: string;
  shipment_no: string | null;
  ship_date: string | null;
  invoice_no: string | null;
  invoice_date: string | null;
  buyer_id: string | null;
  buyer_name: string | null;
  brand_name: string | null;
  site_id: string | null;
  site_name: string | null;
  po_count: number;
  line_count: number;
  revenue_usd: number;
  planned_cogs_usd: number;
  actual_cogs_usd: number;
  effective_cogs_usd: number;
  freight_usd: number;
  packing_usd: number;
  other_expenses_usd: number;
  total_expenses_usd: number;
  gross_profit_usd: number;
  net_profit_usd: number;
  gross_margin_pct: number | null;
  net_margin_pct: number | null;
  actual_coverage_pct: number | null;
  margin_mode: "ACTUAL" | "PLANNED_FALLBACK" | "MIXED" | "NO_COST";
};

type ShipmentPoRow = {
  shipment_id: string;
  shipment_no: string | null;
  ship_date: string | null;
  po_header_id: string | null;
  po_no: string | null;
  buyer_name: string | null;
  brand_name: string | null;
  revenue_usd: number;
  planned_cogs_usd: number;
  actual_cogs_usd: number;
  effective_cogs_usd: number;
  freight_usd: number;
  packing_usd: number;
  other_expenses_usd: number;
  total_expenses_usd: number;
  gross_profit_usd: number;
  net_profit_usd: number;
  gross_margin_pct: number | null;
  net_margin_pct: number | null;
  actual_coverage_pct: number | null;
  line_count: number;
  margin_mode: "ACTUAL" | "PLANNED_FALLBACK" | "MIXED" | "NO_COST";
};

type ShipmentLineRow = {
  shipment_id: string;
  shipment_no: string | null;
  ship_date: string | null;
  po_header_id: string | null;
  po_line_id: string | null;
  po_no: string | null;
  style_no: string | null;
  buyer_style_no: string | null;
  description: string | null;
  buyer_name: string | null;
  brand_name: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  shipped_qty: number;
  order_qty: number;
  revenue_usd: number;
  planned_cogs_usd: number;
  actual_cogs_usd: number;
  effective_cogs_usd: number;
  freight_usd: number;
  packing_usd: number;
  other_expenses_usd: number;
  total_expenses_usd: number;
  gross_profit_usd: number;
  net_profit_usd: number;
  gross_margin_pct: number | null;
  net_margin_pct: number | null;
  actual_coverage_pct: number | null;
  margin_mode: "ACTUAL" | "PLANNED_FALLBACK" | "NO_COST";
};

type CostingHeaderLite = {
  id: string;
  style_no: string | null;
  fx_cny_per_usd: number | null;
  updated_at: string | null;
  created_at: string | null;
};

type CostingLineLite = {
  costing_id: string | null;
  qty: number | null;
  unit_cost_cny: number | null;
};

type DevHeaderLite = {
  id: number;
  style_no: string | null;
  currency: string | null;
  updated_at: string | null;
  created_at: string | null;
};

type DevCostLineLite = {
  product_id: number | null;
  qty: number | null;
  unit_cost: number | null;
};

function num(v: any): number {
  const n = typeof v === "number" ? v : v == null ? NaN : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(v: number | null): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.round(v * 100) / 100;
}

function pct(numer: number, denom: number): number | null {
  return Number.isFinite(numer) && Number.isFinite(denom) && denom !== 0
    ? round2((numer / denom) * 100)
    : null;
}

function s(v: any): string {
  return String(v ?? "").trim();
}

function toISO(v: any): string | null {
  const text = s(v);
  if (!text) return null;
  return text.length >= 10 ? text.slice(0, 10) : text;
}

function pickShipDate(row: any): string | null {
  return (
    toISO(row?.ship_date) ??
    toISO(row?.shipped_date) ??
    toISO(row?.etd) ??
    toISO(row?.shipment_date) ??
    toISO(row?.updated_at) ??
    toISO(row?.created_at) ??
    null
  );
}

function pickFirst(obj: any, keys: string[], fallback: any = null) {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && s(value) !== "") return value;
  }
  return fallback;
}

function parseIds(raw: string | null): string[] | "ALL" {
  if (!raw) return "ALL";
  const text = s(raw);
  if (!text || text.toUpperCase() === "ALL") return "ALL";
  const items = text.split(",").map((x) => x.trim()).filter(Boolean);
  return items.length ? items : "ALL";
}

function dateInRange(d: string | null, start: string, end: string) {
  if (!d) return false;
  return d >= start && d <= end;
}

function classifyExpense(code: any): "freight" | "packing" | "other" {
  const v = s(code).toUpperCase();
  if (!v) return "other";
  if (
    v.includes("FORWARDER") ||
    v.includes("FREIGHT") ||
    v.includes("SHIP") ||
    v.includes("TRANSPORT") ||
    v.includes("LOGISTIC") ||
    v.includes("COURIER")
  ) {
    return "freight";
  }
  if (
    v.includes("PACK") ||
    v.includes("BOX") ||
    v.includes("CARTON") ||
    v.includes("PKG")
  ) {
    return "packing";
  }
  return "other";
}

function computeMarginMode(args: {
  actualCount: number;
  fallbackCount: number;
  costCount: number;
}): ShipmentProfitRow["margin_mode"] {
  if (args.actualCount > 0 && args.fallbackCount > 0) return "MIXED";
  if (args.actualCount > 0) return "ACTUAL";
  if (args.fallbackCount > 0) return "PLANNED_FALLBACK";
  return "NO_COST";
}

function calcGrossProfit(revenueUsd: number, effectiveCogsUsd: number) {
  return round2(revenueUsd - effectiveCogsUsd) ?? 0;
}

function calcNetProfit(args: {
  revenueUsd: number;
  effectiveCogsUsd: number;
  freightUsd: number;
  packingUsd: number;
  otherExpensesUsd: number;
}) {
  return (
    round2(
      args.revenueUsd -
        args.effectiveCogsUsd -
        args.freightUsd -
        args.packingUsd -
        args.otherExpensesUsd
    ) ?? 0
  );
}

function convertLocalUnitToUsd(localValue: number, currency: string | null, fxRate: number) {
  if (!Number.isFinite(localValue) || localValue <= 0) return 0;
  const cur = s(currency || "USD").toUpperCase();
  if (cur === "USD") return localValue;
  if (Number.isFinite(fxRate) && fxRate > 0) return localValue / fxRate;
  return 0;
}

function defaultFxPerUsd(currency: string | null): number {
  const cur = s(currency || "USD").toUpperCase();
  if (cur === "USD") return 1;
  if (cur === "CNY") return 7.2;
  if (cur === "KRW") return 1400;
  if (cur === "VND") return 25000;
  return 1;
}

function pickLatestCostingByStyle(rows: CostingHeaderLite[]): Map<string, CostingHeaderLite> {
  const out = new Map<string, CostingHeaderLite>();
  for (const row of rows) {
    const key = s(row.style_no);
    if (!key) continue;
    const prev = out.get(key);
    if (!prev) {
      out.set(key, row);
      continue;
    }
    const prevStamp = s(prev.updated_at || prev.created_at);
    const nextStamp = s(row.updated_at || row.created_at);
    if (nextStamp > prevStamp) out.set(key, row);
  }
  return out;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const start = searchParams.get("start") || "1970-01-01";
    const end = searchParams.get("end") || "2999-12-31";
    const buyerIds = parseIds(searchParams.get("buyer_ids"));
    const vendorIds = parseIds(searchParams.get("vendor_ids"));
    const siteIds = parseIds(searchParams.get("site_ids"));
    const q = s(searchParams.get("q")).toLowerCase();
    const limit = Math.min(Math.max(Number(searchParams.get("limit") || "200"), 50), 1000);

    const { data: shipmentsRaw, error: shipErr } = await supabaseAdmin
      .from("shipments")
      .select("*")
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .limit(limit * 5);
    if (shipErr) throw shipErr;

    const shipmentsBase = (shipmentsRaw || []).filter((row: any) =>
      dateInRange(pickShipDate(row), start, end)
    );
    if (!shipmentsBase.length) {
      return NextResponse.json({
        ok: true,
        filters_echo: { start, end, buyer_ids: buyerIds, vendor_ids: vendorIds, site_ids: siteIds, q, limit },
        kpis: {
          shipment_count: 0,
          revenue_usd: 0,
          effective_cogs_usd: 0,
          freight_usd: 0,
          packing_usd: 0,
          other_expenses_usd: 0,
          net_profit_usd: 0,
          net_margin_pct: null,
        },
        shipments: [],
        po_rows: [],
        line_rows: [],
      });
    }

    const shipmentIds = shipmentsBase.map((x: any) => x.id).filter(Boolean);

    const [shipmentLinesRes, invoicesRes, shipmentPosRes] = await Promise.all([
      supabaseAdmin
        .from("shipment_lines")
        .select("*")
        .in("shipment_id", shipmentIds)
        .eq("is_deleted", false),
      supabaseAdmin
        .from("invoice_headers")
        .select("id, shipment_id, invoice_no, invoice_date, total_amount")
        .in("shipment_id", shipmentIds)
        .eq("is_deleted", false),
      supabaseAdmin
        .from("shipment_pos")
        .select("*")
        .in("shipment_id", shipmentIds)
        .eq("is_deleted", false),
    ]);

    if (shipmentLinesRes.error) throw shipmentLinesRes.error;
    if (invoicesRes.error) throw invoicesRes.error;
    const shipmentPosRows = shipmentPosRes.error ? [] : shipmentPosRes.data || [];

    const shipmentLines = shipmentLinesRes.data || [];
    const invoiceRows = invoicesRes.data || [];

    const poLineIds = Array.from(new Set(shipmentLines.map((x: any) => x.po_line_id).filter(Boolean)));

    const poLineRes = poLineIds.length
      ? await supabaseAdmin
          .from("po_lines")
          .select(
            "id, po_header_id, qty, unit_price, buyer_style_no, jm_style_no, description"
          )
          .in("id", poLineIds)
      : ({ data: [], error: null } as any);
    if (poLineRes.error) throw poLineRes.error;
    const poLines = poLineRes.data || [];

    const styleNos = Array.from(
      new Set(
        [
          ...shipmentLines.map((x: any) => s(x.style_no)),
          ...poLines.map((x: any) => s(x.jm_style_no)),
        ].filter(Boolean)
      )
    );

    const poHeaderIds = Array.from(
      new Set([
        ...poLines.map((x: any) => x.po_header_id).filter(Boolean),
        ...shipmentPosRows.map((x: any) => x.po_header_id).filter(Boolean),
      ])
    );

    const poHeaderRes = poHeaderIds.length
      ? await supabaseAdmin
          .from("po_headers")
          .select("id, po_no, buyer_id, buyer_name, buyer_brand_name, site_id")
          .in("id", poHeaderIds)
      : ({ data: [], error: null } as any);
    if (poHeaderRes.error) throw poHeaderRes.error;
    const poHeaders = poHeaderRes.data || [];

    const wsRes = poLineIds.length
      ? await supabaseAdmin
          .from("work_sheet_lines")
          .select(
            "po_line_id, jm_style_no, buyer_style, vendor_id, vendor_unit_cost_usd, actual_unit, actual_amt, actual_vendor_unit_cost_usd, internal_material_cost, vendor_currency, fx_rate, actual_fx_rate, outsourcing_type, production_mode"
          )
          .in("po_line_id", poLineIds)
          .eq("is_deleted", false)
      : ({ data: [], error: null } as any);
    if (wsRes.error) throw wsRes.error;
    const wsLines = wsRes.data || [];

    const vendorIdsFromWs = Array.from(new Set(wsLines.map((x: any) => x.vendor_id).filter(Boolean)));
    const vendorRes = vendorIdsFromWs.length
      ? await supabaseAdmin
          .from("companies")
          .select("id, company_name, name")
          .in("id", vendorIdsFromWs)
      : ({ data: [], error: null } as any);
    if (vendorRes.error) throw vendorRes.error;
    const vendors = vendorRes.data || [];

    const allocFilters: string[] = [];
    if (shipmentIds.length) allocFilters.push(`shipment_id.in.(${shipmentIds.join(",")})`);
    if (poHeaderIds.length) allocFilters.push(`po_header_id.in.(${poHeaderIds.join(",")})`);
    if (poLineIds.length) allocFilters.push(`po_line_id.in.(${poLineIds.join(",")})`);

    const allocRes = allocFilters.length
      ? await supabaseAdmin
          .from("expense_allocation_results")
          .select("expense_id, shipment_id, po_header_id, po_line_id, allocated_usd")
          .eq("is_deleted", false)
          .or(allocFilters.join(","))
      : ({ data: [], error: null } as any);
    if (allocRes.error) throw allocRes.error;
    const allocations = allocRes.data || [];

    const expenseIds = Array.from(new Set(allocations.map((x: any) => x.expense_id).filter(Boolean)));
    const expenseHeaderRes = expenseIds.length
      ? await supabaseAdmin
          .from("expense_headers")
          .select("id, expense_type_code")
          .in("id", expenseIds)
          .eq("is_deleted", false)
      : ({ data: [], error: null } as any);
    if (expenseHeaderRes.error) throw expenseHeaderRes.error;
    const expenseHeaders = expenseHeaderRes.data || [];

    const extraCostRes = poLineIds.length
      ? await supabaseAdmin
          .from("po_line_extra_costs")
          .select("po_line_id, unit_cost, enabled")
          .in("po_line_id", poLineIds)
      : ({ data: [], error: null } as any);
    if (extraCostRes.error) throw extraCostRes.error;
    const extraCosts = extraCostRes.data || [];

    const devStyleNos = Array.from(new Set(wsLines.map((x: any) => s((x as any).jm_style_no)).filter(Boolean)));
    const devHeaderRes = devStyleNos.length
      ? await supabaseAdmin
          .from("product_development_headers")
          .select("id, style_no, currency, updated_at, created_at")
          .in("style_no", devStyleNos)
          .eq("is_deleted", false)
      : ({ data: [], error: null } as any);
    if (devHeaderRes.error) throw devHeaderRes.error;
    const devHeaders = (devHeaderRes.data || []) as DevHeaderLite[];
    const devByStyle = new Map<string, DevHeaderLite>();
    for (const row of devHeaders) {
      const key = s(row.style_no);
      if (!key) continue;
      const prev = devByStyle.get(key);
      if (!prev) {
        devByStyle.set(key, row);
        continue;
      }
      const prevStamp = s(prev.updated_at || prev.created_at);
      const nextStamp = s(row.updated_at || row.created_at);
      if (nextStamp > prevStamp) devByStyle.set(key, row);
    }
    const devIds = Array.from(new Set(Array.from(devByStyle.values()).map((x) => x.id).filter(Boolean)));
    const [devMatRes, devOpRes] = await Promise.all([
      devIds.length
        ? supabaseAdmin
            .from("product_development_materials")
            .select("product_id, qty, unit_cost")
            .in("product_id", devIds)
            .eq("is_deleted", false)
        : ({ data: [], error: null } as any),
      devIds.length
        ? supabaseAdmin
            .from("product_development_operations")
            .select("product_id, qty, unit_cost")
            .in("product_id", devIds)
            .eq("is_deleted", false)
            .throwOnError()
        : ({ data: [], error: null } as any),
    ]);
    if (devMatRes.error) throw devMatRes.error;
    if (devOpRes.error) throw devOpRes.error;
    const devMats = (devMatRes.data || []) as DevCostLineLite[];
    const devOps = (devOpRes.data || []) as DevCostLineLite[];

    const costingHeaderRes = styleNos.length
      ? await supabaseAdmin
          .from("costing_headers")
          .select("id, style_no, fx_cny_per_usd, updated_at, created_at")
          .in("style_no", styleNos)
          .eq("is_deleted", false)
      : ({ data: [], error: null } as any);
    if (costingHeaderRes.error) throw costingHeaderRes.error;
    const costingHeaders = (costingHeaderRes.data || []) as CostingHeaderLite[];
    const costingByStyle = pickLatestCostingByStyle(costingHeaders);
    const costingIds = Array.from(new Set(Array.from(costingByStyle.values()).map((x) => x.id).filter(Boolean)));

    const [costingMaterialRes, costingOperationRes] = await Promise.all([
      costingIds.length
        ? supabaseAdmin
            .from("costing_material_lines")
            .select("costing_id, qty, unit_cost_cny")
            .in("costing_id", costingIds)
            .eq("is_deleted", false)
        : ({ data: [], error: null } as any),
      costingIds.length
        ? supabaseAdmin
            .from("costing_operation_lines")
            .select("costing_id, qty, unit_cost_cny")
            .in("costing_id", costingIds)
            .eq("is_deleted", false)
        : ({ data: [], error: null } as any),
    ]);
    if (costingMaterialRes.error) throw costingMaterialRes.error;
    if (costingOperationRes.error) throw costingOperationRes.error;
    const costingMaterials = (costingMaterialRes.data || []) as CostingLineLite[];
    const costingOperations = (costingOperationRes.data || []) as CostingLineLite[];

    const poLineById = new Map(poLines.map((x: any) => [x.id, x]));
    const poHeaderById = new Map(poHeaders.map((x: any) => [x.id, x]));
    const wsByPoLineId = new Map(wsLines.map((x: any) => [x.po_line_id, x]));
    const vendorById = new Map(vendors.map((x: any) => [x.id, x]));
    const expenseHeaderById = new Map(expenseHeaders.map((x: any) => [x.id, x]));
    const poHeaderIdsWithLineExpense = new Set<string>();
    for (const alloc of allocations) {
      const poLineId = s((alloc as any).po_line_id);
      if (!poLineId) continue;
      const poLine: any = poLineById.get(poLineId);
      const poHeaderId = s(poLine?.po_header_id || (alloc as any).po_header_id);
      if (poHeaderId) poHeaderIdsWithLineExpense.add(poHeaderId);
    }
    const extraUnitCostByPoLineId = new Map<string, number>();
    for (const row of extraCosts) {
      const poLineId = s((row as any).po_line_id);
      if (!poLineId || (row as any).enabled === false) continue;
      extraUnitCostByPoLineId.set(
        poLineId,
        (extraUnitCostByPoLineId.get(poLineId) || 0) + num((row as any).unit_cost)
      );
    }
    const costingTotalCnyById = new Map<string, number>();
    for (const row of [...costingMaterials, ...costingOperations]) {
      const costingId = s(row.costing_id);
      if (!costingId) continue;
      costingTotalCnyById.set(
        costingId,
        (costingTotalCnyById.get(costingId) || 0) + num(row.qty) * num(row.unit_cost_cny)
      );
    }
    const costingUnitUsdByStyle = new Map<string, number>();
    for (const [styleNo, header] of costingByStyle.entries()) {
      const totalCny = costingTotalCnyById.get(header.id) || 0;
      const fx = num(header.fx_cny_per_usd);
      const usd = totalCny > 0 && fx > 0 ? totalCny / fx : 0;
      if (usd > 0) costingUnitUsdByStyle.set(styleNo, usd);
    }
    const devTotalLocalById = new Map<number, number>();
    for (const row of [...devMats, ...devOps]) {
      const devId = Number(row.product_id || 0);
      if (!devId) continue;
      devTotalLocalById.set(devId, (devTotalLocalById.get(devId) || 0) + num(row.qty) * num(row.unit_cost));
    }
    const devUnitUsdByStyle = new Map<string, number>();
    for (const [styleNo, header] of devByStyle.entries()) {
      const totalLocal = devTotalLocalById.get(header.id) || 0;
      if (totalLocal <= 0) continue;
      const fx = defaultFxPerUsd(header.currency);
      const usd = header.currency && s(header.currency).toUpperCase() === "USD" ? totalLocal : totalLocal / fx;
      if (usd > 0) devUnitUsdByStyle.set(styleNo, usd);
    }

    const invoiceByShipmentId = new Map<string, any[]>();
    for (const row of invoiceRows) {
      const key = s((row as any).shipment_id);
      if (!key) continue;
      const list = invoiceByShipmentId.get(key) || [];
      list.push(row);
      invoiceByShipmentId.set(key, list);
    }

    const poRevenueBaseByHeaderId = new Map<string, number>();
    for (const line of poLines) {
      const headerId = s((line as any).po_header_id);
      if (!headerId) continue;
      const revenue = num((line as any).qty) * num((line as any).unit_price);
      poRevenueBaseByHeaderId.set(headerId, (poRevenueBaseByHeaderId.get(headerId) || 0) + revenue);
    }

    const lineRows: ShipmentLineRow[] = [];
    const shipmentMap = new Map<string, ShipmentProfitRow & { _actualCount: number; _fallbackCount: number; _costCount: number }>();
    const poMap = new Map<string, ShipmentPoRow & { _actualCount: number; _fallbackCount: number; _costCount: number }>();

    for (const shipment of shipmentsBase) {
      const shipmentId = s((shipment as any).id);
      if (!shipmentId) continue;
      const headerBuyerId = (shipment as any).buyer_id ?? null;
      const headerSiteId = (shipment as any).site_id ?? null;

      const linesForShipment = shipmentLines.filter((line: any) => s(line.shipment_id) === shipmentId);
      const invoicesForShipment = invoiceByShipmentId.get(shipmentId) || [];
      const shipmentInvoiceNo = invoicesForShipment[0]?.invoice_no ?? null;
      const shipmentInvoiceDate = invoicesForShipment[0]?.invoice_date ?? null;
      const shipmentShipDate = pickShipDate(shipment);

      let shipmentSummary = shipmentMap.get(shipmentId);
      if (!shipmentSummary) {
        shipmentSummary = {
          shipment_id: shipmentId,
          shipment_no: (shipment as any).shipment_no ?? null,
          ship_date: shipmentShipDate,
          invoice_no: shipmentInvoiceNo,
          invoice_date: shipmentInvoiceDate,
          buyer_id: headerBuyerId,
          buyer_name: (shipment as any).buyer_name ?? null,
          brand_name: null,
          site_id: headerSiteId,
          site_name: headerSiteId,
          po_count: 0,
          line_count: 0,
          revenue_usd: 0,
          planned_cogs_usd: 0,
          actual_cogs_usd: 0,
          effective_cogs_usd: 0,
          freight_usd: 0,
          packing_usd: 0,
          other_expenses_usd: 0,
          total_expenses_usd: 0,
          gross_profit_usd: 0,
          net_profit_usd: 0,
          gross_margin_pct: null,
          net_margin_pct: null,
          actual_coverage_pct: null,
          margin_mode: "NO_COST",
          _actualCount: 0,
          _fallbackCount: 0,
          _costCount: 0,
        };
        shipmentMap.set(shipmentId, shipmentSummary);
      }

      const poSet = new Set<string>();

      for (const line of linesForShipment) {
        const poLineId = s((line as any).po_line_id) || null;
        const poLine: any = poLineId ? poLineById.get(poLineId) : null;
        const poHeaderId = s((poLine as any)?.po_header_id) || s((line as any).po_header_id) || null;
        const poHeader: any = poHeaderId ? poHeaderById.get(poHeaderId) : null;
        const ws: any = poLineId ? wsByPoLineId.get(poLineId) : null;
        const vendor: any = ws?.vendor_id ? vendorById.get(ws.vendor_id) : null;

        const buyerId = (poHeader as any)?.buyer_id ?? headerBuyerId ?? null;
        const siteId = (poHeader as any)?.site_id ?? headerSiteId ?? null;
        const vendorId = ws?.vendor_id ?? null;

        if (buyerIds !== "ALL" && (!buyerId || !(buyerIds as string[]).includes(String(buyerId)))) continue;
        if (siteIds !== "ALL" && (!siteId || !(siteIds as string[]).includes(String(siteId)))) continue;
        if (vendorIds !== "ALL" && (!vendorId || !(vendorIds as string[]).includes(String(vendorId)))) continue;

        const poNo = (poHeader as any)?.po_no ?? (poLine as any)?.po_no ?? (line as any).po_no ?? null;
        const styleNo = (line as any).style_no ?? (poLine as any)?.jm_style_no ?? null;
        const buyerStyleNo = (poLine as any)?.buyer_style_no ?? null;
        const description = (line as any).description ?? (poLine as any)?.description ?? null;
        const costingUnitUsd = styleNo ? costingUnitUsdByStyle.get(s(styleNo)) || 0 : 0;
        const extraUnitUsd = poLineId ? extraUnitCostByPoLineId.get(poLineId) || 0 : 0;
        const wsJmStyleNo = s(ws?.jm_style_no);
        const devUnitUsd = wsJmStyleNo ? devUnitUsdByStyle.get(wsJmStyleNo) || 0 : 0;

        const haystack = [
          (shipment as any).shipment_no,
          shipmentSummary.invoice_no,
          poNo,
          styleNo,
          buyerStyleNo,
          description,
          (shipment as any).buyer_name,
          (poHeader as any)?.buyer_name,
          (poHeader as any)?.buyer_brand_name,
          vendor?.company_name,
          vendor?.name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (q && !haystack.includes(q)) continue;

        const shippedQty = num((line as any).shipped_qty ?? (line as any).qty);
        const orderQty = num((poLine as any)?.qty);
        const ratio = orderQty > 0 ? Math.min(1, Math.max(0, shippedQty / orderQty)) : 1;
        const revenueUsd =
          num((line as any).amount) ||
          shippedQty * num((line as any).unit_price ?? (poLine as any)?.unit_price);

        const productionMode = s(ws?.production_mode || (ws?.vendor_id ? "OUTSOURCED" : "IN_HOUSE")).toUpperCase();
        const outsourcingType = s(ws?.outsourcing_type || "FULL").toUpperCase();
        const vendorCurrency = s(ws?.vendor_currency || "CNY").toUpperCase();
        const plannedFxRate = num(ws?.fx_rate);
        const internalMaterialUnitLocal = num(ws?.internal_material_cost);
        const plannedMaterialUnitUsd = convertLocalUnitToUsd(
          internalMaterialUnitLocal,
          productionMode === "IN_HOUSE" ? "CNY" : vendorCurrency,
          plannedFxRate
        );
        const plannedVendorUnitUsd = num(ws?.vendor_unit_cost_usd);

        // Match the simpler fallback behavior used by the existing profitability dashboard:
        // use vendor_unit_cost_usd first when it exists, and only fall back to converted
        // material cost when vendor cost is missing. This prevents IN_HOUSE shipment rows
        // from showing zero cost just because internal_material_cost is blank.
        const plannedUnitUsd =
          productionMode === "OUTSOURCED"
            ? outsourcingType === "PROCESSING"
              ? plannedMaterialUnitUsd + plannedVendorUnitUsd || plannedVendorUnitUsd || plannedMaterialUnitUsd
              : plannedVendorUnitUsd || plannedMaterialUnitUsd
            : plannedVendorUnitUsd || plannedMaterialUnitUsd;

        const actualAmt = num(ws?.actual_amt);
        const actualUnitUsd =
          actualAmt > 0 && orderQty > 0
            ? actualAmt / orderQty
            : num(ws?.actual_unit) || num(ws?.actual_vendor_unit_cost_usd);

        const basePlannedUnitUsd = plannedUnitUsd || costingUnitUsd || devUnitUsd;
        const plannedCogsUsd = basePlannedUnitUsd > 0 ? basePlannedUnitUsd * shippedQty : 0;
        const actualCogsUsd =
          actualAmt > 0 && ratio > 0
            ? actualAmt * ratio
            : actualUnitUsd > 0
            ? actualUnitUsd * shippedQty
            : 0;

        const hasActual = actualCogsUsd > 0.0001;
        const useFallback = !hasActual && plannedCogsUsd > 0.0001;
        const effectiveBaseCogsUsd = hasActual ? actualCogsUsd : useFallback ? plannedCogsUsd : 0;
        const extraCogsUsd = extraUnitUsd > 0 ? extraUnitUsd * shippedQty : 0;
        const effectiveCogsUsd = effectiveBaseCogsUsd + extraCogsUsd;
        const actualCoverage = hasActual ? 100 : useFallback ? 0 : 0;
        const marginMode: ShipmentLineRow["margin_mode"] = hasActual
          ? "ACTUAL"
          : useFallback
          ? "PLANNED_FALLBACK"
          : "NO_COST";

        const poKey = `${shipmentId}::${poHeaderId || poNo || "NO_PO"}`;
        let poSummary = poMap.get(poKey);
        if (!poSummary) {
          poSummary = {
            shipment_id: shipmentId,
            shipment_no: shipmentSummary.shipment_no,
            ship_date: shipmentSummary.ship_date,
            po_header_id: poHeaderId,
            po_no: poNo,
            buyer_name: (poHeader as any)?.buyer_name ?? shipmentSummary.buyer_name,
            brand_name: (poHeader as any)?.buyer_brand_name ?? null,
            revenue_usd: 0,
            planned_cogs_usd: 0,
            actual_cogs_usd: 0,
            effective_cogs_usd: 0,
            freight_usd: 0,
            packing_usd: 0,
            other_expenses_usd: 0,
            total_expenses_usd: 0,
            gross_profit_usd: 0,
            net_profit_usd: 0,
            gross_margin_pct: null,
            net_margin_pct: null,
            actual_coverage_pct: null,
            line_count: 0,
            margin_mode: "NO_COST",
            _actualCount: 0,
            _fallbackCount: 0,
            _costCount: 0,
          };
          poMap.set(poKey, poSummary);
        }

        poSet.add(poKey);

        const lineRow: ShipmentLineRow = {
          shipment_id: shipmentId,
          shipment_no: shipmentSummary.shipment_no,
          ship_date: shipmentSummary.ship_date,
          po_header_id: poHeaderId,
          po_line_id: poLineId,
          po_no: poNo,
          style_no: styleNo,
          buyer_style_no: buyerStyleNo,
          description,
          buyer_name: (poHeader as any)?.buyer_name ?? shipmentSummary.buyer_name,
          brand_name: (poHeader as any)?.buyer_brand_name ?? null,
          vendor_id: vendorId,
          vendor_name: vendor?.company_name ?? vendor?.name ?? (productionMode === "IN_HOUSE" ? "In-house" : null),
          shipped_qty: round2(shippedQty) ?? 0,
          order_qty: round2(orderQty) ?? 0,
          revenue_usd: round2(revenueUsd) ?? 0,
          planned_cogs_usd: round2(plannedCogsUsd) ?? 0,
          actual_cogs_usd: round2(actualCogsUsd) ?? 0,
          effective_cogs_usd: round2(effectiveCogsUsd) ?? 0,
          freight_usd: 0,
          packing_usd: 0,
          other_expenses_usd: 0,
          total_expenses_usd: 0,
          gross_profit_usd: round2(revenueUsd - effectiveCogsUsd) ?? 0,
          net_profit_usd: round2(revenueUsd - effectiveCogsUsd) ?? 0,
          gross_margin_pct: pct(revenueUsd - effectiveCogsUsd, revenueUsd),
          net_margin_pct: pct(revenueUsd - effectiveCogsUsd, revenueUsd),
          actual_coverage_pct: actualCoverage,
          margin_mode: marginMode,
        };
        lineRows.push(lineRow);

        shipmentSummary.buyer_id = shipmentSummary.buyer_id ?? buyerId ?? null;
        shipmentSummary.buyer_name =
          shipmentSummary.buyer_name ?? (poHeader as any)?.buyer_name ?? (shipment as any).buyer_name ?? null;
        shipmentSummary.brand_name =
          shipmentSummary.brand_name ?? (poHeader as any)?.buyer_brand_name ?? null;
        shipmentSummary.site_id = shipmentSummary.site_id ?? siteId ?? null;
        shipmentSummary.site_name = shipmentSummary.site_name ?? siteId ?? null;
        shipmentSummary.line_count += 1;
        shipmentSummary.revenue_usd += revenueUsd;
        shipmentSummary.planned_cogs_usd += plannedCogsUsd;
        shipmentSummary.actual_cogs_usd += actualCogsUsd;
        shipmentSummary.effective_cogs_usd += effectiveCogsUsd;
        if (hasActual) shipmentSummary._actualCount += 1;
        if (useFallback) shipmentSummary._fallbackCount += 1;
        if (hasActual || useFallback) shipmentSummary._costCount += 1;

        poSummary.line_count += 1;
        poSummary.revenue_usd += revenueUsd;
        poSummary.planned_cogs_usd += plannedCogsUsd;
        poSummary.actual_cogs_usd += actualCogsUsd;
        poSummary.effective_cogs_usd += effectiveCogsUsd;
        if (hasActual) poSummary._actualCount += 1;
        if (useFallback) poSummary._fallbackCount += 1;
        if (hasActual || useFallback) poSummary._costCount += 1;
      }

      shipmentSummary.po_count += poSet.size;
      if (!shipmentSummary.invoice_no && invoicesForShipment[0]?.invoice_no) {
        shipmentSummary.invoice_no = invoicesForShipment[0]?.invoice_no ?? null;
        shipmentSummary.invoice_date = invoicesForShipment[0]?.invoice_date ?? null;
      }
    }

    const lineRowsByPoLineId = new Map<string, ShipmentLineRow[]>();
    const poRowsByPoHeaderId = new Map<string, ShipmentPoRow[]>();
    for (const row of lineRows) {
      const poLineId = s(row.po_line_id);
      if (poLineId) {
        const list = lineRowsByPoLineId.get(poLineId) || [];
        list.push(row);
        lineRowsByPoLineId.set(poLineId, list);
      }
      const poHeaderId = s(row.po_header_id);
      if (poHeaderId) {
        const list = poRowsByPoHeaderId.get(poHeaderId) || [];
        const poSummary = poMap.get(`${row.shipment_id}::${poHeaderId || row.po_no || "NO_PO"}`);
        if (poSummary && !list.includes(poSummary)) list.push(poSummary);
        poRowsByPoHeaderId.set(poHeaderId, list);
      }
    }

    for (const alloc of allocations) {
      const allocAmount = num((alloc as any).allocated_usd);
      if (allocAmount <= 0) continue;
      const expense = expenseHeaderById.get((alloc as any).expense_id);
      const bucket = classifyExpense((expense as any)?.expense_type_code);

      const addExpenseToLine = (row: ShipmentLineRow, amount: number) => {
        if (bucket === "freight") row.freight_usd += amount;
        else if (bucket === "packing") row.packing_usd += amount;
        else row.other_expenses_usd += amount;
      };

      const addExpenseToPo = (row: ShipmentPoRow, amount: number) => {
        if (bucket === "freight") row.freight_usd += amount;
        else if (bucket === "packing") row.packing_usd += amount;
        else row.other_expenses_usd += amount;
      };

      const addExpenseToShipment = (row: ShipmentProfitRow, amount: number) => {
        if (bucket === "freight") row.freight_usd += amount;
        else if (bucket === "packing") row.packing_usd += amount;
        else row.other_expenses_usd += amount;
      };

      const shipmentId = s((alloc as any).shipment_id);
      const poLineId = s((alloc as any).po_line_id);
      const poHeaderId = s((alloc as any).po_header_id);

      if (shipmentId && shipmentMap.has(shipmentId)) {
        addExpenseToShipment(shipmentMap.get(shipmentId)!, allocAmount);
        continue;
      }

      if (poLineId) {
        const targetLines = lineRowsByPoLineId.get(poLineId) || [];
        const revenueBase = targetLines.reduce((sum, row) => sum + row.revenue_usd, 0);
        const qtyBase = targetLines.reduce((sum, row) => sum + row.shipped_qty, 0);
        for (const row of targetLines) {
          const share =
            revenueBase > 0
              ? allocAmount * (row.revenue_usd / revenueBase)
              : qtyBase > 0
              ? allocAmount * (row.shipped_qty / qtyBase)
              : allocAmount / Math.max(targetLines.length, 1);
          addExpenseToLine(row, share);
          const poSummary = poMap.get(`${row.shipment_id}::${row.po_header_id || row.po_no || "NO_PO"}`);
          const shipmentSummary = shipmentMap.get(row.shipment_id);
          if (poSummary) addExpenseToPo(poSummary, share);
          if (shipmentSummary) addExpenseToShipment(shipmentSummary, share);
        }
        continue;
      }

      if (poHeaderId) {
        if (poHeaderIdsWithLineExpense.has(poHeaderId)) {
          continue;
        }
        const targetPos = poRowsByPoHeaderId.get(poHeaderId) || [];
        const baseRevenue = poRevenueBaseByHeaderId.get(poHeaderId) || 0;
        const distributedBase = targetPos.reduce((sum, row) => sum + row.revenue_usd, 0);
        const divisor = baseRevenue > 0 ? baseRevenue : distributedBase;
        for (const row of targetPos) {
          const share = divisor > 0 ? allocAmount * (row.revenue_usd / divisor) : 0;
          addExpenseToPo(row, share);
          const shipmentSummary = shipmentMap.get(row.shipment_id);
          if (shipmentSummary) addExpenseToShipment(shipmentSummary, share);
        }
      }
    }

    const finalizeLine = (row: ShipmentLineRow) => {
      row.freight_usd = round2(row.freight_usd) ?? 0;
      row.packing_usd = round2(row.packing_usd) ?? 0;
      row.other_expenses_usd = round2(row.other_expenses_usd) ?? 0;
      row.total_expenses_usd = round2(row.freight_usd + row.packing_usd + row.other_expenses_usd) ?? 0;
      row.gross_profit_usd = calcGrossProfit(row.revenue_usd, row.effective_cogs_usd);
      row.net_profit_usd = calcNetProfit({
        revenueUsd: row.revenue_usd,
        effectiveCogsUsd: row.effective_cogs_usd,
        freightUsd: row.freight_usd,
        packingUsd: row.packing_usd,
        otherExpensesUsd: row.other_expenses_usd,
      });
      row.gross_margin_pct = pct(row.gross_profit_usd, row.revenue_usd);
      row.net_margin_pct = pct(row.net_profit_usd, row.revenue_usd);
    };

    lineRows.forEach(finalizeLine);

    const poRows = Array.from(poMap.values()).map((row) => {
      row.revenue_usd = round2(row.revenue_usd) ?? 0;
      row.planned_cogs_usd = round2(row.planned_cogs_usd) ?? 0;
      row.actual_cogs_usd = round2(row.actual_cogs_usd) ?? 0;
      row.effective_cogs_usd = round2(row.effective_cogs_usd) ?? 0;
      row.freight_usd = round2(row.freight_usd) ?? 0;
      row.packing_usd = round2(row.packing_usd) ?? 0;
      row.other_expenses_usd = round2(row.other_expenses_usd) ?? 0;
      row.total_expenses_usd = round2(row.freight_usd + row.packing_usd + row.other_expenses_usd) ?? 0;
      row.gross_profit_usd = calcGrossProfit(row.revenue_usd, row.effective_cogs_usd);
      row.net_profit_usd = calcNetProfit({
        revenueUsd: row.revenue_usd,
        effectiveCogsUsd: row.effective_cogs_usd,
        freightUsd: row.freight_usd,
        packingUsd: row.packing_usd,
        otherExpensesUsd: row.other_expenses_usd,
      });
      row.gross_margin_pct = pct(row.gross_profit_usd, row.revenue_usd);
      row.net_margin_pct = pct(row.net_profit_usd, row.revenue_usd);
      row.actual_coverage_pct = pct(row._actualCount, row.line_count);
      row.margin_mode = computeMarginMode({
        actualCount: row._actualCount,
        fallbackCount: row._fallbackCount,
        costCount: row._costCount,
      });
      return row;
    });

    const shipments = Array.from(shipmentMap.values())
      .map((row) => {
        row.revenue_usd = round2(row.revenue_usd) ?? 0;
        row.planned_cogs_usd = round2(row.planned_cogs_usd) ?? 0;
        row.actual_cogs_usd = round2(row.actual_cogs_usd) ?? 0;
        row.effective_cogs_usd = round2(row.effective_cogs_usd) ?? 0;
        row.freight_usd = round2(row.freight_usd) ?? 0;
        row.packing_usd = round2(row.packing_usd) ?? 0;
        row.other_expenses_usd = round2(row.other_expenses_usd) ?? 0;
        row.total_expenses_usd = round2(row.freight_usd + row.packing_usd + row.other_expenses_usd) ?? 0;
        row.gross_profit_usd = calcGrossProfit(row.revenue_usd, row.effective_cogs_usd);
        row.net_profit_usd = calcNetProfit({
          revenueUsd: row.revenue_usd,
          effectiveCogsUsd: row.effective_cogs_usd,
          freightUsd: row.freight_usd,
          packingUsd: row.packing_usd,
          otherExpensesUsd: row.other_expenses_usd,
        });
        row.gross_margin_pct = pct(row.gross_profit_usd, row.revenue_usd);
        row.net_margin_pct = pct(row.net_profit_usd, row.revenue_usd);
        row.actual_coverage_pct = pct(row._actualCount, row.line_count);
        row.margin_mode = computeMarginMode({
          actualCount: row._actualCount,
          fallbackCount: row._fallbackCount,
          costCount: row._costCount,
        });
        return row;
      })
      .filter((row) => row.line_count > 0)
      .sort((a, b) => (b.ship_date || "").localeCompare(a.ship_date || ""));

    const kpis = {
      shipment_count: shipments.length,
      revenue_usd: round2(shipments.reduce((sum, row) => sum + row.revenue_usd, 0)) ?? 0,
      effective_cogs_usd: round2(shipments.reduce((sum, row) => sum + row.effective_cogs_usd, 0)) ?? 0,
      freight_usd: round2(shipments.reduce((sum, row) => sum + row.freight_usd, 0)) ?? 0,
      packing_usd: round2(shipments.reduce((sum, row) => sum + row.packing_usd, 0)) ?? 0,
      other_expenses_usd: round2(shipments.reduce((sum, row) => sum + row.other_expenses_usd, 0)) ?? 0,
      net_profit_usd: round2(shipments.reduce((sum, row) => sum + row.net_profit_usd, 0)) ?? 0,
      net_margin_pct: pct(
        shipments.reduce((sum, row) => sum + row.net_profit_usd, 0),
        shipments.reduce((sum, row) => sum + row.revenue_usd, 0)
      ),
    };

    return NextResponse.json(
      {
        ok: true,
        filters_echo: {
          start,
          end,
          buyer_ids: buyerIds,
          vendor_ids: vendorIds,
          site_ids: siteIds,
          q,
          limit,
        },
        kpis,
        shipments,
        po_rows: poRows.sort((a, b) => (b.ship_date || "").localeCompare(a.ship_date || "")),
        line_rows: lineRows.sort((a, b) => (b.ship_date || "").localeCompare(a.ship_date || "")),
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
      }
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
