import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { supabaseAdmin } from "@/lib/supabaseAdmin";

function toNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

type AllocationIn = { invoice_id: string; apply_amount: number };

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

async function tryInsertAudit(row: any) {
  // If audit table doesn't exist, ignore.
  const { error } = await supabaseAdmin.from("audit_logs").insert(row);
  if (!error) return;
  const code = (error as any)?.code;
  if (code === "42P01") return; // undefined_table
}

type InsertOk<T> = { ok: true; table: string; row: T };
type InsertFail = { ok: false; table: string; error: any };

async function tryInsertSingle<T = any>(table: string, payload: any): Promise<InsertOk<T> | InsertFail> {
  const { data, error } = await supabaseAdmin.from(table).insert(payload).select("*").single();
  if (error) return { ok: false, table, error };
  return { ok: true, table, row: data as T };
}

/**
 * JM_ERP_V2 header candidates.
 * - receipt_deposits: deposit-level header for bulk apply
 * - receipt_headers : alternative schema
 */
const HEADER_TABLE_CANDIDATES = ["receipt_deposits", "receipt_headers"] as const;

/**
 * JM_ERP_V2 apply/line candidates.
 * - receipt_applications: invoice apply map
 * - receipt_lines       : alternative schema
 */
const APPLY_TABLE_CANDIDATES = ["receipt_applications", "receipt_lines"] as const;

async function insertReceiptHeader(headerInsert: any) {
  const errs: any[] = [];
  for (const t of HEADER_TABLE_CANDIDATES) {
    const r = await tryInsertSingle(t, headerInsert);
    if (r.ok) return r;
    const code = (r.error as any)?.code;
    // table missing / column missing / not-null / FK missing -> try next
    if (code === "42P01" || code === "42703" || code === "23502" || code === "23503") {
      errs.push({ table: t, code, message: (r.error as any)?.message });
      continue;
    }
    return r;
  }
  return {
    ok: false,
    table: "receipt_deposits|receipt_headers",
    error: { message: "No suitable receipt header table found", detail: errs },
  } as InsertFail;
}

async function insertApplyRows(table: string, rows: any[]) {
  const { error } = await supabaseAdmin.from(table).insert(rows);
  return error;
}

/**
 * Try inserting apply rows with various foreign key column names.
 * Probe 1 row to find compatible FK key, then bulk insert rest.
 */
async function insertReceiptApplications(receiptId: string, allocationsOut: any[]) {
  const baseRows = allocationsOut.map((a) => ({
    invoice_id: a.invoice_id,
    apply_amount: a.apply_amount,
  }));

  const fkKeyVariants = [
    "receipt_id",
    "receipt_deposit_id",
    "deposit_id",
    "receipt_header_id",
    "header_id",
  ] as const;

  const errs: any[] = [];

  for (const table of APPLY_TABLE_CANDIDATES) {
    for (const fk of fkKeyVariants) {
      const probe = [{ ...baseRows[0], [fk]: receiptId }];
      const probeErr = await insertApplyRows(table, probe);
      if (!probeErr) {
        const rest = baseRows.slice(1).map((r) => ({ ...r, [fk]: receiptId }));
        if (rest.length) {
          const bulkErr = await insertApplyRows(table, rest);
          if (bulkErr) {
            return { ok: false, table, error: { message: `Bulk insert failed after probe (${fk})`, detail: bulkErr } };
          }
        }
        return { ok: true, table, fk };
      }

      const code = (probeErr as any)?.code;
      if (code === "42P01" || code === "42703" || code === "23502" || code === "23503") {
        errs.push({ table, fk, code, message: (probeErr as any)?.message });
        continue;
      }
      return { ok: false, table, error: probeErr };
    }
  }

  return { ok: false, table: "receipt_applications|receipt_lines", error: { message: "No suitable receipt apply table / FK column found", detail: errs } };
}

async function getInvoicesByIds(ids: string[]) {
  // We assume invoice headers table. If your project uses a different name, adjust here.
  const { data, error } = await supabaseAdmin
    .from("invoice_headers")
    .select("id, invoice_no, total_amount, received_amount, status, is_deleted")
    .in("id", ids);

  if (error) throw error;
  return (data ?? []).filter((r: any) => !r.is_deleted);
}

export async function POST(req: Request) {
  try {
    const { user, error: userErr } = await getUser();
    if (userErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));

    const buyer_id = String(body?.buyer_id ?? "");
    const bank_account_id = body?.bank_account_id ? String(body.bank_account_id) : null;

    const deposit_date = String(body?.deposit_date ?? "");
    const total_received = round2(toNum(body?.total_received));
    const bank_fee_amount = round2(toNum(body?.bank_fee_amount)); // our bank
    const buyer_bank_fee_amount = round2(toNum(body?.buyer_bank_fee_amount)); // buyer bank / buyer deducted
    const claim_deduction_amount = round2(toNum(body?.claim_deduction_amount));
    const method = body?.method ? String(body.method) : null;
    const reference_no = body?.reference_no ? String(body.reference_no) : null;
    const note_in = body?.note ? String(body.note) : null;

    const allocationsIn: AllocationIn[] = Array.isArray(body?.allocations) ? body.allocations : [];

    if (!buyer_id) return NextResponse.json({ error: "buyer_id required" }, { status: 400 });
    if (!deposit_date) return NextResponse.json({ error: "deposit_date required" }, { status: 400 });
    if (total_received < 0) return NextResponse.json({ error: "total_received must be >= 0" }, { status: 400 });
    if (bank_fee_amount < 0 || buyer_bank_fee_amount < 0 || claim_deduction_amount < 0) {
      return NextResponse.json({ error: "fee/deduction must be >= 0" }, { status: 400 });
    }
    if (!allocationsIn.length) return NextResponse.json({ error: "allocations required" }, { status: 400 });

    const computed_net = round2(total_received - bank_fee_amount - buyer_bank_fee_amount - claim_deduction_amount);
    if (computed_net < 0) return NextResponse.json({ error: "Net received cannot be negative" }, { status: 400 });

    const allocationsOut = allocationsIn
      .map((a) => ({ invoice_id: String(a.invoice_id), apply_amount: round2(toNum(a.apply_amount)) }))
      .filter((a) => a.invoice_id && a.apply_amount > 0);

    if (!allocationsOut.length) return NextResponse.json({ error: "No positive apply_amount found" }, { status: 400 });

    const apply_total = round2(allocationsOut.reduce((s, a) => s + a.apply_amount, 0));

    if (Math.abs(apply_total - computed_net) > 0.01) {
      return NextResponse.json(
        { error: `Apply total (${apply_total}) must equal Net Received (${computed_net}).` },
        { status: 400 }
      );
    }

    // Fetch invoices and validate apply doesn't exceed remaining
    const invoiceIds = Array.from(new Set(allocationsOut.map((a) => a.invoice_id)));
    const invoices = await getInvoicesByIds(invoiceIds);

    const invMap = new Map<string, any>(invoices.map((r: any) => [r.id, r]));
    for (const a of allocationsOut) {
      const inv = invMap.get(a.invoice_id);
      if (!inv) return NextResponse.json({ error: `Invoice not found: ${a.invoice_id}` }, { status: 400 });
      const total = round2(toNum(inv.total_amount));
      const received = round2(toNum(inv.received_amount));
      const remaining = round2(total - received);
      if (a.apply_amount - remaining > 0.01) {
        return NextResponse.json(
          { error: `Apply exceeds remaining for ${inv.invoice_no ?? inv.id}. Remaining=${remaining}, Apply=${a.apply_amount}` },
          { status: 400 }
        );
      }
    }

    // Insert receipt header (deposit)
    const headerInsert: any = {
      buyer_id,
      bank_account_id,
      deposit_date,
      total_received_amount: total_received,
      bank_fee_amount,
      buyer_bank_fee_amount,
      claim_deduction_amount,
      net_received_amount: computed_net,
      method,
      reference_no,
      note: note_in,
      created_by: user.id,
      created_by_email: user.email,
    };

    // Some schemas may use different column names; try a smaller fallback if needed.
    let headerRes = await insertReceiptHeader(headerInsert);
    if (!headerRes.ok) {
      // fallback payload with safest common keys
      const minimal: any = {
        buyer_id,
        bank_account_id,
        deposit_date,
        total_received: total_received,
        bank_fee_amount,
        buyer_bank_fee_amount,
        claim_deduction_amount,
        net_received_amount: computed_net,
        method,
        reference_no,
        note: note_in,
        created_by: user.id,
        created_by_email: user.email,
      };
      headerRes = await insertReceiptHeader(minimal);
    }
    if (!headerRes.ok) {
      return NextResponse.json({ error: "Failed to insert receipt header", detail: headerRes.error }, { status: 500 });
    }

    const receiptId = (headerRes.row as any).id as string;

    // Insert applications/lines
    const appRes = await insertReceiptApplications(receiptId, allocationsOut);
    if (!appRes.ok) {
      return NextResponse.json({ error: "Failed to insert receipt applications", detail: appRes.error }, { status: 500 });
    }

    // Update invoices: received_amount and status CLOSED if fully paid
    for (const a of allocationsOut) {
      const inv = invMap.get(a.invoice_id);
      const total = round2(toNum(inv.total_amount));
      const received = round2(toNum(inv.received_amount));
      const newReceived = round2(received + a.apply_amount);
      const remaining = round2(total - newReceived);

      const patch: any = { received_amount: newReceived };
      if (remaining <= 0.01) patch.status = "CLOSED";

      const { error: upErr } = await supabaseAdmin.from("invoice_headers").update(patch).eq("id", a.invoice_id);
      if (upErr) throw upErr;
    }

    await tryInsertAudit({
      actor_user_id: user.id,
      actor_email: user.email,
      action: "RECEIPT_BULK_APPLY",
      entity_table: headerRes.table,
      entity_id: receiptId,
      meta: {
        buyer_id,
        deposit_date,
        total_received,
        bank_fee_amount,
        buyer_bank_fee_amount,
        claim_deduction_amount,
        net_received_amount: computed_net,
        apply_total,
        apply_table: (appRes as any).table,
      },
      created_at: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      receipt_id: receiptId,
      header_table: headerRes.table,
      apply_table: (appRes as any).table,
      net_received_amount: computed_net,
      apply_total,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error", detail: e }, { status: 500 });
  }
}
