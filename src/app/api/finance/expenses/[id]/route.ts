import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function bad(error: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error, ...(extra || {}) }, { status });
}

function num(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function makeLineLabel(args: {
  po_no?: string | null;
  buyer_style_no?: string | null;
  jm_style_no?: string | null;
}) {
  const parts = [
    args.po_no ? `PO ${args.po_no}` : "",
    args.buyer_style_no || "",
    args.jm_style_no || "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * ✅ TS build fix
 * poLineMap.get(...) / poHeaderMap.get(...) 결과 shape를 명확히 지정해서
 * poLine?.po_header_id, poHeader?.po_no 접근 시 타입 에러가 나지 않게 함.
 */
type PoLineLite = {
  id: string;
  po_header_id?: string | null;
  buyer_style_no?: string | null;
  jm_style_no?: string | null;
};

type PoHeaderLite = {
  id: string;
  po_no?: string | null;
};

type ShipmentLite = {
  id: string;
  shipment_no?: string | null;
};

type BuyerLite = {
  id: string;
  company_name?: string | null;
  name?: string | null;
  code?: string | null;
};

async function hydrateResults(results: any[]) {
  const poHeaderIds = Array.from(
    new Set(results.map((r) => r.po_header_id).filter(Boolean))
  );
  const poLineIds = Array.from(
    new Set(results.map((r) => r.po_line_id).filter(Boolean))
  );
  const shipmentIds = Array.from(
    new Set(results.map((r) => r.shipment_id).filter(Boolean))
  );
  const buyerIds = Array.from(
    new Set(results.map((r) => r.buyer_id).filter(Boolean))
  );

  const [poHeadersRes, poLinesRes, shipmentsRes, buyersRes] = await Promise.all([
    poHeaderIds.length
      ? supabaseAdmin.from("po_headers").select("id,po_no").in("id", poHeaderIds)
      : Promise.resolve({ data: [], error: null } as any),
    poLineIds.length
      ? supabaseAdmin
          .from("po_lines")
          .select("id,po_header_id,buyer_style_no,jm_style_no")
          .in("id", poLineIds)
      : Promise.resolve({ data: [], error: null } as any),
    shipmentIds.length
      ? supabaseAdmin
          .from("shipments")
          .select("id,shipment_no")
          .in("id", shipmentIds)
      : Promise.resolve({ data: [], error: null } as any),
    buyerIds.length
      ? supabaseAdmin
          .from("companies")
          .select("id,company_name,name,code")
          .in("id", buyerIds)
      : Promise.resolve({ data: [], error: null } as any),
  ]);

  if (poHeadersRes.error) throw poHeadersRes.error;
  if (poLinesRes.error) throw poLinesRes.error;
  if (shipmentsRes.error) throw shipmentsRes.error;
  if (buyersRes.error) throw buyersRes.error;

  const poHeaderMap = new Map<string, PoHeaderLite>(
    (poHeadersRes.data || []).map((x: any) => [
      x.id,
      {
        id: x.id,
        po_no: x.po_no ?? null,
      },
    ])
  );

  const poLineMap = new Map<string, PoLineLite>(
    (poLinesRes.data || []).map((x: any) => [
      x.id,
      {
        id: x.id,
        po_header_id: x.po_header_id ?? null,
        buyer_style_no: x.buyer_style_no ?? null,
        jm_style_no: x.jm_style_no ?? null,
      },
    ])
  );

  const shipmentMap = new Map<string, ShipmentLite>(
    (shipmentsRes.data || []).map((x: any) => [
      x.id,
      {
        id: x.id,
        shipment_no: x.shipment_no ?? null,
      },
    ])
  );

  const buyerMap = new Map<string, BuyerLite>(
    (buyersRes.data || []).map((x: any) => [
      x.id,
      {
        id: x.id,
        company_name: x.company_name ?? null,
        name: x.name ?? null,
        code: x.code ?? null,
      },
    ])
  );

  return results.map((r: any) => {
    const poHeader = r.po_header_id ? poHeaderMap.get(r.po_header_id) ?? null : null;
    const poLine = r.po_line_id ? poLineMap.get(r.po_line_id) ?? null : null;
    const shipment = r.shipment_id ? shipmentMap.get(r.shipment_id) ?? null : null;
    const buyer = r.buyer_id ? buyerMap.get(r.buyer_id) ?? null : null;

    const linePoHeader =
      poLine?.po_header_id ? poHeaderMap.get(poLine.po_header_id) ?? null : null;

    const linePoNo = linePoHeader?.po_no ?? null;

    return {
      ...r,
      po_no: poHeader?.po_no || linePoNo || null,
      shipment_no: shipment?.shipment_no || null,
      buyer_name: buyer?.company_name || buyer?.name || buyer?.code || null,
      po_line_label: makeLineLabel({
        po_no: poHeader?.po_no || linePoNo || null,
        buyer_style_no: poLine?.buyer_style_no || null,
        jm_style_no: poLine?.jm_style_no || null,
      }),
    };
  });
}

export async function GET(_req: NextRequest, ctx: { params: { id: string } }) {
  try {
    const id = String(ctx.params.id || "").trim();
    if (!id) return bad("Missing id", 400);

    const { data: header, error: hErr } = await supabaseAdmin
      .from("expense_headers")
      .select("*")
      .eq("id", id)
      .eq("is_deleted", false)
      .maybeSingle();

    if (hErr) return bad(hErr.message, 500);
    if (!header) return bad("Expense not found", 404);

    const { data: allocationsRaw, error: aErr } = await supabaseAdmin
      .from("expense_allocations")
      .select(`
        *,
        po_headers:po_header_id (
          id,
          po_no
        ),
        shipments:shipment_id (
          id,
          shipment_no
        ),
        po_lines:po_line_id (
          id,
          buyer_style_no,
          jm_style_no,
          po_header_id,
          po_headers:po_header_id (
            id,
            po_no
          )
        )
      `)
      .eq("expense_id", id)
      .eq("is_deleted", false)
      .order("created_at", { ascending: true });

    if (aErr) return bad(aErr.message, 500);

    const allocations = (allocationsRaw || []).map((row: any) => ({
      ...row,
      po_no: row?.po_headers?.po_no || row?.po_lines?.po_headers?.po_no || null,
      shipment_no: row?.shipments?.shipment_no || null,
      po_line_label: makeLineLabel({
        po_no: row?.po_headers?.po_no || row?.po_lines?.po_headers?.po_no || null,
        buyer_style_no: row?.po_lines?.buyer_style_no || null,
        jm_style_no: row?.po_lines?.jm_style_no || null,
      }),
    }));

    const { data: resultsRaw, error: rErr } = await supabaseAdmin
      .from("expense_allocation_results")
      .select("*")
      .eq("expense_id", id)
      .eq("is_deleted", false)
      .order("created_at", { ascending: true });

    if (rErr) return bad(rErr.message, 500);

    const results = await hydrateResults(resultsRaw || []);

    return NextResponse.json({
      ok: true,
      data: { header, allocations, results },
    });
  } catch (e: any) {
    return bad(e?.message || String(e), 500);
  }
}

export async function PUT(req: NextRequest, ctx: { params: { id: string } }) {
  try {
    const id = String(ctx.params.id || "").trim();
    if (!id) return bad("Missing id", 400);

    const body = await req.json();
    const header =
      body?.header && typeof body.header === "object" ? body.header : body;
    const allocations = Array.isArray(body?.allocations) ? body.allocations : [];

    const { data: current, error: cErr } = await supabaseAdmin
      .from("expense_headers")
      .select("id,status")
      .eq("id", id)
      .eq("is_deleted", false)
      .maybeSingle();

    if (cErr) return bad(cErr.message, 500);
    if (!current) return bad("Expense not found", 404);
    if (current.status === "CONFIRMED")
      return bad("Confirmed expense is locked", 409);

    const totalOriginal =
      num(header.total_amount_original ?? header.amount_original ?? header.amount_local) ?? 0;
    const fxRate = num(header.fx_rate_to_usd ?? 1) ?? 1;
    const currency = String(header.currency || "USD").toUpperCase();
    const totalUsd =
      num(header.total_amount_usd ?? header.amount_usd) ??
      (currency === "USD" ? totalOriginal : fxRate > 0 ? totalOriginal / fxRate : 0);

    const { data: updated, error: uErr } = await supabaseAdmin
      .from("expense_headers")
      .update({
        expense_type_code: header.expense_type_code ?? null,
        vendor_id: header.vendor_id || null,
        expense_date: header.expense_date || null,
        posting_month: header.posting_month || null,
        currency,
        fx_rate_to_usd: fxRate,
        fx_as_of: header.fx_as_of || header.expense_date || null,
        fx_source: header.fx_source || (currency === "USD" ? "fixed_usd" : "manual"),
        total_amount_original: totalOriginal,
        total_amount_usd: totalUsd,
        scope_type: header.scope_type || "PO",
        allocation_method: header.allocation_method || "BY_REVENUE",
        note: header.note || null,
        status: header.status || "DRAFT",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("is_deleted", false)
      .select("*")
      .single();

    if (uErr) return bad(uErr.message, 500);

    const { error: delErr } = await supabaseAdmin
      .from("expense_allocations")
      .update({ is_deleted: true })
      .eq("expense_id", id)
      .eq("is_deleted", false);

    if (delErr) return bad(delErr.message, 500);

    if (allocations.length) {
      const rows = allocations.map((a: any) => ({
        expense_id: id,
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

      const { error: insErr } = await supabaseAdmin
        .from("expense_allocations")
        .insert(rows);
      if (insErr) return bad(insErr.message, 500);
    }

    return NextResponse.json({ ok: true, data: { id: updated.id, header: updated } });
  } catch (e: any) {
    return bad(e?.message || String(e), 500);
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: { id: string } }) {
  try {
    const id = String(ctx.params.id || "").trim();
    if (!id) return bad("Missing id", 400);

    const now = new Date().toISOString();

    const { error: hErr } = await supabaseAdmin
      .from("expense_headers")
      .update({ is_deleted: true, updated_at: now })
      .eq("id", id)
      .eq("is_deleted", false);
    if (hErr) return bad(hErr.message, 500);

    const { error: aErr } = await supabaseAdmin
      .from("expense_allocations")
      .update({ is_deleted: true })
      .eq("expense_id", id)
      .eq("is_deleted", false);
    if (aErr) return bad(aErr.message, 500);

    const { error: rErr } = await supabaseAdmin
      .from("expense_allocation_results")
      .update({ is_deleted: true })
      .eq("expense_id", id)
      .eq("is_deleted", false);
    if (rErr) return bad(rErr.message, 500);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return bad(e?.message || String(e), 500);
  }
}