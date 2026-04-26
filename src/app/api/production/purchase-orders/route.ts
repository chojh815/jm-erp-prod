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

async function generateOrderNo(orderDate: string) {
  const compact = safeTrim(orderDate).replace(/-/g, "").slice(2);
  const prefix = `PRO-${compact}`;
  const { data, error } = await supabaseAdmin
    .from("production_order_headers")
    .select("order_no")
    .ilike("order_no", `${prefix}-%`)
    .order("order_no", { ascending: false })
    .limit(1);

  if (error) throw error;

  const last = safeTrim(data?.[0]?.order_no);
  const nextSeq = last ? Number(last.split("-").pop() || "0") + 1 : 1;
  return `${prefix}-${String(nextSeq).padStart(3, "0")}`;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const q = safeTrim(searchParams.get("q"));
    const statusRaw = safeTrim(searchParams.get("status"));
    const status = normalizeStatus(statusRaw);
    const allStatuses = !statusRaw || statusRaw.toUpperCase() === "ALL";
    const limit = Math.min(Math.max(Number(searchParams.get("limit") || "200"), 1), 1000);

    let query = supabaseAdmin
      .from("production_order_headers")
      .select("*")
      .eq("is_deleted", false)
      .order("order_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limit);

    if (!allStatuses) {
      query = query.eq("status", status);
    }

    if (q) {
      query = query.or(
        `order_no.ilike.%${q}%,vendor_name.ilike.%${q}%,buyer_po_ref.ilike.%${q}%,work_sheet_ref.ilike.%${q}%`
      );
    }

    const { data, error } = await query;
    if (error) throw error;

    return ok({ rows: data || [] });
  } catch (e: any) {
    return bad(e?.message || "Failed to load production orders", 500);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return bad("Invalid JSON body", 400);

    const header = normalizeHeader(body.header);
    const lines = normalizeLines(body.lines);

    if (!header.order_date) return bad("order_date is required", 400);
    if (!header.vendor_name) return bad("vendor_name is required", 400);
    if (lines.length === 0) return bad("At least one line is required", 400);

    const orderNo = header.order_no || (await generateOrderNo(header.order_date));
    const subtotal = calculateSubtotal(lines);

    const headerPayload = {
      ...header,
      order_no: orderNo,
      subtotal_amount: subtotal,
      updated_at: new Date().toISOString(),
    };

    const { data: insertedHeader, error: headerError } = await supabaseAdmin
      .from("production_order_headers")
      .insert(headerPayload)
      .select("*")
      .single();

    if (headerError) throw headerError;

    const linePayload = lines.map((line, index) => ({
      header_id: insertedHeader.id,
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

    if (lineError) {
      await supabaseAdmin.from("production_order_headers").delete().eq("id", insertedHeader.id);
      throw lineError;
    }

    return ok({
      header: insertedHeader,
      lines: insertedLines || [],
    });
  } catch (e: any) {
    return bad(e?.message || "Failed to create production order", 500);
  }
}
