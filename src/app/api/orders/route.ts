// src/app/api/orders/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * JM ERP - Orders (PO) API
 * - POST: upsert PO header + upsert lines by line_no (soft-delete removed lines)
 * - GET:  load single PO by po_no or id
 * - DELETE: soft-delete header by po_no + (optional) hard/soft delete lines (here: soft-delete lines)
 *
 * Notes:
 * - Brand snapshot column is buyer_brand_name (NOT buyer_brand)
 * - Buyer code is buyer_code; buyer_name is also stored
 * - Images:
 *    UI can send any of: image_urls | imageUrls | thumbUrls | images
 *    We store into po_lines.image_urls (jsonb array)
 *    Also store image_url/main_image_url if provided
 */

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

function str(v: any): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s : null;
}
function strUndefIfEmpty(v: any): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s ? s : undefined;
}
function num(v: any, fallback: number | null = 0): number | null {
  if (v === undefined || v === null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function pickStr(obj: any, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj?.[k];
    const s = strUndefIfEmpty(v);
    if (s !== undefined) return s;
  }
  return undefined;
}
function pickNum(obj: any, keys: string[], fallback: number | null = null): number | null | undefined {
  for (const k of keys) {
    if (!(k in (obj || {}))) continue;
    return num(obj?.[k], fallback);
  }
  return undefined;
}
function pickDate(obj: any, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj?.[k];
    if (v === undefined || v === null || v === "") continue;
    // Accept ISO date or ISO datetime
    const s = String(v).trim();
    if (!s) continue;
    // Normalize to YYYY-MM-DD if looks like date-time
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10);
    return s;
  }
  return undefined;
}

async function upsertByConflict(table: string, row: any, onConflict: string) {
  const { data, error } = await supabaseAdmin.from(table).upsert(row, { onConflict }).select("*").single();
  if (error) throw error;
  return data as any;
}
async function updateById(table: string, id: string, row: any) {
  const { data, error } = await supabaseAdmin.from(table).update(row).eq("id", id).select("*").single();
  if (error) throw error;
  return data as any;
}

function normalizeImageUrls(input: any): string[] | null | undefined {
  // explicit null => null
  if (input === null) return null;

  const v =
    input?.image_urls ??
    input?.imageUrls ??
    input?.thumbUrls ??
    input?.thumb_urls ??
    input?.images;

  if (v === undefined) return undefined;

  if (v === null) return null;
  if (Array.isArray(v)) {
    const cleaned = v
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter((x) => !!x);
    return cleaned.length ? cleaned : [];
  }
  return null;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const poNo = (searchParams.get("poNo") || "").trim();
    const id = (searchParams.get("id") || "").trim();

    if (!poNo && !id) return bad("poNo or id is required", 400);

    let headerQuery = supabaseAdmin.from("po_headers").select("*").eq("is_deleted", false);
    if (id) headerQuery = headerQuery.eq("id", id);
    else headerQuery = headerQuery.eq("po_no", poNo);

    const { data: header, error: hErr } = await headerQuery.maybeSingle();
    if (hErr) return bad(hErr.message, 500);
    if (!header) return bad("PO not found", 404);

    const { data: lines, error: lErr } = await supabaseAdmin
      .from("po_lines")
      .select("*")
      .eq("po_header_id", header.id)
      .eq("is_deleted", false)
      .order("line_no", { ascending: true });

    if (lErr) return bad(lErr.message, 500);

    return ok({ header, lines: lines || [] });
  } catch (e: any) {
    return bad(e?.message || "Unexpected error", 500);
  }
}

export async function DELETE(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const poNo = String(body?.poNo ?? body?.po_no ?? "").trim();
    if (!poNo) return bad("poNo is required", 400);

    const { data: header, error: hErr } = await supabaseAdmin
      .from("po_headers")
      .select("id")
      .eq("po_no", poNo)
      .eq("is_deleted", false)
      .maybeSingle();

    if (hErr) return bad(hErr.message, 500);
    if (!header?.id) return bad("PO not found", 404);

    // soft-delete lines
    const { error: lErr } = await supabaseAdmin
      .from("po_lines")
      .update({ is_deleted: true, updated_at: new Date().toISOString() })
      .eq("po_header_id", header.id);

    if (lErr) return bad(lErr.message, 500);

    // soft-delete header
    const { error: uErr } = await supabaseAdmin
      .from("po_headers")
      .update({ is_deleted: true, status: "DELETED", updated_at: new Date().toISOString() })
      .eq("id", header.id);

    if (uErr) return bad(uErr.message, 500);

    return ok();
  } catch (e: any) {
    return bad(e?.message || "Unexpected error", 500);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const headerIn = body?.header ?? body ?? {};
    const linesIn = body?.lines ?? headerIn?.lines ?? [];

    const poNo = String(headerIn?.po_no ?? headerIn?.poNo ?? body?.po_no ?? body?.poNo ?? "").trim();
    if (!poNo) return bad("PO No is required", 400);

    const buyerId = pickStr(headerIn, ["buyer_id", "buyerId"]);
    if (!buyerId || !isUuid(buyerId)) return bad("Buyer is required", 400);

    const status = (pickStr(headerIn, ["status"]) ?? "DRAFT").toUpperCase();
    const headerIdFromClient = pickStr(headerIn, ["id", "header_id", "headerId"]);
    const headerId = headerIdFromClient && isUuid(headerIdFromClient) ? headerIdFromClient : undefined;

    // Load existing header:
// - if client sent id => treat as UPDATE by id (and forbid po_no change)
// - else => treat as CREATE by po_no (exact match). If po_no already exists, reject to prevent overwrite.
let existingHeader: any = null;

if (headerId) {
  const { data: byId, error: byIdErr } = await supabaseAdmin
    .from("po_headers")
    .select("id, po_no, confirmed_at")
    .eq("id", headerId)
    .maybeSingle();
  if (byIdErr) throw byIdErr;
  existingHeader = byId;

  if (!existingHeader?.id) return bad("PO not found (invalid header id)", 404);

  const existingPoNo = str((existingHeader as any).po_no);
  if (existingPoNo && existingPoNo !== poNo) {
    return bad(
      `PO No cannot be changed from ${existingPoNo} to ${poNo}. Use 'Copy as New PO' instead.`,
      409
    );
  }
} else {
  const { data: byPo, error: byPoErr } = await supabaseAdmin
    .from("po_headers")
    .select("id, po_no, confirmed_at")
    .eq("po_no", poNo)
    .eq("is_deleted", false)
    .maybeSingle();
  if (byPoErr) throw byPoErr;
  existingHeader = byPo;

  if (existingHeader?.id) {
    return bad("PO No already exists. Open it and edit, or use 'Copy as New PO'.", 409);
  }
}

const effectiveHeaderId = headerId ?? undefined;


    // Snapshot brand/dept
    const buyerBrandName = str(
      headerIn.buyer_brand_name ??
        headerIn.buyerBrandName ??
        headerIn.buyer_brand ??
        headerIn.brand ??
        body?.buyer_brand_name ??
        body?.brand
    );
    const buyerDeptName = str(
      headerIn.buyer_dept_name ??
        headerIn.buyerDeptName ??
        headerIn.buyer_dept ??
        headerIn.dept ??
        body?.buyer_dept_name ??
        body?.dept
    );

    // HS CODE (po_headers.hs_code)
    const hsCode =
      pickStr(headerIn, ["hs_code", "hsCode", "hscode"]) ?? pickStr(body, ["hs_code", "hsCode", "hscode"]);

    // confirmed_at stamping
    let confirmedAt = pickDate(headerIn, ["confirmed_at", "confirmedAt"]);
    if (confirmedAt === undefined && status === "CONFIRMED" && !existingHeader?.confirmed_at) {
      confirmedAt = new Date().toISOString();
    }

    const headerRow: Record<string, any> = {
      id: effectiveHeaderId ?? undefined,
      po_no: poNo,
      buyer_id: buyerId,
      buyer_name: str(headerIn.buyer_name ?? headerIn.buyerName) ?? str(body?.buyer_name ?? body?.buyerName),
      
      buyer_brand_id: pickStr(headerIn, ["buyer_brand_id", "buyerBrandId"]) ?? null,
      buyer_department_id:
        pickStr(headerIn, ["buyer_department_id", "buyerDepartmentId"]) ??
        headerIn.buyer_department_id ??
        headerIn.buyer_dept_id ??
        null,

      buyer_brand_name: buyerBrandName,
      buyer_dept_name: buyerDeptName,

      hs_code: hsCode === undefined ? undefined : hsCode,

      // origin
      origin_code: pickStr(headerIn, ["origin_code", "originCode"]) ?? undefined,
      shipping_origin_code:
        pickStr(headerIn, ["shipping_origin_code", "shippingOriginCode"]) ??
        pickStr(headerIn, ["origin_code", "originCode"]) ??
        undefined,

      // dates & terms
      order_type: pickStr(headerIn, ["order_type", "orderType"]) ?? undefined,
      order_date: pickDate(headerIn, ["order_date", "orderDate"]) ?? undefined,
      requested_ship_date: pickDate(headerIn, ["requested_ship_date", "requestedShipDate", "reqShipDate"]) ?? undefined,
      cancel_date: pickDate(headerIn, ["cancel_date", "cancelDate"]) ?? undefined,

      ship_mode: pickStr(headerIn, ["ship_mode", "shipMode", "shipmentMode"]) ?? undefined,
      incoterm: pickStr(headerIn, ["incoterm"]) ?? undefined,
      final_destination: pickStr(headerIn, ["final_destination", "finalDestination"]) ?? undefined,
      destination: pickStr(headerIn, ["destination"]) ?? undefined,
      currency: pickStr(headerIn, ["currency"]) ?? undefined,

      // payment terms
      payment_term_id: pickStr(headerIn, ["payment_term_id", "paymentTermId"]) ?? undefined,
      payment_term:
        pickStr(headerIn, ["payment_term", "paymentTerm"]) ?? str(headerIn.payment_term) ?? undefined,

      // sample targets
      approval_sample_target_date: pickDate(headerIn, ["approval_sample_target_date", "approvalSampleTargetDate"]) ?? undefined,
      pp_sample_target_date: pickDate(headerIn, ["pp_sample_target_date", "ppSampleTargetDate"]) ?? undefined,
      top_sample_target_date: pickDate(headerIn, ["top_sample_target_date", "topSampleTargetDate"]) ?? undefined,
      final_sample_target_date: pickDate(headerIn, ["final_sample_target_date", "finalSampleTargetDate"]) ?? undefined,

      status,
      subtotal:
        pickNum(headerIn, ["subtotal", "subtotal_amount", "subtotalAmount"], null) ??
        pickNum(body, ["subtotal", "subtotal_amount", "subtotalAmount"], null) ??
        undefined,
      confirmed_at: confirmedAt ?? undefined,

      created_by: headerIn.created_by ?? undefined,
      created_by_email: str(headerIn.created_by_email) ?? undefined,
      updated_by: headerIn.updated_by ?? undefined,
      updated_by_email: str(headerIn.updated_by_email) ?? undefined,

      updated_at: new Date().toISOString(),
      is_deleted: false,
    };

    // Auto set confirmed_at when status becomes CONFIRMED (and caller didn't send confirmed_at)
    if ((headerRow.status || "").toUpperCase() === "CONFIRMED" && !headerRow.confirmed_at) {
      headerRow.confirmed_at = new Date().toISOString();
    }

    // Save header
let savedHeader: any;

if (effectiveHeaderId) {
  // UPDATE by id (po_no change already blocked above)
  savedHeader = await updateById("po_headers", effectiveHeaderId, { ...headerRow, id: undefined });
} else {
  // CREATE new (po_no duplicate already blocked above)
  savedHeader = await upsertByConflict("po_headers", headerRow, "po_no");
}

const poHeaderId = savedHeader?.id as string | undefined;
    if (!poHeaderId) return bad("Saved header but missing id", 500);

    // Lines: upsert by line_no (keep existing image urls if UI didn't send)
    // Lines: update/insert by (id if provided) else by line_no.
// To avoid accidental overwrites when payload contains duplicate/invalid line_no,
// we normalize line numbers to be unique (fallback to sequential 1..N).
const linesRaw = Array.isArray(linesIn) ? linesIn : [];
const lines = linesRaw.map((x: any) => x ?? {});

const parsedLineNos = lines.map((ln: any, i: number) => {
  const n = Number(ln?.line_no ?? ln?.lineNo);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : i + 1;
});
const hasDupLineNo = new Set(parsedLineNos).size !== parsedLineNos.length;
const useSequentialLineNo = hasDupLineNo;



    // Load existing ACTIVE lines for this header (keyed by line_no)
    const { data: existingActiveLines, error: linesErr } = await supabaseAdmin
      .from("po_lines")
      .select("id,line_no,is_deleted,image_url,image_urls,main_image_url")
      .eq("po_header_id", poHeaderId)
      .eq("is_deleted", false);

    if (linesErr) return bad(linesErr.message || "Failed to load existing PO lines", 500);

    const byLineNo = new Map<number, any>();
    for (const r of existingActiveLines || []) {
      const ln = Number((r as any).line_no);
      if (!Number.isNaN(ln)) byLineNo.set(ln, r);
    }

    const keepIds: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const ln: any = lines[i] || {};
      const lineNo = useSequentialLineNo ? i + 1 : ((num(ln.line_no ?? ln.lineNo ?? i + 1, i + 1) as number) ?? i + 1);

      const existing = byLineNo.get(lineNo);

      const qty = (num(ln.qty, 0) as number) || 0;
      const unitPrice = (num(ln.unit_price ?? ln.unitPrice ?? ln.price, 0) as number) || 0;
      // amount: prefer explicit amount; else qty*unitPrice
      const amount =
        (num(ln.amount, null) as number | null) !== null
          ? (num(ln.amount, 0) as number)
          : qty && unitPrice
          ? qty * unitPrice
          : 0;

      const base: any = {
        po_header_id: poHeaderId,
        line_no: lineNo,

        buyer_style_no: str(ln.buyer_style_no ?? ln.buyerStyleNo),
        jm_style_no: str(ln.jm_style_no ?? ln.jmStyleNo ?? ln.style_no ?? ln.styleNo),
        description: str(ln.description),

        color: str(ln.color),
        size: str(ln.size),
        uom: str(ln.uom ?? ln.unit) ?? "PCS",
        remark: str(ln.remark),

        qty,
        unit_price: unitPrice,
        amount,

        currency: str(ln.currency) ?? str(savedHeader?.currency),
        hs_code: str(ln.hs_code ?? ln.hsCode),
        upc: str(ln.upc),
        plating_color: str(ln.plating_color ?? ln.platingColor),

        is_deleted: false,
        updated_at: new Date().toISOString(),
      };

      // Delivery/Shipment on line optional (fallback to header)
      const deliveryDate = pickDate(ln, ["delivery_date", "deliveryDate"]) ?? headerRow.requested_ship_date ?? undefined;
      const shipmentMode = pickStr(ln, ["ship_mode", "shipmentMode", "shipMode"]) ?? headerRow.ship_mode ?? undefined;
      if (deliveryDate !== undefined) base.delivery_date = deliveryDate;
      if (shipmentMode !== undefined) base.ship_mode = shipmentMode;

      // Image fields
      const image_url = strUndefIfEmpty(ln.image_url ?? ln.imageUrl);
      const main_image_url = strUndefIfEmpty(ln.main_image_url ?? ln.mainImageUrl);

      if (image_url !== undefined) base.image_url = image_url;
      if (main_image_url !== undefined) base.main_image_url = main_image_url;

      // image_urls jsonb: overwrite only if explicitly provided by client
      // ✅ FIX: accept images/thumbUrls too
      const normalized = normalizeImageUrls(ln);
      if (
        "image_urls" in ln ||
        "imageUrls" in ln ||
        "thumbUrls" in ln ||
        "thumb_urls" in ln ||
        "images" in ln
      ) {
        base.image_urls = normalized;
      }

      // If client did NOT provide image_url but did provide image_urls, set image_url to first one for convenience
      if (base.image_url === undefined && Array.isArray(base.image_urls) && base.image_urls.length > 0) {
        base.image_url = base.image_urls[0];
      }
      if (base.main_image_url === undefined && base.image_url) {
        base.main_image_url = base.image_url;
      }

      if (existing?.id) {
        const { error: upErr } = await supabaseAdmin.from("po_lines").update(base).eq("id", existing.id);
        if (upErr) return bad(upErr.message || "Failed to update PO line", 500);
        keepIds.push(existing.id);
      } else {
        const { data: ins, error: inErr } = await supabaseAdmin.from("po_lines").insert(base).select("id").single();
        if (inErr) return bad(inErr.message || "Failed to insert PO line", 500);
        if (ins?.id) keepIds.push(ins.id);
      }
    }

    // Soft-delete lines missing from payload (ACTIVE only)
    if (keepIds.length > 0) {
      const idList = keepIds.map((id) => `"${id}"`).join(",");
      const { error: delErr } = await supabaseAdmin
        .from("po_lines")
        .update({ is_deleted: true, updated_at: new Date().toISOString() })
        .eq("po_header_id", poHeaderId)
        .eq("is_deleted", false)
        .not("id", "in", `(${idList})`);

      if (delErr) return bad(delErr.message || "Failed to remove missing lines", 500);
    } else {
      const { error: delAllErr } = await supabaseAdmin
        .from("po_lines")
        .update({ is_deleted: true, updated_at: new Date().toISOString() })
        .eq("po_header_id", poHeaderId)
        .eq("is_deleted", false);

      if (delAllErr) return bad(delAllErr.message || "Failed to remove lines", 500);
    }

    return ok({
      header_id: poHeaderId,
      headerId: poHeaderId,
      po_no: savedHeader.po_no ?? poNo,
      poNo: savedHeader.po_no ?? poNo,
      status: savedHeader.status ?? status,
    });
  } catch (e: any) {
    const msg = e?.message || String(e);
    if (msg.toLowerCase().includes("duplicate") && msg.toLowerCase().includes("po_no")) {
      return bad("Duplicate PO NO", 409, { details: msg });
    }
    return bad(msg, 500);
  }
}
