import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonNoStore(body: any, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}
function ok(data: any = {}) {
  return jsonNoStore({ success: true, ...data }, 200);
}
function bad(message: string, status = 400, extra: any = {}) {
  return jsonNoStore({ success: false, error: message, ...extra }, status);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isUuid(v: any) {
  return typeof v === "string" && UUID_RE.test(v);
}
function n(v: any, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}
function s(v: any) {
  return (v ?? "").toString().trim();
}
function normalizeDate10(v: any): string | null {
  const t = s(v);
  if (!t) return null;
  return t.slice(0, 10);
}
function isConfirmedStatus(v: any) {
  const t = s(v).toUpperCase();
  return t === "CONFIRMED";
}

async function loadInvoiceHeader(invoiceId: string) {
  const { data, error } = await supabaseAdmin
    .from("invoice_headers")
    .select("*")
    .eq("id", invoiceId)
    .eq("is_deleted", false)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ?? null;
}

async function loadInvoiceLines(invoiceId: string, invoiceNo?: string | null) {
  const { data: a, error: e1 } = await supabaseAdmin
    .from("invoice_lines")
    .select(`*, po_lines:po_lines ( buyer_style_no, buyer_style_code, jm_style_no, jm_style_code )`)
    .eq("invoice_id", invoiceId)
    .order("po_no", { ascending: true })
    .order("style_no", { ascending: true })
    .order("line_no", { ascending: true });

  if (!e1 && Array.isArray(a) && a.length > 0) return a;

  const { data: b, error: e2 } = await supabaseAdmin
    .from("invoice_lines")
    .select(`*, po_lines:po_lines ( buyer_style_no, buyer_style_code, jm_style_no, jm_style_code )`)
    .eq("invoice_header_id", invoiceId)
    .order("po_no", { ascending: true })
    .order("style_no", { ascending: true })
    .order("line_no", { ascending: true });

  if (!e2 && Array.isArray(b) && b.length > 0) return b;

  const invNo = s(invoiceNo);
  if (invNo) {
    try {
      const { data: c, error: e3 } = await supabaseAdmin
        .from("invoice_lines")
        .select(`*, po_lines:po_lines ( buyer_style_no, buyer_style_code, jm_style_no, jm_style_code )`)
        // @ts-ignore
        .eq("invoice_no", invNo)
        .order("po_no", { ascending: true })
        .order("style_no", { ascending: true })
        .order("line_no", { ascending: true });

      if (!e3 && Array.isArray(c) && c.length > 0) return c;
    } catch {}
  }

  if (e2) throw new Error(e2.message);
  return [];
}

function computeTotalAmount(lines: any[]) {
  const alive = (lines || []).filter((l) => !l?.is_deleted);
  return alive.reduce((sum, l) => sum + n(l.amount, n(l.qty) * n(l.unit_price)), 0);
}

function pickStyleNo(line: any) {
  const p = line?.po_lines ?? {};
  const candidates = [
    p.buyer_style_no,
    p.buyer_style_code,
    p.jm_style_no,
    p.jm_style_code,
    line?.style_no,
  ];
  for (const v of candidates) {
    const sv = s(v);
    if (sv) return sv;
  }
  return "-";
}

function normalizeHeaderOut(header: any, computedTotal?: number) {
  return {
    ...header,
    invoice_date: normalizeDate10(header?.invoice_date),
    etd: normalizeDate10(header?.etd),
    eta: normalizeDate10(header?.eta),
    total_amount:
      header?.total_amount != null && Number(header.total_amount) > 0
        ? Number(header.total_amount)
        : Number(computedTotal || 0),
  };
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!id || !isUuid(id)) return bad("Invalid id", 400);

    const header = await loadInvoiceHeader(id);
    if (!header) return bad("Invoice not found", 404);

    let lines = await loadInvoiceLines(id, header?.invoice_no);
    lines = (lines || []).map((l: any) => ({
      ...(l ?? {}),
      style_no: pickStyleNo(l),
    }));

    const computed = computeTotalAmount(lines);

    return ok({
      header: normalizeHeaderOut(header, computed),
      lines,
      meta: {
        locked: isConfirmedStatus(header.status),
        lock_reason: isConfirmedStatus(header.status)
          ? "Invoice is CONFIRMED. Use Revision to change."
          : null,
      },
    });
  } catch (e: any) {
    return bad(e?.message || "Server error", 500);
  }
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!id || !isUuid(id)) return bad("Invalid id", 400);

    const existing = await loadInvoiceHeader(id);
    if (!existing) return bad("Invoice not found", 404);

    if (isConfirmedStatus(existing.status)) {
      return bad("Invoice is locked (CONFIRMED). Use Revision.", 409, {
        meta: {
          locked: true,
          lock_reason: "Invoice is CONFIRMED. Use Revision to change.",
        },
      });
    }

    const body = await req.json().catch(() => ({}));
    const headerIn = body?.header ?? {};
    const linesIn: any[] = Array.isArray(body?.lines) ? body.lines : [];

    const requestedInvoiceDate =
      headerIn.invoice_date !== undefined
        ? normalizeDate10(headerIn.invoice_date)
        : normalizeDate10(existing.invoice_date);

    const headerPatch: any = {
      invoice_no:
        headerIn.invoice_no !== undefined
          ? (s(headerIn.invoice_no) || null)
          : (existing.invoice_no ?? null),
      currency:
        headerIn.currency !== undefined
          ? (s(headerIn.currency) || null)
          : (existing.currency ?? null),
      incoterm:
        headerIn.incoterm !== undefined
          ? (s(headerIn.incoterm) || null)
          : (existing.incoterm ?? null),
      payment_term:
        headerIn.payment_term !== undefined
          ? (s(headerIn.payment_term) || null)
          : (existing.payment_term ?? null),
      destination:
        headerIn.destination !== undefined
          ? (s(headerIn.destination) || null)
          : (existing.destination ?? null),
      remarks:
        headerIn.remarks !== undefined
          ? (headerIn.remarks ?? null)
          : (existing.remarks ?? null),
      consignee_text:
        headerIn.consignee_text !== undefined
          ? (headerIn.consignee_text ?? null)
          : (existing.consignee_text ?? null),
      notify_party_text:
        headerIn.notify_party_text !== undefined
          ? (headerIn.notify_party_text ?? null)
          : (existing.notify_party_text ?? null),
      shipper_name:
        headerIn.shipper_name !== undefined
          ? (s(headerIn.shipper_name) || null)
          : (existing.shipper_name ?? null),
      shipper_address:
        headerIn.shipper_address !== undefined
          ? (s(headerIn.shipper_address) || null)
          : (existing.shipper_address ?? null),
      shipping_origin_code:
        headerIn.shipping_origin_code !== undefined
          ? (s(headerIn.shipping_origin_code) || null)
          : (existing.shipping_origin_code ?? null),
      port_of_loading:
        headerIn.port_of_loading !== undefined
          ? (s(headerIn.port_of_loading) || null)
          : (existing.port_of_loading ?? null),
      final_destination:
        headerIn.final_destination !== undefined
          ? (s(headerIn.final_destination) || null)
          : (existing.final_destination ?? null),
      etd:
        headerIn.etd !== undefined
          ? normalizeDate10(headerIn.etd)
          : normalizeDate10(existing.etd),
      eta:
        headerIn.eta !== undefined
          ? normalizeDate10(headerIn.eta)
          : normalizeDate10(existing.eta),
      status:
        headerIn.status !== undefined
          ? (s(headerIn.status) || null)
          : (existing.status ?? null),
      updated_at: new Date().toISOString(),
    };

    const { data: firstUpdatedHeader, error: hUpErr } = await supabaseAdmin
      .from("invoice_headers")
      .update({
        ...headerPatch,
        invoice_date: requestedInvoiceDate,
      })
      .eq("id", id)
      .select("*")
      .single();

    if (hUpErr) return bad(hUpErr.message, 500);

    if (normalizeDate10(firstUpdatedHeader?.invoice_date) !== requestedInvoiceDate) {
      return bad("Invoice date did not persist after header update.", 500, {
        debug: {
          requested_invoice_date: requestedInvoiceDate,
          saved_invoice_date: normalizeDate10(firstUpdatedHeader?.invoice_date),
        },
      });
    }

    if (linesIn.length > 0) {
      const toUpsert = linesIn
        .filter((x) => x)
        .map((x) => {
          const qty = x.qty === "" || x.qty == null ? null : n(x.qty, 0);
          const unit_price =
            x.unit_price === "" || x.unit_price == null ? null : n(x.unit_price, 0);

          const amount =
            x.amount == null || x.amount === ""
              ? n(qty) * n(unit_price)
              : n(x.amount, n(qty) * n(unit_price));

          return {
            id: x.id ?? randomUUID(),
            invoice_id: x.invoice_id ?? id,
            invoice_header_id: x.invoice_header_id ?? id,
            shipment_id: x.shipment_id ?? null,
            po_no: x.po_no ?? null,
            line_no: x.line_no ?? null,
            style_no: x.style_no && x.style_no !== "-" ? x.style_no : null,
            description: x.description ?? null,
            material_content: x.material_content ?? null,
            hs_code: x.hs_code ?? null,
            qty,
            unit_price,
            amount,
            is_deleted: !!x.is_deleted,
            updated_at: new Date().toISOString(),
          };
        });

      const { error: lErr } = await supabaseAdmin
        .from("invoice_lines")
        .upsert(toUpsert, { onConflict: "id" });

      if (lErr) return bad(lErr.message, 500);
    }

    const newLines = await loadInvoiceLines(id, firstUpdatedHeader?.invoice_no ?? existing.invoice_no);
    const total = computeTotalAmount(newLines);

    const { data: finalHeader, error: totalErr } = await supabaseAdmin
      .from("invoice_headers")
      .update({
        total_amount: total,
        invoice_date: requestedInvoiceDate,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .single();

    if (totalErr) return bad(totalErr.message, 500);

    const finalSavedDate = normalizeDate10(finalHeader?.invoice_date);
    if (finalSavedDate !== requestedInvoiceDate) {
      return bad("Invoice date changed after final save.", 500, {
        debug: {
          requested_invoice_date: requestedInvoiceDate,
          saved_invoice_date: finalSavedDate,
        },
      });
    }

    const outLines = (newLines || []).map((l: any) => ({
      ...(l ?? {}),
      style_no: pickStyleNo(l),
    }));

    return ok({
      header: normalizeHeaderOut(finalHeader, total),
      lines: outLines,
      meta: { locked: false, lock_reason: null },
      debug: {
        requested_invoice_date: requestedInvoiceDate,
        saved_invoice_date: finalSavedDate,
      },
    });
  } catch (e: any) {
    return bad(e?.message || "Server error", 500);
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!id || !isUuid(id)) return bad("Invalid id", 400);

    const existing = await loadInvoiceHeader(id);
    if (!existing) return bad("Invoice not found", 404);

    const { data: receiptLines, error: receiptErr } = await supabaseAdmin
      .from("receipt_lines")
      .select("id")
      .eq("invoice_id", id)
      .eq("is_deleted", false)
      .limit(1);

    if (receiptErr) return bad(receiptErr.message, 500);
    if ((receiptLines || []).length > 0) {
      return bad("Cannot delete invoice because receipts are already applied.", 409);
    }

    const now = new Date().toISOString();

    const { error: lineErr } = await supabaseAdmin
      .from("invoice_lines")
      .update({ is_deleted: true, updated_at: now })
      .or(`invoice_id.eq.${id},invoice_header_id.eq.${id}`);

    if (lineErr) return bad(lineErr.message, 500);

    const { error: linkErr } = await supabaseAdmin
      .from("invoice_shipments")
      .delete()
      .eq("invoice_id", id);

    if (linkErr) return bad(linkErr.message, 500);

    const { error: headerErr } = await supabaseAdmin
      .from("invoice_headers")
      .update({
        is_deleted: true,
        status: "DELETED",
        updated_at: now,
      })
      .eq("id", id);

    if (headerErr) return bad(headerErr.message, 500);

    return ok({ id });
  } catch (e: any) {
    return bad(e?.message || "Server error", 500);
  }
}
