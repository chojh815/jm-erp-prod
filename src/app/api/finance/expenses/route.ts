import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveExpenseTypeCodeForSave } from "./_lib/expenseTypeHelpers";

export const dynamic = "force-dynamic";

function num(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function bad(error: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error, ...(extra || {}) }, { status });
}

async function generateExpenseNo(expenseDate?: string | null) {
  const dt = expenseDate ? new Date(`${expenseDate}T00:00:00`) : new Date();
  const yy = String(dt.getFullYear()).slice(-2);
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const prefix = `EXP-${yy}${mm}-`;

  const { data, error } = await supabaseAdmin
    .from("expense_headers")
    .select("expense_no")
    .ilike("expense_no", `${prefix}%`)
    .order("expense_no", { ascending: false })
    .limit(1);

  if (error) throw new Error(error.message);

  const last = data?.[0]?.expense_no ? String(data[0].expense_no) : "";
  const m = last.match(/(\d{4})$/);
  const seq = m ? Number(m[1]) + 1 : 1;

  return `${prefix}${String(seq).padStart(4, "0")}`;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim();
    const status = (searchParams.get("status") || "ALL").trim().toUpperCase();
    const scope = (searchParams.get("scope") || "ALL").trim().toUpperCase();
    const page = Math.max(Number(searchParams.get("page") || "1"), 1);
    const pageSize = Math.min(Math.max(Number(searchParams.get("page_size") || "20"), 1), 100);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabaseAdmin
      .from("expense_headers")
      .select("*", { count: "exact" })
      .eq("is_deleted", false)
      .order("updated_at", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (q) {
      query = query.or(
        `expense_no.ilike.%${q}%,expense_type_code.ilike.%${q}%,currency.ilike.%${q}%,note.ilike.%${q}%,scope_type.ilike.%${q}%,status.ilike.%${q}%`
      );
    }
    if (status !== "ALL") query = query.eq("status", status);
    if (scope !== "ALL") query = query.eq("scope_type", scope);

    const { data, error, count } = await query;
    if (error) return bad(error.message, 500);

    const headers = data || [];
    const ids = headers.map((x: any) => x.id).filter(Boolean);

    let allocationCounts = new Map<string, number>();
    if (ids.length) {
      const { data: allocRows, error: allocErr } = await supabaseAdmin
        .from("expense_allocations")
        .select("expense_id")
        .in("expense_id", ids)
        .eq("is_deleted", false);

      if (allocErr) return bad(allocErr.message, 500);

      for (const r of allocRows || []) {
        const k = String(r.expense_id);
        allocationCounts.set(k, (allocationCounts.get(k) || 0) + 1);
      }
    }

    const items = headers.map((row: any) => ({
      ...row,
      allocation_count: allocationCounts.get(String(row.id)) || 0,
    }));

    return NextResponse.json({
      ok: true,
      items,
      total: Number(count || 0),
      total_pages: Math.max(1, Math.ceil(Number(count || 0) / pageSize)),
      page,
      page_size: pageSize,
    });
  } catch (e: any) {
    return bad(e?.message || String(e), 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const header = body?.header && typeof body.header === "object" ? body.header : body;
    const allocations = Array.isArray(body?.allocations) ? body.allocations : [];

    const expenseTypeCode = await resolveExpenseTypeCodeForSave(
      header.expense_type_code ?? header.category ?? header.type ?? ""
    );
    if (!expenseTypeCode) return bad("Invalid expense type", 400);

    const expenseDate = String(header.expense_date || header.date || new Date().toISOString().slice(0, 10));
    const postingMonth = String(header.posting_month || expenseDate.slice(0, 7) + "-01");
    const currency = String(header.currency || "USD").toUpperCase();
    const fxRate = num(header.fx_rate_to_usd ?? 1) ?? 1;
    const totalOriginal = num(header.total_amount_original ?? header.amount_original ?? header.amount_local) ?? 0;
    const totalUsd =
      num(header.total_amount_usd ?? header.amount_usd) ??
      (currency === "USD" ? totalOriginal : fxRate > 0 ? totalOriginal / fxRate : 0);

    const expenseNo = String(header.expense_no || "").trim() || (await generateExpenseNo(expenseDate));

    const { data: inserted, error: hErr } = await supabaseAdmin
      .from("expense_headers")
      .insert({
        expense_no: expenseNo,
        expense_type_code: expenseTypeCode,
        vendor_id: header.vendor_id || null,
        expense_date: expenseDate,
        posting_month: postingMonth,
        currency,
        fx_rate_to_usd: fxRate,
        fx_as_of: header.fx_as_of || expenseDate,
        fx_source: header.fx_source || (currency === "USD" ? "fixed_usd" : "manual"),
        total_amount_original: totalOriginal,
        total_amount_usd: totalUsd,
        scope_type: header.scope_type || "PO",
        allocation_method: header.allocation_method || "BY_REVENUE",
        note: header.note || null,
        status: "DRAFT",
        is_deleted: false,
      })
      .select("*")
      .single();

    if (hErr) return bad(hErr.message, 500);

    if (allocations.length) {
      const rows = allocations.map((a: any) => ({
        expense_id: inserted.id,
        target_type: a.target_type || "PO",
        po_header_id: a.po_header_id || null,
        shipment_id: a.shipment_id || null,
        po_line_id: a.po_line_id || null,
        site_id: a.site_id || null,
        share_pct: num(a.share_pct),
        amount_usd: num(a.amount_usd ?? a.manual_usd),
        note: a.note || null,
        is_deleted: false,
      }));

      const { error: aErr } = await supabaseAdmin.from("expense_allocations").insert(rows);
      if (aErr) return bad(aErr.message, 500);
    }

    return NextResponse.json({ ok: true, id: inserted.id, data: { id: inserted.id, header: inserted } });
  } catch (e: any) {
    return bad(e?.message || String(e), 500);
  }
}
