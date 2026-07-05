import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const DEFAULT_RATE = 6.8;

function monthStart(value?: string | null) {
  const raw = String(value ?? "").trim();
  if (/^\d{4}-\d{2}$/.test(raw)) return `${raw}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw.slice(0, 7)}-01`;
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function missingTable(error: any) {
  return error?.code === "42P01" || /does not exist|schema cache/i.test(String(error?.message ?? ""));
}

export async function GET(req: NextRequest) {
  const month = monthStart(req.nextUrl.searchParams.get("month"));
  const { data, error } = await supabaseAdmin
    .from("expected_margin_fx_rates")
    .select("*")
    .lte("effective_month", month)
    .order("effective_month", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error && !missingTable(error)) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({
    success: true,
    row: data ?? null,
    effective_month: month,
    cny_per_usd: Number(data?.cny_per_usd ?? DEFAULT_RATE),
    is_default: !data,
  });
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const month = monthStart(body?.effective_month);
  const rate = Number(body?.cny_per_usd);
  if (!Number.isFinite(rate) || rate <= 0) {
    return NextResponse.json({ success: false, error: "CNY per USD must be greater than 0" }, { status: 400 });
  }
  const now = new Date().toISOString();
  const row = {
    effective_month: month,
    cny_per_usd: rate,
    note: body?.note ? String(body.note) : null,
    updated_at: now,
    updated_by: body?.updated_by ?? null,
    updated_by_email: body?.updated_by_email ?? null,
  };
  const { data, error } = await supabaseAdmin
    .from("expected_margin_fx_rates")
    .upsert(row, { onConflict: "effective_month" })
    .select("*")
    .single();
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, row: data });
}
