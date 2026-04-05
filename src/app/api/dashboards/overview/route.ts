import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../_supabase";

export const dynamic = "force-dynamic";

type Preset = "MTD" | "YTD" | "LAST_30" | "LAST_90" | "LAST_12_MONTHS" | "CUSTOM";

const SAFE_DATE = "1970-01-01";

function iso(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function addDaysISO(baseISO: string, deltaDays: number) {
  const d = new Date(baseISO + "T00:00:00");
  d.setDate(d.getDate() + deltaDays);
  return iso(d);
}

function pickTermDays(r: any): number | null {
  const candidates = [
    r?.payment_terms_days,
    r?.payment_term_days,
    r?.terms_days,
    r?.net_days,
    r?.net_terms_days,
    r?.due_days,
    r?.payment_terms,
  ];
  for (const v of candidates) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0 && n < 3660) return Math.floor(n);
  }
  return null;
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

function pickDate(row: any): string | null {
  return (
    row?.order_date ??
    row?.po_date ??
    row?.invoice_date ??
    row?.receipt_date ??
    row?.ship_date ??
    row?.req_ship_date ??
    row?.updated_at ??
    row?.created_at ??
    null
  );
}

function pickAmountUSD(row: any): number {
  const v =
    row?.subtotal ??
    row?.total_amount ??
    row?.grand_total ??
    row?.paid_amount ??
    row?.balance_amount ??
    row?.amount_usd ??
    row?.total_usd ??
    row?.total_amount_usd ??
    row?.grand_total_usd ??
    row?.balance_usd ??
    row?.net_received_usd ??
    row?.paid_usd ??
    row?.amount ??
    0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pickLineAmountUSD(row: any): number {
  const v =
    row?.amount_usd ??
    row?.line_amount_usd ??
    row?.line_total_usd ??
    row?.total_usd ??
    row?.total_amount_usd ??
    row?.subtotal_usd ??
    row?.fob_total_usd ??
    row?.offer_total_usd ??
    row?.amount ??
    row?.line_amount ??
    row?.line_total ??
    row?.total ??
    0;

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
  return row?.invoice_no ?? row?.invoiceNo ?? row?.no ?? null;
}

function pickBuyerId(row: any): string | null {
  return row?.buyer_id ?? row?.buyerId ?? row?.company_id ?? null;
}

function pickBuyerName(row: any): string | null {
  return row?.buyer_name ?? row?.buyerName ?? row?.company_name ?? null;
}

function pickBrand(row: any): string | null {
  return row?.buyer_brand_name ?? row?.brand ?? row?.buyer_brand ?? null;
}

function pickReqShipDate(row: any): string | null {
  return row?.req_ship_date ?? row?.required_ship_date ?? row?.ship_date ?? null;
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

function ymOf(dISO: string) {
  return dISO.slice(0, 7);
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

    const { start, end } = rangeFromPreset(
      preset,
      url.searchParams.get("start"),
      url.searchParams.get("end")
    );

    const supabase = createSupabaseServerClient();

    const [poRes, poLinesRes, invRes, shipRes, rchRes, rcaRes, sampleRes] = await Promise.all([
      supabase.from("po_headers").select("*"),
      supabase.from("po_lines").select("*"),
      supabase.from("invoice_headers").select("*"),
      supabase.from("shipments").select("*"),
      supabase.from("receipt_headers").select("*"),
      supabase.from("receipt_applications").select("*"),
      supabase.from("sample_requests").select("*"),
    ]);

    const pos = poRes.error ? [] : (poRes.data || []);
    const poLines = poLinesRes.error ? [] : (poLinesRes.data || []);
    const invoices = invRes.error ? [] : (invRes.data || []);
    const shipments = shipRes.error ? [] : (shipRes.data || []);
    const receiptHeaders = rchRes.error ? [] : (rchRes.data || []);
    const receiptApps = rcaRes.error ? [] : (rcaRes.data || []);
    const samples = sampleRes.error ? [] : (sampleRes.data || []);

    const pickReceiptId = (row: any): string | null => row?.id ?? row?.receipt_id ?? null;
    const pickReceiptHeaderIdFromApp = (row: any): string | null => row?.receipt_header_id ?? row?.receipt_id ?? row?.header_id ?? null;
    const pickInvoiceIdFromApp = (row: any): string | null => row?.invoice_id ?? row?.invoice_header_id ?? row?.inv_id ?? null;
    const pickAppliedUSD = (row: any): number => {
      const v = row?.applied_amount_usd ?? row?.applied_usd ?? row?.amount_usd ?? row?.amount ?? row?.applied_amount ?? 0;
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };

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
    const sampleDateOk = (row: any) => {
      const d = (row?.request_date ?? row?.created_at ?? row?.updated_at ?? "").slice?.(0, 10) || null;
      return inRangeISO(d, start, end);
    };
    const EXCLUDED_PO_HEADER_STATUSES = new Set(["DELETED", "CANCELLED", "CANCELED"]);
    const notDeleted = (row: any) =>
      row?.is_deleted !== true && !EXCLUDED_PO_HEADER_STATUSES.has(String(row?.status ?? "").toUpperCase());

    const posF = pos.filter(notDeleted).filter(buyerOk).filter(siteOk).filter(dateOk);
    const invF = invoices.filter(notDeleted).filter(buyerOk).filter(siteOk).filter(dateOk);
    const shipF = shipments.filter(notDeleted).filter(buyerOk).filter(siteOk).filter(dateOk);
    const sampleF = samples.filter(notDeleted).filter(buyerOk).filter(sampleDateOk);

    const rchF = receiptHeaders.filter(notDeleted).filter(buyerOk).filter(siteOk).filter(dateOk);
    const rchIdSet = new Set(rchF.map((r: any) => pickReceiptId(r)).filter(Boolean));
    const rcaF = receiptApps.filter(notDeleted).filter((r: any) => {
      const hid = pickReceiptHeaderIdFromApp(r);
      return !!hid && rchIdSet.has(hid);
    });

    const poHeaderIdSet = new Set(posF.map((h: any) => pickPoHeaderId(h)).filter(Boolean));
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

    const ordersUsd = posF.reduce((s, r) => s + amountForPoHeader(r), 0);
    const poCount = new Set(posF.map((r: any) => r.id ?? pickPoNo(r)).filter(Boolean)).size;

    const shipmentIds = new Set(shipF.map((r: any) => r?.id).filter(Boolean));
    const shippedInvoices = invoices
      .filter(notDeleted)
      .filter((r: any) => (shipmentIds.size ? shipmentIds.has(r?.shipment_id) : false));
    const shippedUsd = shippedInvoices.reduce((s: number, r: any) => s + pickAmountUSD(r), 0);
    const shipCount = shipmentIds.size;
    const shippedPoCount = new Set(shippedInvoices.map((r: any) => pickPoNo(r)).filter(Boolean)).size;

    const pendingOrdersUsd = Math.max((ordersUsd || 0) - (shippedUsd || 0), 0);
    const pendingPoCount = Math.max((poCount || 0) - (shippedPoCount || 0), 0);

    const invoicedUsd = invF.reduce((s, r) => s + pickAmountUSD(r), 0);
    const invCount = new Set(invF.map((r) => r.id ?? pickInvoiceNo(r)).filter(Boolean)).size;

    const appliedCollectedUsd = rcaF.reduce((s: number, r: any) => s + pickAppliedUSD(r), 0);
    const headerCollectedUsd = rchF.reduce((s: number, r: any) => s + pickAmountUSD(r), 0);
    const collectedUsd = appliedCollectedUsd > 0 ? appliedCollectedUsd : headerCollectedUsd;

    const rcpCount = new Set(rchF.map((r: any) => pickReceiptId(r)).filter(Boolean)).size;
    const arUsd = Math.max(0, invoicedUsd - collectedUsd);

    const today = iso(new Date());
    const sampleRows = sampleF.map((r: any) => {
      const result_status = normalizeSampleResult(r?.result_status);
      const progress_status = normalizeSampleProgress(r?.status ?? r?.progress_status, result_status);
      const alert_status = String(r?.alert_status || "").trim().toUpperCase() || computeSampleAlert(r, today);
      const request_date = (r?.request_date ?? r?.created_at ?? "").slice?.(0, 10) || null;
      const target_ship_date = (r?.target_ship_date ?? "").slice?.(0, 10) || null;
      const days_open = request_date
        ? Math.max(0, Math.floor((new Date(today).getTime() - new Date(request_date).getTime()) / 86400000))
        : 0;
      return {
        id: r?.id ?? null,
        request_no: r?.request_no ?? null,
        request_title: r?.request_title ?? null,
        buyer_name: r?.buyer_name ?? pickBuyerName(r),
        owner_name: r?.owner_name ?? null,
        request_date,
        target_ship_date,
        progress_status,
        result_status,
        alert_status,
        days_open,
      };
    });

    const sampleCount = sampleRows.length;
    const sampleWaitingFeedbackCount = sampleRows.filter((r) => r.alert_status === "WAITING_FEEDBACK" || r.alert_status === "FOLLOW_UP_DUE").length;
    const sampleOverdueCount = sampleRows.filter((r) => r.alert_status === "OVERDUE").length;

    const sample_overdue = sampleRows
      .filter((r) => r.alert_status === "OVERDUE")
      .sort((a, b) => (String(a.target_ship_date || "").localeCompare(String(b.target_ship_date || "")) || b.days_open - a.days_open))
      .slice(0, 100);

    const sample_waiting_feedback = sampleRows
      .filter((r) => r.alert_status === "WAITING_FEEDBACK" || r.alert_status === "FOLLOW_UP_DUE")
      .sort((a, b) => b.days_open - a.days_open)
      .slice(0, 100);

    const kpis = [
      { key: "orders", label: "Orders", value_usd: ordersUsd, delta_pct: null, sub_label: "POs", sub_value: String(poCount) },
      { key: "pending", label: "Pending Orders", value_usd: pendingOrdersUsd, delta_pct: null, sub_label: "POs", sub_value: String(pendingPoCount) },
      { key: "production", label: "In Production", value_usd: 0, delta_pct: null, sub_label: "Lines", sub_value: "0" },
      { key: "ready", label: "Ready", value_usd: 0, delta_pct: null, sub_label: "POs", sub_value: "0" },
      { key: "shipped", label: "Shipped", value_usd: shippedUsd, delta_pct: null, sub_label: "Shipments", sub_value: String(shipCount) },
      { key: "invoiced", label: "Invoiced", value_usd: invoicedUsd, delta_pct: null, sub_label: "Invoices", sub_value: String(invCount) },
      { key: "collected", label: "Collected", value_usd: collectedUsd, delta_pct: null, sub_label: "Receipts", sub_value: String(rcpCount) },
      { key: "ar", label: "AR Outstanding", value_usd: arUsd, delta_pct: null, sub_label: "Invoices", sub_value: String(invCount) },
      { key: "at_risk", label: "At Risk", value_usd: 0, delta_pct: null, sub_label: "POs", sub_value: "0" },
      { key: "sample_requests", label: "Sample Requests", value_usd: 0, delta_pct: null, sub_label: "Requests", sub_value: String(sampleCount) },
      { key: "sample_waiting_feedback", label: "Sample Waiting Feedback", value_usd: 0, delta_pct: null, sub_label: "Requests", sub_value: String(sampleWaitingFeedbackCount) },
      { key: "sample_overdue", label: "Sample Overdue", value_usd: 0, delta_pct: null, sub_label: "Requests", sub_value: String(sampleOverdueCount) },
    ];

    const monthSet = new Set<string>();
    const addMonths = (rows: any[]) => {
      for (const r of rows) {
        const d = pickDate(r);
        if (!d) continue;
        if (!inRangeISO(d, start, end)) continue;
        monthSet.add(ymOf(d));
      }
    };
    addMonths(posF);
    addMonths(shipF);
    addMonths(invF);
    addMonths(rchF);
    for (const r of sampleRows) {
      if (r.request_date && inRangeISO(r.request_date, start, end)) monthSet.add(ymOf(r.request_date));
    }

    const months = Array.from(monthSet).sort();

    const ordersM = (() => {
      const map = new Map<string, number>();
      for (const h of posF) {
        const d = pickDate(h);
        if (!d) continue;
        const ym = ymOf(d);
        map.set(ym, (map.get(ym) || 0) + amountForPoHeader(h));
      }
      return map;
    })();

    const byMonthHeaderAmount = (rows: any[]) => {
      const map = new Map<string, number>();
      for (const r of rows) {
        const d = pickDate(r);
        if (!d) continue;
        const ym = ymOf(d);
        map.set(ym, (map.get(ym) || 0) + pickAmountUSD(r));
      }
      return map;
    };

    const shippedM = byMonthHeaderAmount(shipF);
    const invoicedM = byMonthHeaderAmount(invF);

    const collectedM = (() => {
      const map = new Map<string, number>();
      if (rcaF.length) {
        const hdrById = new Map<string, any>();
        for (const h of rchF) {
          const hid = pickReceiptId(h);
          if (hid) hdrById.set(hid, h);
        }
        for (const a of rcaF) {
          const hid = pickReceiptHeaderIdFromApp(a);
          const h = hid ? hdrById.get(hid) : null;
          const d = h ? pickDate(h) : null;
          if (!d) continue;
          const ym = ymOf(d);
          map.set(ym, (map.get(ym) || 0) + pickAppliedUSD(a));
        }
      } else {
        for (const h of rchF) {
          const d = pickDate(h);
          if (!d) continue;
          const ym = ymOf(d);
          map.set(ym, (map.get(ym) || 0) + pickAmountUSD(h));
        }
      }
      return map;
    })();

    const sampleM = (() => {
      const map = new Map<string, number>();
      for (const r of sampleRows) {
        if (!r.request_date) continue;
        const ym = ymOf(r.request_date);
        map.set(ym, (map.get(ym) || 0) + 1);
      }
      return map;
    })();

    const points = months.map((ym) => ({
      ym,
      sample_requests: sampleM.get(ym) || 0,
      orders_usd: Number((ordersM.get(ym) || 0).toFixed(2)),
      shipped_usd: Number((shippedM.get(ym) || 0).toFixed(2)),
      invoiced_usd: Number((invoicedM.get(ym) || 0).toFixed(2)),
      collected_usd: Number((collectedM.get(ym) || 0).toFixed(2)),
    }));

    const trend = points.length ? [{ preset, start, end, points }] : [];

    const distMap = new Map<string, { status: string; count: number; amount_usd: number }>();
    for (const r of posF) {
      const st = pickStatus(r);
      const cur = distMap.get(st) || { status: st, count: 0, amount_usd: 0 };
      cur.count += 1;
      cur.amount_usd += amountForPoHeader(r);
      distMap.set(st, cur);
    }
    const status_dist = Array.from(distMap.values()).sort((a, b) => b.amount_usd - a.amount_usd);

    const at_risk = posF
      .map((r) => {
        const req = pickReqShipDate(r);
        const delay = req ? Math.max(0, Math.floor((new Date(today).getTime() - new Date(req).getTime()) / 86400000)) : 0;
        return {
          po_no: pickPoNo(r),
          buyer_name: pickBuyerName(r),
          brand: pickBrand(r),
          req_ship_date: req,
          delay_days: delay,
          amount_usd: Number(amountForPoHeader(r).toFixed(2)),
          stage: pickStatus(r),
        };
      })
      .filter((r) => !!r.po_no && !!r.req_ship_date && r.req_ship_date < today && r.amount_usd > 0)
      .sort((a, b) => (b.delay_days - a.delay_days) || (b.amount_usd - a.amount_usd))
      .slice(0, 200);

    const next_ship = posF
      .map((r) => ({
        req_ship_date: pickReqShipDate(r),
        po_no: pickPoNo(r),
        buyer_name: pickBuyerName(r),
        brand: pickBrand(r),
        amount_usd: Number(amountForPoHeader(r).toFixed(2)),
        ship_mode: pickShipMode(r),
      }))
      .filter((r) => !!r.po_no && !!r.req_ship_date && r.req_ship_date >= today)
      .sort((a, b) => String(a.req_ship_date).localeCompare(String(b.req_ship_date)))
      .slice(0, 200);

    const rchAll = receiptHeaders.filter(notDeleted).filter(buyerOk).filter(siteOk).filter((h: any) => {
      const d = pickDate(h);
      if (!d) return false;
      return d.slice(0, 10) <= end;
    });
    const rchAllIds = new Set(rchAll.map((h: any) => pickReceiptId(h)).filter(Boolean));
    const rcaAll = receiptApps.filter(notDeleted).filter((a: any) => {
      const hid = pickReceiptHeaderIdFromApp(a);
      return !!hid && rchAllIds.has(hid);
    });

    const appliedByInvoice = new Map<string, number>();
    for (const a of rcaAll) {
      const invId = pickInvoiceIdFromApp(a);
      if (!invId) continue;
      appliedByInvoice.set(invId, (appliedByInvoice.get(invId) || 0) + pickAppliedUSD(a));
    }

    const cash_watch = invF
      .map((r) => {
        const invId = r?.id ?? null;
        const invDate = (r?.invoice_date ?? r?.date ?? pickDate(r) ?? "").slice(0, 10) || null;
        const due = (r?.due_date ?? r?.invoice_due_date ?? null) as string | null;
        const termDays = pickTermDays(r);
        const dueISO = due ? due.slice(0, 10) : (invDate ? addDaysISO(invDate, termDays ?? 30) : null);
        const overdue = dueISO ? Math.max(0, Math.floor((new Date(today).getTime() - new Date(dueISO).getTime()) / 86400000)) : 0;
        const total = pickAmountUSD(r);
        const applied = invId ? (appliedByInvoice.get(invId) || 0) : 0;
        const explicitBal = Number(r?.balance_usd);
        const bal = Number.isFinite(explicitBal) && explicitBal >= 0 ? explicitBal : Math.max(0, total - applied);
        return {
          buyer_name: pickBuyerName(r),
          invoice_no: pickInvoiceNo(r),
          invoice_date: invDate,
          due_date: dueISO,
          overdue_days: overdue,
          balance_usd: Number(Number(bal || 0).toFixed(2)),
        };
      })
      .filter((r) => !!r.invoice_no && (r.balance_usd || 0) > 0)
      .sort((a, b) => (b.overdue_days - a.overdue_days) || (b.balance_usd - a.balance_usd))
      .slice(0, 200);

    return NextResponse.json({
      filters_echo: {
        preset,
        start,
        end,
        buyer_ids: buyerIds === "ALL" ? "ALL" : (buyerIds as string[]).join(","),
        site_ids: siteIds === "ALL" ? "ALL" : (siteIds as string[]).join(","),
      },
      kpis,
      trend,
      status_dist,
      sample_requests: sampleCount,
      sample_waiting_feedback: sampleWaitingFeedbackCount,
      sample_overdue: sampleOverdueCount,
      lists: {
        at_risk,
        next_ship,
        cash_watch,
        sample_overdue,
        sample_waiting_feedback,
      },
      meta: {
        source: "route-computed",
        missing_tables: {
          po_headers: !!poRes.error ? poRes.error.message : null,
          po_lines: !!poLinesRes.error ? poLinesRes.error.message : null,
          invoice_headers: !!invRes.error ? invRes.error.message : null,
          shipments: !!shipRes.error ? shipRes.error.message : null,
          receipt_headers: !!rchRes.error ? rchRes.error.message : null,
          receipt_applications: !!rcaRes.error ? rcaRes.error.message : null,
          sample_requests: !!sampleRes.error ? sampleRes.error.message : null,
        },
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || String(e), hint: e?.hint, details: e?.details, code: e?.code },
      { status: 500 }
    );
  }
}
