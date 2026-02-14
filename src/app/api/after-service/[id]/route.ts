import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function asNumber(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function GET(_req: NextRequest, ctx: { params: { id: string } }) {
  try {
    const supabase = createClient();
    const id = ctx.params.id;

    const { data: header, error: hErr } = await supabase
      .from("after_service_headers")
      .select("*")
      .eq("id", id)
      .eq("is_deleted", false)
      .single();

    if (hErr) {
      return NextResponse.json({ ok: false, error: hErr.message }, { status: 404 });
    }

    const { data: lines } = await supabase
      .from("after_service_lines")
      .select("*")
      .eq("header_id", id)
      .eq("is_deleted", false)
      .order("line_no", { ascending: true });

    const { data: events } = await supabase
      .from("after_service_events")
      .select("*")
      .eq("header_id", id)
      .order("created_at", { ascending: false })
      .limit(200);

    return NextResponse.json({ ok: true, header, lines: lines ?? [], events: events ?? [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Unknown error" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, ctx: { params: { id: string } }) {
  try {
    const supabase = createClient();
    const id = ctx.params.id;
    const body = await req.json().catch(() => ({}));

    const headerPatch = body?.header || {};
    const incomingLines = Array.isArray(body?.lines) ? body.lines : null;

    // Load current header for status change detection
    const { data: cur, error: curErr } = await supabase
      .from("after_service_headers")
      .select("*")
      .eq("id", id)
      .eq("is_deleted", false)
      .single();

    if (curErr || !cur) {
      return NextResponse.json({ ok: false, error: curErr?.message || "Not found" }, { status: 404 });
    }

    const patch: any = {
      title: headerPatch?.title ?? cur.title,
      description: headerPatch?.description ?? cur.description,

      status: headerPatch?.status ?? cur.status,
      issue_type: headerPatch?.issue_type ?? cur.issue_type,
      responsible_party: headerPatch?.responsible_party ?? cur.responsible_party,

      issue_date: headerPatch?.issue_date ?? cur.issue_date,
      reported_date: headerPatch?.reported_date ?? cur.reported_date,
      due_date: headerPatch?.due_date ?? cur.due_date,

      po_no: headerPatch?.po_no ?? cur.po_no,
      po_header_id: headerPatch?.po_header_id ?? cur.po_header_id,
      shipment_id: headerPatch?.shipment_id ?? cur.shipment_id,
      invoice_id: headerPatch?.invoice_id ?? cur.invoice_id,

      buyer_id: headerPatch?.buyer_id ?? cur.buyer_id,
      buyer_name: headerPatch?.buyer_name ?? cur.buyer_name,
      vendor_id: headerPatch?.vendor_id ?? cur.vendor_id,
      vendor_name: headerPatch?.vendor_name ?? cur.vendor_name,

      site_id: headerPatch?.site_id ?? cur.site_id,
      shipping_origin_code: headerPatch?.shipping_origin_code ?? cur.shipping_origin_code,

      currency: headerPatch?.currency ?? cur.currency,
      fx_rate_to_usd: headerPatch?.fx_rate_to_usd ?? cur.fx_rate_to_usd,
      claim_amount: headerPatch?.claim_amount ?? cur.claim_amount,
      approved_amount: headerPatch?.approved_amount ?? cur.approved_amount,
      loss_amount_usd: headerPatch?.loss_amount_usd ?? cur.loss_amount_usd,

      resolution_type: headerPatch?.resolution_type ?? cur.resolution_type,
      resolution_notes: headerPatch?.resolution_notes ?? cur.resolution_notes,

      updated_by: headerPatch?.updated_by ?? cur.updated_by,
      updated_by_email: headerPatch?.updated_by_email ?? cur.updated_by_email,
    };

    // Auto-close timestamp
    const wasClosed = !!cur.closed_at;
    const willBeClosed = patch.status === "CLOSED";
    if (willBeClosed && !wasClosed) patch.closed_at = new Date().toISOString();
    if (!willBeClosed && wasClosed) patch.closed_at = null;

    const { data: updated, error: uErr } = await supabase
      .from("after_service_headers")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();

    if (uErr) {
      return NextResponse.json({ ok: false, error: uErr.message }, { status: 500 });
    }

    // status change event
    if ((cur.status || "") !== (updated.status || "")) {
      await supabase.from("after_service_events").insert({
        header_id: id,
        event_type: "STATUS_CHANGE",
        from_status: cur.status,
        to_status: updated.status,
        message: `Status changed: ${cur.status} → ${updated.status}`,
        created_by: patch.updated_by,
        created_by_email: patch.updated_by_email,
        payload: { from: cur.status, to: updated.status },
      });
    }

    // lines replacement (optional)
    if (incomingLines) {
      // soft delete existing lines
      await supabase
        .from("after_service_lines")
        .update({ is_deleted: true })
        .eq("header_id", id)
        .eq("is_deleted", false);

      const inserts = incomingLines.map((ln: any, idx: number) => {
        const qty = asNumber(ln?.qty, 0);
        const unit_price = asNumber(ln?.unit_price, 0);
        const amount = Number.isFinite(Number(ln?.amount)) ? asNumber(ln.amount, qty * unit_price) : qty * unit_price;

        return {
          header_id: id,
          line_no: idx + 1,
          po_line_id: ln?.po_line_id || null,
          style_no: ln?.style_no || null,
          buyer_style_no: ln?.buyer_style_no || null,
          color: ln?.color || null,
          size: ln?.size || null,
          issue_type: ln?.issue_type || "OTHER",
          description: ln?.description || null,
          qty,
          unit: ln?.unit || null,
          unit_price,
          amount,
          cartons_from: ln?.cartons_from ?? null,
          cartons_to: ln?.cartons_to ?? null,
          is_deleted: false,
        };
      });

      if (inserts.length > 0) {
        const { error: lErr } = await supabase.from("after_service_lines").insert(inserts);
        if (lErr) {
          return NextResponse.json({ ok: false, error: lErr.message }, { status: 500 });
        }
      }

      await supabase.from("after_service_events").insert({
        header_id: id,
        event_type: "LINES_UPDATED",
        message: `Lines replaced (${inserts.length})`,
        created_by: patch.updated_by,
        created_by_email: patch.updated_by_email,
        payload: { count: inserts.length },
      });
    }

    return NextResponse.json({ ok: true, header: updated });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Unknown error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: { id: string } }) {
  try {
    const supabase = createClient();
    const id = ctx.params.id;

    const { data, error } = await supabase
      .from("after_service_headers")
      .update({ is_deleted: true, status: "CLOSED", closed_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    await supabase.from("after_service_events").insert({
      header_id: id,
      event_type: "DELETED",
      message: "Case soft-deleted",
      payload: { soft_delete: true },
    });

    return NextResponse.json({ ok: true, header: data });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Unknown error" }, { status: 500 });
  }
}
