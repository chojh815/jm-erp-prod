import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function isoDateOnly(d: Date) {
  return d.toISOString().slice(0, 10);
}

function firstDayOfMonth(dateStr: string) {
  // expects YYYY-MM-DD
  const d = new Date(dateStr + "T00:00:00Z");
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function toNumber(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

async function resolveExpenseTypeCode(raw: any): Promise<string | null> {
  const input = String(raw ?? "").trim();
  if (!input) return null;

  // 1) exact code match (case-insensitive)
  {
    const { data, error } = await supabaseAdmin
      .from("expense_types")
      .select("code")
      .ilike("code", input)
      .limit(1);
    if (!error && data && data[0]?.code) return data[0].code;
  }

  // 2) exact name match (case-insensitive)
  {
    const { data, error } = await supabaseAdmin
      .from("expense_types")
      .select("code")
      .ilike("name", input)
      .limit(1);
    if (!error && data && data[0]?.code) return data[0].code;
  }

  // 3) loose match (contains)
  const safe = input.replace(/%/g, "");
  {
    const { data, error } = await supabaseAdmin
      .from("expense_types")
      .select("code")
      .or(`code.ilike.%${safe}%,name.ilike.%${safe}%`)
      .limit(1);
    if (!error && data && data[0]?.code) return data[0].code;
  }

  return null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const header = body?.header || {};
    const allocationsInput = Array.isArray(body?.allocations) ? body.allocations : [];

    const now = new Date();
    const expenseDate = String(header.expense_date || header.date || isoDateOnly(now));
    const postingMonth = String(header.posting_month || firstDayOfMonth(expenseDate));

    // DB uses expense_headers + expense_allocations (NOT finance_expenses)
    const scopeType = String(header.scope_type || header.scopeType || "PO");

    const currency = String(header.currency || "USD");
    const fxToUsd = toNumber(header.fx_rate_to_usd ?? header.fxToUsd ?? header.fx_to_usd) ?? 1;

    // totals: prefer explicit header totals, else compute
    let totalOriginal =
      toNumber(header.total_amount_original ?? header.amount_original ?? header.amount_local) ?? null;
    let totalUsd = toNumber(header.total_amount_usd ?? header.amount_usd) ?? null;

    // If allocations carry amounts, use them
    const allocSumOriginal = allocationsInput
      .map((a: any) => toNumber(a.amount_original ?? a.amount_local))
      .filter((n: any) => typeof n === "number")
      .reduce((s: number, n: number) => s + n, 0);

    const allocSumUsd = allocationsInput
      .map((a: any) => toNumber(a.amount_usd))
      .filter((n: any) => typeof n === "number")
      .reduce((s: number, n: number) => s + n, 0);

    if ((totalOriginal === null || totalOriginal === 0) && allocSumOriginal > 0)
      totalOriginal = allocSumOriginal;
    if ((totalUsd === null || totalUsd === 0) && allocSumUsd > 0) totalUsd = allocSumUsd;

    if (totalUsd === null) {
      const base = totalOriginal ?? 0;
      totalUsd = Number((base * fxToUsd).toFixed(2));
    }

    // expense_type_code must exist in expense_types (FK)
    const rawType =
      header.expense_type_code ??
      header.expenseTypeCode ??
      header.category ??
      header.expense_type ??
      header.type ??
      "";

    let expenseTypeCode = await resolveExpenseTypeCode(rawType);

    // common UI labels fallback
    if (!expenseTypeCode && typeof rawType === "string") {
      const up = rawType.trim().toUpperCase();
      if (up === "FORWARDER") expenseTypeCode = await resolveExpenseTypeCode("FORWARDER");
      if (up === "TRANSPORT") expenseTypeCode = await resolveExpenseTypeCode("TRANSPORT");
      if (up === "OVERTIME") expenseTypeCode = await resolveExpenseTypeCode("OVERTIME");
      if (up === "MATERIALS" || up === "MATERIAL")
        expenseTypeCode = await resolveExpenseTypeCode("MATERIALS");
      if (up === "LOGISTICS") expenseTypeCode = await resolveExpenseTypeCode("LOGISTICS");
    }

    if (!expenseTypeCode) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Invalid expense type. Check expense_types table (code/name) and ensure UI sends a valid expense_type_code.",
          debug: { rawType },
        },
        { status: 400 }
      );
    }

    // IMPORTANT: your expense_headers schema uses total_* columns (per your screenshot)
    const insertHeader: any = {
      expense_date: expenseDate,
      posting_month: postingMonth,
      expense_type_code: expenseTypeCode,

      description: header.description || null,
      currency,
      fx_rate_to_usd: fxToUsd,
      total_amount_original: totalOriginal ?? 0,
      total_amount_usd: totalUsd ?? 0,

      scope_type: scopeType,
      vendor_id: header.vendor_id || null,
      site_id: header.site_id || null,
      note: header.note || null,
      is_deleted: false,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    };

    const { data: inserted, error: e1 } = await supabaseAdmin
      .from("expense_headers")
      .insert(insertHeader)
      .select("*")
      .single();

    if (e1) throw e1;

    const expenseId = inserted.id;

    // Fill allocations.site_id from selected PO if missing (A1: po_headers.site_id exists)
    let allocations = allocationsInput;
    const needSiteFromPo = allocations
      .filter((a: any) => a?.target_type === "PO" && a?.po_header_id && !a?.site_id)
      .map((a: any) => a.po_header_id);

    if (needSiteFromPo.length) {
      const uniqPoIds = Array.from(new Set(needSiteFromPo));
      const { data: poRows, error: poErr } = await supabaseAdmin
        .from("po_headers")
        .select("id, site_id")
        .in("id", uniqPoIds);

      if (poErr) throw poErr;

      const poSiteMap = new Map<string, string | null>(
        (poRows || []).map((r: any) => [r.id, r.site_id ?? null])
      );

      allocations = allocations.map((a: any) => {
        if (a?.target_type === "PO" && a?.po_header_id && !a?.site_id) {
          return { ...a, site_id: poSiteMap.get(a.po_header_id) ?? null };
        }
        return a;
      });
    }

    const insertAllocations = allocations.map((a: any) => {
      const sharePct = toNumber(a.share_pct ?? a.sharePct) ?? null;
      const amtOrig = toNumber(a.amount_original ?? a.amount_local ?? a.amountOriginal) ?? null;
      const amtUsd = toNumber(a.amount_usd ?? a.amountUsd) ?? null;

      return {
        expense_id: expenseId,
        target_type: String(a.target_type || a.targetType || "PO"),
        po_header_id: a.po_header_id || null,
        shipment_id: a.shipment_id || null,
        po_line_id: a.po_line_id || null,
        site_id: a.site_id || null,
        share_pct: sharePct,
        amount_original: amtOrig,
        amount_usd: amtUsd,
        note: a.note || null,
        created_at: now.toISOString(),
        is_deleted: false,
      };
    });

    if (insertAllocations.length) {
      const { error: e2 } = await supabaseAdmin
        .from("expense_allocations")
        .insert(insertAllocations);
      if (e2) throw e2;
    }

    return NextResponse.json({ ok: true, id: expenseId });
  } catch (err: any) {
    const msg = err?.message || String(err);
    return NextResponse.json({ ok: false, error: msg, detail: err }, { status: 500 });
  }
}
