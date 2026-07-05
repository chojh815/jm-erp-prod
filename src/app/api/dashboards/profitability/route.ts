import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ProfitRow = {
  invoice_id: string | null;
  invoice_no: string | null;
  invoice_date: string | null;
  buyer_id: string | null;
  buyer_name: string | null;
  buyer_code: string | null;
  brand_name: string | null;
  po_no: string | null;
  po_line_id?: string | null;
  jm_style: string | null;
  buyer_style: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  site_id: string | null;
  site_name: string | null;
  currency: string | null;
  fx_rate_to_usd: number | null;
  revenue_local: number | null;
  revenue_usd: number | null;
  planned_cogs_usd: number | null;
  actual_cogs_usd: number | null;
  freight_usd: number | null;
  other_expenses_usd: number | null;
  factory_overhead_usd: number | null;
  profit_usd: number | null;
  margin_pct: number | null;
  net_profit_usd: number | null;
  net_margin_pct: number | null;
  actual_coverage: number | null;

  effective_cogs_usd?: number | null;
  margin_mode?: "ACTUAL" | "PLANNED_FALLBACK" | "NO_COST";
  has_actual_cost?: boolean;
  using_planned_fallback?: boolean;
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
    ? (numer / denom) * 100
    : null;
}

function monthKey(iso: string | null): string {
  return iso ? iso.slice(0, 7) : "Unknown";
}

function classifyExpense(code: any): "freight" | "other" | "factory_overhead" {
  const v = s(code).toUpperCase();
  if (
    v.includes("FORWARDER") ||
    v.includes("FREIGHT") ||
    v.includes("PORT_FEE") ||
    v.includes("CUSTOMS")
  ) {
    return "freight";
  }
  if (v.includes("OVERHEAD")) return "factory_overhead";
  return "other";
}

function s(v: any): string {
  return String(v ?? "").trim();
}

function defaultFxPerUsd(currency: string | null): number {
  const cur = s(currency || "USD").toUpperCase();
  if (cur === "USD") return 1;
  if (cur === "CNY") return 7.2;
  if (cur === "KRW") return 1400;
  if (cur === "VND") return 25000;
  return 1;
}

function pickLatestDevByStyle(rows: DevHeaderLite[]): Map<string, DevHeaderLite> {
  const out = new Map<string, DevHeaderLite>();
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

function withEffectiveCost(row: ProfitRow): ProfitRow {
  const revenue = num(row.revenue_usd);
  const planned = num(row.planned_cogs_usd);
  const actual = num(row.actual_cogs_usd);
  const freight = num(row.freight_usd);
  const otherExp = num(row.other_expenses_usd);
  const factoryOH = num(row.factory_overhead_usd);

  const hasActual = actual > 0;
  const usePlanned = !hasActual && planned > 0;

  const effectiveCogs = hasActual ? actual : usePlanned ? planned : 0;
  const marginMode: ProfitRow["margin_mode"] = hasActual
    ? "ACTUAL"
    : usePlanned
    ? "PLANNED_FALLBACK"
    : "NO_COST";

  const profitUsd = revenue - effectiveCogs;
  const marginPct = marginMode === "NO_COST" ? null : pct(profitUsd, revenue);

  const netProfitUsd = revenue - effectiveCogs - freight - otherExp - factoryOH;
  const netMarginPct = marginMode === "NO_COST" ? null : pct(netProfitUsd, revenue);

  return {
    ...row,
    effective_cogs_usd: round2(effectiveCogs),
    margin_mode: marginMode,
    has_actual_cost: hasActual,
    using_planned_fallback: usePlanned,
    profit_usd: round2(profitUsd),
    margin_pct: round2(marginPct),
    net_profit_usd: round2(netProfitUsd),
    net_margin_pct: round2(netMarginPct),
  };
}

async function loadFallbackRows(args: {
  start: string;
  end: string;
  buyerIds: string[];
  vendorIds: string[];
  siteIds: string[];
  q: string;
  limit: number;
}): Promise<ProfitRow[]> {
  const buyerFilter = args.buyerIds.length && args.buyerIds[0] !== "ALL" ? args.buyerIds : null;
  const vendorFilter = args.vendorIds.length && args.vendorIds[0] !== "ALL" ? args.vendorIds : null;
  const siteFilter = args.siteIds.length && args.siteIds[0] !== "ALL" ? args.siteIds : null;

  let invQ = supabaseAdmin
    .from("invoice_headers")
    .select("id, invoice_no, invoice_date, buyer_id, buyer_name, buyer_code, currency, total_amount, is_deleted")
    .eq("is_deleted", false)
    .order("invoice_date", { ascending: false })
    .limit(args.limit);

  if (args.start) invQ = invQ.gte("invoice_date", args.start);
  if (args.end) invQ = invQ.lte("invoice_date", args.end);
  if (buyerFilter) invQ = invQ.in("buyer_id", buyerFilter);

  const { data: invoices, error: invErr } = await invQ;
  if (invErr) throw invErr;

  const invoiceIds = (invoices || []).map((x: any) => x.id).filter(Boolean);
  if (!invoiceIds.length) return [];

  const { data: lines, error: lineErr } = await supabaseAdmin
    .from("invoice_lines")
    .select("id, invoice_id, po_header_id, po_line_id, po_no, style_no, buyer_style_no, description, qty, unit_price, amount, is_deleted")
    .in("invoice_id", invoiceIds)
    .eq("is_deleted", false);
  if (lineErr) throw lineErr;

  const poLineIds = Array.from(new Set((lines || []).map((x: any) => x.po_line_id).filter(Boolean)));
  const poHeaderIds = Array.from(new Set((lines || []).map((x: any) => x.po_header_id).filter(Boolean)));

  const [{ data: poLines, error: poLineErr }, { data: poHeaders, error: poHeadErr }, { data: wsLines, error: wsErr }] =
    await Promise.all([
      poLineIds.length
        ? supabaseAdmin
            .from("po_lines")
            .select("id, po_header_id, jm_style_no, buyer_style_no, jm_style_code, buyer_style_code, description, qty")
            .in("id", poLineIds)
        : Promise.resolve({ data: [], error: null } as any),
      poHeaderIds.length
        ? supabaseAdmin
            .from("po_headers")
            .select("id, buyer_brand_name, site_id")
            .in("id", poHeaderIds)
        : Promise.resolve({ data: [], error: null } as any),
      poLineIds.length
        ? supabaseAdmin
            .from("work_sheet_lines")
            .select("po_line_id, jm_style_no, buyer_style, vendor_id, vendor_unit_cost_usd, actual_unit, actual_amt, actual_vendor_unit_cost_usd")
            .in("po_line_id", poLineIds)
            .eq("is_deleted", false)
        : Promise.resolve({ data: [], error: null } as any),
    ]);

  if (poLineErr) throw poLineErr;
  if (poHeadErr) throw poHeadErr;
  if (wsErr) throw wsErr;

  const vendorIds = Array.from(new Set((wsLines || []).map((x: any) => x.vendor_id).filter(Boolean)));
  const poSiteIds = Array.from(new Set((poHeaders || []).map((x: any) => x.site_id).filter(Boolean)));
  const devStyleNos = Array.from(
    new Set(
      (wsLines || [])
        .map((x: any) => s(x.jm_style_no))
        .concat((poLines || []).map((x: any) => s(x.jm_style_no)))
        .filter(Boolean)
    )
  );
  const [
    { data: vendors, error: vendorErr },
    { data: expenses, error: expenseErr },
    { data: sites, error: sitesErr },
  ] = await Promise.all([
    vendorIds.length
      ? supabaseAdmin.from("companies").select("id, company_name, name").in("id", vendorIds)
      : Promise.resolve({ data: [], error: null } as any),
    poLineIds.length || poHeaderIds.length
      ? supabaseAdmin
          .from("expense_allocation_results")
          .select("expense_id, po_header_id, po_line_id, allocated_usd, is_deleted")
          .eq("is_deleted", false)
          .or(
            [
              poLineIds.length ? `po_line_id.in.(${poLineIds.join(",")})` : "",
              poHeaderIds.length ? `po_header_id.in.(${poHeaderIds.join(",")})` : "",
            ]
              .filter(Boolean)
              .join(",")
          )
      : Promise.resolve({ data: [], error: null } as any),
    poSiteIds.length
      ? supabaseAdmin
          .from("company_sites")
          .select("id, site_name, name")
          .in("id", poSiteIds)
      : Promise.resolve({ data: [], error: null } as any),
  ]);

  if (vendorErr) throw vendorErr;
  if (expenseErr) throw expenseErr;
  if (sitesErr) throw sitesErr;

  const expenseHeaderIds = Array.from(
    new Set((expenses || []).map((x: any) => s(x.expense_id)).filter(Boolean))
  );
  const expenseHeadersRes = expenseHeaderIds.length
    ? await supabaseAdmin
        .from("expense_headers")
        .select("id, expense_type_code")
        .in("id", expenseHeaderIds)
    : ({ data: [], error: null } as any);
  if (expenseHeadersRes.error) throw expenseHeadersRes.error;
  const expenseHeadersById = new Map(
    (expenseHeadersRes.data || []).map((x: any) => [String(x.id), x])
  );

  const devHeadersRes = devStyleNos.length
    ? await supabaseAdmin
        .from("product_development_headers")
        .select("id, style_no, currency, updated_at, created_at")
        .in("style_no", devStyleNos)
    : ({ data: [], error: null } as any);
  if (devHeadersRes.error) throw devHeadersRes.error;
  const devHeaders = (devHeadersRes.data || []) as DevHeaderLite[];

  const devIds = devHeaders.map((x) => x.id).filter(Boolean);
  const [devMaterialsRes, devOperationsRes] = await Promise.all([
    devIds.length
      ? supabaseAdmin
          .from("product_development_materials")
          .select("product_id, qty, unit_cost")
          .in("product_id", devIds)
      : Promise.resolve({ data: [], error: null } as any),
    devIds.length
      ? supabaseAdmin
          .from("product_development_operations")
          .select("product_id, qty, unit_cost")
          .in("product_id", devIds)
      : Promise.resolve({ data: [], error: null } as any),
  ]);
  if (devMaterialsRes.error) throw devMaterialsRes.error;
  if (devOperationsRes.error) throw devOperationsRes.error;
  const devMaterials = (devMaterialsRes.data || []) as DevCostLineLite[];
  const devOperations = (devOperationsRes.data || []) as DevCostLineLite[];

  const invById = new Map((invoices || []).map((x: any) => [x.id, x]));
  const poLineById = new Map((poLines || []).map((x: any) => [x.id, x]));
  const poHeaderById = new Map((poHeaders || []).map((x: any) => [x.id, x]));
  const wsByPoLine = new Map((wsLines || []).map((x: any) => [x.po_line_id, x]));
  const vendorById = new Map((vendors || []).map((x: any) => [x.id, x]));
  const siteById = new Map((sites || []).map((x: any) => [x.id, x]));
  const latestDevByStyle = pickLatestDevByStyle(devHeaders);
  const devTotalLocalById = new Map<number, number>();
  for (const row of devMaterials) {
    const id = Number(row.product_id || 0);
    if (!id) continue;
    devTotalLocalById.set(id, (devTotalLocalById.get(id) || 0) + num(row.qty) * num(row.unit_cost));
  }
  for (const row of devOperations) {
    const id = Number(row.product_id || 0);
    if (!id) continue;
    devTotalLocalById.set(id, (devTotalLocalById.get(id) || 0) + num(row.qty) * num(row.unit_cost));
  }
  const devUnitUsdByStyle = new Map<string, number>();
  for (const [styleNo, header] of latestDevByStyle.entries()) {
    const localTotal = devTotalLocalById.get(header.id) || 0;
    if (localTotal <= 0) continue;
    const fx = defaultFxPerUsd(header.currency);
    const unitUsd = fx > 0 ? localTotal / fx : 0;
    if (unitUsd > 0) devUnitUsdByStyle.set(styleNo, unitUsd);
  }

  const freightByPoLine = new Map<string, number>();
  const otherByPoLine = new Map<string, number>();
  const freightByPoHeader = new Map<string, number>();
  const otherByPoHeader = new Map<string, number>();
  const poHeaderIdsWithLineFreight = new Set<string>();
  const poHeaderIdsWithLineOther = new Set<string>();
  for (const e of expenses || []) {
    const header: any = expenseHeadersById.get(s(e.expense_id));
    const bucket = classifyExpense(header?.expense_type_code);
    const poLineId = s(e.po_line_id);
    const poHeaderIdDirect = s(e.po_header_id);
    if (e.po_line_id) {
      if (bucket === "freight") {
        freightByPoLine.set(poLineId, (freightByPoLine.get(poLineId) || 0) + num(e.allocated_usd));
      } else if (bucket === "other") {
        otherByPoLine.set(poLineId, (otherByPoLine.get(poLineId) || 0) + num(e.allocated_usd));
      }
      const poLine: any = poLineById.get(poLineId);
      const poHeaderId = s(poLine?.po_header_id || poHeaderIdDirect);
      if (poHeaderId) {
        if (bucket === "freight") poHeaderIdsWithLineFreight.add(poHeaderId);
        if (bucket === "other") poHeaderIdsWithLineOther.add(poHeaderId);
      }
    }
    if (e.po_header_id && !e.po_line_id) {
      if (bucket === "freight") {
        freightByPoHeader.set(
          poHeaderIdDirect,
          (freightByPoHeader.get(poHeaderIdDirect) || 0) + num(e.allocated_usd)
        );
      } else if (bucket === "other") {
        otherByPoHeader.set(
          poHeaderIdDirect,
          (otherByPoHeader.get(poHeaderIdDirect) || 0) + num(e.allocated_usd)
        );
      }
    }
  }

  const lineRevenueBaseByPoHeader = new Map<string, number>();
  for (const line of lines || []) {
    const poHeaderId = line.po_header_id ? String(line.po_header_id) : "";
    if (!poHeaderId) continue;
    const revenueUsd = line.amount == null ? num(line.qty) * num(line.unit_price) : num(line.amount);
    lineRevenueBaseByPoHeader.set(
      poHeaderId,
      (lineRevenueBaseByPoHeader.get(poHeaderId) || 0) + revenueUsd
    );
  }

  const rows: ProfitRow[] = [];
  const query = args.q.toLowerCase();

  for (const line of lines || []) {
    const inv: any = invById.get(line.invoice_id);
    if (!inv) continue;

    const poLine: any = line.po_line_id ? poLineById.get(line.po_line_id) : null;
    const poHeader: any = line.po_header_id ? poHeaderById.get(line.po_header_id) : null;
    const ws: any = line.po_line_id ? wsByPoLine.get(line.po_line_id) : null;
    const vendor: any = ws?.vendor_id ? vendorById.get(ws.vendor_id) : null;
    const site: any = poHeader?.site_id ? siteById.get(poHeader.site_id) : null;

    if (vendorFilter && (!ws?.vendor_id || !vendorFilter.includes(String(ws.vendor_id)))) continue;
    if (siteFilter && (!poHeader?.site_id || !siteFilter.includes(String(poHeader.site_id)))) continue;

    const hay = [
      inv.invoice_no,
      line.po_no,
      line.style_no,
      line.buyer_style_no,
      poLine?.jm_style_no,
      poLine?.buyer_style_no,
      poLine?.jm_style_code,
      poLine?.buyer_style_code,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (query && !hay.includes(query)) continue;

    const qty = num(line.qty) || num(poLine?.qty);
    const wsJmStyleNo = s(ws?.jm_style_no || poLine?.jm_style_no);
    const devUnitUsd = wsJmStyleNo ? devUnitUsdByStyle.get(wsJmStyleNo) || 0 : 0;
    const plannedUnit = num(ws?.vendor_unit_cost_usd) || devUnitUsd;
    const actualUnit = num(ws?.actual_vendor_unit_cost_usd) || num(ws?.actual_unit);
    const actualAmt = num(ws?.actual_amt);

    const revenueUsd = line.amount == null ? num(line.qty) * num(line.unit_price) : num(line.amount);
    const poHeaderFreightUsd = line.po_header_id ? freightByPoHeader.get(line.po_header_id) || 0 : 0;
    const poHeaderOtherUsd = line.po_header_id ? otherByPoHeader.get(line.po_header_id) || 0 : 0;
    const hasLineLevelFreightForHeader =
      !!line.po_header_id && poHeaderIdsWithLineFreight.has(String(line.po_header_id));
    const hasLineLevelOtherForHeader =
      !!line.po_header_id && poHeaderIdsWithLineOther.has(String(line.po_header_id));
    const poHeaderRevenueBase =
      line.po_header_id ? lineRevenueBaseByPoHeader.get(String(line.po_header_id)) || 0 : 0;
    const poHeaderFreightShareUsd =
      !hasLineLevelFreightForHeader && poHeaderFreightUsd > 0 && poHeaderRevenueBase > 0
        ? poHeaderFreightUsd * (revenueUsd / poHeaderRevenueBase)
        : 0;
    const poHeaderOtherShareUsd =
      !hasLineLevelOtherForHeader && poHeaderOtherUsd > 0 && poHeaderRevenueBase > 0
        ? poHeaderOtherUsd * (revenueUsd / poHeaderRevenueBase)
        : 0;

    rows.push({
      invoice_id: inv.id ?? null,
      invoice_no: inv.invoice_no ?? null,
      invoice_date: inv.invoice_date ?? null,
      buyer_id: inv.buyer_id ?? null,
      buyer_name: inv.buyer_name ?? null,
      buyer_code: inv.buyer_code ?? null,
      brand_name: poHeader?.buyer_brand_name ?? null,
      po_no: line.po_no ?? null,
      po_line_id: line.po_line_id ?? null,
      jm_style: line.style_no ?? poLine?.jm_style_no ?? poLine?.jm_style_code ?? null,
      buyer_style: line.buyer_style_no ?? poLine?.buyer_style_no ?? poLine?.buyer_style_code ?? null,
      vendor_id: ws?.vendor_id ?? null,
      vendor_name: vendor?.company_name ?? vendor?.name ?? null,
      site_id: poHeader?.site_id ?? null,
      site_name: site?.site_name ?? site?.name ?? poHeader?.site_id ?? null,
      currency: inv.currency ?? null,
      fx_rate_to_usd: null,
      revenue_local: line.amount == null ? null : revenueUsd,
      revenue_usd: line.amount == null ? null : revenueUsd,
      planned_cogs_usd: plannedUnit > 0 && qty > 0 ? plannedUnit * qty : null,
      actual_cogs_usd: actualAmt > 0 ? actualAmt : actualUnit > 0 && qty > 0 ? actualUnit * qty : null,
      freight_usd: poHeaderFreightShareUsd,
      other_expenses_usd: poHeaderOtherShareUsd,
      factory_overhead_usd: null,
      profit_usd: null,
      margin_pct: null,
      net_profit_usd: null,
      net_margin_pct: null,
      actual_coverage: actualAmt > 0 || actualUnit > 0 ? 1 : 0,
    });
  }

  const rowsByPoLineId = new Map<string, ProfitRow[]>();
  for (const row of rows) {
    const poLineId = s((row as any).po_line_id);
    if (!poLineId) continue;
    const list = rowsByPoLineId.get(poLineId) || [];
    list.push(row);
    rowsByPoLineId.set(poLineId, list);
  }

  for (const [poLineId, amount] of freightByPoLine.entries()) {
    const targetRows = rowsByPoLineId.get(poLineId) || [];
    if (!targetRows.length) continue;
    const revenueBase = targetRows.reduce((sum, row) => sum + num(row.revenue_usd), 0);
    for (const row of targetRows) {
      const share =
        revenueBase > 0
          ? amount * (num(row.revenue_usd) / revenueBase)
          : amount / Math.max(targetRows.length, 1);
      row.freight_usd = round2(num(row.freight_usd) + share);
    }
  }

  for (const [poLineId, amount] of otherByPoLine.entries()) {
    const targetRows = rowsByPoLineId.get(poLineId) || [];
    if (!targetRows.length) continue;
    const revenueBase = targetRows.reduce((sum, row) => sum + num(row.revenue_usd), 0);
    for (const row of targetRows) {
      const share =
        revenueBase > 0
          ? amount * (num(row.revenue_usd) / revenueBase)
          : amount / Math.max(targetRows.length, 1);
      row.other_expenses_usd = round2(num(row.other_expenses_usd) + share);
    }
  }

  return rows.slice(0, args.limit);
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const start = searchParams.get("start") || "";
    const end = searchParams.get("end") || "";
    const preset = searchParams.get("preset") || "LAST_12_MONTHS";
    const buyerIds = (searchParams.get("buyer_ids") || "ALL").split(",").filter(Boolean);
    const vendorIds = (searchParams.get("vendor_ids") || "ALL").split(",").filter(Boolean);
    const siteIds = (searchParams.get("site_ids") || "ALL").split(",").filter(Boolean);
    const q = (searchParams.get("q") || "").trim();
    const includeExpectedOnly = searchParams.get("include_expected_only") === "true";
    const limit = Math.min(Math.max(Number(searchParams.get("limit") || "500"), 50), 5000);

    const rpcArgs = {
      p_start: start || null,
      p_end: end || null,
      p_preset: preset || null,
      p_buyer_ids: buyerIds.length && buyerIds[0] !== "ALL" ? buyerIds : null,
      p_vendor_ids: vendorIds.length && vendorIds[0] !== "ALL" ? vendorIds : null,
      p_site_ids: siteIds.length && siteIds[0] !== "ALL" ? siteIds : null,
      p_q: q || null,
      p_limit: limit,
    };

    const sourceRows = await loadFallbackRows({ start, end, buyerIds, vendorIds, siteIds, q, limit });
    if (includeExpectedOnly) {
    const existingPoLineIds = new Set(
      sourceRows.map((row: any) => s(row.po_line_id)).filter(Boolean)
    );

    let expectedQuery = supabaseAdmin
      .from("expected_margin_snapshots")
      .select(
        "po_header_id,po_line_id,po_no,jm_style_no,buyer_style_no,revenue_usd,expected_cogs_usd,snapshot_at"
      )
      .order("snapshot_at", { ascending: false })
      .limit(limit);
    if (q) {
      expectedQuery = expectedQuery.or(
        `po_no.ilike.%${q}%,jm_style_no.ilike.%${q}%,buyer_style_no.ilike.%${q}%`
      );
    }
    const expectedResult = await expectedQuery;
    const expectedMissing =
      expectedResult.error?.code === "42P01" ||
      /does not exist|schema cache/i.test(String(expectedResult.error?.message ?? ""));
    if (expectedResult.error && !expectedMissing) throw expectedResult.error;

    const expectedCandidates = (expectedResult.data ?? []).filter(
      (row: any) => !existingPoLineIds.has(s(row.po_line_id))
    );
    const expectedHeaderIds = Array.from(
      new Set(expectedCandidates.map((row: any) => row.po_header_id).filter(Boolean))
    );
    const expectedHeadersResult = expectedHeaderIds.length
      ? await supabaseAdmin
          .from("po_headers")
          .select("id,order_date,buyer_id,buyer_name,buyer_brand_name,site_id,currency")
          .in("id", expectedHeaderIds)
      : ({ data: [], error: null } as any);
    if (expectedHeadersResult.error) throw expectedHeadersResult.error;
    const expectedHeaderById = new Map(
      (expectedHeadersResult.data ?? []).map((row: any) => [String(row.id), row])
    );

    if (!vendorIds.length || vendorIds[0] === "ALL") {
      for (const snapshot of expectedCandidates) {
        const header: any = expectedHeaderById.get(String((snapshot as any).po_header_id));
        if (!header) continue;
        if (start && s(header.order_date) < start) continue;
        if (end && s(header.order_date) > end) continue;
        if (buyerIds.length && buyerIds[0] !== "ALL" && !buyerIds.includes(String(header.buyer_id))) continue;
        if (siteIds.length && siteIds[0] !== "ALL" && !siteIds.includes(String(header.site_id))) continue;
        sourceRows.push({
          invoice_id: null,
          invoice_no: null,
          invoice_date: header.order_date ?? (snapshot as any).snapshot_at ?? null,
          buyer_id: header.buyer_id ?? null,
          buyer_name: header.buyer_name ?? null,
          buyer_code: null,
          brand_name: header.buyer_brand_name ?? null,
          po_no: (snapshot as any).po_no ?? null,
          po_line_id: (snapshot as any).po_line_id ?? null,
          jm_style: (snapshot as any).jm_style_no ?? null,
          buyer_style: (snapshot as any).buyer_style_no ?? null,
          vendor_id: null,
          vendor_name: null,
          site_id: header.site_id ?? null,
          site_name: header.site_id ?? null,
          currency: header.currency ?? "USD",
          fx_rate_to_usd: null,
          revenue_local: (snapshot as any).revenue_usd ?? null,
          revenue_usd: (snapshot as any).revenue_usd ?? null,
          planned_cogs_usd: (snapshot as any).expected_cogs_usd ?? null,
          actual_cogs_usd: null,
          freight_usd: null,
          other_expenses_usd: null,
          factory_overhead_usd: null,
          profit_usd: null,
          margin_pct: null,
          net_profit_usd: null,
          net_margin_pct: null,
          actual_coverage: 0,
        });
      }
    }
    }

    const rawRows: ProfitRow[] = (sourceRows || []).map((r: any) => ({
      invoice_id: r.invoice_id ?? null,
      invoice_no: r.invoice_no ?? null,
      invoice_date: r.invoice_date ?? null,
      buyer_id: r.buyer_id ?? null,
      buyer_name: r.buyer_name ?? null,
      buyer_code: r.buyer_code ?? null,
      brand_name: r.brand_name ?? null,
      po_no: r.po_no ?? null,
      po_line_id: r.po_line_id ?? null,
      jm_style: r.jm_style ?? r.jm_style_no ?? null,
      buyer_style: r.buyer_style ?? r.buyer_style_no ?? null,
      vendor_id: r.vendor_id ?? null,
      vendor_name: r.vendor_name ?? null,
      site_id: r.site_id ?? null,
      site_name: r.site_name ?? null,
      currency: r.currency ?? null,
      fx_rate_to_usd: r.fx_rate_to_usd == null ? null : Number(r.fx_rate_to_usd),
      revenue_local: r.revenue_local == null ? null : round2(Number(r.revenue_local)),
      revenue_usd: r.revenue_usd == null ? null : round2(Number(r.revenue_usd)),
      planned_cogs_usd: r.planned_cogs_usd == null ? null : round2(Number(r.planned_cogs_usd)),
      actual_cogs_usd: r.actual_cogs_usd == null ? null : round2(Number(r.actual_cogs_usd)),
      freight_usd: r.freight_usd == null ? null : round2(Number(r.freight_usd)),
      other_expenses_usd: r.other_expenses_usd == null ? null : round2(Number(r.other_expenses_usd)),
      factory_overhead_usd: r.factory_overhead_usd == null ? null : round2(Number(r.factory_overhead_usd)),
      profit_usd: r.profit_usd == null ? null : round2(Number(r.profit_usd)),
      margin_pct: r.margin_pct == null ? null : round2(Number(r.margin_pct)),
      net_profit_usd: r.net_profit_usd == null ? null : round2(Number(r.net_profit_usd)),
      net_margin_pct: r.net_margin_pct == null ? null : round2(Number(r.net_margin_pct)),
      actual_coverage: r.actual_coverage == null ? null : round2(Number(r.actual_coverage)),
    }));

    const rows: ProfitRow[] = rawRows.map(withEffectiveCost);

    const revenueUsd = round2(rows.reduce((a, r) => a + num(r.revenue_usd), 0));
    const plannedCogsUsd = round2(rows.reduce((a, r) => a + num(r.planned_cogs_usd), 0));
    const actualCogsUsd = round2(rows.reduce((a, r) => a + num(r.actual_cogs_usd), 0));
    const effectiveCogsUsd = round2(rows.reduce((a, r) => a + num(r.effective_cogs_usd), 0));
    const freightUsd = round2(rows.reduce((a, r) => a + num(r.freight_usd), 0));
    const otherExpensesUsd = round2(rows.reduce((a, r) => a + num(r.other_expenses_usd), 0));
    const factoryOverheadUsd = round2(rows.reduce((a, r) => a + num(r.factory_overhead_usd), 0));

    const profitUsd = round2(num(revenueUsd) - num(effectiveCogsUsd));
    const marginPct = round2(pct(num(profitUsd), num(revenueUsd)));
    const netProfitUsd = round2(
      num(revenueUsd) -
        num(effectiveCogsUsd) -
        num(freightUsd) -
        num(otherExpensesUsd) -
        num(factoryOverheadUsd)
    );
    const netMarginPct = round2(pct(num(netProfitUsd), num(revenueUsd)));

    const coveragePct = round2(
      pct(
        rows.reduce((a, r) => a + (num(r.actual_coverage) > 0 ? num(r.revenue_usd) : 0), 0),
        num(revenueUsd)
      )
    );

    const plannedFallbackRevenueUsd = round2(
      rows.reduce((a, r) => a + (r.using_planned_fallback ? num(r.revenue_usd) : 0), 0)
    );

    const byMonth = new Map<string, any>();
    for (const r of rows) {
      const m = monthKey(r.invoice_date);
      const cur =
        byMonth.get(m) || {
          month: m,
          revenue_usd: 0,
          actual_cogs_usd: 0,
          planned_cogs_usd: 0,
          effective_cogs_usd: 0,
          freight_usd: 0,
          other_expenses_usd: 0,
          factory_overhead_usd: 0,
          net_profit_usd: 0,
          net_margin_pct: null,
        };
      cur.revenue_usd += num(r.revenue_usd);
      cur.actual_cogs_usd += num(r.actual_cogs_usd);
      cur.planned_cogs_usd += num(r.planned_cogs_usd);
      cur.effective_cogs_usd += num(r.effective_cogs_usd);
      cur.freight_usd += num(r.freight_usd);
      cur.other_expenses_usd += num(r.other_expenses_usd);
      cur.factory_overhead_usd += num(r.factory_overhead_usd);
      cur.net_profit_usd =
        cur.revenue_usd -
        cur.effective_cogs_usd -
        cur.freight_usd -
        cur.other_expenses_usd -
        cur.factory_overhead_usd;
      cur.net_margin_pct = pct(cur.net_profit_usd, cur.revenue_usd);
      byMonth.set(m, cur);
    }

    const monthly = Array.from(byMonth.values())
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((m) => ({
        ...m,
        revenue_usd: round2(m.revenue_usd),
        actual_cogs_usd: round2(m.actual_cogs_usd),
        planned_cogs_usd: round2(m.planned_cogs_usd),
        effective_cogs_usd: round2(m.effective_cogs_usd),
        freight_usd: round2(m.freight_usd),
        other_expenses_usd: round2(m.other_expenses_usd),
        factory_overhead_usd: round2(m.factory_overhead_usd),
        net_profit_usd: round2(m.net_profit_usd),
        net_margin_pct: round2(m.net_margin_pct),
      }));

    const rank = (keyFn: any, nameFn: any) => {
      const map = new Map<string, any>();
      for (const r of rows) {
        const key = keyFn(r) || "UNKNOWN";
        const name = nameFn(r) || "UNKNOWN";
        const cur =
          map.get(key) || {
            key,
            name,
            revenue_usd: 0,
            net_profit_usd: 0,
            net_margin_pct: null,
          };
        cur.revenue_usd += num(r.revenue_usd);
        cur.net_profit_usd += num(r.net_profit_usd);
        cur.net_margin_pct = pct(cur.net_profit_usd, cur.revenue_usd);
        map.set(key, cur);
      }
      return Array.from(map.values())
        .map((x) => ({
          ...x,
          revenue_usd: round2(x.revenue_usd),
          net_profit_usd: round2(x.net_profit_usd),
          net_margin_pct: round2(x.net_margin_pct),
        }))
        .sort((a, b) => num(b.net_profit_usd) - num(a.net_profit_usd))
        .slice(0, 10);
    };

    const topBuyers = rank((r: ProfitRow) => r.buyer_id || r.buyer_name, (r: ProfitRow) => r.buyer_name);
    const topVendors = rank((r: ProfitRow) => r.vendor_id || r.vendor_name, (r: ProfitRow) => r.vendor_name);
    const topBrands = rank((r: ProfitRow) => r.brand_name, (r: ProfitRow) => r.brand_name);

    const buyerOptionsMap = new Map<string, { id: string; name: string }>();
    const vendorOptionsMap = new Map<string, { id: string; name: string }>();
    const siteOptionsMap = new Map<string, { id: string; name: string }>();

    for (const r of rows) {
      if (r.buyer_id || r.buyer_name) {
        buyerOptionsMap.set(r.buyer_id || r.buyer_name || "UNKNOWN", {
          id: r.buyer_id || r.buyer_name || "UNKNOWN",
          name: r.buyer_name || "UNKNOWN",
        });
      }
      if (r.vendor_id || r.vendor_name) {
        vendorOptionsMap.set(r.vendor_id || r.vendor_name || "UNKNOWN", {
          id: r.vendor_id || r.vendor_name || "UNKNOWN",
          name: r.vendor_name || "UNKNOWN",
        });
      }
      if (r.site_id || r.site_name) {
        siteOptionsMap.set(r.site_id || r.site_name || "UNKNOWN", {
          id: r.site_id || r.site_name || "UNKNOWN",
          name: r.site_name || "UNKNOWN",
        });
      }
    }

    return NextResponse.json(
      {
        ok: true,
        filters_echo: {
          preset,
          start,
          end,
          buyer_ids: buyerIds.length ? (buyerIds[0] === "ALL" ? "ALL" : buyerIds.join(",")) : "ALL",
          vendor_ids: vendorIds.length ? (vendorIds[0] === "ALL" ? "ALL" : vendorIds.join(",")) : "ALL",
          site_ids: siteIds.length ? (siteIds[0] === "ALL" ? "ALL" : siteIds.join(",")) : "ALL",
          q: q || "",
          limit,
        },
        kpis: {
          revenue_usd: revenueUsd,
          planned_cogs_usd: plannedCogsUsd,
          actual_cogs_usd: actualCogsUsd,
          effective_cogs_usd: effectiveCogsUsd,
          freight_usd: freightUsd,
          other_expenses_usd: otherExpensesUsd,
          factory_overhead_usd: factoryOverheadUsd,
          profit_usd: profitUsd,
          margin_pct: marginPct,
          net_profit_usd: netProfitUsd,
          net_margin_pct: netMarginPct,
          actual_coverage_pct: coveragePct,
          planned_fallback_revenue_usd: plannedFallbackRevenueUsd,
          row_count: rows.length,
        },
        monthly,
        topBuyers,
        topVendors,
        topBrands,
        options: {
          buyers: Array.from(buyerOptionsMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
          vendors: Array.from(vendorOptionsMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
          sites: Array.from(siteOptionsMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
        },
        rows,
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
