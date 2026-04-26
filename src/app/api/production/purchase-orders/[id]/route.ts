import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type {
  ProductionOrderHeaderInput,
  ProductionOrderLineInput,
  ProductionOrderReferenceImage,
  ProductionOrderStatus,
} from "@/lib/productionOrders";

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

function normalizeStatus(value: any): ProductionOrderStatus {
  const normalized = safeTrim(value).toUpperCase();
  if (normalized === "CONFIRMED" || normalized === "CANCELLED") return normalized;
  return "DRAFT";
}

function normalizeReferenceImages(input: any): ProductionOrderReferenceImage[] {
  const rows = Array.isArray(input) ? input : [];
  return rows
    .map((row: any) => ({
      url: safeTrim(row?.url),
      caption: safeTrim(row?.caption),
      path: safeTrim(row?.path),
    }))
    .filter((row) => row.url);
}

function normalizeHeader(input: any): ProductionOrderHeaderInput {
  return {
    order_no: safeTrim(input?.order_no) || undefined,
    order_date: safeTrim(input?.order_date),
    vendor_id: safeTrim(input?.vendor_id) || null,
    vendor_name: safeTrim(input?.vendor_name),
    supplier_contact: safeTrim(input?.supplier_contact),
    delivery_date: safeTrim(input?.delivery_date),
    buyer_po_ref: safeTrim(input?.buyer_po_ref),
    work_sheet_ref: safeTrim(input?.work_sheet_ref),
    payment_terms: safeTrim(input?.payment_terms),
    delivery_address: safeTrim(input?.delivery_address),
    reference_images: normalizeReferenceImages(input?.reference_images),
    currency: safeTrim(input?.currency) || "CNY",
    material_supplied_by_jm: Boolean(input?.material_supplied_by_jm),
    special_instructions: safeTrim(input?.special_instructions),
    notes: safeTrim(input?.notes),
    prepared_by: safeTrim(input?.prepared_by),
    approved_by: safeTrim(input?.approved_by),
    supplier_confirmation: safeTrim(input?.supplier_confirmation),
    status: normalizeStatus(input?.status),
  };
}

function normalizeLines(input: any): ProductionOrderLineInput[] {
  const rows = Array.isArray(input) ? input : [];
  return rows
    .map((row: any) => ({
      process_type: safeTrim(row?.process_type).toUpperCase(),
      description: safeTrim(row?.description),
      qty: toNumber(row?.qty, 0),
      unit: safeTrim(row?.unit) || "PCS",
      unit_price: toNumber(row?.unit_price, 0),
      remarks: safeTrim(row?.remarks),
    }))
    .filter((row) => row.process_type || row.description || row.qty || row.unit_price || row.remarks);
}

function calculateSubtotal(lines: ProductionOrderLineInput[]) {
  const subtotal = lines.reduce((sum, row) => {
    return sum + toNumber(row.qty, 0) * toNumber(row.unit_price, 0);
  }, 0);
  return Math.round(subtotal * 100) / 100;
}

async function loadDetail(id: string) {
  const { data: header, error: headerError } = await supabaseAdmin
    .from("production_order_headers")
    .select("*")
    .eq("id", id)
    .eq("is_deleted", false)
    .maybeSingle();

  if (headerError) throw headerError;
  if (!header) return null;

  const { data: lines, error: lineError } = await supabaseAdmin
    .from("production_order_lines")
    .select("*")
    .eq("header_id", id)
    .order("line_no", { ascending: true });

  if (lineError) throw lineError;

  return {
    header,
    lines: lines || [],
  };
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const detail = await loadDetail(params.id);
    if (!detail) return bad("Production order not found", 404);
    return ok(detail);
  } catch (e: any) {
    return bad(e?.message || "Failed to load production order", 500);
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const existing = await loadDetail(params.id);
    if (!existing) return bad("Production order not found", 404);

    const body = await req.json().catch(() => null);
    if (!body) return bad("Invalid JSON body", 400);

    const header = normalizeHeader(body.header);
    const lines = normalizeLines(body.lines);

    if (!header.order_date) return bad("order_date is required", 400);
    if (!header.vendor_name) return bad("vendor_name is required", 400);
    if (lines.length === 0) return bad("At least one line is required", 400);

    const subtotal = calculateSubtotal(lines);

    const headerPayload = {
      ...header,
      order_no: header.order_no || existing.header.order_no,
      subtotal_amount: subtotal,
      updated_at: new Date().toISOString(),
    };

    const { data: updatedHeader, error: headerError } = await supabaseAdmin
      .from("production_order_headers")
      .update(headerPayload)
      .eq("id", params.id)
      .select("*")
      .single();

    if (headerError) throw headerError;

    const { error: deleteError } = await supabaseAdmin
      .from("production_order_lines")
      .delete()
      .eq("header_id", params.id);

    if (deleteError) throw deleteError;

    const linePayload = lines.map((line, index) => ({
      header_id: params.id,
      line_no: index + 1,
      process_type: line.process_type,
      description: line.description || null,
      qty: toNumber(line.qty, 0),
      unit: line.unit || "PCS",
      unit_price: toNumber(line.unit_price, 0),
      remarks: line.remarks || null,
      updated_at: new Date().toISOString(),
    }));

    const { data: insertedLines, error: lineError } = await supabaseAdmin
      .from("production_order_lines")
      .insert(linePayload)
      .select("*")
      .order("line_no", { ascending: true });

    if (lineError) throw lineError;

    return ok({
      header: updatedHeader,
      lines: insertedLines || [],
    });
  } catch (e: any) {
    return bad(e?.message || "Failed to update production order", 500);
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const existing = await loadDetail(params.id);
    if (!existing) return bad("Production order not found", 404);

    const { error } = await supabaseAdmin
      .from("production_order_headers")
      .update({
        is_deleted: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", params.id);

    if (error) throw error;

    return ok({ id: params.id });
  } catch (e: any) {
    return bad(e?.message || "Failed to delete production order", 500);
  }
}
