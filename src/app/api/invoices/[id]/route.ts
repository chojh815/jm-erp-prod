import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}
function bad(message: string, status = 400, extra: any = {}) {
  return NextResponse.json({ success: false, error: message, ...extra }, { status });
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
  // 1) invoice_id 우선
  const { data: a, error: e1 } = await supabaseAdmin
    .from("invoice_lines")
    .select(`*, po_lines:po_lines ( buyer_style_no, buyer_style_code, jm_style_no, jm_style_code )`)
    .eq("invoice_id", invoiceId)
    .order("po_no", { ascending: true })
    .order("style_no", { ascending: true })
    .order("line_no", { ascending: true });

  if (!e1 && Array.isArray(a) && a.length > 0) return a;

  // 2) fallback: invoice_header_id (과거 데이터)
  const { data: b, error: e2 } = await supabaseAdmin
    .from("invoice_lines")
    .select(`*, po_lines:po_lines ( buyer_style_no, buyer_style_code, jm_style_no, jm_style_code )`)
    .eq("invoice_header_id", invoiceId)
    .order("po_no", { ascending: true })
    .order("style_no", { ascending: true })
    .order("line_no", { ascending: true });

  if (!e2 && Array.isArray(b) && b.length > 0) return b;

  // 3) 최종 fallback: invoice_no 컬럼이 있는 경우 (일부 구버전 스키마)
  const invNo = (invoiceNo ?? "").toString().trim();
  if (invNo) {
    try {
      const { data: c, error: e3 } = await supabaseAdmin
        .from("invoice_lines")
        .select(`*, po_lines:po_lines ( buyer_style_no, buyer_style_code, jm_style_no, jm_style_code )`)
        // @ts-ignore - invoice_no 컬럼이 없을 수 있음
        .eq("invoice_no", invNo)
        .order("po_no", { ascending: true })
        .order("style_no", { ascending: true })
        .order("line_no", { ascending: true });

      if (!e3 && Array.isArray(c) && c.length > 0) return c;
    } catch {
      // ignore (invoice_no 컬럼이 없는 경우)
    }
  }

  // 여기까지면 진짜 없음
  if (e2) throw new Error(e2.message);
  return [];
}

function computeTotalAmount(lines: any[]) {
  const alive = (lines || []).filter((l) => !l?.is_deleted);
  return alive.reduce((sum, l) => sum + n(l.amount, n(l.qty) * n(l.unit_price)), 0);
}

function pickStyleNo(line: any) {
  // buyer_style_no 우선, 없으면 buyer_style_code, 없으면 jm_style_no/jm_style_code, 마지막으로 기존 style_no
  const p = line?.po_lines ?? {};
  const candidates = [
    p.buyer_style_no,
    p.buyer_style_code,
    p.jm_style_no,
    p.jm_style_code,
    line?.style_no,
  ];
  for (const v of candidates) {
    const s = (v ?? "").toString().trim();
    if (s) return s;
  }
  return "-";
}


export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!id || !isUuid(id)) return bad("Invalid id", 400);

    const header = await loadInvoiceHeader(id);
    if (!header) return bad("Invoice not found", 404);

    let lines = await loadInvoiceLines(id, header?.invoice_no);

    // ✅ display용 Style No = Buyer Style No 우선
    lines = (lines || []).map((l: any) => ({
      ...(l ?? {}),
      style_no: pickStyleNo(l),
    }));

    // total_amount가 비어있거나 0이면 lines로 계산해서 내려줌(화면 표시 안정)
    const computed = computeTotalAmount(lines);
    const outHeader = {
      ...header,
      total_amount:
        header.total_amount != null && Number(header.total_amount) > 0
          ? Number(header.total_amount)
          : computed,
    };

    return ok({
      header: outHeader,
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

    // ✅ Confirm 이후 수정 잠금
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

    // --- header update (page.tsx payload 기준)
    const headerPatch: any = {
      invoice_no: headerIn.invoice_no ?? existing.invoice_no ?? null,
      invoice_date: headerIn.invoice_date ?? existing.invoice_date ?? null,

      currency: headerIn.currency ?? existing.currency ?? null,
      incoterm: headerIn.incoterm ?? existing.incoterm ?? null,
      payment_term: headerIn.payment_term ?? existing.payment_term ?? null,

      destination: headerIn.destination ?? existing.destination ?? null,

      remarks: headerIn.remarks ?? existing.remarks ?? null,
      consignee_text: headerIn.consignee_text ?? existing.consignee_text ?? null,
      notify_party_text:
        headerIn.notify_party_text ?? existing.notify_party_text ?? null,

      shipper_name: headerIn.shipper_name ?? existing.shipper_name ?? null,
      shipper_address: headerIn.shipper_address ?? existing.shipper_address ?? null,

      shipping_origin_code:
        headerIn.shipping_origin_code ?? existing.shipping_origin_code ?? null,
      port_of_loading: headerIn.port_of_loading ?? existing.port_of_loading ?? null,
      final_destination:
        headerIn.final_destination ?? existing.final_destination ?? null,

      etd: headerIn.etd ?? existing.etd ?? null,
      eta: headerIn.eta ?? existing.eta ?? null,

      status: headerIn.status ?? existing.status ?? null,

      // total_amount는 아래에서 lines 기준으로 확정해서 다시 업데이트
      updated_at: new Date().toISOString(),
    };

    const { error: hUpErr } = await supabaseAdmin
      .from("invoice_headers")
      .update(headerPatch)
      .eq("id", id);

    if (hUpErr) return bad(hUpErr.message, 500);

    // --- lines upsert (삭제는 is_deleted=true로)
    if (linesIn.length > 0) {
      const toUpsert = linesIn
        .filter((x) => x) // id 없으면 서버에서 생성
        .map((x) => {
          const qty = x.qty === "" || x.qty == null ? null : n(x.qty, 0);
          const unit_price =
            x.unit_price === "" || x.unit_price == null ? null : n(x.unit_price, 0);

          // amount가 안오면 qty*unit_price로 계산
          const amount =
            x.amount == null || x.amount === ""
              ? n(qty) * n(unit_price)
              : n(x.amount, n(qty) * n(unit_price));

          return {
            id: x.id ?? randomUUID(),
            invoice_id: x.invoice_id ?? id, // 안전
            invoice_header_id: x.invoice_header_id ?? null,
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

    // --- 재조회 + total 확정 업데이트
    const newHeader = await loadInvoiceHeader(id);
    const newLines = await loadInvoiceLines(id, newHeader?.invoice_no);

    const total = computeTotalAmount(newLines);

    // header.total_amount 확정 반영
    await supabaseAdmin
      .from("invoice_headers")
      .update({ total_amount: total, updated_at: new Date().toISOString() })
      .eq("id", id);

    const finalHeader = await loadInvoiceHeader(id);

    return ok({
      header: finalHeader,
      lines: newLines,
      meta: { locked: false, lock_reason: null },
    });
  } catch (e: any) {
    return bad(e?.message || "Server error", 500);
  }
}