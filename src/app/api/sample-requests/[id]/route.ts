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

function ok(data: any = {}) { return json({ ok: true, ...data }); }
function bad(message: string, status = 400, extra?: any) { return json({ ok: false, error: message, ...(extra ?? {}) }, { status }); }
function asText(v: any) { return v === null || v === undefined ? "" : String(v).trim(); }
function asNum(v: any, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function asBool(v: any, fallback = false) { if (typeof v === "boolean") return v; const s = asText(v).toLowerCase(); if (["true","1","yes","y"].includes(s)) return true; if (["false","0","no","n"].includes(s)) return false; return fallback; }
function asDate(v: any): string | null { const s = asText(v); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; }
function asJsonArray(v: any) { if (Array.isArray(v)) return v; if (!v) return []; try { const j = JSON.parse(String(v)); return Array.isArray(j) ? j : []; } catch { return []; } }
function normalizeBuyerCode(v: any) { const s = asText(v).toUpperCase().replace(/[^A-Z0-9]/g, ""); return s || "GEN"; }
function isDuplicateKeyError(error: any, keyName?: string) {
  const text = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""} ${error?.code || ""}`.toLowerCase();
  if (!text) return false;
  if (keyName) return text.includes("duplicate key") && text.includes(keyName.toLowerCase());
  return text.includes("duplicate key") || text.includes("23505");
}
function normalizeResultStatus(v: any) { const s = asText(v).toUpperCase(); if (!s) return "WAITING"; if (s === "CONVERTED") return "CONVERTED_TO_ORDER"; if (s === "CLOSED" || s === "NO_ORDER") return "CLOSED_NO_ORDER"; return s; }
function normalizeProgressStatus(v: any, resultStatus?: any) { const s = asText(v).toUpperCase(); const result = normalizeResultStatus(resultStatus); if (s === "CONVERTED_TO_ORDER" || s === "CLOSED_NO_ORDER") return "COMPLETED"; if (result === "CONVERTED_TO_ORDER" || result === "CLOSED_NO_ORDER") return "COMPLETED"; return s || "REQUESTED"; }

function normalizeRow(r: any) {
  const result_status = normalizeResultStatus(r.result_status);
  return {
    ...r,
    progress_status: normalizeProgressStatus(r.status || r.progress_status, result_status),
    result_status,
    our_owner_name: asText(r.owner_name),
    our_owner_email: asText(r.owner_email),
    requested_items_text: asText(r.progress_note) || asText(r.requested_items_text),
    attachments: asJsonArray(r.attachments),
    reference_images: asJsonArray(r.reference_images),
    shipment_proof_files: asJsonArray(r.shipment_proof_files),
  };
}

function buildPayload(body: any) {
  let result_status = normalizeResultStatus(body.result_status);
  let status = normalizeProgressStatus(body.progress_status || body.status, result_status);
  if (result_status === "CONVERTED_TO_ORDER" || result_status === "CLOSED_NO_ORDER") status = "COMPLETED";
  if (status !== "COMPLETED" && (result_status === "CONVERTED_TO_ORDER" || result_status === "CLOSED_NO_ORDER")) result_status = "WAITING";
  return {
    request_title: asText(body.request_title) || null,
    buyer_style_no: asText(body.buyer_style_no) || null,
    buyer_id: asText(body.buyer_id) || null,
    buyer_code: normalizeBuyerCode(body.buyer_code || body.buyer_name),
    buyer_name: asText(body.buyer_name) || null,
    buyer_contact_name: asText(body.buyer_contact_name) || null,
    buyer_contact_email: asText(body.buyer_contact_email) || null,
    buyer_contact_phone: asText(body.buyer_contact_phone) || null,
    owner_name: asText(body.our_owner_name || body.owner_name) || null,
    owner_email: asText(body.our_owner_email || body.owner_email) || null,
    current_owner: asText(body.current_owner || body.our_owner_name || body.owner_name) || null,
    current_step: asText(body.current_step) || "Requested",
    request_date: asDate(body.request_date),
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
    carrier: asText(body.carrier) || null,
    tracking_no: asText(body.tracking_no) || null,
    shipping_cost: asNum(body.shipping_cost, 0),
    ship_to_country: asText(body.ship_to_country) || null,
    ship_to_address_summary: asText(body.ship_to_address_summary) || null,
    development_cost_material: asNum(body.development_cost_material, 0),
    development_cost_labor: asNum(body.development_cost_labor, 0),
    development_cost_shipping: asNum(body.development_cost_shipping, 0),
    development_cost_total: asNum(body.development_cost_material, 0) + asNum(body.development_cost_labor, 0) + asNum(body.development_cost_shipping, 0),
    cost_currency: asText(body.cost_currency) || "USD",
    sample_chargeable: asBool(body.sample_chargeable, false),
    charged_to_buyer: asBool(body.charged_to_buyer, false),
    charged_amount: asNum(body.charged_amount, 0),
    charged_currency: asText(body.charged_currency) || "USD",
    is_converted_to_order: asBool(body.is_converted_to_order, false) || result_status === "CONVERTED_TO_ORDER",
    po_header_id: asText(body.po_header_id) || null,
    po_no: asText(body.po_no) || null,
    estimated_order_value: asNum(body.estimated_order_value, 0),
    attachments: asJsonArray(body.attachments),
    reference_images: asJsonArray(body.reference_images),
    shipment_proof_files: asJsonArray(body.shipment_proof_files),
  };
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { data, error } = await supabaseAdmin.from("sample_requests").select("*").eq("id", id).eq("is_deleted", false).maybeSingle();
    if (error) return bad(error.message || "Failed to load sample request", 500);
    if (!data) return bad("Sample request not found", 404);
    return ok({ item: normalizeRow(data) });
  } catch (e: any) {
    return bad(e?.message || "Unknown error", 500);
  }
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const payload = buildPayload(body);
    const { data, error } = await supabaseAdmin.from("sample_requests").update(payload).eq("id", id).eq("is_deleted", false).select("*").maybeSingle();
    if (error) {
      if (isDuplicateKeyError(error, "sample_requests_request_no_key") || isDuplicateKeyError(error, "request_no")) {
        return bad("Request No already exists.", 409, { reason: "request_no_conflict", detail: error });
      }
      return bad(error.message || "Failed to update sample request", 500, { detail: error });
    }
    if (!data) return bad("Sample request not found", 404);
    return ok({ item: normalizeRow(data) });
  } catch (e: any) {
    return bad(e?.message || "Unknown error", 500);
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { data, error } = await supabaseAdmin.from("sample_requests").update({ is_deleted: true }).eq("id", id).eq("is_deleted", false).select("id").maybeSingle();
    if (error) return bad(error.message || "Failed to delete sample request", 500);
    if (!data) return bad("Sample request not found", 404);
    return ok({ id });
  } catch (e: any) {
    return bad(e?.message || "Unknown error", 500);
  }
}
