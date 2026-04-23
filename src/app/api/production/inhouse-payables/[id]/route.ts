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

function toNumber(value: any, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function loadExisting(id: string) {
  const { data, error } = await supabaseAdmin
    .from("inhouse_payables")
    .select("id, work_sheet_material_spec_id, cash_transaction_id, is_deleted")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    if (isSchemaCacheMissingRelation(error)) {
      throw new Error(
        "Inhouse Payables DB table is not ready yet. Run the latest Supabase migration and reload schema first."
      );
    }
    throw error;
  }
  return data as any;
}

async function setCashTransactionDeleted(id: string, isDeleted: boolean) {
  if (!id) return;
  const { error } = await supabaseAdmin
    .from("cash_transactions")
    .update({ is_deleted: isDeleted })
    .eq("id", id);
  if (error) {
    if (isSchemaCacheMissingRelation(error)) {
      throw new Error(
        "Inhouse Payables DB table is not ready yet. Run the latest Supabase migration and reload schema first."
      );
    }
    throw error;
  }
}

async function syncSpecActual(specId: string) {
  const id = safeTrim(specId);
  if (!id) return;

  const { data: rows, error } = await supabaseAdmin
    .from("inhouse_payables")
    .select("qty, gross_amount, status, is_deleted")
    .eq("work_sheet_material_spec_id", id);

  if (error) throw error;

  const active = (rows || []).filter((row: any) => !row?.is_deleted && row?.status !== "VOID");
  const totalQty = active.reduce((sum: number, row: any) => sum + toNumber(row?.qty, 0), 0);
  const totalAmount = active.reduce((sum: number, row: any) => sum + toNumber(row?.gross_amount, 0), 0);
  const weightedUnit = totalQty > 0 ? totalAmount / totalQty : null;

  const { error: updErr } = await supabaseAdmin
    .from("work_sheet_material_specs")
    .update({
      actual_qty: totalQty > 0 ? totalQty : null,
      actual_unit_cost: weightedUnit,
    })
    .eq("id", id);

  if (updErr) throw updErr;
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return bad("Invalid JSON body", 400);

    const existing = await loadExisting(params.id);
    if (!existing || existing.is_deleted) return bad("Inhouse payable not found", 404);

    const status = safeTrim(body.status).toUpperCase();
    const payload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (status) payload.status = status;
    if (body.paid_amount !== undefined) payload.paid_amount = toNumber(body.paid_amount, 0);
    if (body.paid_date !== undefined) payload.paid_date = safeTrim(body.paid_date) || null;
    if (body.payment_account_id !== undefined) payload.payment_account_id = safeTrim(body.payment_account_id) || null;
    if (body.payment_method !== undefined) payload.payment_method = safeTrim(body.payment_method) || null;
    if (body.cash_transaction_id !== undefined) payload.cash_transaction_id = safeTrim(body.cash_transaction_id) || null;
    if (body.note !== undefined) payload.note = safeTrim(body.note) || null;

    if (status === "PAID" && !payload.paid_date) {
      payload.paid_date = new Date().toISOString().slice(0, 10);
    }

    if (status === "OPEN" && existing.cash_transaction_id) {
      await setCashTransactionDeleted(existing.cash_transaction_id, true);
      payload.cash_transaction_id = null;
      if (body.paid_amount === undefined) payload.paid_amount = 0;
      if (body.paid_date === undefined) payload.paid_date = null;
      if (body.payment_account_id === undefined) payload.payment_account_id = null;
      if (body.payment_method === undefined) payload.payment_method = null;
    }

    const { data, error } = await supabaseAdmin
      .from("inhouse_payables")
      .update(payload)
      .eq("id", params.id)
      .eq("is_deleted", false)
      .select("*")
      .single();

    if (error) throw error;
    if (existing.work_sheet_material_spec_id) {
      await syncSpecActual(existing.work_sheet_material_spec_id);
    }

    return ok({ row: data });
  } catch (e: any) {
    return bad(e?.message || "Failed to update inhouse payable", 500);
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const existing = await loadExisting(params.id);
    if (!existing || existing.is_deleted) return ok();

    const cashTransactionId = safeTrim(existing.cash_transaction_id);
    if (cashTransactionId) {
      await setCashTransactionDeleted(cashTransactionId, true);
    }

    const { error } = await supabaseAdmin
      .from("inhouse_payables")
      .update({ is_deleted: true, updated_at: new Date().toISOString() })
      .eq("id", params.id)
      .eq("is_deleted", false);

    if (error) {
      if (cashTransactionId) await setCashTransactionDeleted(cashTransactionId, false);
      throw error;
    }

    if (existing.work_sheet_material_spec_id) {
      await syncSpecActual(existing.work_sheet_material_spec_id);
    }

    return ok();
  } catch (e: any) {
    return bad(e?.message || "Failed to delete inhouse payable", 500);
  }
}
