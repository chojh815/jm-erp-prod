import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}

function bad(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function safeTrim(value: any) {
  return (value ?? "").toString().trim();
}

function toNumber(value: any, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function loadWorkSheet(id: string) {
  if (!id) return null;
  const { data } = await supabaseAdmin
    .from("work_sheet_headers")
    .select("id, work_sheet_no, ws_no, po_no")
    .eq("id", id)
    .maybeSingle();
  return data as any;
}

async function loadWorkSheetOrderQty(id: string) {
  const { data, error } = await supabaseAdmin
    .from("work_sheet_lines")
    .select("qty, is_deleted")
    .eq("work_sheet_id", id);

  if (error) return 0;

  return (data || []).reduce((sum: number, row: any) => {
    if (row?.is_deleted === true) return sum;
    const qty = Number(row?.qty || 0);
    return sum + (Number.isFinite(qty) ? qty : 0);
  }, 0);
}

async function loadAlreadyReceivedQty(workSheetId: string) {
  const { data, error } = await supabaseAdmin
    .from("subcontract_payables")
    .select("received_qty, status")
    .eq("work_sheet_id", workSheetId)
    .eq("is_deleted", false);

  if (error) return 0;

  return (data || []).reduce((sum: number, row: any) => {
    if (row?.status === "VOID") return sum;
    const qty = Number(row?.received_qty || 0);
    return sum + (Number.isFinite(qty) ? qty : 0);
  }, 0);
}

async function loadVendor(id: string) {
  if (!id) return null;
  const { data } = await supabaseAdmin
    .from("companies")
    .select("id, company_name, code")
    .eq("id", id)
    .maybeSingle();
  return data as any;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const status = safeTrim(searchParams.get("status")).toUpperCase();
    const vendorId = safeTrim(searchParams.get("vendor_id"));
    const q = safeTrim(searchParams.get("q"));
    const dueFrom = safeTrim(searchParams.get("due_from"));
    const dueTo = safeTrim(searchParams.get("due_to"));
    const paidFrom = safeTrim(searchParams.get("paid_from"));
    const paidTo = safeTrim(searchParams.get("paid_to"));
    const limit = Math.min(Math.max(Number(searchParams.get("limit") || "500"), 1), 2000);

    let query = supabaseAdmin
      .from("subcontract_payables")
      .select("*")
      .eq("is_deleted", false)
      .order("due_date", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status && status !== "ALL") query = query.eq("status", status);
    if (vendorId) query = query.eq("vendor_id", vendorId);
    if (dueFrom) query = query.gte("due_date", dueFrom);
    if (dueTo) query = query.lte("due_date", dueTo);
    if (paidFrom) query = query.gte("paid_date", paidFrom);
    if (paidTo) query = query.lte("paid_date", paidTo);
    if (q) {
      query = query.or(
        `po_no.ilike.%${q}%,work_sheet_no.ilike.%${q}%,vendor_name.ilike.%${q}%,note.ilike.%${q}%`
      );
    }

    const { data, error } = await query;
    if (error) throw error;

    return ok({ rows: data || [] });
  } catch (e: any) {
    return bad(e?.message || "Failed to load subcontract payables", 500);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return bad("Invalid JSON body", 400);

    const workSheetId = safeTrim(body.work_sheet_id);
    const vendorId = safeTrim(body.vendor_id);
    const receiptDate = safeTrim(body.receipt_date);
    const receivedQty = toNumber(body.received_qty, -1);
    const unitCost = toNumber(body.unit_cost, -1);
    const claimDeductionAmount = Math.max(0, toNumber(body.claim_deduction_amount, 0));
    const otherDeductionAmount = Math.max(0, toNumber(body.other_deduction_amount, 0));
    const termsDays = Math.max(0, Math.round(toNumber(body.payment_terms_days, 60)));

    if (!workSheetId) return bad("work_sheet_id is required", 400);
    if (!vendorId) return bad("vendor_id is required", 400);
    if (!receiptDate) return bad("receipt_date is required", 400);
    if (!(receivedQty > 0)) return bad("received_qty must be greater than 0", 400);
    if (!(unitCost >= 0)) return bad("unit_cost must be >= 0", 400);

    const [workSheet, vendor] = await Promise.all([loadWorkSheet(workSheetId), loadVendor(vendorId)]);
    if (!workSheet) return bad("Work sheet not found", 404);
    if (!vendor) return bad("Vendor not found", 404);

    const [orderQty, alreadyReceivedQty] = await Promise.all([
      loadWorkSheetOrderQty(workSheetId),
      loadAlreadyReceivedQty(workSheetId),
    ]);
    if (orderQty > 0 && alreadyReceivedQty + receivedQty > orderQty) {
      return bad(
        `Received qty exceeds work sheet qty. Order qty ${orderQty}, already received ${alreadyReceivedQty}, this receipt ${receivedQty}.`,
        400
      );
    }

    const payload = {
      work_sheet_id: workSheetId,
      vendor_id: vendorId,
      po_no: safeTrim(workSheet.po_no) || null,
      work_sheet_no: safeTrim(workSheet.work_sheet_no) || safeTrim(workSheet.ws_no) || null,
      vendor_name: safeTrim(vendor.company_name) || safeTrim(vendor.code) || null,
      receipt_date: receiptDate,
      received_qty: receivedQty,
      currency: safeTrim(body.currency) || "CNY",
      unit_cost: unitCost,
      claim_deduction_amount: claimDeductionAmount,
      other_deduction_amount: otherDeductionAmount,
      payment_terms_days: termsDays,
      due_date: safeTrim(body.due_date) || addDays(receiptDate, termsDays),
      status: safeTrim(body.status).toUpperCase() || "OPEN",
      paid_amount: toNumber(body.paid_amount, 0),
      paid_date: safeTrim(body.paid_date) || null,
      claim_receipt_header_id: safeTrim(body.claim_receipt_header_id) || null,
      note: safeTrim(body.note) || null,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabaseAdmin
      .from("subcontract_payables")
      .insert(payload)
      .select("*")
      .single();

    if (error) throw error;
    return ok({ row: data });
  } catch (e: any) {
    return bad(e?.message || "Failed to create subcontract payable", 500);
  }
}
