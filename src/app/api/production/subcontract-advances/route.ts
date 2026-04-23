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

async function loadVendor(id: string) {
  if (!id) return null;
  const { data } = await supabaseAdmin
    .from("companies")
    .select("id, company_name, code")
    .eq("id", id)
    .maybeSingle();
  return data as any;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const vendorId = safeTrim(searchParams.get("vendor_id"));
    const status = safeTrim(searchParams.get("status")).toUpperCase();
    const dateFrom = safeTrim(searchParams.get("date_from"));
    const dateTo = safeTrim(searchParams.get("date_to"));
    const limit = Math.min(Math.max(Number(searchParams.get("limit") || "500"), 1), 2000);

    let query = supabaseAdmin
      .from("subcontract_advances")
      .select("*")
      .eq("is_deleted", false)
      .order("advance_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limit);

    if (vendorId) query = query.eq("vendor_id", vendorId);
    if (status && status !== "ALL") query = query.eq("status", status);
    if (dateFrom) query = query.gte("advance_date", dateFrom);
    if (dateTo) query = query.lte("advance_date", dateTo);

    const { data, error } = await query;
    if (error) throw error;

    return ok({ rows: data || [] });
  } catch (e: any) {
    const message = String(e?.message || "");
    if (message.includes("subcontract_advances")) return ok({ rows: [] });
    return bad(message || "Failed to load subcontract advances", 500);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return bad("Invalid JSON body", 400);

    const vendorId = safeTrim(body.vendor_id);
    const advanceDate = safeTrim(body.advance_date);
    const amount = toNumber(body.amount, -1);

    if (!vendorId) return bad("vendor_id is required", 400);
    if (!advanceDate) return bad("advance_date is required", 400);
    if (!(amount > 0)) return bad("amount must be greater than 0", 400);

    const vendor = await loadVendor(vendorId);
    if (!vendor) return bad("Vendor not found", 404);

    const payload = {
      vendor_id: vendorId,
      vendor_name: safeTrim(vendor.company_name) || safeTrim(vendor.code) || null,
      advance_date: advanceDate,
      currency: safeTrim(body.currency) || "CNY",
      amount,
      applied_amount: Math.max(0, toNumber(body.applied_amount, 0)),
      status: safeTrim(body.status).toUpperCase() || "OPEN",
      payment_account_id: safeTrim(body.payment_account_id) || null,
      payment_method: safeTrim(body.payment_method) || null,
      cash_transaction_id: safeTrim(body.cash_transaction_id) || null,
      note: safeTrim(body.note) || null,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabaseAdmin
      .from("subcontract_advances")
      .insert(payload)
      .select("*")
      .single();

    if (error) throw error;
    return ok({ row: data });
  } catch (e: any) {
    return bad(e?.message || "Failed to create subcontract advance", 500);
  }
}
