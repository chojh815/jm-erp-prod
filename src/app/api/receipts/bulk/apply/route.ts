import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { recalcInvoiceTotals } from "@/lib/receipts/recalc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function safe(v: any) {
  return (v ?? "").toString().trim();
}

type AllocationIn = { invoice_id: string; apply_amount: number };
type AllocationOut = { invoice_id: string; apply_amount: number };

async function getUser() {
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
      },
    }
  );
  const { data, error } = await supabase.auth.getUser();
  if (error) return { user: null as any, error };
  return { user: data.user, error: null };
}

async function getInvoicesByIds(ids: string[]) {
  const { data, error } = await supabaseAdmin
    .from("invoice_headers")
    .select("id, invoice_no, buyer_id, buyer_name, buyer_code, currency, total_amount, balance_amount, paid_amount, status, is_deleted")
    .in("id", ids)
    .eq("is_deleted", false);
  if (error) throw error;
  return data ?? [];
}

function proportionalSplit(total: number, allocations: AllocationOut[]) {
  if (!allocations.length) return [] as Array<{ invoice_id: string; value: number }>;
  const base = round2(allocations.reduce((s, r) => s + r.apply_amount, 0));
  const out = allocations.map((a) => ({ invoice_id: a.invoice_id, value: 0 }));
  if (total === 0 || base === 0) return out;
  let running = 0;
  for (let i = 0; i < allocations.length; i++) {
    if (i === allocations.length - 1) {
      out[i].value = round2(total - running);
    } else {
      const part = round2((total * allocations[i].apply_amount) / base);
      out[i].value = part;
      running = round2(running + part);
    }
  }
  return out;
}

export async function POST(req: Request) {
  try {
    const { user, error: userErr } = await getUser();
    if (userErr || !user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));

    const buyer_id = safe(body?.buyer_id);
    const bank_account_id = safe(body?.bank_account_id) || null;
    const deposit_date = safe(body?.deposit_date);
    const total_received = round2(toNum(body?.total_received_amount ?? body?.total_received));
    const bank_fee_amount = round2(toNum(body?.bank_fee_amount));
    const buyer_bank_fee_amount = round2(toNum(body?.buyer_bank_fee_amount));
    const claim_deduction_amount = round2(toNum(body?.claim_deduction_amount));
    const buyer_wire_fee_writeoff_amount = round2(toNum(body?.buyer_wire_fee_writeoff_amount));
    const method = safe(body?.method) || null;
    const payment_method = safe(body?.payment_method) || method;
    const reference_no = safe(body?.reference_no) || null;
    const note = safe(body?.note) || null;
    const allocationsIn: AllocationIn[] = Array.isArray(body?.allocations) ? body.allocations : [];

    if (!buyer_id) return NextResponse.json({ success: false, error: "buyer_id required" }, { status: 400 });
    if (!deposit_date) return NextResponse.json({ success: false, error: "deposit_date required" }, { status: 400 });
    if (!allocationsIn.length) return NextResponse.json({ success: false, error: "allocations required" }, { status: 400 });
    if (total_received < 0) return NextResponse.json({ success: false, error: "total_received must be >= 0" }, { status: 400 });
    if (bank_fee_amount < 0 || buyer_bank_fee_amount < 0 || claim_deduction_amount < 0 || buyer_wire_fee_writeoff_amount < 0) {
      return NextResponse.json({ success: false, error: "fee/deduction/writeoff must be >= 0" }, { status: 400 });
    }

    const computed_net = round2(total_received - bank_fee_amount - buyer_bank_fee_amount - claim_deduction_amount);
    const computed_settlement = round2(computed_net + bank_fee_amount + buyer_wire_fee_writeoff_amount);
    if (computed_net < 0) {
      return NextResponse.json({ success: false, error: "Net received cannot be negative" }, { status: 400 });
    }

    const allocationsOut: AllocationOut[] = allocationsIn
      .map((a) => ({ invoice_id: safe(a.invoice_id), apply_amount: round2(toNum(a.apply_amount)) }))
      .filter((a) => a.invoice_id && a.apply_amount > 0);

    if (!allocationsOut.length) {
      return NextResponse.json({ success: false, error: "No positive apply_amount found" }, { status: 400 });
    }

    const apply_total = round2(allocationsOut.reduce((s, a) => s + a.apply_amount, 0));
    if (Math.abs(apply_total - computed_net) > 0.01) {
      return NextResponse.json(
        { success: false, error: `Apply total (${apply_total}) must equal Net Received (${computed_net}).` },
        { status: 400 }
      );
    }

    const invoiceIds = Array.from(new Set(allocationsOut.map((a) => a.invoice_id)));
    const invoices = await getInvoicesByIds(invoiceIds);
    const invMap = new Map<string, any>(invoices.map((r: any) => [r.id, r]));

    for (const a of allocationsOut) {
      const inv = invMap.get(a.invoice_id);
      if (!inv) {
        return NextResponse.json({ success: false, error: `Invoice not found: ${a.invoice_id}` }, { status: 400 });
      }
      if (String(inv.buyer_id || "") !== buyer_id) {
        return NextResponse.json({ success: false, error: `Buyer mismatch: ${inv.invoice_no || a.invoice_id}` }, { status: 400 });
      }
      const total = round2(toNum(inv.total_amount));
      const paid = round2(toNum(inv.paid_amount));
      const balance = round2(toNum(inv.balance_amount));
      const remaining = balance > 0 ? balance : Math.max(0, total - paid);
      if (a.apply_amount - remaining > 0.01) {
        return NextResponse.json(
          {
            success: false,
            error: `Apply exceeds remaining for ${inv.invoice_no ?? inv.id}. Remaining=${remaining}, Apply=${a.apply_amount}`,
          },
          { status: 400 }
        );
      }
    }

    const grossParts = proportionalSplit(total_received, allocationsOut);
    const ourFeeParts = proportionalSplit(bank_fee_amount, allocationsOut);
    const buyerFeeParts = proportionalSplit(buyer_bank_fee_amount, allocationsOut);
    const claimParts = proportionalSplit(claim_deduction_amount, allocationsOut);
    const headerWriteoffParts = proportionalSplit(buyer_wire_fee_writeoff_amount, allocationsOut);

    const grossMap = new Map(grossParts.map((r) => [r.invoice_id, r.value]));
    const ourFeeMap = new Map(ourFeeParts.map((r) => [r.invoice_id, r.value]));
    const buyerFeeMap = new Map(buyerFeeParts.map((r) => [r.invoice_id, r.value]));
    const claimMap = new Map(claimParts.map((r) => [r.invoice_id, r.value]));
    const headerWriteoffMap = new Map(headerWriteoffParts.map((r) => [r.invoice_id, r.value]));

    const createdHeaderIds: string[] = [];

    for (const a of allocationsOut) {
      const inv = invMap.get(a.invoice_id);
      const headerPayload = {
        invoice_id: a.invoice_id,
        invoice_no: safe(inv?.invoice_no) || null,
        buyer_id: inv?.buyer_id ?? buyer_id,
        buyer_name: safe(inv?.buyer_name) || null,
        buyer_code: safe(inv?.buyer_code) || null,
        currency: safe(inv?.currency) || "USD",
        receipt_date: deposit_date,
        deposit_date,
        payment_method,
        method,
        reference_no,
        note,
        received_amount: round2(grossMap.get(a.invoice_id) ?? a.apply_amount),
        total_received: round2(grossMap.get(a.invoice_id) ?? a.apply_amount),
        bank_fee_amount: round2(ourFeeMap.get(a.invoice_id) ?? 0),
        buyer_bank_fee_amount: round2(buyerFeeMap.get(a.invoice_id) ?? 0),
        claim_deduction_amount: round2(claimMap.get(a.invoice_id) ?? 0),
        buyer_wire_fee_writeoff_amount: round2(headerWriteoffMap.get(a.invoice_id) ?? 0),
        net_received_amount: a.apply_amount,
        bank_account_id,
        created_by: user.id ?? null,
        created_by_email: user.email ?? null,
      };

      const { data: header, error: headerErr } = await supabaseAdmin
        .from("receipt_headers")
        .insert(headerPayload)
        .select("id")
        .single();

      if (headerErr || !header?.id) {
        return NextResponse.json(
          {
            success: false,
            error: "Failed to insert receipt header",
            detail: headerErr,
            invoice_id: a.invoice_id,
            invoice_no: safe(inv?.invoice_no) || null,
          },
          { status: 500 }
        );
      }

      createdHeaderIds.push(String(header.id));

      const { error: lineErr } = await supabaseAdmin.from("receipt_lines").insert({
        receipt_header_id: String(header.id),
        invoice_id: a.invoice_id,
        applied_amount: a.apply_amount,
        writeoff_amount: 0,
        created_by_email: user.email ?? null,
      });

      if (lineErr) {
        return NextResponse.json(
          {
            success: false,
            error: "Failed to insert receipt line",
            detail: lineErr,
            invoice_id: a.invoice_id,
            receipt_header_id: String(header.id),
          },
          { status: 500 }
        );
      }
    }

    const recalc = await recalcInvoiceTotals(invoiceIds);

    return NextResponse.json({
      success: true,
      receipt_header_ids: createdHeaderIds,
      net_received_amount: computed_net,
      settlement_total: computed_settlement,
      apply_total,
      invoice_recalc: recalc.rows,
    });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message ?? "Server error", detail: e }, { status: 500 });
  }
}
