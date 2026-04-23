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

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return bad("Invalid JSON body", 400);

    const payload: Record<string, any> = { updated_at: new Date().toISOString() };
    if (body.advance_date !== undefined) payload.advance_date = safeTrim(body.advance_date);
    if (body.amount !== undefined) payload.amount = toNumber(body.amount, 0);
    if (body.applied_amount !== undefined) payload.applied_amount = Math.max(0, toNumber(body.applied_amount, 0));
    if (body.status !== undefined) payload.status = safeTrim(body.status).toUpperCase() || "OPEN";
    if (body.payment_account_id !== undefined) payload.payment_account_id = safeTrim(body.payment_account_id) || null;
    if (body.payment_method !== undefined) payload.payment_method = safeTrim(body.payment_method) || null;
    if (body.cash_transaction_id !== undefined) payload.cash_transaction_id = safeTrim(body.cash_transaction_id) || null;
    if (body.note !== undefined) payload.note = safeTrim(body.note) || null;

    const { data, error } = await supabaseAdmin
      .from("subcontract_advances")
      .update(payload)
      .eq("id", params.id)
      .eq("is_deleted", false)
      .select("*")
      .single();

    if (error) throw error;
    return ok({ row: data });
  } catch (e: any) {
    return bad(e?.message || "Failed to update subcontract advance", 500);
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const { error } = await supabaseAdmin
      .from("subcontract_advances")
      .update({ is_deleted: true, updated_at: new Date().toISOString() })
      .eq("id", params.id);

    if (error) throw error;
    return ok();
  } catch (e: any) {
    return bad(e?.message || "Failed to delete subcontract advance", 500);
  }
}
