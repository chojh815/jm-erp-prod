import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: { id: string } }) {
  try {
    const id = ctx.params.id;

    const { data: header, error: e1 } = await supabaseAdmin
      .from("finance_expenses")
      .select("*")
      .eq("id", id)
      .eq("is_deleted", false)
      .single();
    if (e1) throw e1;

    const { data: allocations, error: e2 } = await supabaseAdmin
      .from("finance_expense_allocations")
      .select("*")
      .eq("expense_id", id)
      .eq("is_deleted", false)
      .order("created_at", { ascending: true });
    if (e2) throw e2;

    return NextResponse.json({ ok: true, header, allocations: allocations || [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, ctx: { params: { id: string } }) {
  try {
    const id = ctx.params.id;
    const body = await req.json();

    const header = body?.header || {};
    const allocations = Array.isArray(body?.allocations) ? body.allocations : [];

    const now = new Date().toISOString();

    const patch = {
      expense_date: header.expense_date || null,
      category: header.category || null,
      description: header.description || null,
      currency: header.currency || null,
      amount_local: header.amount_local ?? null,
      fx_rate_to_usd: header.fx_rate_to_usd ?? null,
      amount_usd: header.amount_usd ?? null,
      allocation_method: header.allocation_method || "BY_REVENUE",
      scope_type: header.scope_type || "PO",
      vendor_id: header.vendor_id || null,
      site_id: header.site_id || null,
      note: header.note || null,
      updated_at: now,
    };

    const { data: updated, error: e1 } = await supabaseAdmin
      .from("finance_expenses")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();
    if (e1) throw e1;

    // soft-delete existing allocations, then insert new
    const { error: eDel } = await supabaseAdmin
      .from("finance_expense_allocations")
      .update({ is_deleted: true, updated_at: now })
      .eq("expense_id", id)
      .eq("is_deleted", false);
    if (eDel) throw eDel;

    if (allocations.length) {
      const rows = allocations.map((a: any) => ({
        expense_id: id,
        target_type: a.target_type,
        po_header_id: a.po_header_id || null,
        shipment_id: a.shipment_id || null,
        po_line_id: a.po_line_id || null,
        site_id: a.site_id || null,
        share_pct: a.share_pct ?? null,
        manual_usd: a.manual_usd ?? null,
        note: a.note || null,
        is_deleted: false,
        created_at: now,
        updated_at: now,
      }));

      const { error: eIns } = await supabaseAdmin.from("finance_expense_allocations").insert(rows);
      if (eIns) throw eIns;
    }

    return NextResponse.json({ ok: true, header: updated });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: { id: string } }) {
  try {
    const id = ctx.params.id;
    const now = new Date().toISOString();

    const { error: e1 } = await supabaseAdmin
      .from("finance_expenses")
      .update({ is_deleted: true, updated_at: now })
      .eq("id", id);
    if (e1) throw e1;

    const { error: e2 } = await supabaseAdmin
      .from("finance_expense_allocations")
      .update({ is_deleted: true, updated_at: now })
      .eq("expense_id", id)
      .eq("is_deleted", false);
    if (e2) throw e2;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
