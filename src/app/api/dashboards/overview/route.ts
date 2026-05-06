import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type Preset = "MTD" | "YTD" | "LAST_30" | "LAST_90" | "LAST_12_MONTHS" | "CUSTOM";

const SAFE_DATE = "1970-01-01";

function iso(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function isoTodayKST() {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function addDaysISO(baseISO: string, deltaDays: number) {
  const d = new Date(baseISO + "T00:00:00");
  d.setDate(d.getDate() + deltaDays);
  return iso(d);
}

function monthStartISO(anyISO: string) {
  const d = new Date(anyISO + "T00:00:00");
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  return iso(first);
}

function yearStartISO(anyISO: string) {
  const d = new Date(anyISO + "T00:00:00");
  const first = new Date(d.getFullYear(), 0, 1);
  return iso(first);
}

function monthsAgoStartISO(anyISO: string, monthsAgo: number) {
  const d = new Date(anyISO + "T00:00:00");
  const firstThisMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  const target = new Date(firstThisMonth.getFullYear(), firstThisMonth.getMonth() - monthsAgo, 1);
  return iso(target);
}

function rangeFromPreset(preset: Preset, startParam: string | null, endParam: string | null) {
  const end = endParam && endParam.length >= 10 ? endParam.slice(0, 10) : iso(new Date());
  if (preset === "CUSTOM") {
    const start = startParam && startParam.length >= 10 ? startParam.slice(0, 10) : end;
    return { start, end };
  }
  if (preset === "MTD") return { start: monthStartISO(end), end };
  if (preset === "YTD") return { start: yearStartISO(end), end };
  if (preset === "LAST_30") return { start: addDaysISO(end, -29), end };
  if (preset === "LAST_90") return { start: addDaysISO(end, -89), end };
  if (preset === "LAST_12_MONTHS") return { start: monthsAgoStartISO(end, 11), end };
  return { start: SAFE_DATE, end };
}

function parseIds(raw: string | null): string[] | "ALL" {
  if (!raw) return "ALL";
  const t = String(raw).trim();
  if (!t || t.toUpperCase() === "ALL") return "ALL";
  const parts = t.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : "ALL";
}

function inRangeISO(dISO: string | null | undefined, start: string, end: string) {
  if (!dISO) return false;
  const d = dISO.slice(0, 10);
  return d >= start && d <= end;
}

function parseTermNumber(v: any): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v) && v > 0 && v < 3660) return Math.floor(v);
  const s = String(v).trim();
  if (!s) return null;
  const direct = Number(s);
  if (Number.isFinite(direct) && direct > 0 && direct < 3660) return Math.floor(direct);
  const m = s.match(/(\d{1,4})/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 && n < 3660 ? Math.floor(n) : null;
}

function pickTermDays(r: any): number | null {
  const candidates = [
    r?.payment_terms_days, r?.payment_term_days, r?.terms_days, r?.net_days,
    r?.net_terms_days, r?.due_days, r?.payment_terms, r?.payment_term,
  ];
  for (const v of candidates) {
    const n = parseTermNumber(v);
    if (n) return n;
  }
  return null;
}

function pickCompanyTermDays(r: any): number | null {
  const candidates = [
    r?.payment_terms_days, r?.payment_term_days, r?.terms_days, r?.net_days, r?.net_terms_days, r?.due_days,
    r?.default_payment_terms_days, r?.default_payment_term_days, r?.buyer_default_payment_terms_days, r?.buyer_default_payment_term_days,
    r?.payment_terms, r?.payment_term, r?.default_payment_terms, r?.default_payment_term,
    r?.buyer_payment_term, r?.buyer_payment_terms, r?.buyer_default_payment_term, r?.buyer_default_payment_terms,
    r?.terms, r?.default_terms, r?.payment_term_name, r?.payment_terms_name,
  ];
  for (const v of candidates) {
    const n = parseTermNumber(v);
    if (n) return n;
  }
  return null;
}

function normKey(v: any): string {
  return String(v ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

function pickDate(row: any): string | null {
  return row?.order_date ?? row?.po_date ?? row?.invoice_date ?? row?.receipt_date ?? row?.deposit_date ?? row?.ship_date ?? row?.req_ship_date ?? row?.updated_at ?? row?.created_at ?? null;
}

function pickAmountUSD(row: any): number {
  const v = row?.subtotal ?? row?.total_amount ?? row?.grand_total ?? row?.paid_amount ?? row?.balance_amount ?? row?.amount_usd ?? row?.total_usd ?? row?.total_amount_usd ?? row?.grand_total_usd ?? row?.balance_usd ?? row?.net_received_usd ?? row?.paid_usd ?? row?.amount ?? 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pickLineAmountUSD(row: any): number {
  const v = row?.amount_usd ?? row?.line_amount_usd ?? row?.line_total_usd ?? row?.total_usd ?? row?.total_amount_usd ?? row?.subtotal_usd ?? row?.fob_total_usd ?? row?.offer_total_usd ?? row?.amount ?? row?.line_amount ?? row?.line_total ?? row?.total ?? 0;
  const n = Number(v);
  if (Number.isFinite(n) && n !== 0) return n;
  const qty = Number(row?.qty ?? row?.quantity ?? row?.order_qty ?? row?.pcs ?? 0);
  const unit = Number(row?.unit_price ?? row?.price ?? row?.unit_price_usd ?? row?.price_usd ?? 0);
  if (Number.isFinite(qty) && Number.isFinite(unit) && qty > 0 && unit > 0) return qty * unit;
  return 0;
}

function pickStatus(row: any): string {
  return String(row?.status ?? row?.stage ?? row?.state ?? "UNKNOWN");
}

function pickPoNo(row: any): string | null {
  return row?.po_no ?? row?.poNo ?? row?.po_number ?? null;
}

function pickInvoiceNo(row: any): string | null {
  return row?.invoice_no ?? row?.invoiceNo ?? row?.invoice_number ?? row?.no ?? null;
}

function pickBuyerId(row: any): string | null {
  return row?.buyer_id ?? row?.buyerId ?? row?.company_id ?? null;
}

function pickBuyerName(row: any): string | null {
  return row?.buyer_name ?? row?.buyerName ?? row?.company_name ?? null;
}

function pickBuyerCode(row: any): string | null {
  return row?.buyer_code ?? row?.buyerCode ?? row?.company_code ?? row?.code ?? null;
}

function pickBrand(row: any): string | null {
  return row?.buyer_brand_name ?? row?.brand ?? row?.buyer_brand ?? null;
}

function pickReqShipDate(row: any): string | null {
  return row?.req_ship_date ?? row?.requested_ship_date ?? row?.required_ship_date ?? row?.ship_date ?? null;
}

function pickFulfillmentStatus(row: any): string {
  return String(row?.fulfillment_status ?? row?.status ?? "").trim().toUpperCase();
}

function isReadyWorkSheetStatus(v: any): boolean {
  return String(v ?? "").trim().toUpperCase() === "READY";
}

function isShipmentPending(row: any): boolean {
  const status = pickFulfillmentStatus(row);
  return !["SHIPPED", "CLOSED", "COMPLETED"].includes(status);
}

function pickShipMode(row: any): string | null {
  return row?.ship_mode ?? row?.shipping_mode ?? row?.mode ?? null;
}

function pickSiteId(row: any): string | null {
  return row?.ship_from_site_id ?? row?.site_id ?? row?.company_site_id ?? null;
}

function pickPoHeaderId(row: any): string | null {
  return row?.id ?? row?.po_header_id ?? row?.header_id ?? row?.po_id ?? null;
}

function pickPoHeaderIdFromLine(row: any): string | null {
  return row?.po_header_id ?? row?.header_id ?? row?.po_id ?? row?.poHeaderId ?? null;
}

function pickReceiptId(row: any): string | null {
  return row?.id ?? row?.receipt_id ?? row?.receipt_header_id ?? null;
}

function pickReceiptHeaderId(row: any): string | null {
  return row?.receipt_header_id ?? row?.receipt_id ?? row?.header_id ?? row?.receipt_header ?? null;
}

function pickInvoiceIdAny(row: any): string | null {
  return row?.invoice_id ?? row?.invoice_header_id ?? row?.inv_id ?? null;
}

function pickInvoiceNoAny(row: any): string | null {
  return row?.invoice_no ?? row?.invoice_number ?? row?.inv_no ?? null;
}

function pickAppliedUSD(row: any): number {
  const candidates = [row?.applied_amount_usd, row?.apply_amount_usd, row?.applied_usd, row?.amount_applied_usd, row?.amount_usd, row?.applied_amount, row?.apply_amount, row?.amount_applied, row?.amount];
  for (const v of candidates) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function pickWriteoffUSD(row: any): number {
  const candidates = [row?.writeoff_amount_usd, row?.writeoff_usd, row?.writeoff_amount, row?.amount_writeoff_usd, row?.amount_writeoff];
  for (const v of candidates) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function ymOf(dISO: string) {
  return dISO.slice(0, 7);
}

function normalizeSampleProgress(v: any, resultStatus?: any) {
  const s = String(v ?? "").trim().toUpperCase();
  const r = String(resultStatus ?? "").trim().toUpperCase();
  if (s === "CONVERTED_TO_ORDER" || s === "CLOSED_NO_ORDER") return "COMPLETED";
  if (r === "CONVERTED_TO_ORDER" || r === "CLOSED_NO_ORDER") return "COMPLETED";
  if (["IN_PROGRESS", "READY_TO_SEND", "APPROVED", "REJECTED", "WAITING_FEEDBACK", "FEEDBACK_RECEIVED", "REVISE_REQUIRED"].includes(s)) {
    if (["WAITING_FEEDBACK", "FEEDBACK_RECEIVED", "REVISE_REQUIRED"].includes(s)) return "FEEDBACK";
    if (["READY_TO_SEND", "APPROVED", "REJECTED"].includes(s)) return "SENT";
    return "DEVELOPING";
  }
  if (s === "SENT") return "SENT";
  if (s === "COMPLETED") return "COMPLETED";
  return "REQUESTED";
}

function normalizeSampleResult(v: any) {
  const s = String(v ?? "").trim().toUpperCase();
  if (!s) return "WAITING";
  if (s === "CONVERTED") return "CONVERTED_TO_ORDER";
  if (s === "CLOSED" || s === "NO_ORDER") return "CLOSED_NO_ORDER";
  return s;
}

function computeSampleAlert(row: any, today: string) {
  const resultStatus = normalizeSampleResult(row?.result_status);
  const progress = normalizeSampleProgress(row?.status ?? row?.progress_status, resultStatus);
  const targetShipDate = (row?.target_ship_date ?? "").slice?.(0, 10) || null;
  const sentDate = (row?.sent_date ?? "").slice?.(0, 10) || null;
  const feedbackDate = (row?.feedback_date ?? "").slice?.(0, 10) || null;
  const nextFollowUpDate = (row?.next_follow_up_date ?? "").slice?.(0, 10) || null;
  const converted = row?.is_converted_to_order === true || resultStatus === "CONVERTED_TO_ORDER";
  if (converted || resultStatus === "CLOSED_NO_ORDER" || progress === "COMPLETED") return "DONE";
  if (!sentDate) {
    if (!targetShipDate) return "ON_TRACK";
    if (targetShipDate < today) return "OVERDUE";
    const soon = addDaysISO(today, 2);
    return targetShipDate <= soon ? "DUE_SOON" : "ON_TRACK";
  }
  if (!feedbackDate) {
    if (nextFollowUpDate && nextFollowUpDate < today) return "FOLLOW_UP_DUE";
    return "WAITING_FEEDBACK";
  }
  return "ON_TRACK";
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const preset = (url.searchParams.get("preset") || "MTD") as Preset;
    const buyerIds = parseIds(url.searchParams.get("buyerIds") ?? url.searchParams.get("buyer_ids"));
    const siteIds = parseIds(url.searchParams.get("siteIds") ?? url.searchParams.get("site_ids"));
    const debug = url.searchParams.get("debug") === "1";
    const { start, end } = rangeFromPreset(preset, url.searchParams.get("start"), url.searchParams.get("end"));
    const supabase = supabaseAdmin;

    const [poRes, poLinesRes, wsLinesRes, wsHdrRes, invRes, shipRes, rchRes, rcaRes, rclRes, sampleRes, companiesRes] = await Promise.all([
      supabase.from("po_headers").select("*"),
      supabase.from("po_lines").select("*"),
      supabase.from("work_sheet_lines").select("po_line_id, work_sheet_id"),
      supabase.from("work_sheet_headers").select("id, status"),
      supabase.from("invoice_headers").select("*"),
      supabase.from("shipments").select("*"),
      supabase.from("receipt_headers").select("*"),
      supabase.from("receipt_applications").select("*"),
      supabase.from("receipt_lines").select("*"),
      supabase.from("sample_requests").select("*"),
      supabase.from("companies").select("*"),
    ]);

    const pos = poRes.error ? [] : (poRes.data || []);
    const poLines = poLinesRes.error ? [] : (poLinesRes.data || []);
    const workSheetLines = wsLinesRes.error ? [] : (wsLinesRes.data || []);
    const workSheetHeaders = wsHdrRes.error ? [] : (wsHdrRes.data || []);
    const invoices = invRes.error ? [] : (invRes.data || []);
    const shipments = shipRes.error ? [] : (shipRes.data || []);
    const receiptHeaders = rchRes.error ? [] : (rchRes.data || []);
    const receiptApps = rcaRes.error ? [] : (rcaRes.data || []);
    const receiptLines = rclRes.error ? [] : (rclRes.data || []);
    const samples = sampleRes.error ? [] : (sampleRes.data || []);
    const companies = companiesRes.error ? [] : (companiesRes.data || []);

    const EXCLUDED_STATUSES = new Set(["DELETED", "CANCELLED", "CANCELED"]);
    const notDeleted = (row: any) => row?.is_deleted !== true && !EXCLUDED_STATUSES.has(String(row?.status ?? "").toUpperCase());

    const buyerOk = (row: any) => {
      if (buyerIds === "ALL") return true;
      const id = pickBuyerId(row);
      return !!id && (buyerIds as string[]).includes(id);
    };
    const siteOk = (row: any) => {
      if (siteIds === "ALL") return true;
      const id = pickSiteId(row);
      return !!id && (siteIds as string[]).includes(id);
    };
    const dateOk = (row: any) => {
      const d = pickDate(row);
      return inRangeISO(d, start, end);
    };
    const asOfOk = (row: any) => {
      const d = pickDate(row);
      return !!d && d.slice(0, 10) <= end;
    };
    const sampleDateOk = (row: any) => {
      const d = (row?.request_date ?? row?.created_at ?? row?.updated_at ?? "").slice?.(0, 10) || null;
      return inRangeISO(d, start, end);
    };

    const posBaseF = pos.filter(notDeleted).filter(buyerOk).filter(siteOk);
    const posF = posBaseF.filter(dateOk);
    const invPeriodF = invoices.filter(notDeleted).filter(buyerOk).filter(siteOk).filter(dateOk);
    const invAsOfF = invoices.filter(notDeleted).filter(buyerOk).filter(siteOk).filter(asOfOk);
    const shipF = shipments.filter(notDeleted).filter(buyerOk).filter(siteOk).filter(dateOk);
    const sampleF = samples.filter(notDeleted).filter(buyerOk).filter(sampleDateOk);

    const rchF = receiptHeaders.filter(notDeleted).filter(buyerOk).filter(siteOk).filter(dateOk);
    const rchAsOfF = receiptHeaders.filter(notDeleted).filter(buyerOk).filter(siteOk).filter(asOfOk);

    const receiptHeaderIdsPeriod = new Set(rchF.map((r: any) => String(pickReceiptId(r) ?? "").trim()).filter(Boolean));
    const receiptHeaderIdsAsOf = new Set(rchAsOfF.map((r: any) => String(pickReceiptId(r) ?? "").trim()).filter(Boolean));

    const rcaF = receiptApps.filter(notDeleted).filter((r: any) => {
      const hid = String(pickReceiptHeaderId(r) ?? "").trim();
      return hid ? receiptHeaderIdsPeriod.has(hid) : false;
    });
    const rclF = receiptLines.filter(notDeleted).filter((r: any) => {
      const hid = String(pickReceiptHeaderId(r) ?? "").trim();
      if (hid) return receiptHeaderIdsPeriod.has(hid);
      const d = pickDate(r);
      return !!d && inRangeISO(d, start, end);
    });

    const rcaAsOfF = receiptApps.filter(notDeleted).filter((r: any) => {
      const hid = String(pickReceiptHeaderId(r) ?? "").trim();
      return hid ? receiptHeaderIdsAsOf.has(hid) : false;
    });
    const rclAsOfF = receiptLines.filter(notDeleted).filter((r: any) => {
      const hid = String(pickReceiptHeaderId(r) ?? "").trim();
      if (hid) return receiptHeaderIdsAsOf.has(hid);
      const d = pickDate(r);
      return !!d && d.slice(0, 10) <= end;
    });

    const poHeaderIdSet = new Set(posBaseF.map((h: any) => pickPoHeaderId(h)).filter(Boolean));
    const poLineSumByHeader = new Map<string, number>();
    for (const ln of poLines.filter(notDeleted)) {
      const hid = pickPoHeaderIdFromLine(ln);
      if (!hid) continue;
      if (poHeaderIdSet.size && !poHeaderIdSet.has(hid)) continue;
      const amt = pickLineAmountUSD(ln);
      if (!amt) continue;
      poLineSumByHeader.set(hid, (poLineSumByHeader.get(hid) || 0) + amt);
    }

    const amountForPoHeader = (h: any) => {
      const hid = pickPoHeaderId(h);
      return hid ? (poLineSumByHeader.get(hid) || 0) : 0;
    };

    const posById = new Map<string, any>();
    for (const h of pos.filter(notDeleted)) {
      const hid = pickPoHeaderId(h);
      if (hid) posById.set(hid, h);
    }

    const wsPoLineIdSet = new Set(
      workSheetLines
        .filter(notDeleted)
        .map((r: any) => String(r?.po_line_id ?? "").trim())
        .filter(Boolean)
    );
    const wsIdByPoLineId = new Map<string, string>();
    for (const row of workSheetLines.filter(notDeleted)) {
      const poLineId = String(row?.po_line_id ?? "").trim();
      const wsId = String(row?.work_sheet_id ?? "").trim();
      if (poLineId && wsId && !wsIdByPoLineId.has(poLineId)) {
        wsIdByPoLineId.set(poLineId, wsId);
      }
    }
    const wsStatusById = new Map<string, string>();
    for (const hdr of workSheetHeaders.filter(notDeleted)) {
      const wsId = String(hdr?.id ?? "").trim();
      if (!wsId) continue;
      wsStatusById.set(wsId, String(hdr?.status ?? "").trim().toUpperCase() || "DRAFT");
    }

    const productionRows = poLines
      .filter(notDeleted)
      .map((ln: any) => {
        const headerId = pickPoHeaderIdFromLine(ln);
        const header = headerId ? posById.get(headerId) : undefined;
        const scopeRow = header ?? ln;
        const poLineId = String(ln?.id ?? "").trim();
        const wsId = poLineId ? (wsIdByPoLineId.get(poLineId) ?? null) : null;
        const wsStatus = wsId ? (wsStatusById.get(wsId) ?? "DRAFT") : null;
        return {
          po_line_id: poLineId,
          po_no: pickPoNo(scopeRow),
          req_ship_date: pickReqShipDate(scopeRow),
          amount_usd: Number(pickLineAmountUSD(ln).toFixed(2)),
          fulfillment_status: pickFulfillmentStatus(scopeRow),
          scope_row: scopeRow,
          has_work_sheet: poLineId ? wsPoLineIdSet.has(poLineId) : false,
          work_sheet_status: wsStatus,
          ready_to_ship: isReadyWorkSheetStatus(wsStatus),
        };
      })
      .filter((row) =>
        row.has_work_sheet &&
        !!row.po_no &&
        !!row.req_ship_date &&
        buyerOk(row.scope_row) &&
        siteOk(row.scope_row) &&
        isShipmentPending({ fulfillment_status: row.fulfillment_status })
      );

    const readyRows = productionRows.filter((r) => r.ready_to_ship);
    const readyUsd = readyRows.reduce((sum, row) => sum + Number(row.amount_usd || 0), 0);
    const readyPoCount = new Set(readyRows.map((r) => r.po_no).filter(Boolean)).size;

    const scheduleRows = posBaseF
      .filter((r: any) => {
        const reqShipDate = pickReqShipDate(r);
        return !!pickPoNo(r) && !!reqShipDate && isShipmentPending(r);
      })
      .map((r: any) => {
        return {
          po_no: pickPoNo(r),
          buyer_name: pickBuyerName(r),
          brand: pickBrand(r),
          req_ship_date: pickReqShipDate(r),
          ship_mode: pickShipMode(r),
          amount_usd: Number(amountForPoHeader(r).toFixed(2)),
          stage: pickFulfillmentStatus(r) || null,
        };
      });

    const today = isoTodayKST();
    const nextShipEnd = addDaysISO(today, 7);

    const today_ship = scheduleRows
      .filter((r) => inRangeISO(r.req_ship_date, today, today))
      .sort((a, b) => String(a.req_ship_date).localeCompare(String(b.req_ship_date)) || String(a.po_no).localeCompare(String(b.po_no)))
      .slice(0, 100);

    const next_ship = scheduleRows
      .filter((r) => inRangeISO(r.req_ship_date, today, nextShipEnd))
      .sort((a, b) => String(a.req_ship_date).localeCompare(String(b.req_ship_date)) || String(a.po_no).localeCompare(String(b.po_no)))
      .slice(0, 100);

    const at_risk = scheduleRows
      .filter((r) => !!r.req_ship_date && String(r.req_ship_date) < end)
      .map((r) => ({
        ...r,
        delay_days: Math.max(
          1,
          Math.floor(
            (new Date(`${end}T00:00:00`).getTime() - new Date(`${String(r.req_ship_date).slice(0, 10)}T00:00:00`).getTime()) / 86400000
          )
        ),
      }))
      .sort((a, b) => (b.delay_days - a.delay_days) || String(a.req_ship_date).localeCompare(String(b.req_ship_date)))
      .slice(0, 100);

    const atRiskUsd = at_risk.reduce((sum, row) => sum + Number(row.amount_usd || 0), 0);

    const ordersUsd = posF.reduce((s, r) => s + amountForPoHeader(r), 0);
    const poCount = new Set(posF.map((r: any) => r.id ?? pickPoNo(r)).filter(Boolean)).size;

    const shipmentIds = new Set(shipF.map((r: any) => r?.id).filter(Boolean));
    const shippedInvoices = invoices.filter(notDeleted).filter((r: any) => (shipmentIds.size ? shipmentIds.has(r?.shipment_id) : false));
    const shippedUsd = shippedInvoices.reduce((s: number, r: any) => s + pickAmountUSD(r), 0);
    const shipCount = shipmentIds.size;
    const shippedPoCount = new Set(shippedInvoices.map((r: any) => pickPoNo(r)).filter(Boolean)).size;

    const pendingOrderRows = posBaseF.filter((r: any) => {
      const total = amountForPoHeader(r);
      return total > 0.0001 && isShipmentPending(r);
    });
    const pendingOrdersUsd = pendingOrderRows.reduce((sum, row) => sum + amountForPoHeader(row), 0);
    const pendingPoCount = new Set(pendingOrderRows.map((r: any) => pickPoHeaderId(r) ?? pickPoNo(r)).filter(Boolean)).size;

    const productionRowsActive = productionRows.filter((r) => !r.ready_to_ship);
    const productionUsd = productionRowsActive.reduce((sum, row) => sum + Number(row.amount_usd || 0), 0);
    const productionLineCount = productionRowsActive.length;

    const invoicedUsd = invPeriodF.reduce((s, r) => s + pickAmountUSD(r), 0);
    const invCount = new Set(invPeriodF.map((r: any) => r.id ?? pickInvoiceNo(r)).filter(Boolean)).size;

    const appliedCollectedUsd = rcaF.reduce((s: number, r: any) => s + pickAppliedUSD(r), 0) + rclF.reduce((s: number, r: any) => s + pickAppliedUSD(r), 0);
    const headerCollectedUsd = rchF.reduce((s: number, r: any) => s + pickAmountUSD(r), 0);
    const collectedUsd = appliedCollectedUsd > 0 ? appliedCollectedUsd : headerCollectedUsd;
    const rcpCount = new Set(rchF.map((r: any) => pickReceiptId(r)).filter(Boolean)).size;

    const companyTermById = new Map<string, number>();
    const companyTermByName = new Map<string, number>();
    const companyTermByCode = new Map<string, number>();
    for (const c of companies.filter(notDeleted)) {
      const term = pickCompanyTermDays(c);
      if (!term) continue;
      const idKey = normKey(c?.id);
      const nameKey = normKey(c?.company_name ?? c?.name ?? c?.buyer_name);
      const codeKey = normKey(c?.code ?? c?.company_code ?? c?.buyer_code);
      if (idKey) companyTermById.set(idKey, term);
      if (nameKey) companyTermByName.set(nameKey, term);
      if (codeKey) companyTermByCode.set(codeKey, term);
    }

    const resolveInvoiceTermDays = (inv: any): number => {
      const direct = pickTermDays(inv);
      if (direct) return direct;
      const buyerIdKey = normKey(inv?.buyer_id ?? inv?.company_id);
      if (buyerIdKey && companyTermById.has(buyerIdKey)) return companyTermById.get(buyerIdKey)!;
      const buyerNameKey = normKey(inv?.buyer_name ?? inv?.company_name);
      if (buyerNameKey && companyTermByName.has(buyerNameKey)) return companyTermByName.get(buyerNameKey)!;
      const buyerCodeKey = normKey(inv?.buyer_code ?? inv?.company_code);
      if (buyerCodeKey && companyTermByCode.has(buyerCodeKey)) return companyTermByCode.get(buyerCodeKey)!;
      return 30;
    };

    const appliedByInvoiceIdAsOf = new Map<string, number>();
    const appliedByInvoiceNoAsOf = new Map<string, number>();
    const settledByInvoiceIdAsOf = new Map<string, number>();
    const settledByInvoiceNoAsOf = new Map<string, number>();
    const addAppliedAsOf = (row: any) => {
      const amt = pickAppliedUSD(row);
      const writeoff = pickWriteoffUSD(row);
      const invId = String(pickInvoiceIdAny(row) ?? "").trim();
      const invNo = String(pickInvoiceNoAny(row) ?? "").trim();
      if (amt > 0) {
        if (invId) appliedByInvoiceIdAsOf.set(invId, (appliedByInvoiceIdAsOf.get(invId) || 0) + amt);
        if (invNo) appliedByInvoiceNoAsOf.set(invNo, (appliedByInvoiceNoAsOf.get(invNo) || 0) + amt);
      }
      if (writeoff > 0) {
        if (invId) settledByInvoiceIdAsOf.set(invId, (settledByInvoiceIdAsOf.get(invId) || 0) + writeoff);
        if (invNo) settledByInvoiceNoAsOf.set(invNo, (settledByInvoiceNoAsOf.get(invNo) || 0) + writeoff);
      }
    };
    rcaAsOfF.forEach(addAppliedAsOf);
    rclAsOfF.forEach(addAppliedAsOf);

    const receiptHeaderByIdAsOf = new Map<string, any>();
    for (const h of rchAsOfF) {
      const hid = String(pickReceiptId(h) ?? "").trim();
      if (hid) receiptHeaderByIdAsOf.set(hid, h);
    }

    const receiptLinesByHeaderIdAsOf = new Map<string, any[]>();
    for (const row of rclAsOfF) {
      const hid = String(pickReceiptHeaderId(row) ?? "").trim();
      if (!hid) continue;
      const arr = receiptLinesByHeaderIdAsOf.get(hid) || [];
      arr.push(row);
      receiptLinesByHeaderIdAsOf.set(hid, arr);
    }

    for (const [headerId, rows] of receiptLinesByHeaderIdAsOf.entries()) {
      const header = receiptHeaderByIdAsOf.get(headerId);
      if (!header) continue;
      const totalAppliedForHeader = rows.reduce((sum, row) => sum + pickAppliedUSD(row), 0);
      if (totalAppliedForHeader <= 0) continue;

      for (const row of rows) {
        const applied = pickAppliedUSD(row);
        if (applied <= 0) continue;

        const ratio = applied / totalAppliedForHeader;
        const settledExtra =
          ratio * Number(header?.bank_fee_amount || 0) +
          ratio * (Number(header?.buyer_bank_fee_amount || 0) + Number(header?.buyer_wire_fee_writeoff_amount || 0)) +
          ratio * Number(header?.claim_deduction_amount || 0);

        if (settledExtra <= 0) continue;

        const invId = String(pickInvoiceIdAny(row) ?? "").trim();
        const invNo = String(pickInvoiceNoAny(row) ?? "").trim();
        if (invId) settledByInvoiceIdAsOf.set(invId, (settledByInvoiceIdAsOf.get(invId) || 0) + settledExtra);
        if (invNo) settledByInvoiceNoAsOf.set(invNo, (settledByInvoiceNoAsOf.get(invNo) || 0) + settledExtra);
      }
    }

    const arRows = invAsOfF.map((r: any) => {
      const invId = String(r?.id ?? "").trim();
      const invNo = String(pickInvoiceNo(r) ?? "").trim();
      const invDate = (r?.invoice_date ?? r?.date ?? pickDate(r) ?? "").slice(0, 10) || null;
      const due = (r?.due_date ?? r?.invoice_due_date ?? null) as string | null;
      const termDays = resolveInvoiceTermDays(r);
      const dueISO = due ? due.slice(0, 10) : (invDate ? addDaysISO(invDate, termDays) : null);
      const overdue = dueISO ? Math.floor((new Date(end).getTime() - new Date(dueISO).getTime()) / 86400000) : 0;
      const total = pickAmountUSD(r);
      const explicitBalance = Number(r?.balance_amount ?? r?.balance_usd);
      const explicitPaid = Number(r?.paid_amount);
      const applied = Math.max(invId ? (appliedByInvoiceIdAsOf.get(invId) || 0) : 0, invNo ? (appliedByInvoiceNoAsOf.get(invNo) || 0) : 0, Number.isFinite(explicitPaid) ? explicitPaid : 0);
      const settled = applied + Math.max(invId ? (settledByInvoiceIdAsOf.get(invId) || 0) : 0, invNo ? (settledByInvoiceNoAsOf.get(invNo) || 0) : 0);
      const fallbackBalance = Math.max(0, total - settled);
      const hasComputedSettlement = settled > 0.0001;
      const balance =
        hasComputedSettlement
          ? fallbackBalance
          : Number.isFinite(explicitBalance) && explicitBalance > 0
            ? explicitBalance
            : fallbackBalance;
      return {
        buyer_name: pickBuyerName(r),
        buyer_id: pickBuyerId(r),
        buyer_code: pickBuyerCode(r),
        brand: pickBrand(r),
        invoice_id: invId || null,
        invoice_no: invNo,
        invoice_date: invDate,
        due_date: dueISO,
        overdue_days: overdue,
        balance_usd: Number(balance.toFixed(2)),
      };
    }).filter((r: any) => !!r.invoice_no && (r.balance_usd || 0) > 0.0001);

    const arUsd = arRows.reduce((s, r) => s + r.balance_usd, 0);
    const arInvCount = new Set(arRows.map((r) => r.invoice_id || r.invoice_no).filter(Boolean)).size;

    const sampleRows = sampleF.map((r: any) => {
      const result_status = normalizeSampleResult(r?.result_status);
      const progress_status = normalizeSampleProgress(r?.status ?? r?.progress_status, result_status);
      const alert_status = String(r?.alert_status || "").trim().toUpperCase() || computeSampleAlert(r, today);
      const request_date = (r?.request_date ?? r?.created_at ?? "").slice?.(0, 10) || null;
      const target_ship_date = (r?.target_ship_date ?? "").slice?.(0, 10) || null;
      const days_open = request_date ? Math.max(0, Math.floor((new Date(today).getTime() - new Date(request_date).getTime()) / 86400000)) : 0;
      return { id: r?.id ?? null, request_no: r?.request_no ?? null, request_title: r?.request_title ?? null, buyer_name: r?.buyer_name ?? pickBuyerName(r), owner_name: r?.owner_name ?? null, request_date, target_ship_date, progress_status, result_status, alert_status, days_open };
    });

    const sampleCount = sampleRows.length;
    const sampleWaitingFeedbackCount = sampleRows.filter((r) => r.alert_status === "WAITING_FEEDBACK" || r.alert_status === "FOLLOW_UP_DUE").length;
    const sampleOverdueCount = sampleRows.filter((r) => r.alert_status === "OVERDUE").length;
    const sample_overdue = sampleRows.filter((r) => r.alert_status === "OVERDUE").sort((a, b) => (String(a.target_ship_date || "").localeCompare(String(b.target_ship_date || "")) || b.days_open - a.days_open)).slice(0, 100);
    const sample_waiting_feedback = sampleRows.filter((r) => r.alert_status === "WAITING_FEEDBACK" || r.alert_status === "FOLLOW_UP_DUE").sort((a, b) => b.days_open - a.days_open).slice(0, 100);

    const kpis = [
      { key: "orders", label: "Orders", value_usd: ordersUsd, delta_pct: null, sub_label: "POs", sub_value: String(poCount) },
      { key: "pending", label: "Pending Orders", value_usd: pendingOrdersUsd, delta_pct: null, sub_label: "POs", sub_value: String(pendingPoCount) },
      { key: "production", label: "In Production", value_usd: productionUsd, delta_pct: null, sub_label: "Lines", sub_value: String(productionLineCount) },
      { key: "ready", label: "Ready", value_usd: readyUsd, delta_pct: null, sub_label: "POs", sub_value: String(readyPoCount) },
      { key: "shipped", label: "Shipped", value_usd: shippedUsd, delta_pct: null, sub_label: "Shipments", sub_value: String(shipCount) },
      { key: "invoiced", label: "Invoiced", value_usd: invoicedUsd, delta_pct: null, sub_label: "Invoices", sub_value: String(invCount) },
      { key: "collected", label: "Collected", value_usd: collectedUsd, delta_pct: null, sub_label: "Receipts", sub_value: String(rcpCount) },
      { key: "ar", label: "AR Outstanding", value_usd: arUsd, delta_pct: null, sub_label: "Invoices", sub_value: String(arInvCount) },
      { key: "at_risk", label: "At Risk", value_usd: atRiskUsd, delta_pct: null, sub_label: "POs", sub_value: String(at_risk.length) },
      { key: "sample_requests", label: "Sample Requests", value_usd: 0, delta_pct: null, sub_label: "Requests", sub_value: String(sampleCount) },
      { key: "sample_waiting_feedback", label: "Sample Waiting Feedback", value_usd: 0, delta_pct: null, sub_label: "Requests", sub_value: String(sampleWaitingFeedbackCount) },
      { key: "sample_overdue", label: "Sample Overdue", value_usd: 0, delta_pct: null, sub_label: "Requests", sub_value: String(sampleOverdueCount) },
    ];

    const trendMap = new Map<string, { as_of: string; orders_usd: number; shipped_usd: number; invoiced_usd: number; collected_usd: number }>();
    const ensureTrend = (ym: string) => {
      if (!trendMap.has(ym)) trendMap.set(ym, { as_of: `${ym}-01`, orders_usd: 0, shipped_usd: 0, invoiced_usd: 0, collected_usd: 0 });
      return trendMap.get(ym)!;
    };
    for (const r of posF) {
      const d = pickDate(r);
      if (!d) continue;
      ensureTrend(ymOf(d)).orders_usd += amountForPoHeader(r);
    }
    for (const r of shippedInvoices.filter((x: any) => dateOk(x)).filter(buyerOk).filter(siteOk)) {
      const d = (r?.invoice_date ?? r?.date ?? "").slice(0, 10);
      if (!d) continue;
      ensureTrend(ymOf(d)).shipped_usd += pickAmountUSD(r);
    }
    for (const r of invPeriodF) {
      const d = (r?.invoice_date ?? r?.date ?? "").slice(0, 10);
      if (!d) continue;
      ensureTrend(ymOf(d)).invoiced_usd += pickAmountUSD(r);
    }
    for (const r of rchF) {
      const d = (pickDate(r) ?? "").slice(0, 10);
      if (!d) continue;
      ensureTrend(ymOf(d)).collected_usd += pickAmountUSD(r);
    }

    const trend = Array.from(trendMap.values()).sort((a, b) => a.as_of.localeCompare(b.as_of)).map((r) => ({
      as_of: r.as_of,
      orders_usd: Number(r.orders_usd.toFixed(2)),
      shipped_usd: Number(r.shipped_usd.toFixed(2)),
      invoiced_usd: Number(r.invoiced_usd.toFixed(2)),
      collected_usd: Number(r.collected_usd.toFixed(2)),
    }));

    const statusMap = new Map<string, { status: string; amount_usd: number; count: number }>();
    for (const r of posF) {
      const st = pickStatus(r).toUpperCase();
      const cur = statusMap.get(st) || { status: st, amount_usd: 0, count: 0 };
      cur.amount_usd += amountForPoHeader(r);
      cur.count += 1;
      statusMap.set(st, cur);
    }
    const status_dist = Array.from(statusMap.values()).map((r) => ({ status: r.status, amount_usd: Number(r.amount_usd.toFixed(2)), count: r.count })).sort((a, b) => b.amount_usd - a.amount_usd);

    const cash_watch = arRows.sort((a, b) => (b.overdue_days - a.overdue_days) || (b.balance_usd - a.balance_usd)).slice(0, 200);

    return NextResponse.json({
      filters_echo: {
        preset, start, end,
        buyer_ids: buyerIds === "ALL" ? "ALL" : (buyerIds as string[]).join(","),
        site_ids: siteIds === "ALL" ? "ALL" : (siteIds as string[]).join(","),
      },
      kpis, trend, status_dist,
      sample_requests: sampleCount,
      sample_waiting_feedback: sampleWaitingFeedbackCount,
      sample_overdue: sampleOverdueCount,
      lists: { at_risk, today_ship, next_ship, cash_watch, sample_overdue, sample_waiting_feedback },
      meta: {
        source: "route-computed-ar-unified-asof-v2",
        debug_counts: debug ? {
          po_headers_total: pos.length,
          po_headers_scope: posBaseF.length,
          work_sheet_lines_total: workSheetLines.length,
          production_rows_scope: productionRows.length,
          production_rows_active: productionRowsActive.length,
          ready_rows_window: readyRows.length,
          today_ship_count: today_ship.length,
          next_ship_count: next_ship.length,
          at_risk_count: at_risk.length,
          invoices_period: invPeriodF.length,
          invoices_asof: invAsOfF.length,
          open_ar_rows: arRows.length,
          receipt_headers_period: rchF.length,
          receipt_headers_asof: rchAsOfF.length,
          receipt_apps_asof: rcaAsOfF.length,
          receipt_lines_asof: rclAsOfF.length,
        } : undefined,
        missing_tables: {
          po_headers: poRes.error ? poRes.error.message : null,
          po_lines: poLinesRes.error ? poLinesRes.error.message : null,
          work_sheet_lines: wsLinesRes.error ? wsLinesRes.error.message : null,
          invoice_headers: invRes.error ? invRes.error.message : null,
          shipments: shipRes.error ? shipRes.error.message : null,
          receipt_headers: rchRes.error ? rchRes.error.message : null,
          receipt_applications: rcaRes.error ? rcaRes.error.message : null,
          receipt_lines: rclRes.error ? rclRes.error.message : null,
          sample_requests: sampleRes.error ? sampleRes.error.message : null,
          companies: companiesRes.error ? companiesRes.error.message : null,
        },
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e), hint: e?.hint, details: e?.details, code: e?.code }, { status: 500 });
  }
}
