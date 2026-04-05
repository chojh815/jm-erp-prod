import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, {
    ...init,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      ...(init?.headers || {}),
    },
  });
}

function ok(data: any = {}) {
  return json({ ok: true, ...data });
}

function bad(message: string, status = 400, extra?: any) {
  return json({ ok: false, error: message, ...(extra ?? {}) }, { status });
}

function asText(v: any) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function asNum(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function asBool(v: any, fallback = false) {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(s)) return true;
    if (["false", "0", "no", "n"].includes(s)) return false;
  }
  return fallback;
}

function asDate(v: any): string | null {
  const s = asText(v);
  if (!s) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function asJsonArray(v: any) {
  if (Array.isArray(v)) return v;
  if (!v) return [];
  if (typeof v === "string") {
    try {
      const j = JSON.parse(v);
      return Array.isArray(j) ? j : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeBuyerCode(v: any) {
  const s = asText(v).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s || "GEN";
}

function yymmdd(dateText?: string | null) {
  const d = asDate(dateText) || new Date().toISOString().slice(0, 10);
  return `${d.slice(2, 4)}${d.slice(5, 7)}${d.slice(8, 10)}`;
}

function seqFromValue(v: any) {
  const raw = asText(v);
  const seq = Number(raw.split("-").pop() || 0);
  return Number.isFinite(seq) ? seq : 0;
}

function isDuplicateKeyError(error: any, keyName?: string) {
  const text = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""} ${error?.code || ""}`.toLowerCase();
  if (!text) return false;
  if (keyName) return text.includes("duplicate key") && text.includes(keyName.toLowerCase());
  return text.includes("duplicate key") || text.includes("23505");
}

async function generateNo(field: "request_no" | "temp_style_no", buyerCodeRaw: any, requestDate?: string | null) {
  const buyerCode = normalizeBuyerCode(buyerCodeRaw);
  const prefix = `${field === "request_no" ? "SR" : "TMP"}-${buyerCode}-${yymmdd(requestDate)}-`;

  const { data, error } = await supabaseAdmin
    .from("sample_requests")
    .select(field)
    .eq("is_deleted", false)
    .ilike(field, `${prefix}%`);

  if (error) throw error;

  let maxSeq = 0;
  for (const row of data || []) {
    const seq = seqFromValue((row as any)?.[field]);
    if (seq > maxSeq) maxSeq = seq;
  }
  return `${prefix}${String(maxSeq + 1).padStart(3, "0")}`;
}

async function generateFreshNumbers(buyerCodeRaw: any, requestDate?: string | null) {
  const request_no = await generateNo("request_no", buyerCodeRaw, requestDate);
  const temp_style_no = await generateNo("temp_style_no", buyerCodeRaw, requestDate);
  return { request_no, temp_style_no };
}

function computeAlertStatus(row: any) {
  const today = new Date().toISOString().slice(0, 10);
  const resultStatus = asText(row?.result_status).toUpperCase();
  const status = asText(row?.status).toUpperCase();
  const targetShipDate = asDate(row?.target_ship_date);
  const sentDate = asDate(row?.sent_date);
  const feedbackDate = asDate(row?.feedback_date);
  const nextFollowUpDate = asDate(row?.next_follow_up_date);
  const converted = asBool(row?.is_converted_to_order, false);

  if (converted || resultStatus === "CONVERTED_TO_ORDER") return "DONE";
  if (["REJECTED", "CLOSED_NO_ORDER", "CLOSED NO ORDER"].includes(resultStatus)) return "DONE";

  if (!sentDate) {
    if (!targetShipDate) return "ON_TRACK";
    if (targetShipDate < today) return "OVERDUE";
    const soon = new Date(today);
    soon.setDate(soon.getDate() + 2);
    return targetShipDate <= soon.toISOString().slice(0, 10) ? "DUE_SOON" : "ON_TRACK";
  }

  if (!feedbackDate) {
    if (nextFollowUpDate && nextFollowUpDate < today) return "FOLLOW_UP_DUE";
    return "WAITING_FEEDBACK";
  }

  return "ON_TRACK";
}

function normalizeProgressStatus(v: any, resultStatus?: any) {
  const s = asText(v).toUpperCase();
  const result = asText(resultStatus).toUpperCase();
  if (s === "CONVERTED_TO_ORDER" || s === "CLOSED_NO_ORDER") return "COMPLETED";
  if (result === "CONVERTED_TO_ORDER" || result === "CLOSED_NO_ORDER") return "COMPLETED";
  return s || "REQUESTED";
}

function normalizeResultStatus(v: any) {
  const s = asText(v).toUpperCase();
  if (!s || s === "CONVERTED") return s === "CONVERTED" ? "CONVERTED_TO_ORDER" : "WAITING";
  if (s === "CLOSED" || s === "NO_ORDER") return "CLOSED_NO_ORDER";
  return s;
}

function normalizeRow(r: any) {
  const requestDate = asDate(r.request_date);
  const sentDate = asDate(r.sent_date);
  const feedbackDate = asDate(r.feedback_date);
  const today = new Date().toISOString().slice(0, 10);
  const result_status = normalizeResultStatus(r.result_status);
  const progress_status = normalizeProgressStatus(r.status || r.progress_status, result_status);
  const alertStatus = asText(r.alert_status) || computeAlertStatus({ ...r, result_status, status: progress_status });

  return {
    ...r,
    progress_status,
    result_status,
    our_owner_name: asText(r.owner_name) || asText(r.our_owner_name),
    our_owner_email: asText(r.owner_email) || asText(r.our_owner_email),
    requested_items_text: asText(r.progress_note) || asText(r.requested_items_text),
    alert_status: alertStatus,
    days_open: requestDate ? Math.max(0, Math.floor((new Date(today).getTime() - new Date(requestDate).getTime()) / 86400000)) : 0,
    days_after_sent: sentDate ? Math.max(0, Math.floor((new Date(today).getTime() - new Date(sentDate).getTime()) / 86400000)) : null,
    days_waiting_feedback: sentDate && !feedbackDate ? Math.max(0, Math.floor((new Date(today).getTime() - new Date(sentDate).getTime()) / 86400000)) : null,
    attachments: asJsonArray(r.attachments),
    reference_images: asJsonArray(r.reference_images),
    shipment_proof_files: asJsonArray(r.shipment_proof_files),
  };
}

function buildPayload(body: any) {
  let result_status = normalizeResultStatus(body.result_status);
  let status = normalizeProgressStatus(body.progress_status || body.status, result_status);

  if (result_status === "CONVERTED_TO_ORDER" || result_status === "CLOSED_NO_ORDER") {
    status = "COMPLETED";
  }
  if (status !== "COMPLETED" && (result_status === "CONVERTED_TO_ORDER" || result_status === "CLOSED_NO_ORDER")) {
    result_status = "WAITING";
  }

  const isConverted = asBool(body.is_converted_to_order, false) || result_status === "CONVERTED_TO_ORDER";

  return {
    request_title: asText(body.request_title) || null,
    request_no: asText(body.request_no) || undefined,
    temp_style_no: asText(body.temp_style_no) || undefined,
    buyer_style_no: asText(body.buyer_style_no) || null,
    sample_type: asText(body.sample_type) || "New Sample",
    priority: asText(body.priority) || "Normal",

    buyer_id: asText(body.buyer_id) || null,
    buyer_code: normalizeBuyerCode(body.buyer_code || body.buyerCode || body.buyer_name),
    buyer_name: asText(body.buyer_name) || null,
    buyer_contact_name: asText(body.buyer_contact_name) || null,
    buyer_contact_email: asText(body.buyer_contact_email) || null,
    buyer_contact_phone: asText(body.buyer_contact_phone) || null,

    owner_id: asText(body.owner_id) || null,
    owner_name: asText(body.our_owner_name || body.owner_name) || null,
    owner_email: asText(body.our_owner_email || body.owner_email) || null,
    current_owner: asText(body.current_owner || body.our_owner_name || body.owner_name) || null,
    current_step: asText(body.current_step) || "Requested",

    request_date: asDate(body.request_date) || new Date().toISOString().slice(0, 10),
    due_date: asDate(body.due_date),
    target_ship_date: asDate(body.target_ship_date),
    sent_date: asDate(body.sent_date),
    feedback_date: asDate(body.feedback_date),
    next_follow_up_date: asDate(body.next_follow_up_date),
    converted_date: asDate(body.converted_date),

    status,
    result_status,
    progress_note: asText(body.progress_note || body.requested_items_text) || null,
    buyer_feedback: asText(body.buyer_feedback) || null,
    buyer_additional_request: asText(body.buyer_additional_request) || null,
    internal_note: asText(body.internal_note) || null,
    buyer_note: asText(body.buyer_note) || null,

    sample_qty: asNum(body.sample_qty, 1),
    sample_unit: asText(body.sample_unit) || "pcs",

    carrier: asText(body.carrier) || null,
    tracking_no: asText(body.tracking_no) || null,
    shipping_cost: asNum(body.shipping_cost, 0),
    ship_to_country: asText(body.ship_to_country) || null,
    ship_to_address_summary: asText(body.ship_to_address_summary) || null,

    development_cost_material: asNum(body.development_cost_material, 0),
    development_cost_labor: asNum(body.development_cost_labor, 0),
    development_cost_shipping: asNum(body.development_cost_shipping, 0),
    development_cost_total:
      asNum(body.development_cost_material, 0) +
      asNum(body.development_cost_labor, 0) +
      asNum(body.development_cost_shipping, 0),
    cost_currency: asText(body.cost_currency) || "USD",

    sample_chargeable: asBool(body.sample_chargeable, false),
    charged_to_buyer: asBool(body.charged_to_buyer, false),
    charged_amount: asNum(body.charged_amount, 0),
    charged_currency: asText(body.charged_currency) || "USD",

    is_converted_to_order: isConverted,
    po_header_id: asText(body.po_header_id) || null,
    po_no: asText(body.po_no) || null,
    estimated_order_value: asNum(body.estimated_order_value, 0),

    attachments: asJsonArray(body.attachments),
    reference_images: asJsonArray(body.reference_images),
    shipment_proof_files: asJsonArray(body.shipment_proof_files),
  };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const q = asText(searchParams.get("q")).toLowerCase();
    const buyerId = asText(searchParams.get("buyer_id"));

    let query = supabaseAdmin
      .from("sample_requests")
      .select("*", { count: "exact" })
      .eq("is_deleted", false)
      .order("request_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (buyerId) query = query.eq("buyer_id", buyerId);

    const { data, error, count } = await query.limit(500);
    if (error) return bad(error.message || "Failed to load sample requests", 500);

    let items = (data || []).map(normalizeRow);
    if (q) {
      items = items.filter((r: any) => [
        r.request_title,
        r.request_no,
        r.buyer_name,
        r.progress_note,
        r.buyer_additional_request,
        r.buyer_feedback,
      ].some((v: any) => asText(v).toLowerCase().includes(q)));
    }

    const summary = {
      total_requests: items.length,
      in_progress: items.filter((r: any) => normalizeProgressStatus(r.progress_status, r.result_status) !== "COMPLETED").length,
      completed: items.filter((r: any) => normalizeProgressStatus(r.progress_status, r.result_status) === "COMPLETED").length,
      converted_requests: items.filter((r: any) => asText(r.result_status).toUpperCase() === "CONVERTED_TO_ORDER").length,
      conversion_pct: 0,
      overdue: items.filter((r: any) => asText(r.alert_status).toUpperCase() === "OVERDUE").length,
      waiting_feedback: items.filter((r: any) => asText(r.alert_status).toUpperCase() === "WAITING_FEEDBACK" || asText(r.result_status).toUpperCase() === "WAITING").length,
    };
    summary.conversion_pct = summary.total_requests > 0 ? Math.round((summary.converted_requests / summary.total_requests) * 10000) / 100 : 0;

    const buyerMap = new Map<string, any>();
    for (const r of items) {
      const key = asText(r.buyer_id) || asText(r.buyer_name) || "UNKNOWN";
      const cur = buyerMap.get(key) || {
        buyer_name: asText(r.buyer_name) || "—",
        requests: 0,
        converted: 0,
        overdue: 0,
        waiting: 0,
      };
      cur.requests += 1;
      if (asText(r.result_status).toUpperCase() === "CONVERTED_TO_ORDER") cur.converted += 1;
      if (asText(r.alert_status).toUpperCase() === "OVERDUE") cur.overdue += 1;
      if (asText(r.alert_status).toUpperCase() === "WAITING_FEEDBACK" || asText(r.result_status).toUpperCase() === "WAITING") cur.waiting += 1;
      buyerMap.set(key, cur);
    }
    const buyer_kpis = Array.from(buyerMap.values())
      .map((r: any) => ({ ...r, conversion_pct: r.requests > 0 ? Math.round((r.converted / r.requests) * 10000) / 100 : 0 }))
      .sort((a, b) => a.buyer_name.localeCompare(b.buyer_name));

    return ok({ items, total: count ?? items.length, summary, buyer_kpis });
  } catch (e: any) {
    return bad(e?.message || "Unknown error", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const payload = buildPayload(body);

    if (!payload.buyer_id || !payload.buyer_name) {
      return bad("Buyer is required.", 400);
    }
    if (!payload.request_title) {
      return bad("Request Title is required.", 400);
    }

    const MAX_ATTEMPTS = 6;
    let lastError: any = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const freshNos = await generateFreshNumbers(payload.buyer_code, payload.request_date);
      const insertPayload = {
        ...payload,
        request_no: freshNos.request_no,
        temp_style_no: freshNos.temp_style_no,
      };

      const { data, error } = await supabaseAdmin
        .from("sample_requests")
        .insert(insertPayload)
        .select("*")
        .single();

      if (!error && data) {
        return ok({ item: normalizeRow(data) });
      }

      lastError = error;
      const requestNoDup = isDuplicateKeyError(error, "sample_requests_request_no_key") || isDuplicateKeyError(error, "request_no");
      const tempStyleDup = isDuplicateKeyError(error, "temp_style_no");
      if (!requestNoDup && !tempStyleDup) {
        return bad(error?.message || "Failed to create sample request", 500, { detail: error });
      }
    }

    return bad(
      "Failed to generate a unique Request No. Please save again.",
      409,
      { detail: lastError, reason: "request_no_conflict" }
    );
  } catch (e: any) {
    return bad(e?.message || "Unknown error", 500);
  }
}
