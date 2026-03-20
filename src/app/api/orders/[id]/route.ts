// src/app/api/orders/[id]/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assertApiPermission } from "@/lib/api-guard";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(v: any) {
  return typeof v === "string" && UUID_RE.test(v);
}
function safeTrim(v: any) {
  return (v ?? "").toString().trim();
}
function isEmpty(v: any) {
  return safeTrim(v) === "";
}
function str(v: any): string | null {
  const s = safeTrim(v);
  return s ? s : null;
}
function strUndefIfEmpty(v: any): string | undefined {
  const s = safeTrim(v);
  return s ? s : undefined;
}
function num(v: any, fallback: number | null = 0): number | null {
  if (v === undefined || v === null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function intNum(v: any, fallback = 0): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.trunc(n));
}
function pickDate(obj: any, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj?.[k];
    if (v === undefined || v === null || v === "") continue;
    const s = String(v).trim();
    if (!s) continue;
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10);
    return s;
  }
  return undefined;
}

function normalizeImageUrls(input: any): string[] | null | undefined {
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
      .filter(Boolean);
    return cleaned.length ? cleaned : [];
  }

  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return [];
    if (s.startsWith("[") && s.endsWith("]")) {
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) {
          const cleaned = parsed
            .map((x) => (typeof x === "string" ? x.trim() : ""))
            .filter(Boolean);
          return cleaned.length ? cleaned : [];
        }
      } catch {
        // ignore
      }
    }
    return [s];
  }

  return null;
}

async function loadBuyerDefaults(buyerId: string) {
  if (!buyerId || !isUuid(buyerId)) return null;

  const { data, error } = await supabaseAdmin
    .from("companies")
    .select(
      "buyer_default_incoterm, buyer_consignee, buyer_notify_party, buyer_payment_term_id, buyer_payment_term, buyer_default_ship_mode, buyer_final_destination"
    )
    .eq("id", buyerId)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

async function resolveBrandName(brandId: string) {
  if (!brandId || !isUuid(brandId)) return "";

  const { data, error } = await supabaseAdmin
    .from("buyer_brands")
    .select("id, brand_name, name")
    .eq("id", brandId)
    .maybeSingle();

  if (error) {
    console.warn("resolveBrandName error:", error?.message);
    return "";
  }

  return safeTrim((data as any)?.brand_name ?? (data as any)?.name);
}

async function loadExistingLineByIdOrLineNo(
  poHeaderId: string,
  incomingLine: any,
  fallbackLineNo: number
) {
  const incomingId = safeTrim(incomingLine?.id);

  if (incomingId && isUuid(incomingId)) {
    const { data, error } = await supabaseAdmin
      .from("po_lines")
      .select("id, line_no, image_url, image_urls, main_image_url, is_deleted")
      .eq("id", incomingId)
      .eq("po_header_id", poHeaderId)
      .maybeSingle();

    if (error) throw error;
    if (data?.id) return data;
  }

  const lineNoRaw =
    incomingLine?.line_no ?? incomingLine?.lineNo ?? fallbackLineNo;
  const lineNo = intNum(lineNoRaw, fallbackLineNo);

  const { data, error } = await supabaseAdmin
    .from("po_lines")
    .select(
      "id, line_no, image_url, image_urls, main_image_url, is_deleted, updated_at"
    )
    .eq("po_header_id", poHeaderId)
    .eq("line_no", lineNo)
    .eq("is_deleted", false)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  return Array.isArray(data) && data.length > 0 ? data[0] : null;
}

/**
 * GET /api/orders/[id]
 * - PO 헤더/라인 조회 (소프트삭제 제외)
 * - shipped_qty / remaining_qty 포함
 */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const guard = await assertApiPermission("po.view");
    if (guard) return guard;

    const poHeaderId = params?.id;

    if (!poHeaderId || !isUuid(poHeaderId)) {
      return NextResponse.json(
        { success: false, error: "Valid PO Header ID (uuid) is required" },
        { status: 400 }
      );
    }

    const { data: header, error: headerErr } = await supabaseAdmin
      .from("po_headers")
      .select("*")
      .eq("id", poHeaderId)
      .eq("is_deleted", false)
      .maybeSingle();

    if (headerErr) {
      console.error("Read PO Header Error:", headerErr);
      return NextResponse.json(
        { success: false, error: headerErr.message },
        { status: 500 }
      );
    }

    if (!header?.id) {
      return NextResponse.json(
        { success: false, error: "PO Header not found" },
        { status: 404 }
      );
    }

    const { data: lines, error: linesErr } = await supabaseAdmin
      .from("po_lines")
      .select("*")
      .eq("po_header_id", poHeaderId)
      .eq("is_deleted", false)
      .order("line_no", { ascending: true });

    if (linesErr) {
      console.error("Read PO Lines Error:", linesErr);
      return NextResponse.json(
        { success: false, error: linesErr.message },
        { status: 500 }
      );
    }

    const baseLines = (lines ?? []) as any[];
    const lineIds = baseLines
      .map((r) => String(r?.id || ""))
      .filter((v) => isUuid(v));

    const shippedMap = new Map<string, number>();
    if (lineIds.length > 0) {
      const { data: shipRows, error: shipErr } = await supabaseAdmin
        .from("shipment_lines")
        .select("po_line_id, shipped_qty")
        .in("po_line_id", lineIds);

      if (shipErr) {
        console.error("Load shipment_lines error:", shipErr);
      } else {
        for (const r of shipRows ?? []) {
          const id = String((r as any).po_line_id || "");
          const q = Number((r as any).shipped_qty ?? 0);
          if (!id) continue;
          shippedMap.set(id, (shippedMap.get(id) ?? 0) + (Number.isFinite(q) ? q : 0));
        }
      }
    }

    const enrichedLines = baseLines.map((r) => {
      const ordered = Number((r as any).qty ?? 0) || 0;
      const cancelled =
        Number((r as any).qty_cancelled ?? (r as any).cancel_qty ?? 0) || 0;
      const shipped = shippedMap.get(String((r as any).id)) ?? 0;
      const remaining = Math.max(0, ordered - shipped - cancelled);

      return {
        ...r,
        shipped_qty: shipped,
        qty_cancelled: cancelled,
        remaining_qty: remaining,
      };
    });

    return NextResponse.json({ success: true, header, lines: enrichedLines });
  } catch (err: any) {
    console.error("Get PO Fatal:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/orders/[id]
 * - 기존 PO 수정 저장
 * - 헤더 + 라인 동시 저장
 * - po_no 변경 금지
 * - payload에 없는 기존 라인은 soft-delete
 */
export async function PUT(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const guard = await assertApiPermission("po.edit");
    if (guard) return guard;

    const poHeaderId = params?.id;

    if (!poHeaderId || !isUuid(poHeaderId)) {
      return NextResponse.json(
        { success: false, error: "Valid PO Header ID (uuid) is required" },
        { status: 400 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const headerIn = (body?.header ?? body ?? {}) as any;
    const linesIn = Array.isArray(body?.lines) ? body.lines : [];
    const totalsIn = (body?.totals ?? {}) as any;

    const { data: existing, error: existErr } = await supabaseAdmin
      .from("po_headers")
      .select("*")
      .eq("id", poHeaderId)
      .maybeSingle();

    if (existErr) {
      console.error("Read PO Header Error:", existErr);
      return NextResponse.json(
        { success: false, error: existErr.message },
        { status: 500 }
      );
    }

    if (!existing?.id) {
      return NextResponse.json(
        { success: false, error: "PO Header not found" },
        { status: 404 }
      );
    }

    if (existing.is_deleted === true) {
      return NextResponse.json(
        { success: false, error: "This PO is deleted." },
        { status: 409 }
      );
    }

    const existingPoNo = safeTrim(existing?.po_no);
    const incomingPoNo =
      headerIn?.po_no !== undefined ? safeTrim(headerIn?.po_no) : "";

    if (!isEmpty(incomingPoNo) && !isEmpty(existingPoNo) && incomingPoNo !== existingPoNo) {
      return NextResponse.json(
        {
          success: false,
          error:
            `PO No cannot be changed (existing: ${existingPoNo}, incoming: ${incomingPoNo}). ` +
            `Use "Copy as New PO" to create a new PO instead.`,
        },
        { status: 409 }
      );
    }

    const now = new Date().toISOString();

    const buyer_id = safeTrim(headerIn?.buyer_id) || safeTrim(existing?.buyer_id);
    const buyerDefaults = await loadBuyerDefaults(buyer_id).catch((e) => {
      console.error("loadBuyerDefaults error:", e);
      return null;
    });

    const incomingBrandId = safeTrim(headerIn?.buyer_brand_id);
    const existingBrandId = safeTrim(existing?.buyer_brand_id);
    const brandIdToSave = incomingBrandId || existingBrandId || null;

    let brandNameToSave =
      safeTrim(headerIn?.buyer_brand_name) ||
      safeTrim(headerIn?.brand) ||
      safeTrim(existing?.buyer_brand_name);

    if (brandIdToSave) {
      const resolved = await resolveBrandName(brandIdToSave);
      if (!isEmpty(resolved)) brandNameToSave = resolved;
    }

    const incomingIncoterm = safeTrim(headerIn?.incoterm);
    const existingIncoterm = safeTrim(existing?.incoterm);
    const companyDefaultIncoterm = safeTrim(buyerDefaults?.buyer_default_incoterm);

    const incotermToSave =
      !isEmpty(incomingIncoterm)
        ? incomingIncoterm
        : !isEmpty(existingIncoterm)
        ? existingIncoterm
        : companyDefaultIncoterm;

    const patch: Record<string, any> = {
      updated_at: now,
    };

    const allow = [
      "buyer_id",
      "buyer_name",
      "buyer_code",
      "order_type",
      "order_date",
      "requested_ship_date",
      "origin_code",
      "payment_term_id",
      "payment_term",
      "currency",
      "final_destination",
      "destination",
      "port_of_loading",
      "ship_mode",
      "carrier",
      "remarks",
      "cancel_date",
      "cancel_reason",
      "status",
      "shipping_origin_code",
      "approval_sample_target_date",
      "pp_sample_target_date",
      "top_sample_target_date",
      "final_sample_target_date",
      "updated_by",
      "updated_by_email",
      "created_by",
      "created_by_email",
    ];

    for (const k of allow) {
      if (headerIn?.[k] !== undefined) patch[k] = headerIn[k];
    }

    if (buyer_id) patch.buyer_id = buyer_id;
    patch.buyer_brand_id = brandIdToSave;
    patch.buyer_brand_name = brandNameToSave || null;
    patch.buyer_dept_name =
      safeTrim(headerIn?.buyer_dept_name) ||
      safeTrim(headerIn?.department) ||
      safeTrim(headerIn?.dept) ||
      safeTrim(existing?.buyer_dept_name) ||
      null;

    patch.incoterm = incotermToSave || null;

    if (
      patch.payment_term_id &&
      typeof patch.payment_term_id === "string" &&
      patch.payment_term_id.startsWith("TEMP-")
    ) {
      patch.payment_term_id = null;
    }

    if (patch.payment_term === undefined) {
      patch.payment_term =
        safeTrim(headerIn?.payment_term) ||
        safeTrim(existing?.payment_term) ||
        safeTrim(buyerDefaults?.buyer_payment_term) ||
        null;
    }

    if (patch.ship_mode === undefined) {
      patch.ship_mode =
        safeTrim(headerIn?.ship_mode) ||
        safeTrim(existing?.ship_mode) ||
        safeTrim(buyerDefaults?.buyer_default_ship_mode) ||
        null;
    }

    if (patch.destination === undefined && patch.final_destination === undefined) {
      const fallbackDest =
        safeTrim(headerIn?.destination) ||
        safeTrim(existing?.destination) ||
        safeTrim(buyerDefaults?.buyer_final_destination) ||
        null;
      patch.destination = fallbackDest;
    }

    if (patch.shipping_origin_code === undefined) {
      patch.shipping_origin_code =
        safeTrim(headerIn?.shipping_origin_code) ||
        safeTrim(existing?.shipping_origin_code) ||
        null;
    }

    if (
      String(patch.status ?? existing?.status ?? "").toUpperCase() === "CONFIRMED" &&
      !existing?.confirmed_at
    ) {
      patch.confirmed_at = now;
    }

    if (totalsIn?.subtotal !== undefined) {
      const subtotal = num(totalsIn.subtotal, null);
      if (subtotal !== null) patch.subtotal = subtotal;
    }

    const { data: updatedHeader, error: upErr } = await supabaseAdmin
      .from("po_headers")
      .update(patch)
      .eq("id", poHeaderId)
      .select("*")
      .maybeSingle();

    if (upErr) {
      console.error("Update PO Header Error:", upErr);
      return NextResponse.json(
        { success: false, error: upErr.message },
        { status: 500 }
      );
    }

    const incomingLines = Array.isArray(linesIn) ? linesIn : [];
    const keepIds: string[] = [];

    const parsedLineNos = incomingLines.map((ln: any, i: number) => {
      const raw = ln?.line_no ?? ln?.lineNo ?? i + 1;
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : i + 1;
    });
    const hasDupLineNo = new Set(parsedLineNos).size !== parsedLineNos.length;
    const useSequentialLineNo = hasDupLineNo;

    for (let i = 0; i < incomingLines.length; i++) {
      const ln = incomingLines[i] ?? {};
      const lineNo = useSequentialLineNo
        ? i + 1
        : intNum(ln?.line_no ?? ln?.lineNo, i + 1);

      const existingLine = await loadExistingLineByIdOrLineNo(poHeaderId, ln, lineNo);

      const qty = intNum(ln?.qty, 0);
      const qtyCancelled = intNum(
        ln?.qty_cancelled ?? ln?.cancel_qty ?? existingLine?.qty_cancelled,
        0
      );
      const unitPrice = Number(num(ln?.unit_price ?? ln?.unitPrice ?? ln?.price, 0) ?? 0);
      const amount =
        num(ln?.amount, null) !== null
          ? Number(num(ln?.amount, 0) ?? 0)
          : Math.round(qty * unitPrice * 100) / 100;

      const base: Record<string, any> = {
        po_header_id: poHeaderId,
        line_no: lineNo,

        buyer_style_no: str(ln?.buyer_style_no ?? ln?.buyerStyleNo),
        jm_style_no: str(ln?.jm_style_no ?? ln?.jmStyleNo ?? ln?.style_no ?? ln?.styleNo),
        description: str(ln?.description),

        color: str(ln?.color),
        size: str(ln?.size),
        plating_color: str(ln?.plating_color ?? ln?.platingColor),
        hs_code: str(ln?.hs_code ?? ln?.hsCode),
        upc: str(ln?.upc),

        uom: str(ln?.uom ?? ln?.unit) ?? "PCS",
        remark: str(ln?.remark),

        qty,
        qty_cancelled: qtyCancelled,
        amount,
        unit_price: unitPrice,

        currency: str(ln?.currency) ?? str(updatedHeader?.currency),
        is_deleted: false,
        updated_at: now,
      };

      const deliveryDate =
        pickDate(ln, ["delivery_date", "deliveryDate"]) ??
        pickDate(headerIn, ["requested_ship_date", "requestedShipDate"]) ??
        pickDate(existing, ["requested_ship_date"]);
      const shipmentMode =
        strUndefIfEmpty(ln?.ship_mode ?? ln?.shipMode ?? ln?.shipmentMode) ??
        strUndefIfEmpty(headerIn?.ship_mode) ??
        strUndefIfEmpty(updatedHeader?.ship_mode);

      if (deliveryDate !== undefined) base.delivery_date = deliveryDate;
      if (shipmentMode !== undefined) base.ship_mode = shipmentMode;

      const imageUrl = strUndefIfEmpty(ln?.image_url ?? ln?.imageUrl);
      const mainImageUrl = strUndefIfEmpty(ln?.main_image_url ?? ln?.mainImageUrl);
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

      if (imageUrl !== undefined) base.image_url = imageUrl;
      if (mainImageUrl !== undefined) base.main_image_url = mainImageUrl;

      if (base.image_url === undefined && Array.isArray(base.image_urls) && base.image_urls.length > 0) {
        base.image_url = base.image_urls[0];
      }
      if (base.main_image_url === undefined && base.image_url) {
        base.main_image_url = base.image_url;
      }

      if (existingLine?.id) {
        const { error: lineUpErr } = await supabaseAdmin
          .from("po_lines")
          .update(base)
          .eq("id", existingLine.id);

        if (lineUpErr) {
          console.error("Update PO Line Error:", lineUpErr);
          return NextResponse.json(
            { success: false, error: lineUpErr.message },
            { status: 500 }
          );
        }
        keepIds.push(existingLine.id);
      } else {
        const { data: inserted, error: lineInErr } = await supabaseAdmin
          .from("po_lines")
          .insert(base)
          .select("id")
          .single();

        if (lineInErr) {
          console.error("Insert PO Line Error:", lineInErr);
          return NextResponse.json(
            { success: false, error: lineInErr.message },
            { status: 500 }
          );
        }
        if (inserted?.id) keepIds.push(inserted.id);
      }
    }

    if (keepIds.length > 0) {
      const idList = keepIds.map((id) => `"${id}"`).join(",");
      const { error: delErr } = await supabaseAdmin
        .from("po_lines")
        .update({ is_deleted: true, updated_at: now })
        .eq("po_header_id", poHeaderId)
        .eq("is_deleted", false)
        .not("id", "in", `(${idList})`);

      if (delErr) {
        console.error("Soft Delete Missing Lines Error:", delErr);
        return NextResponse.json(
          { success: false, error: delErr.message },
          { status: 500 }
        );
      }
    } else {
      const { error: delAllErr } = await supabaseAdmin
        .from("po_lines")
        .update({ is_deleted: true, updated_at: now })
        .eq("po_header_id", poHeaderId)
        .eq("is_deleted", false);

      if (delAllErr) {
        console.error("Soft Delete All Lines Error:", delAllErr);
        return NextResponse.json(
          { success: false, error: delAllErr.message },
          { status: 500 }
        );
      }
    }

    const { data: savedLines, error: readLinesErr } = await supabaseAdmin
      .from("po_lines")
      .select("*")
      .eq("po_header_id", poHeaderId)
      .eq("is_deleted", false)
      .order("line_no", { ascending: true });

    if (readLinesErr) {
      console.error("Read Saved Lines Error:", readLinesErr);
    }

    return NextResponse.json({
      success: true,
      header: updatedHeader,
      header_id: poHeaderId,
      headerId: poHeaderId,
      po_no: updatedHeader?.po_no ?? existingPoNo,
      poNo: updatedHeader?.po_no ?? existingPoNo,
      lines: savedLines ?? [],
      linesReceived: incomingLines.length,
    });
  } catch (err: any) {
    console.error("Update PO Fatal:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const guard = await assertApiPermission("po.delete");
    if (guard) return guard;

    const poHeaderId = params?.id;

    if (!poHeaderId || !isUuid(poHeaderId)) {
      return NextResponse.json(
        { success: false, error: "Valid PO Header ID (uuid) is required" },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    const { data: headerRow, error: headerGetErr } = await supabaseAdmin
      .from("po_headers")
      .select("id, is_deleted")
      .eq("id", poHeaderId)
      .maybeSingle();

    if (headerGetErr) {
      console.error("Read PO Header Error:", headerGetErr);
      return NextResponse.json(
        { success: false, error: headerGetErr.message },
        { status: 500 }
      );
    }

    if (!headerRow?.id) {
      return NextResponse.json(
        { success: false, error: "PO Header not found" },
        { status: 404 }
      );
    }

    if (headerRow.is_deleted === true) {
      return NextResponse.json({ success: true, alreadyDeleted: true });
    }

    const { error: lineErr } = await supabaseAdmin
      .from("po_lines")
      .update({
        is_deleted: true,
        updated_at: now,
      })
      .eq("po_header_id", poHeaderId);

    if (lineErr) {
      console.error("Soft Delete PO Lines Error:", lineErr);
      return NextResponse.json(
        { success: false, error: lineErr.message },
        { status: 500 }
      );
    }

    const { error: headerErr } = await supabaseAdmin
      .from("po_headers")
      .update({
        is_deleted: true,
        status: "DELETED",
        updated_at: now,
      })
      .eq("id", poHeaderId);

    if (headerErr) {
      console.error("Soft Delete PO Header Error:", headerErr);
      return NextResponse.json(
        { success: false, error: headerErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("Delete PO Fatal:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}