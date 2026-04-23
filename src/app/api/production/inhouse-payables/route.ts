import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}

function bad(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function isSchemaCacheMissingRelation(error: any) {
  const message = String(error?.message || "");
  return (
    message.includes("schema cache") &&
    (message.includes("inhouse_payables") || message.includes("work_sheet_material_specs"))
  );
}

function safeTrim(value: any) {
  return (value ?? "").toString().trim();
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isUuid(value: any) {
  return typeof value === "string" && UUID_RE.test(value);
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
  const { data, error } = await supabaseAdmin
    .from("work_sheet_headers")
    .select("id, work_sheet_no, ws_no, po_no")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data as any;
}

async function loadWorkSheetLine(id: string) {
  if (!id) return null;
  const { data, error } = await supabaseAdmin
    .from("work_sheet_lines")
    .select("id, work_sheet_id, jm_style_no, buyer_style, description, production_mode, is_deleted")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data as any;
}

async function loadMaterialSpec(id: string) {
  if (!id) return null;
  const { data, error } = await supabaseAdmin
    .from("work_sheet_material_specs")
    .select("id, work_sheet_line_id, material_type, material_name, spec_text, is_deleted")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data as any;
}

async function loadVendor(id: string) {
  if (!id) return null;
  const { data, error } = await supabaseAdmin
    .from("companies")
    .select("id, company_name, code")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data as any;
}

async function syncSpecActual(specId: string) {
  const id = safeTrim(specId);
  if (!id) return;

  const { data: rows, error } = await supabaseAdmin
    .from("inhouse_payables")
    .select("qty, gross_amount, unit_cost, status, is_deleted")
    .eq("work_sheet_material_spec_id", id);

  if (error) throw error;

  const active = (rows || []).filter((row: any) => !row?.is_deleted && row?.status !== "VOID");
  const totalQty = active.reduce((sum: number, row: any) => sum + toNumber(row?.qty, 0), 0);
  const totalAmount = active.reduce((sum: number, row: any) => sum + toNumber(row?.gross_amount, 0), 0);
  const weightedUnit = totalQty > 0 ? totalAmount / totalQty : null;

  const patch: Record<string, any> = {
    actual_qty: totalQty > 0 ? totalQty : null,
    actual_unit_cost: weightedUnit,
  };

  const { error: updErr } = await supabaseAdmin
    .from("work_sheet_material_specs")
    .update(patch)
    .eq("id", id);

  if (updErr) throw updErr;
}

function isMaterialType(type: any) {
  return safeTrim(type).toUpperCase() === "MATERIAL";
}

async function findActivePlannedDuplicate(input: {
  workSheetId: string;
  workSheetLineId: string;
  payableType: string;
  materialSpecId?: string | null;
  itemName?: string | null;
  specText?: string | null;
}) {
  const query = supabaseAdmin
    .from("inhouse_payables")
    .select("id, vendor_name, item_name, spec_text, status, due_date, work_sheet_material_spec_id")
    .eq("is_deleted", false)
    .eq("source_type", "WORK_SHEET")
    .eq("work_sheet_id", input.workSheetId)
    .eq("work_sheet_line_id", input.workSheetLineId)
    .eq("payable_type", input.payableType)
    .neq("status", "VOID");

  const { data, error } = await query;
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];

  if (input.materialSpecId) {
    return rows.find(
      (row: any) => safeTrim(row?.work_sheet_material_spec_id) === safeTrim(input.materialSpecId)
    ) as any;
  }

  const itemName = safeTrim(input.itemName);
  const specText = safeTrim(input.specText);

  return rows.find((row: any) => {
    const rowSpecId = safeTrim(row?.work_sheet_material_spec_id);
    if (rowSpecId) return false;
    if (safeTrim(row?.item_name) !== itemName) return false;
    return safeTrim(row?.spec_text) === specText;
  }) as any;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const status = safeTrim(searchParams.get("status")).toUpperCase();
    const vendorId = safeTrim(searchParams.get("vendor_id"));
    const q = safeTrim(searchParams.get("q"));
    const workSheetId = safeTrim(searchParams.get("work_sheet_id"));
    const payableType = safeTrim(searchParams.get("payable_type")).toUpperCase();
    const dueFrom = safeTrim(searchParams.get("due_from"));
    const dueTo = safeTrim(searchParams.get("due_to"));
    const paidFrom = safeTrim(searchParams.get("paid_from"));
    const paidTo = safeTrim(searchParams.get("paid_to"));
    const limit = Math.min(Math.max(Number(searchParams.get("limit") || "500"), 1), 2000);

    let query = supabaseAdmin
      .from("inhouse_payables")
      .select("*")
      .eq("is_deleted", false)
      .order("due_date", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status && status !== "ALL") query = query.eq("status", status);
    if (vendorId) query = query.eq("vendor_id", vendorId);
    if (workSheetId) query = query.eq("work_sheet_id", workSheetId);
    if (payableType && payableType !== "ALL") query = query.eq("payable_type", payableType);
    if (dueFrom) query = query.gte("due_date", dueFrom);
    if (dueTo) query = query.lte("due_date", dueTo);
    if (paidFrom) query = query.gte("paid_date", paidFrom);
    if (paidTo) query = query.lte("paid_date", paidTo);
    if (q) {
      query = query.or(
        `po_no.ilike.%${q}%,work_sheet_no.ilike.%${q}%,vendor_name.ilike.%${q}%,item_name.ilike.%${q}%,note.ilike.%${q}%`
      );
    }

    const { data, error } = await query;
    if (error) {
      if (isSchemaCacheMissingRelation(error)) {
        return bad(
          "Inhouse Payables DB table is not ready yet. Run the latest Supabase migration and reload schema first.",
          500
        );
      }
      throw error;
    }

    return ok({ rows: data || [] });
  } catch (e: any) {
    return bad(e?.message || "Failed to load inhouse payables", 500);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return bad("Invalid JSON body", 400);

    const workSheetId = safeTrim(body.work_sheet_id);
    const workSheetLineId = safeTrim(body.work_sheet_line_id);
    const specId = safeTrim(body.work_sheet_material_spec_id);
    const vendorId = safeTrim(body.vendor_id);
    const payableType = safeTrim(body.payable_type).toUpperCase();
    const sourceType = safeTrim(body.source_type).toUpperCase() || "WORK_SHEET";
    const entryDate = safeTrim(body.entry_date);
    const qty = toNumber(body.qty, -1);
    const unitCost = toNumber(body.unit_cost, -1);
    const termsDays = Math.max(0, Math.round(toNumber(body.payment_terms_days, 60)));

    if (!workSheetId) return bad("work_sheet_id is required", 400);
    if (!workSheetLineId) return bad("work_sheet_line_id is required", 400);
    if (!vendorId) return bad("vendor_id is required", 400);
    if (payableType !== "MATERIAL" && payableType !== "PROCESSING") {
      return bad("payable_type must be MATERIAL or PROCESSING", 400);
    }
    if (sourceType !== "WORK_SHEET" && sourceType !== "EXTRA") {
      return bad("source_type must be WORK_SHEET or EXTRA", 400);
    }
    if (!entryDate) return bad("entry_date is required", 400);
    if (!(qty > 0)) return bad("qty must be greater than 0", 400);
    if (!(unitCost >= 0)) return bad("unit_cost must be >= 0", 400);

    const [workSheet, line, vendor] = await Promise.all([
      loadWorkSheet(workSheetId),
      loadWorkSheetLine(workSheetLineId),
      loadVendor(vendorId),
    ]);

    if (!workSheet) return bad("Work sheet not found", 404);
    if (!line) return bad("Work sheet line not found", 404);
    if (!vendor) return bad("Vendor not found", 404);
    if (safeTrim(line.work_sheet_id) !== workSheetId) {
      return bad("work_sheet_line_id does not belong to work_sheet_id", 400);
    }
    if (safeTrim(line.production_mode).toUpperCase() !== "IN_HOUSE") {
      return bad("Only IN_HOUSE work sheet lines can be used here", 400);
    }

    let itemName = safeTrim(body.item_name);
    let specText = safeTrim(body.spec_text) || null;
    let reasonCode = safeTrim(body.reason_code).toUpperCase() || null;
    let materialSpecId: string | null = null;

    if (sourceType === "WORK_SHEET") {
      if (!specId) return bad("work_sheet_material_spec_id is required for planned items", 400);
      if (isUuid(specId)) {
        const spec = await loadMaterialSpec(specId);
        if (!spec) return bad("Material spec not found", 404);
        if (safeTrim(spec.work_sheet_line_id) !== workSheetLineId) {
          return bad("Material spec does not belong to work_sheet_line_id", 400);
        }
        const specIsMaterial = isMaterialType(spec.material_type);
        if (payableType === "MATERIAL" && !specIsMaterial) {
          return bad("Selected spec is not a material row", 400);
        }
        if (payableType === "PROCESSING" && specIsMaterial) {
          return bad("Selected spec is not a processing row", 400);
        }
        itemName = safeTrim(spec.material_name);
        specText = safeTrim(spec.spec_text) || null;
        materialSpecId = safeTrim(spec.id);
      } else {
        itemName = safeTrim(body.item_name);
        specText = safeTrim(body.spec_text) || null;
        if (!itemName) {
          return bad("item_name is required for planned rows without a saved material spec", 400);
        }
        materialSpecId = null;
      }
      reasonCode = null;

      const duplicate = await findActivePlannedDuplicate({
        workSheetId,
        workSheetLineId,
        payableType,
        materialSpecId,
        itemName,
        specText,
      });
      if (duplicate) {
        return bad(
          "This planned row is already ordered. Void/delete the existing payable first, or use Extra for defect/additional purchase.",
          409
        );
      }
    } else {
      if (!itemName) return bad("item_name is required for extra items", 400);
      if (!reasonCode) reasonCode = "MISSING_IN_WS";
    }

    const payload = {
      work_sheet_id: workSheetId,
      work_sheet_line_id: workSheetLineId,
      work_sheet_material_spec_id: materialSpecId,
      vendor_id: vendorId,
      po_no: safeTrim(workSheet.po_no) || null,
      work_sheet_no: safeTrim(workSheet.work_sheet_no) || safeTrim(workSheet.ws_no) || null,
      vendor_name: safeTrim(vendor.company_name) || safeTrim(vendor.code) || null,
      style_no: safeTrim(line.jm_style_no) || null,
      buyer_style: safeTrim(line.buyer_style) || null,
      payable_type: payableType,
      source_type: sourceType,
      reason_code: reasonCode,
      entry_date: entryDate,
      item_name: itemName,
      spec_text: specText,
      qty,
      currency: safeTrim(body.currency) || "CNY",
      unit_cost: unitCost,
      payment_terms_days: termsDays,
      due_date: safeTrim(body.due_date) || addDays(entryDate, termsDays),
      status: safeTrim(body.status).toUpperCase() || "OPEN",
      paid_amount: toNumber(body.paid_amount, 0),
      paid_date: safeTrim(body.paid_date) || null,
      note: safeTrim(body.note) || null,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabaseAdmin
      .from("inhouse_payables")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      if (isSchemaCacheMissingRelation(error)) {
        return bad(
          "Inhouse Payables DB table is not ready yet. Run the latest Supabase migration and reload schema first.",
          500
        );
      }
      throw error;
    }
    if (materialSpecId) await syncSpecActual(materialSpecId);

    return ok({ row: data });
  } catch (e: any) {
    return bad(e?.message || "Failed to create inhouse payable", 500);
  }
}
