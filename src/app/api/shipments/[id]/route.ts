// src/app/api/shipments/[id]/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}
function bad(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function num(v: any, fallback = 0): number {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isNaN(n) ? fallback : n;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isUuid(v: string) {
  return UUID_RE.test(v);
}

function pickQty(row: any) {
  return row?.shipped_qty ?? row?.order_qty ?? 0;
}

function groupByPo(lines: any[]) {
  const map = new Map<string, any[]>();
  for (const l of lines) {
    const key = String(l.po_no || l.po_header_id || "NO_PO");
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(l);
  }
  const keys = Array.from(map.keys()).sort((a, b) => a.localeCompare(b));
  return keys.map((k) => ({
    po_key: k,
    po_no: k === "NO_PO" ? null : k,
    lines: (map.get(k) || []).slice().sort((a, b) => num(a.line_no) - num(b.line_no)),
  }));
}

async function getInvoiceLink(shipmentId: string) {
  const { data, error } = await supabaseAdmin
    .from("invoice_headers")
    .select("id, invoice_no, status, created_at, updated_at, is_deleted, is_latest")
    .eq("is_deleted", false)
    .eq("is_latest", true)
    .eq("shipment_id", shipmentId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) return null;
  return data?.[0] ?? null;
}

async function getPackingListLink(shipmentId: string) {
  const { data, error } = await supabaseAdmin
    .from("packing_list_headers")
    .select("id, packing_list_no, status, created_at, updated_at, is_deleted")
    .eq("is_deleted", false)
    .eq("shipment_id", shipmentId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) return null;
  return data?.[0] ?? null;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const shipmentId = String(id || "").trim();
    if (!isUuid(shipmentId)) return bad("Invalid shipment id", 400);

    const { data: shipment, error: shErr } = await supabaseAdmin
      .from("shipments")
      .select("*")
      .eq("id", shipmentId)
      .eq("is_deleted", false)
      .maybeSingle();

    if (shErr) throw new Error(shErr.message);
    if (!shipment) return bad("Shipment not found", 404);

    const { data: rawLines, error: lnErr } = await supabaseAdmin
      .from("shipment_lines")
      .select("*")
      .eq("shipment_id", shipmentId)
      .eq("is_deleted", false)
      .order("po_no", { ascending: true })
      .order("line_no", { ascending: true });

    if (lnErr) throw new Error(lnErr.message);

    const lines = (rawLines || []).map((r: any) => ({
      id: r.id,
      shipment_id: r.shipment_id,
      po_line_id: r.po_line_id ?? null,
      po_header_id: r.po_header_id ?? null,
      po_no: r.po_no ?? null,
      line_no: num(r.line_no, 0),

      style_no: r.style_no ?? null,
      description: r.description ?? null,
      color: r.color ?? null,
      size: r.size ?? null,

      qty: num(pickQty(r), 0),

      cartons: num(r.cartons, 0),
      gw: num(r.gw, 0),
      nw: num(r.nw, 0),
      gw_per_ctn: num(r.gw_per_ctn, 0),
      nw_per_ctn: num(r.nw_per_ctn, 0),

      unit_price: r.unit_price ?? null,
      amount: r.amount ?? null,
    }));

    const groups_by_po = groupByPo(lines);

    const calcTotalCTN = lines.reduce((s, l) => s + num(l.cartons), 0);
    const calcTotalGW = lines.reduce((s, l) => s + num(l.gw), 0);
    const calcTotalNW = lines.reduce((s, l) => s + num(l.nw), 0);

    const finalTotalCTN = shipment.total_cartons ?? calcTotalCTN;
    const finalTotalGW = shipment.total_gw ?? calcTotalGW;
    const finalTotalNW = shipment.total_nw ?? calcTotalNW;

    let fallbackPo: any = null;
    if (shipment.po_header_id) {
      const { data, error } = await supabaseAdmin
        .from("po_headers")
        .select("*")
        .eq("id", shipment.po_header_id)
        .eq("is_deleted", false)
        .maybeSingle();
      if (!error) fallbackPo = data ?? null;
    }

    const buyerId = shipment.buyer_id ?? fallbackPo?.buyer_id ?? null;
    const buyerName = shipment.buyer_name ?? fallbackPo?.buyer_name ?? null;
    const buyerCode = shipment.buyer_code ?? fallbackPo?.buyer_code ?? null;

    const currencySummary = shipment.currency ?? fallbackPo?.currency ?? null;
    const incoterm = shipment.incoterm ?? fallbackPo?.incoterm ?? null;
    const payment_term = shipment.payment_term ?? fallbackPo?.payment_term ?? null;

    const shipping_origin_code =
      shipment.shipping_origin_code ?? fallbackPo?.shipping_origin_code ?? null;

    const destination = shipment.destination ?? fallbackPo?.destination ?? null;
    const final_destination = shipment.final_destination ?? fallbackPo?.final_destination ?? null;

    const port_of_loading = shipment.port_of_loading ?? fallbackPo?.port_of_loading ?? null;

    const etd = shipment.etd ?? null;
    const eta = shipment.eta ?? null;

    const invoiceLink = await getInvoiceLink(shipmentId);
    const packingListLink = await getPackingListLink(shipmentId);

    return ok({
      shipment: {
        ...shipment,
        buyer_id: buyerId,
        buyer_name: buyerName,
        buyer_code: buyerCode,
        currency: currencySummary,
        incoterm,
        payment_term,
        shipping_origin_code,
        destination,
        final_destination,
        port_of_loading,
        etd,
        eta,
        total_cartons: finalTotalCTN,
        total_gw: finalTotalGW,
        total_nw: finalTotalNW,
      },
      lines,
      groups_by_po,
      summary: {
        shipment_id: shipmentId,
        shipment_no: shipment.shipment_no ?? null,
        po_no: shipment.po_no ?? fallbackPo?.po_no ?? null,
        buyer_id: buyerId,
        buyer_name: buyerName,
        buyer_code: buyerCode,
        currency: currencySummary,
        total_cartons: finalTotalCTN,
        total_gw: finalTotalGW,
        total_nw: finalTotalNW,
      },
      links: {
        invoice: invoiceLink,
        packing_list: packingListLink,
      },
    });
  } catch (e: any) {
    console.error(e);
    return bad(e?.message || "Server error", 500);
  }
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const shipmentId = String(id || "").trim();
    if (!isUuid(shipmentId)) return bad("Invalid shipment id", 400);

    const body = await req.json().catch(() => ({}));

    const patch: any = {
      shipment_no: body.shipment_no ?? undefined,
      po_header_id: body.po_header_id ?? undefined,
      po_no: body.po_no ?? undefined,

      buyer_id: body.buyer_id ?? undefined,
      buyer_name: body.buyer_name ?? undefined,
      buyer_code: body.buyer_code ?? undefined,

      currency: body.currency ?? undefined,
      incoterm: body.incoterm ?? undefined,
      payment_term: body.payment_term ?? undefined,

      shipping_origin_code: body.shipping_origin_code ?? undefined,
      port_of_loading: body.port_of_loading ?? undefined,

      destination: body.destination ?? undefined,
      final_destination: body.final_destination ?? undefined,

      etd: body.etd ?? undefined,
      eta: body.eta ?? undefined,

      status: body.status ?? undefined,
      memo: body.memo ?? undefined,

      total_cartons: body.total_cartons ?? undefined,
      total_gw: body.total_gw ?? undefined,
      total_nw: body.total_nw ?? undefined,

      updated_at: new Date().toISOString(),
    };

    Object.keys(patch).forEach((k) => patch[k] === undefined && delete patch[k]);

    const { data, error } = await supabaseAdmin
      .from("shipments")
      .update(patch)
      .eq("id", shipmentId)
      .eq("is_deleted", false)
      .select("*")
      .maybeSingle();

    if (error) throw new Error(error.message);
    return ok({ shipment: data });
  } catch (e: any) {
    console.error(e);
    return bad(e?.message || "Server error", 500);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const shipmentId = String(id || "").trim();
    if (!isUuid(shipmentId)) return bad("Invalid shipment id", 400);

    // 0) 존재/미삭제 확인
    const { data: sh, error: shErr } = await supabaseAdmin
      .from("shipments")
      .select("id, is_deleted")
      .eq("id", shipmentId)
      .maybeSingle();

    if (shErr) throw new Error(shErr.message);
    if (!sh) return bad("Shipment not found", 404);
    if (sh.is_deleted) return bad("Shipment already deleted", 409);

    // 1) ✅ 연결된 Invoice 있으면 삭제 금지 (409)
    const { data: inv, error: invErr } = await supabaseAdmin
      .from("invoice_headers")
      .select("id")
      .eq("shipment_id", shipmentId)
      .eq("is_deleted", false)
      .limit(1);

    if (invErr) throw new Error(invErr.message);
    if ((inv ?? []).length > 0) {
      return bad("Cannot delete: linked Invoice exists", 409);
    }

    // 2) ✅ 라인도 같이 soft-delete (추천)
    const { error: lnErr } = await supabaseAdmin
      .from("shipment_lines")
      .update({
        is_deleted: true,
        updated_at: new Date().toISOString(),
      })
      .eq("shipment_id", shipmentId)
      .eq("is_deleted", false);

    if (lnErr) throw new Error(lnErr.message);

    // 3) 헤더 soft-delete
    const { error } = await supabaseAdmin
      .from("shipments")
      .update({
        is_deleted: true,
        status: "DELETED",
        updated_at: new Date().toISOString(),
      })
      .eq("id", shipmentId)
      .eq("is_deleted", false);

    if (error) throw new Error(error.message);
    return ok();
  } catch (e: any) {
    console.error(e);
    return bad(e?.message || "Server error", 500);
  }
}
