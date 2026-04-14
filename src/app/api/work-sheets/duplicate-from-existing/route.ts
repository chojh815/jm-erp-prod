/**
 * src/app/api/work-sheets/duplicate-from-existing/route.ts
 *
 * Duplicate planned Work Sheet structure from an existing WS into a target PO line.
 * - target is always the NEW PO line
 * - source is an EXISTING WS / WS line
 * - planned fields copied
 * - actual / confirmed / vendor delivery tracking reset
 *
 * IMPORTANT:
 * - This version is schema-safe.
 * - It only hard-writes columns we have high confidence exist in the current DB.
 * - Optional columns are updated one-by-one and silently skipped if missing in schema cache.
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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
function bad(message: string, status = 400) {
  return jsonNoStore({ success: false, error: message }, status);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isUuid(v: any) {
  return typeof v === "string" && UUID_RE.test(v);
}
function s(v: any) {
  return (v ?? "").toString().trim();
}
function n(v: any, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}
function yyMM(d = new Date()) {
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yy}${mm}`;
}
function isMissingColumnError(errMsg: string, col: string) {
  if (!errMsg) return false;
  return (
    errMsg.includes(`'${col}'`) &&
    (errMsg.toLowerCase().includes("schema cache") ||
      errMsg.toLowerCase().includes("does not exist"))
  );
}

async function getNextWsNo(prefix2: string) {
  const yymm = yyMM();
  const prefix = `${prefix2}-${yymm}`;

  let latest: string | null = null;

  {
    const { data, error } = await supabaseAdmin
      .from("work_sheet_headers")
      .select("ws_no")
      .eq("is_deleted", false)
      .ilike("ws_no", `${prefix}%`)
      .order("ws_no", { ascending: false })
      .limit(1);

    if (!error && Array.isArray(data) && data[0]?.ws_no) {
      latest = String(data[0].ws_no);
    }
  }

  if (!latest) {
    const { data, error } = await supabaseAdmin
      .from("work_sheet_headers")
      .select("work_sheet_no")
      .eq("is_deleted", false)
      .ilike("work_sheet_no", `${prefix}%`)
      .order("work_sheet_no", { ascending: false })
      .limit(1);

    if (!error && Array.isArray(data) && data[0]?.work_sheet_no) {
      latest = String(data[0].work_sheet_no);
    }
  }

  let nextSeq = 1;
  if (latest) {
    const m = latest.match(/(\d{3})$/);
    if (m) nextSeq = Number(m[1]) + 1;
  }
  const seq = String(nextSeq).padStart(3, "0");
  return `${prefix}${seq}`;
}

async function ensureTargetWorksheet(po_header_id: string, po_line_id: string) {
  const { data: poHRows, error: poHErr } = await supabaseAdmin
    .from("po_headers")
    .select("*")
    .eq("id", po_header_id)
    .limit(1);
  if (poHErr) throw new Error(poHErr.message);
  const poH: any = poHRows?.[0];
  if (!poH) throw new Error("PO header not found");

  const { data: poLRows, error: poLErr } = await supabaseAdmin
    .from("po_lines")
    .select("*")
    .eq("id", po_line_id)
    .limit(1);
  if (poLErr) throw new Error(poLErr.message);
  const poL: any = poLRows?.[0];
  if (!poL) throw new Error("PO line not found");

  const buyer_id = poH.buyer_id ?? poL.buyer_id ?? null;
  const po_no = poH.po_no ?? poL.po_no ?? null;
  const currency = poH.currency ?? poL.currency ?? null;

  let buyer_name: string | null = poH.buyer_name ?? null;
  let buyer_code_full: string | null = poH.buyer_code ?? null;

  if (buyer_id) {
    const { data: comps, error: cErr } = await supabaseAdmin
      .from("companies")
      .select("id, company_name, code")
      .eq("id", buyer_id)
      .limit(1);

    if (!cErr && comps?.[0]) {
      buyer_name = comps[0].company_name ?? buyer_name;
      buyer_code_full = comps[0].code ?? buyer_code_full;
    }
  }

  const buyerCode2 =
    (buyer_code_full ? String(buyer_code_full).trim().slice(0, 2) : "WS").toUpperCase();

  const { data: existingRows, error: exErr } = await supabaseAdmin
    .from("work_sheet_headers")
    .select("*")
    .eq("is_deleted", false)
    .eq("po_line_id", po_line_id)
    .limit(1);

  if (exErr) throw new Error(exErr.message);

  let header: any = existingRows?.[0] ?? null;
  const nowIso = new Date().toISOString();

  if (!header) {
    const wsNo = await getNextWsNo(buyerCode2);
    const insertPayload: any = {
      po_header_id,
      po_line_id,
      po_no,
      buyer_id,
      buyer_name,
      buyer_code: buyer_code_full,
      currency,
      status: "DRAFT",
      ship_mode: poL.ship_mode ?? poH.ship_mode ?? null,
      requested_ship_date: poH.requested_ship_date ?? poL.delivery_date ?? null,
      buyer_style_no: poL.buyer_style_no ?? poL.buyer_style ?? null,
      buyer_brand_name: poH.buyer_brand_name ?? poL.buyer_brand_name ?? poH.buyer_brand ?? null,
      buyer_dept_name: poH.buyer_dept_name ?? poL.buyer_dept_name ?? null,
      ws_no: wsNo,
      work_sheet_no: wsNo,
      created_at: nowIso,
      updated_at: nowIso,
      is_deleted: false,
    };

    const { data: ins, error: insErr } = await supabaseAdmin
      .from("work_sheet_headers")
      .insert(insertPayload)
      .select("*")
      .single();

    if (insErr) throw new Error(insErr.message);
    header = ins;
  } else {
    const patch: any = {
      po_header_id,
      po_line_id,
      po_no,
      buyer_id,
      buyer_name: header.buyer_name ?? buyer_name,
      buyer_code: header.buyer_code ?? buyer_code_full,
      currency: header.currency ?? currency,
      ship_mode: header.ship_mode ?? (poL.ship_mode ?? poH.ship_mode ?? null),
      requested_ship_date:
        header.requested_ship_date ?? (poH.requested_ship_date ?? poL.delivery_date ?? null),
      buyer_style_no: header.buyer_style_no ?? (poL.buyer_style_no ?? poL.buyer_style ?? null),
      buyer_brand_name:
        header.buyer_brand_name ??
        (poH.buyer_brand_name ?? poL.buyer_brand_name ?? poH.buyer_brand ?? null),
      buyer_dept_name: header.buyer_dept_name ?? (poH.buyer_dept_name ?? poL.buyer_dept_name ?? null),
      updated_at: nowIso,
    };

    const { data: upd, error: updErr } = await supabaseAdmin
      .from("work_sheet_headers")
      .update(patch)
      .eq("id", header.id)
      .select("*")
      .single();

    if (updErr) throw new Error(updErr.message);
    header = upd;
  }

  const { data: lineRows, error: lineErr } = await supabaseAdmin
    .from("work_sheet_lines")
    .select("*")
    .eq("is_deleted", false)
    .eq("work_sheet_id", header.id)
    .eq("po_line_id", po_line_id)
    .limit(1);

  if (lineErr) throw new Error(lineErr.message);

  let line: any = lineRows?.[0] ?? null;
  const baseLinePatch: any = {
    work_sheet_id: header.id,
    po_line_id,
    product_id: poL.product_id ?? null,
    qty: Number(poL.qty ?? 0),
    jm_style_no: poL.jm_style_no ?? poL.jm_no ?? header.jm_no ?? null,
    buyer_style: poL.buyer_style_no ?? poL.buyer_style ?? null,
    description: poL.description ?? null,
    plating_color: poL.plating_color ?? poL.plating ?? null,
    image_url_primary: poL.image_url_primary ?? poL.image_url ?? null,
    image_urls: poL.image_urls ?? poL.images ?? null,
    vendor_id: poL.vendor_id ?? null,
    vendor_currency: poL.vendor_currency ?? null,
    vendor_unit_cost_local: poL.vendor_unit_cost_local ?? null,
    product_dev_id: poL.product_dev_id ?? null,
    updated_at: nowIso,
    is_deleted: false,
  };

  if (!line) {
    const { data: insLine, error: insLErr } = await supabaseAdmin
      .from("work_sheet_lines")
      .insert({
        ...baseLinePatch,
        created_at: nowIso,
      })
      .select("*")
      .single();

    if (insLErr) throw new Error(insLErr.message);
    line = insLine;
  } else {
    const { data: updLine, error: updLErr } = await supabaseAdmin
      .from("work_sheet_lines")
      .update(baseLinePatch)
      .eq("id", line.id)
      .select("*")
      .single();

    if (updLErr) throw new Error(updLErr.message);
    line = updLine;
  }

  return { header, line };
}

async function loadSourceHeader(source_work_sheet_id: string) {
  const { data, error } = await supabaseAdmin
    .from("work_sheet_headers")
    .select("*")
    .eq("id", source_work_sheet_id)
    .eq("is_deleted", false)
    .limit(1);
  if (error) throw new Error(error.message);
  const row = data?.[0];
  if (!row) throw new Error("Source work sheet header not found");
  return row;
}

async function loadSourceLine(source_work_sheet_id: string, source_work_sheet_line_id?: string | null) {
  let q = supabaseAdmin
    .from("work_sheet_lines")
    .select("*")
    .eq("work_sheet_id", source_work_sheet_id)
    .eq("is_deleted", false)
    .limit(1);

  if (source_work_sheet_line_id) {
    q = q.eq("id", source_work_sheet_line_id);
  }

  const { data, error } = await q.order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  const row = data?.[0];
  if (!row) throw new Error("Source work sheet line not found");
  return row;
}

async function replaceTargetMaterials(target_line_id: string, source_line_id: string) {
  const { data: sourceRows, error: sourceErr } = await supabaseAdmin
    .from("work_sheet_material_specs")
    .select("*")
    .eq("work_sheet_line_id", source_line_id)
    .eq("is_deleted", false)
    .order("sort_order", { ascending: true });

  if (sourceErr) throw new Error(sourceErr.message);

  const source = Array.isArray(sourceRows) ? sourceRows : [];

  const delRes = await supabaseAdmin
    .from("work_sheet_material_specs")
    .delete()
    .eq("work_sheet_line_id", target_line_id);

  if (delRes.error && !isMissingColumnError(delRes.error.message ?? "", "is_deleted")) {
    throw new Error(delRes.error.message);
  }

  if (source.length === 0) return;

  const nowIso = new Date().toISOString();
  const insertRows = source.map((r: any, idx: number) => ({
    work_sheet_line_id: target_line_id,
    material_type: r.material_type ?? null,
    material_name: r.material_name ?? "",
    spec_text: r.spec_text ?? null,
    color: r.color ?? null,
    source_policy: r.source_policy ?? "FREE",
    source_vendor_id: r.source_vendor_id ?? null,
    source_vendor_text: r.source_vendor_text ?? null,
    note: r.note ?? null,
    sort_order: r.sort_order ?? idx + 1,
    is_deleted: false,
    actual_qty: null,
    actual_unit_cost: null,
    actual_note: null,
    created_at: nowIso,
    updated_at: nowIso,
  }));

  const { error: insErr } = await supabaseAdmin
    .from("work_sheet_material_specs")
    .insert(insertRows);

  if (insErr) throw new Error(insErr.message);
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const po_header_id = s(url.searchParams.get("po_header_id"));
    const po_line_id = s(url.searchParams.get("po_line_id"));
    const q = s(url.searchParams.get("q")).toLowerCase();

    if (!isUuid(po_header_id)) return bad("Invalid po_header_id", 400);
    if (!isUuid(po_line_id)) return bad("Invalid po_line_id", 400);

    const { data: targetPoHRows, error: tphErr } = await supabaseAdmin
      .from("po_headers")
      .select("id, buyer_id, buyer_name")
      .eq("id", po_header_id)
      .limit(1);
    if (tphErr) return bad(tphErr.message, 500);
    const targetPoH: any = targetPoHRows?.[0];
    if (!targetPoH) return bad("Target PO not found", 404);

    const { data: targetPoLRows, error: tplErr } = await supabaseAdmin
      .from("po_lines")
      .select("id, jm_style_no, buyer_style_no, description")
      .eq("id", po_line_id)
      .limit(1);
    if (tplErr) return bad(tplErr.message, 500);
    const targetPoL: any = targetPoLRows?.[0];
    if (!targetPoL) return bad("Target PO line not found", 404);

    const { data: sourceLines, error: linesErr } = await supabaseAdmin
      .from("work_sheet_lines")
      .select("id, work_sheet_id, po_line_id, jm_style_no, buyer_style, description, updated_at, is_deleted")
      .eq("is_deleted", false)
      .order("updated_at", { ascending: false })
      .limit(300);

    if (linesErr) return bad(linesErr.message, 500);

    const lines = (sourceLines ?? []).filter((r: any) => s(r.work_sheet_id) && s(r.id));
    const wsIds = Array.from(new Set(lines.map((r: any) => String(r.work_sheet_id)).filter(Boolean)));

    const { data: headers, error: hdrErr } = await supabaseAdmin
      .from("work_sheet_headers")
      .select("id, ws_no, work_sheet_no, po_no, buyer_name, buyer_id, status, updated_at, is_deleted")
      .in("id", wsIds)
      .eq("is_deleted", false);

    if (hdrErr) return bad(hdrErr.message, 500);

    const headerMap = new Map<string, any>((headers ?? []).map((h: any) => [String(h.id), h]));

    const targetJm = s(targetPoL.jm_style_no).toUpperCase();
    const targetBuyerStyle = s(targetPoL.buyer_style_no).toUpperCase();
    const targetBuyerId = s(targetPoH.buyer_id);

    let rows = lines
      .map((ln: any) => {
        const h = headerMap.get(String(ln.work_sheet_id));
        if (!h) return null;

        const jm = s(ln.jm_style_no).toUpperCase();
        const buyerStyle = s(ln.buyer_style).toUpperCase();

        let score = 0;
        if (targetJm && jm && targetJm === jm) score += 100;
        if (targetBuyerStyle && buyerStyle && targetBuyerStyle === buyerStyle) score += 80;
        if (targetBuyerId && s(h.buyer_id) === targetBuyerId) score += 20;
        if (score <= 0 && !q) return null;

        return {
          source_work_sheet_id: String(h.id),
          source_work_sheet_line_id: String(ln.id),
          ws_no: h.ws_no ?? h.work_sheet_no ?? null,
          po_no: h.po_no ?? null,
          buyer_name: h.buyer_name ?? null,
          jm_style_no: ln.jm_style_no ?? null,
          buyer_style: ln.buyer_style ?? null,
          description: ln.description ?? null,
          updated_at: ln.updated_at ?? h.updated_at ?? null,
          score,
        };
      })
      .filter(Boolean) as any[];

    if (q) {
      rows = rows.filter((r) => {
        const hay = [
          r.ws_no,
          r.po_no,
          r.buyer_name,
          r.jm_style_no,
          r.buyer_style,
          r.description,
        ]
          .map((v: any) => s(v).toLowerCase())
          .join(" ");
        return hay.includes(q);
      });
    }

    rows.sort((a, b) => {
      const sdiff = n(b.score, 0) - n(a.score, 0);
      if (sdiff !== 0) return sdiff;
      const ad = s(a.updated_at);
      const bd = s(b.updated_at);
      return bd.localeCompare(ad);
    });

    return ok({ rows: rows.slice(0, 50) });
  } catch (e: any) {
    console.error(e);
    return bad(e?.message ?? "Server error", 500);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const target_po_header_id = s(body?.target_po_header_id);
    const target_po_line_id = s(body?.target_po_line_id);
    const source_work_sheet_id = s(body?.source_work_sheet_id);
    const source_work_sheet_line_id = s(body?.source_work_sheet_line_id) || null;

    if (!isUuid(target_po_header_id)) return bad("Invalid target_po_header_id", 400);
    if (!isUuid(target_po_line_id)) return bad("Invalid target_po_line_id", 400);
    if (!isUuid(source_work_sheet_id)) return bad("Invalid source_work_sheet_id", 400);
    if (source_work_sheet_line_id && !isUuid(source_work_sheet_line_id)) {
      return bad("Invalid source_work_sheet_line_id", 400);
    }

    const sourceHeader = await loadSourceHeader(source_work_sheet_id);
    const sourceLine = await loadSourceLine(source_work_sheet_id, source_work_sheet_line_id);

    const { header: targetHeader, line: targetLine } = await ensureTargetWorksheet(
      target_po_header_id,
      target_po_line_id
    );

    const nowIso = new Date().toISOString();

    // header: hard-write only confirmed-safe column, optional columns one by one
    const reqHdrErr = await supabaseAdmin
      .from("work_sheet_headers")
      .update({
        updated_at: nowIso,
        internal_notes: sourceHeader.internal_notes ?? sourceHeader.notes ?? null,
      })
      .eq("id", targetHeader.id);

    if (reqHdrErr.error) throw new Error(reqHdrErr.error.message);

    const optionalHeaderFields = [
      ["special_instructions", sourceHeader.special_instructions ?? sourceHeader.general_notes ?? null],
      ["general_notes", sourceHeader.general_notes ?? sourceHeader.special_instructions ?? null],
      ["notes", sourceHeader.notes ?? sourceHeader.internal_notes ?? null],
    ] as const;

    for (const [col, value] of optionalHeaderFields) {
      const { error } = await supabaseAdmin
        .from("work_sheet_headers")
        .update({ [col]: value, updated_at: nowIso })
        .eq("id", targetHeader.id);
      if (error && !isMissingColumnError(error.message ?? "", col)) {
        throw new Error(error.message);
      }
    }

    // line: hard-write only core columns, optional fields one by one
    const reqLineRes = await supabaseAdmin
      .from("work_sheet_lines")
      .update({
        updated_at: nowIso,
        plating_spec: sourceLine.plating_spec ?? null,
        spec_summary: sourceLine.spec_summary ?? null,
        work_notes: sourceLine.work_notes ?? null,
        qc_points: sourceLine.qc_points ?? null,
        packing_notes: sourceLine.packing_notes ?? null,
        production_mode: sourceLine.production_mode ?? null,
        vendor_id: sourceLine.vendor_id ?? null,
        vendor_currency: sourceLine.vendor_currency ?? null,
        vendor_unit_cost_local: sourceLine.vendor_unit_cost_local ?? null,
      })
      .eq("id", targetLine.id);

    if (reqLineRes.error) throw new Error(reqLineRes.error.message);

    const optionalLineFields = [
      ["vendor_unit_cost_usd", sourceLine.vendor_unit_cost_usd ?? null],
      ["fx_rate", sourceLine.fx_rate ?? null],
      ["fx_as_of", sourceLine.fx_as_of ?? null],
      ["fx_mode", sourceLine.fx_mode ?? null],

      ["actual_vendor_unit_cost_local", null],
      ["actual_vendor_unit_cost_usd", null],
      ["actual_fx_rate", null],
      ["actual_fx_as_of", null],
      ["actual_fx_mode", null],
      ["actual_cost_confirmed", false],
      ["actual_cost_confirmed_at", null],
      ["actual_cost_confirmed_by", null],
      ["actual_cost_notes", null],

      ["vendor_ready_date", null],
      ["vendor_delivery_status", null],
      ["vendor_delay_days", null],
    ] as const;

    for (const [col, value] of optionalLineFields) {
      const { error } = await supabaseAdmin
        .from("work_sheet_lines")
        .update({ [col]: value, updated_at: nowIso })
        .eq("id", targetLine.id);
      if (error && !isMissingColumnError(error.message ?? "", col)) {
        throw new Error(error.message);
      }
    }

    await replaceTargetMaterials(String(targetLine.id), String(sourceLine.id));

    return ok({
      work_sheet_id: targetHeader.id,
      source_work_sheet_id,
      target_work_sheet_id: targetHeader.id,
    });
  } catch (e: any) {
    console.error(e);
    return bad(e?.message ?? "Server error", 500);
  }
}
