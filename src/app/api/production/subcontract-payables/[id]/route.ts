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

function isMissingPaymentLinkColumn(error: any) {
  const message = String(error?.message || "");
  return (
    message.includes("payment_account_id") ||
    message.includes("payment_method") ||
    message.includes("cash_transaction_id") ||
    message.includes("advance_applied_amount") ||
    message.includes("claim_receipt_header_id") ||
    message.includes("payment_batch_no")
  );
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return bad("Invalid JSON body", 400);

    const receiptDate = safeTrim(body.receipt_date);
    const termsDays = Math.max(0, Math.round(toNumber(body.payment_terms_days, 60)));
    const status = safeTrim(body.status).toUpperCase();

    const payload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (receiptDate) payload.receipt_date = receiptDate;
    if (body.received_qty !== undefined) payload.received_qty = toNumber(body.received_qty, 0);
    if (body.currency !== undefined) payload.currency = safeTrim(body.currency) || "CNY";
    if (body.unit_cost !== undefined) payload.unit_cost = toNumber(body.unit_cost, 0);
    if (body.claim_deduction_amount !== undefined) payload.claim_deduction_amount = Math.max(0, toNumber(body.claim_deduction_amount, 0));
    if (body.other_deduction_amount !== undefined) payload.other_deduction_amount = Math.max(0, toNumber(body.other_deduction_amount, 0));
    if (body.payment_terms_days !== undefined) payload.payment_terms_days = termsDays;
    if (body.due_date !== undefined) payload.due_date = safeTrim(body.due_date) || (receiptDate ? addDays(receiptDate, termsDays) : null);
    if (status) payload.status = status;
    if (body.paid_amount !== undefined) payload.paid_amount = toNumber(body.paid_amount, 0);
    if (body.paid_date !== undefined) payload.paid_date = safeTrim(body.paid_date) || null;
    if (body.advance_applied_amount !== undefined) payload.advance_applied_amount = Math.max(0, toNumber(body.advance_applied_amount, 0));
    if (body.claim_receipt_header_id !== undefined) payload.claim_receipt_header_id = safeTrim(body.claim_receipt_header_id) || null;
    if (body.payment_batch_no !== undefined) payload.payment_batch_no = safeTrim(body.payment_batch_no) || null;
    if (body.payment_account_id !== undefined) payload.payment_account_id = safeTrim(body.payment_account_id) || null;
    if (body.payment_method !== undefined) payload.payment_method = safeTrim(body.payment_method) || null;
    if (body.cash_transaction_id !== undefined) payload.cash_transaction_id = safeTrim(body.cash_transaction_id) || null;
    if (body.note !== undefined) payload.note = safeTrim(body.note) || null;

    if (status === "PAID" && !payload.paid_date) {
      payload.paid_date = new Date().toISOString().slice(0, 10);
    }

    if (status === "OPEN") {
      const existing = await supabaseAdmin
        .from("subcontract_payables")
        .select("cash_transaction_id")
        .eq("id", params.id)
        .eq("is_deleted", false)
        .maybeSingle();

      if (existing.data?.cash_transaction_id) {
        const { error: txError } = await supabaseAdmin
          .from("cash_transactions")
          .update({ is_deleted: true })
          .eq("id", existing.data.cash_transaction_id);

        if (txError) throw txError;
      }
    }

    let result = await supabaseAdmin
      .from("subcontract_payables")
      .update(payload)
      .eq("id", params.id)
      .eq("is_deleted", false)
      .select("*")
      .single();

    if (result.error && isMissingPaymentLinkColumn(result.error)) {
      const legacyPayload = { ...payload };
      delete legacyPayload.payment_account_id;
      delete legacyPayload.payment_method;
      delete legacyPayload.cash_transaction_id;
      delete legacyPayload.advance_applied_amount;
      delete legacyPayload.claim_receipt_header_id;
      delete legacyPayload.payment_batch_no;

      result = await supabaseAdmin
        .from("subcontract_payables")
        .update(legacyPayload)
        .eq("id", params.id)
        .eq("is_deleted", false)
        .select("*")
        .single();
    }

    if (result.error) throw result.error;
    return ok({ row: result.data });
  } catch (e: any) {
    return bad(e?.message || "Failed to update subcontract payable", 500);
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const { error } = await supabaseAdmin
      .from("subcontract_payables")
      .update({ is_deleted: true, updated_at: new Date().toISOString() })
      .eq("id", params.id);

    if (error) throw error;
    return ok();
  } catch (e: any) {
    return bad(e?.message || "Failed to delete subcontract payable", 500);
  }
}
