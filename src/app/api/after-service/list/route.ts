import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function num(v: string | null): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: NextRequest) {
  try {
    const supabase = createClient();
    const url = new URL(req.url);

    const q = (url.searchParams.get("q") || "").trim();
    const status = (url.searchParams.get("status") || "").trim();
    const buyerId = (url.searchParams.get("buyer_id") || "").trim();
    const vendorId = (url.searchParams.get("vendor_id") || "").trim();
    const poNo = (url.searchParams.get("po_no") || "").trim();
    const caseNo = (url.searchParams.get("case_no") || "").trim();
    const start = (url.searchParams.get("start") || "").trim(); // YYYY-MM-DD
    const end = (url.searchParams.get("end") || "").trim();     // YYYY-MM-DD
    const limit = Math.min(Math.max(num(url.searchParams.get("limit")) ?? 200, 1), 1000);

    let query = supabase
      .from("after_service_headers")
      .select("*")
      .eq("is_deleted", false)
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (status) query = query.eq("status", status);
    if (buyerId) query = query.eq("buyer_id", buyerId);
    if (vendorId) query = query.eq("vendor_id", vendorId);
    if (poNo) query = query.ilike("po_no", `%${poNo}%`);
    if (caseNo) query = query.ilike("case_no", `%${caseNo}%`);

    // Date range: use reported_date if present, else issue_date
    if (start) {
      query = query.or(`reported_date.gte.${start},issue_date.gte.${start}`);
    }
    if (end) {
      query = query.or(`reported_date.lte.${end},issue_date.lte.${end}`);
    }

    if (q) {
      // simple multi-field search
      query = query.or(
        [
          `case_no.ilike.%${q}%`,
          `po_no.ilike.%${q}%`,
          `title.ilike.%${q}%`,
          `buyer_name.ilike.%${q}%`,
          `vendor_name.ilike.%${q}%`,
          `description.ilike.%${q}%`,
        ].join(",")
      );
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, rows: data ?? [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Unknown error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();
    const body = await req.json().catch(() => ({}));

    const payload: any = {
      title: (body?.title || "New After Service").toString(),
      description: (body?.description || "").toString(),
      status: body?.status || "OPEN",
      issue_type: body?.issue_type || "OTHER",
      responsible_party: body?.responsible_party || "UNKNOWN",
      po_no: body?.po_no || null,
      po_header_id: body?.po_header_id || null,
      shipment_id: body?.shipment_id || null,
      invoice_id: body?.invoice_id || null,
      buyer_id: body?.buyer_id || null,
      buyer_name: body?.buyer_name || null,
      vendor_id: body?.vendor_id || null,
      vendor_name: body?.vendor_name || null,
      site_id: body?.site_id || null,
      shipping_origin_code: body?.shipping_origin_code || null,
      issue_date: body?.issue_date || null,
      reported_date: body?.reported_date || null,
      due_date: body?.due_date || null,
      currency: body?.currency || "USD",
      fx_rate_to_usd: body?.fx_rate_to_usd ?? null,
      claim_amount: body?.claim_amount ?? 0,
      approved_amount: body?.approved_amount ?? 0,
      loss_amount_usd: body?.loss_amount_usd ?? 0,
      resolution_type: body?.resolution_type || null,
      resolution_notes: body?.resolution_notes || null,
      created_by: body?.created_by || null,
      created_by_email: body?.created_by_email || null,
      updated_by: body?.updated_by || null,
      updated_by_email: body?.updated_by_email || null,
      is_deleted: false,
    };

const hasLink =
  (payload.po_no && String(payload.po_no).trim() !== "") ||
  !!payload.po_header_id ||
  !!payload.shipment_id ||
  !!payload.invoice_id;

// DB check constraint: at least one link must exist. Allow quick creation via placeholder.
if (!hasLink) {
  payload.po_no = "TBD";
}


    const { data, error } = await supabase
      .from("after_service_headers")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    // initial event
    await supabase.from("after_service_events").insert({
      header_id: data.id,
      event_type: "CREATED",
      message: "Case created",
      created_by: payload.created_by,
      created_by_email: payload.created_by_email,
      payload: { initial: true },
    });

    return NextResponse.json({ ok: true, row: data });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Unknown error" }, { status: 500 });
  }
}
