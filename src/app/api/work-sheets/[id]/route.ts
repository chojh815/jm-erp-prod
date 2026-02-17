/**
 * src/app/api/work-sheets/[id]/route.ts
 *
 * Based on your LONG reference file + your DB schema screenshots:
 *
 * ✅ 핵심 목표
 * 1) Save 후 화면에서 값이 "사라지는" 문제 해결
 *    - 원인: UI가 general_notes/notes 를 보는데, API는 special_instructions/internal_notes만 저장/응답하거나,
 *            저장 직후 응답에서 general_notes/notes가 null로 내려오며 프론트가 state를 덮어써서 입력값이 사라짐.
 *    - 해결: header 저장/응답 시
 *        special_instructions <-> general_notes
 *        internal_notes       <-> notes
 *      를 항상 동기화(둘 다 update)하고, GET 응답에서도 alias를 채워서 내려줌.
 *
 * 2) ws_no 같은 컬럼 미존재 참조로 500 나지 않게 (이 파일은 id 상세이므로 select("*")만 유지)
 * 3) line(Plating Spec / Spec Summary / Work/QC/Packing) 저장/응답 유지
 *
 * NOTE:
 * - work_sheet_headers 테이블에는 (스크린샷 기준) special_instructions, general_notes, internal_notes, notes 모두 존재.
 * - 그래도 환경/캐시 문제로 "schema cache" 에러가 나면, 컬럼 drop & retry로 안전 처리.
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// ✅ Prod(erp.jm-i.com)에서 저장 후에도 "이전 값"이 보이는 현상은
// CDN/브라우저 캐시 또는 Next 데이터 캐시가 API 응답을 재사용해서 생길 수 있습니다.
// 이 route는 항상 최신 DB 값을 내려줘야 하므로, 캐시를 완전히 끕니다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
  "Surrogate-Control": "no-store",
};

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data }, { headers: NO_STORE_HEADERS });
}
function bad(message: string, status = 400) {
  return NextResponse.json(
    { success: false, error: message },
    { status, headers: NO_STORE_HEADERS }
  );
}

function sanitizeVendorView(payload: any) {
  // Defensive: strip any internal/pricing fields from header/lines/materials when view=vendor.
  const stripKeys = (obj: any) => {
    if (!obj || typeof obj !== "object") return;
    for (const k of Object.keys(obj)) {
      const lk = k.toLowerCase();
      if (
        lk.includes("price") ||
        lk.includes("cost") ||
        lk.includes("amount") ||
        lk.includes("margin") ||
        lk.includes("fx") ||
        lk.includes("rate") ||
        lk.includes("etd") ||
        (lk.includes("ship") && lk.includes("date")) ||
        lk === "internal_notes" ||
        lk === "notes" ||
        lk === "created_by_email"
      ) {
        delete obj[k];
      }
    }
  };

  if (payload?.header) stripKeys(payload.header);
  if (Array.isArray(payload?.lines)) payload.lines.forEach(stripKeys);
  if (payload?.materialsByLineId && typeof payload.materialsByLineId === "object") {
    for (const lineId of Object.keys(payload.materialsByLineId)) {
      const arr = payload.materialsByLineId[lineId];
      if (Array.isArray(arr)) arr.forEach(stripKeys);
    }
  }
  // keep special instructions visible to vendor if present
  if (payload?.header?.special_instructions == null && payload?.header?.general_notes) {
    payload.header.special_instructions = payload.header.general_notes;
  }
  return payload;
}


const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isUuid(v: any) {
  return typeof v === "string" && UUID_RE.test(v);
}
function safeText(v: any) {
   return (v ?? "").toString().trim();
}
 
function isBlank(v: any) {
  return !safeText(v).trim();
}

function pickFirst(obj: any, keys: string[]) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== null && v !== undefined && !isBlank(v)) return v;
  }
  return null;
}

/** Supabase(PostgREST) schema cache missing-column 에러 감지 */
function isSchemaCacheMissingColumn(err: any) {
  const msg = String(err?.message ?? "");
  // ex) Could not find the 'internal_notes' column of 'work_sheet_headers' in the schema cache
  const m = msg.match(/Could not find the '([^']+)' column.*schema cache/i);
  return { ok: !!m, col: m?.[1] ?? null, msg };
}

/**
 * Try multiple queries and return the first that doesn't error.
 */
async function firstWorking<T>(
  tries:
    | Array<() => Promise<{ data: T | null; error: any | null }>>
    | (() => Promise<{ data: T | null; error: any | null }>)
): Promise<{ data: T | null; error: any | null }> {
  let lastErr: any = null;
  const list = Array.isArray(tries) ? tries : [tries];
  for (const fn of list) {
    try {
      const r = await fn();
      if (!r?.error) return r;
      lastErr = r.error;
    } catch (e: any) {
      lastErr = e;
    }
  }
  return { data: null, error: lastErr };
}

// ---- WS Line enrichment from PO lines + images (response-time only) ----
async function enrichLinesFromPo(wsLines: any[]) {
  try {
    const poLineIds = (wsLines ?? [])
      .map((l: any) => l?.po_line_id)
      .filter((v: any) => isUuid(v));

    if (poLineIds.length === 0) return;

    // 1) PO lines (safe: select("*") to avoid schema-cache issues)
    const { data: poLines, error: poErr } = await supabaseAdmin
      .from("po_lines")
      .select("*")
      .in("id", poLineIds);

    const poMap: Record<string, any> = {};
    if (!poErr && Array.isArray(poLines)) {
      for (const r of poLines) {
        const id = (r as any)?.id;
        if (isUuid(id)) poMap[id] = r;
      }
    }

    // 2) Images (support both po_line_images and po_images)
    const imgRowsResult = await firstWorking<any[]>([
      async () =>
        supabaseAdmin
          .from("po_line_images")
          .select("*")
          .in("po_line_id", poLineIds)
          .or("is_deleted.is.null,is_deleted.eq.false")
          .order("created_at", { ascending: true }),
      async () =>
        supabaseAdmin
          .from("po_images")
          .select("*")
          .in("po_line_id", poLineIds)
          .or("is_deleted.is.null,is_deleted.eq.false")
          .order("created_at", { ascending: true }),
    ]);

    const imgMap: Record<string, string[]> = {};
    const imgRows = Array.isArray(imgRowsResult.data) ? imgRowsResult.data : [];
    for (const r of imgRows) {
      const plid = (r as any)?.po_line_id;
      if (!isUuid(plid)) continue;

      const url =
        (r as any)?.image_url ??
        (r as any)?.url ??
        (r as any)?.public_url ??
        (r as any)?.path ??
        null;

      if (!url) continue;
      if (!imgMap[plid]) imgMap[plid] = [];
      imgMap[plid].push(String(url));
    }

    // 3) Apply enrichment (do not overwrite if WS line already has values)
    for (const l of wsLines ?? []) {
      const poLineId = (l as any)?.po_line_id;
      if (!isUuid(poLineId)) continue;

      const pl = poMap[poLineId] ?? null;
      const imgs = imgMap[poLineId] ?? [];

      // qty
      const currentQty = (l as any)?.qty;
      if (currentQty === null || currentQty === undefined || currentQty === 0) {
        const q =
          (pl as any)?.order_qty ??
          (pl as any)?.qty ??
          (pl as any)?.quantity ??
          (pl as any)?.order_quantity ??
          null;
        if (q !== null && q !== undefined && q !== "") (l as any).qty = Number(q) || 0;
      }

      // buyer_style / description
      if (isBlank((l as any)?.buyer_style)) {
        (l as any).buyer_style =
          (pl as any)?.buyer_style_no ??
          (pl as any)?.buyer_style ??
          (pl as any)?.buyer_sku ??
          (pl as any)?.sku ??
          null;
      }
      if (isBlank((l as any)?.description)) {
        (l as any).description =
          (pl as any)?.description ??
          (pl as any)?.item_description ??
          (pl as any)?.product_name ??
          null;
      }

      // jm_style_no (fallback)
      if (isBlank((l as any)?.jm_style_no)) {
        (l as any).jm_style_no =
          (pl as any)?.jm_style_no ??
          (pl as any)?.style_no ??
          (pl as any)?.jm_no ??
          (l as any)?.style_no ??
          "";
      }

      // images
      if (!((l as any)?.image_url_primary) && imgs.length > 0) {
        (l as any).image_url_primary = imgs[0] ?? null;
      }
      if (!((l as any)?.image_urls) && imgs.length > 0) {
        (l as any).image_urls = imgs;
      }
    }
  } catch {
    // ignore enrichment failures; main WS still must render
  }
}


/**
 * Product Development (dev) table names are inconsistent across environments.
 * We support both:
 * - dev_product_materials / dev_product_operations
 * - product_development_materials / product_development_operations
 */
async function loadDevProductIdByStyle(styleNo: string): Promise<number | null> {
  const style_no = safeText(styleNo).trim();
  if (!style_no) return null;

  const r = await firstWorking<any>(async () => {
  return await supabaseAdmin
    .from("product_development_headers")
    .select("id, style_no, deleted_at, is_deleted")
    .eq("style_no", style_no)
    .maybeSingle();
});

  if (r.error) return null;
  const id = (r.data as any)?.id;
  if (typeof id === "number") return id;
  const n = Number(id);
  return Number.isFinite(n) ? n : null;
}

async function loadDevMaterials(productId: number) {
  const pid = productId;

  const r = await firstWorking<any[]>([
    async () =>
      supabaseAdmin
        .from("dev_product_materials")
        .select("*")
        .eq("product_id", pid)
        .is("deleted_at", null)
        .order("row_index", { ascending: true })
        .order("created_at", { ascending: true }),
    async () =>
      supabaseAdmin
        .from("product_development_materials")
        .select("*")
        .eq("product_id", pid)
        .is("deleted_at", null)
        .order("row_index", { ascending: true })
        .order("created_at", { ascending: true }),
  ]);

  if (r.error) return [];
  return Array.isArray(r.data) ? r.data : [];
}

async function loadDevOperations(productId: number) {
  const pid = productId;

  const r = await firstWorking<any[]>([
    async () =>
      supabaseAdmin
        .from("dev_product_operations")
        .select("*")
        .eq("product_id", pid)
        .is("deleted_at", null)
        .order("row_index", { ascending: true })
        .order("created_at", { ascending: true }),
    async () =>
      supabaseAdmin
        .from("product_development_operations")
        .select("*")
        .eq("product_id", pid)
        .is("deleted_at", null)
        .order("row_index", { ascending: true })
        .order("created_at", { ascending: true }),
  ]);

  if (r.error) return [];
  return Array.isArray(r.data) ? r.data : [];
}

function toWsMaterialRow(opts: {
  work_sheet_line_id: string;
  kind: "MATERIAL" | "OPERATION";
  name: string;
  qty?: any;
  unit_cost?: any;
  spec?: any;
  color?: any;
  sort_order?: number;
  source_policy?: "MANDATORY" | "PREFERRED" | "FREE";
}) {
  const qty = opts.qty ?? null;
  const unit_cost = opts.unit_cost ?? null;
  const noteParts: string[] = [];
  if (qty !== null && qty !== undefined && qty !== "") noteParts.push(`QTY=${qty}`);
  if (unit_cost !== null && unit_cost !== undefined && unit_cost !== "")
    noteParts.push(`UNIT_COST=${unit_cost}`);
  const note = noteParts.join(", ");

  return {
    id: `DEV-${opts.kind}-${opts.work_sheet_line_id}-${opts.sort_order ?? 0}-${opts.name}`,
    work_sheet_line_id: opts.work_sheet_line_id,
    material_type: opts.kind,
    material_name: opts.name,
    spec_text: opts.spec ?? null,
    color_text: opts.color ?? null,
    source_policy: opts.source_policy ?? "PREFERRED",
    note: note || null,
    sort_order: opts.sort_order ?? 0,
    is_deleted: false,
    created_at: null,
    updated_at: null,
  };
}

/**
 * Header alias normalize:
 * - UI가 general_notes/notes 를 쓰더라도 값이 유지되도록 응답에서 항상 채움.
 * - special_instructions <-> general_notes
 * - internal_notes       <-> notes
 */
function normalizeHeaderAliases(header: any) {
  const h = { ...(header ?? {}) };

  const special =
    !isBlank(h.special_instructions) ? h.special_instructions :
    !isBlank(h.general_notes) ? h.general_notes :
    !isBlank(h.notes) ? h.notes :
    "";

  const internal =
    !isBlank(h.internal_notes) ? h.internal_notes :
    !isBlank(h.notes) ? h.notes :
    !isBlank(h.internal_memo) ? h.internal_memo :
    "";

  // Fill both sets so UI/legacy code won't "clear" on save
  h.special_instructions = special;
  h.general_notes = special;

  h.internal_notes = internal;
  h.notes = internal;
  h.internal_memo = internal; // harmless alias for some older UI

  return h;
}

/**
 * Update work_sheet_headers safely:
 * - Try to update a patch with multiple columns.
 * - If schema cache says a column is missing, drop that column and retry.
 */
async function safeUpdateHeader(workSheetId: string, patch: any) {
  const p: any = { ...(patch ?? {}) };
  // always touch updated_at when we update anything
  if (Object.keys(p).length > 0 && !("updated_at" in p)) {
    p.updated_at = new Date().toISOString();
  }

  let tries = 0;
  while (true) {
    if (Object.keys(p).length === 0) return { ok: true };

    const { error } = await supabaseAdmin
      .from("work_sheet_headers")
      .update(p)
      .eq("id", workSheetId);

    if (!error) return { ok: true };

    const miss = isSchemaCacheMissingColumn(error);
    if (miss.ok && miss.col && (miss.col in p) && tries < 12) {
      delete p[miss.col];
      tries++;
      continue;
    }

    return { ok: false, error };
  }
}

async function loadAll(workSheetId: string) {
  // 0) header
  const { data: headerRaw, error: hErr } = await supabaseAdmin
    .from("work_sheet_headers")
    .select("*")
    .eq("id", workSheetId)
    .maybeSingle();

  if (hErr) throw new Error(hErr.message);
  if (!headerRaw) {
    return {
      header: null,
      lines: [],
      materialsByLineId: {},
      po: null,
    };
  }

  // ✅ normalize header aliases for response
  const header = normalizeHeaderAliases(headerRaw);

  // 1) lines
  const { data: lines, error: lErr } = await supabaseAdmin
    .from("work_sheet_lines")
    .select("*")
    .eq("work_sheet_id", workSheetId)
    .or("is_deleted.is.null,is_deleted.eq.false")
    .order("created_at", { ascending: true });

  if (lErr) throw new Error(lErr.message);
  const safeLines = Array.isArray(lines) ? lines : [];

  // ✅ Enrich WS lines with PO line info (qty, buyer_style, description) and images.
  // Production Status open-or-create may create minimal WS lines, so we backfill display fields on GET.
  // This does NOT write to DB; it's response-time enrichment only.
  await enrichLinesFromPo(safeLines);

  const lineIds = safeLines.map((l: any) => l.id).filter(isUuid);

  // ✅ Work/QC/Packing notes are stored in work_sheet_lines.
  // For PDF/UI convenience, copy the master line notes into header aliases.
  const masterLineId =
    (header as any)?.master_line_id ??
    (header as any)?.primary_line_id ??
    (header as any)?.work_sheet_line_id ??
    (header as any)?.work_sheet_lineid ??
    null;

  const line0 =
    // 1) prefer explicit master/primary line id if present
    (masterLineId
      ? safeLines.find((x: any) => isUuid(x?.id) && x.id === masterLineId)
      : null) ??
    // 2) otherwise, pick the first line that actually has any notes filled
    safeLines.find((x: any) => {
      const w = pickFirst(x, ["work_notes", "work_note", "work_instruction", "work_instructions"]);
      const q = pickFirst(x, ["qc_points", "qc_note", "qc_notes"]);
      const p = pickFirst(x, ["packing_notes", "packing_note", "packing_memo"]);
      const vc = pickFirst(x, ["vendor_currency"]);
      const vu = pickFirst(x, ["vendor_unit_cost_local"]);
      // If vendor price fields are present on any line, we also want to treat it as the "master" for PDF/UI.
      return !isBlank(w) || !isBlank(q) || !isBlank(p) || !isBlank(vc) || !isBlank(vu);
    }) ??
    // 3) fallback to the first line (stable)
    safeLines[0] ??
    null;

  if (line0) {
    const w = pickFirst(line0, ["work_notes", "work_note", "work_instruction", "work_instructions"]);
    const q = pickFirst(line0, ["qc_points", "qc_note", "qc_notes"]);
    const p = pickFirst(line0, ["packing_notes", "packing_note", "packing_memo"]);

    // ✅ Vendor price fields live in work_sheet_lines. Many screens/PDF read from header,
    // so we mirror them onto header for convenience.
    const vc = pickFirst(line0, ["vendor_currency"]);
    const vu = pickFirst(line0, ["vendor_unit_cost_local"]);

    (header as any).work_notes = w ?? "";
    (header as any).work_note = w ?? "";
    (header as any).qc_points = q ?? "";
    (header as any).qc_note = q ?? "";
    (header as any).packing_notes = p ?? "";
    (header as any).packing_note = p ?? "";

    (header as any).vendor_currency = vc ?? (header as any).vendor_currency ?? "";
    (header as any).vendor_unit_cost_local =
      vu ?? (header as any).vendor_unit_cost_local ?? null;
  } else {
    (header as any).work_notes = (header as any).work_notes ?? (header as any).work_note ?? "";
    (header as any).work_note = (header as any).work_note ?? (header as any).work_notes ?? "";
    (header as any).qc_points = (header as any).qc_points ?? (header as any).qc_note ?? "";
    (header as any).qc_note = (header as any).qc_note ?? (header as any).qc_points ?? "";
    (header as any).packing_notes = (header as any).packing_notes ?? (header as any).packing_note ?? "";
    (header as any).packing_note = (header as any).packing_note ?? (header as any).packing_notes ?? "";

    (header as any).vendor_currency = (header as any).vendor_currency ?? "";
    (header as any).vendor_unit_cost_local = (header as any).vendor_unit_cost_local ?? null;
  }

  // 2) materials snapshot
  const materialsByLineId: Record<string, any[]> = {};
  for (const id of lineIds) materialsByLineId[id] = [];

  if (lineIds.length > 0) {
    const { data: mats, error: mErr } = await supabaseAdmin
      .from("work_sheet_material_specs")
      .select("*")
      .in("work_sheet_line_id", lineIds)
      .eq("is_deleted", false)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (mErr) throw new Error(mErr.message);

    for (const r of mats ?? []) {
      const k = (r as any).work_sheet_line_id;
      if (!materialsByLineId[k]) materialsByLineId[k] = [];
      materialsByLineId[k].push(r);
    }
  }

  // 2-b) Fallback: if snapshot is empty, read from Product Development
  for (const line of safeLines) {
    const lineId = (line as any)?.id;
    if (!isUuid(lineId)) continue;

    const current = materialsByLineId[lineId] ?? [];
    if (current.length > 0) continue;

    const productDevIdRaw = (line as any).product_dev_id ?? (line as any).product_id ?? null;
    let devProductId: number | null = null;

    if (typeof productDevIdRaw === "number") devProductId = productDevIdRaw;
    else if (
      typeof productDevIdRaw === "string" &&
      productDevIdRaw.trim() &&
      !isUuid(productDevIdRaw)
    ) {
      const n = Number(productDevIdRaw);
      if (Number.isFinite(n)) devProductId = n;
    }

    if (!devProductId) {
      const styleNo = (line as any).style_no ?? (line as any).jm_style_no ?? null;
      devProductId = await loadDevProductIdByStyle(styleNo ?? "");
    }
    if (!devProductId) continue;

    const devMats = await loadDevMaterials(devProductId);
    const devOps = await loadDevOperations(devProductId);

    const merged: any[] = [];

    for (const m of devMats) {
      const name = m.material_name ?? m.name ?? m.material ?? "";
      if (!safeText(name).trim()) continue;
      merged.push(
        toWsMaterialRow({
          work_sheet_line_id: lineId,
          kind: "MATERIAL",
          name: safeText(name),
          qty: (m as any).qty ?? null,
          unit_cost: (m as any).unit_cost ?? null,
          spec: (m as any).material_spec ?? (m as any).spec_text ?? (m as any).spec ?? null,
          color: (m as any).color_text ?? (m as any).color ?? null,
          sort_order: Number((m as any).row_index ?? (m as any).sort_order ?? 0) || 0,
          source_policy: "PREFERRED",
        })
      );
    }

    for (const o of devOps) {
      const name = o.operation_name ?? o.name ?? o.operation ?? "";
      if (!safeText(name).trim()) continue;
      merged.push(
        toWsMaterialRow({
          work_sheet_line_id: lineId,
          kind: "OPERATION",
          name: safeText(name),
          qty: (o as any).qty ?? null,
          unit_cost: (o as any).unit_cost ?? null,
          spec: (o as any).operation_spec ?? (o as any).spec_text ?? (o as any).spec ?? null,
          color: (o as any).color_text ?? (o as any).color ?? null,
          sort_order: Number((o as any).row_index ?? (o as any).sort_order ?? 0) || 0,
          source_policy: "PREFERRED",
        })
      );
    }

    if (merged.length > 0) {
      merged.sort((a, b) => {
        const ta = a.material_type === "MATERIAL" ? 0 : 1;
        const tb = b.material_type === "MATERIAL" ? 0 : 1;
        if (ta !== tb) return ta - tb;
        const sa = Number(a.sort_order ?? 0) || 0;
        const sb = Number(b.sort_order ?? 0) || 0;
        if (sa !== sb) return sa - sb;
        return safeText(a.material_name).localeCompare(safeText(b.material_name));
      });
      materialsByLineId[lineId] = merged;
    }
  }

  // 3) PO resolve (po_header_id -> po_headers)
  let po: any = null;
  const poHeaderId = isUuid((header as any)?.po_header_id) ? (header as any).po_header_id : null;
  if (poHeaderId) {
    const { data: poH, error: poErr } = await supabaseAdmin
      .from("po_headers")
      .select("*")
      .eq("id", poHeaderId)
      .maybeSingle();
    if (!poErr) po = poH ?? null;
  }

  return { header, lines: safeLines, materialsByLineId, po };
}

function withNoteAliases(data: any) {
  const h: any = data?.header ?? {};
  const special = (h.special_instructions ?? h.general_notes ?? "") as any;
  const internal = (h.internal_notes ?? h.notes ?? "") as any;
  const work = (h.work_notes ?? h.work_note ?? "") as any;
  const qc = (h.qc_points ?? h.qc_note ?? "") as any;
  const packing = (h.packing_notes ?? h.packing_note ?? "") as any;

  // root-level aliases (some UIs read these directly)
  return {
    ...data,
    special_instructions: special,
    general_notes: special,
    internal_notes: internal,
    notes: internal,
    work_notes: work,
    work_note: work,
    qc_points: qc,
    qc_note: qc,
    packing_notes: packing,
    packing_note: packing,
    notes_bundle: { special, internal, work, qc, packing },
  };
}


export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = params?.id;
    if (!isUuid(id)) return bad("Invalid id", 400);

    const data = await loadAll(id);
    if (!data.header) return bad("Work sheet not found", 404);

    return ok(withNoteAliases(data));
  } catch (e: any) {
    return bad(e?.message ?? "Server error", 500);
  }
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = params?.id;
    if (!isUuid(id)) return bad("Invalid id", 400);

    const body = await req.json().catch(() => null);

    // ✅ Confirm Actual Cost (lock) - margin management
    if (body?.confirm_actual_cost === true) {
      const { error: lockErr } = await supabaseAdmin
        .from("work_sheet_lines")
        .update({ actual_cost_confirmed: true })
        .eq("work_sheet_id", id);

      if (lockErr) {
        return NextResponse.json(
          { success: false, error: lockErr.message },
          { status: 500 }
        );
      }

      return NextResponse.json({ success: true });
    }
    if (!body) return bad("Invalid JSON body", 400);

    const headerPatch = body?.header ?? null;
    const linesPatch = Array.isArray(body?.lines) ? body.lines : [];

    const materialsPatch = body?.materialsByLineId && typeof body.materialsByLineId === "object" ? body.materialsByLineId : null;

    // 1) header update
    if (headerPatch && typeof headerPatch === "object") {
      const normalized: any = { ...(headerPatch as any) };

      // Accept legacy/front aliases
      // UI might send general_notes/notes even if DB uses special_instructions/internal_notes
      const special =
        !isBlank(normalized.special_instructions) ? normalized.special_instructions :
        !isBlank(normalized.general_notes) ? normalized.general_notes :
        "";

      const internal =
        !isBlank(normalized.internal_notes) ? normalized.internal_notes :
        !isBlank(normalized.notes) ? normalized.notes :
        !isBlank(normalized.internal_memo) ? normalized.internal_memo :
        "";

      // Update stable columns
      const stableAllowed = ["status", "updated_by", "updated_by_email"];
      const patch: any = {};
      for (const k of stableAllowed) {
        if (k in normalized) patch[k] = (normalized as any)[k];
      }

      // ✅ 핵심: 둘 다 동기화해서 저장 (DB에 둘 다 존재한다고 가정하되, 캐시/환경 문제는 safeUpdate가 처리)
      if (!isBlank(special) || ("special_instructions" in normalized) || ("general_notes" in normalized)) {
        patch.special_instructions = isBlank(special) ? null : safeText(special);
        patch.general_notes = isBlank(special) ? null : safeText(special);
      }
      if (!isBlank(internal) || ("internal_notes" in normalized) || ("notes" in normalized) || ("internal_memo" in normalized)) {
        patch.internal_notes = isBlank(internal) ? null : safeText(internal);
        patch.notes = isBlank(internal) ? null : safeText(internal);
      }

      const r = await safeUpdateHeader(id, patch);
      if (!r.ok) {
        // If even after dropping missing cols it fails, surface the real error
        return bad((r as any).error?.message ?? "Header update error", 500);
      }

    // 1-b) If header carries Work/QC/Packing notes, persist into master line (work_sheet_lines)
    if (headerPatch && typeof headerPatch === "object") {
      const h: any = headerPatch as any;
      const w = h.work_notes ?? h.work_note;
      const q = h.qc_points ?? h.qc_note;
      const p = h.packing_notes ?? h.packing_note;

      if (w !== undefined || q !== undefined || p !== undefined) {
        const { data: hdr0 } = await supabaseAdmin
          .from("work_sheet_headers")
          .select("id, master_line_id, primary_line_id, work_sheet_line_id")
          .eq("id", id)
          .maybeSingle();

        let masterId: any =
          (hdr0 as any)?.master_line_id ??
          (hdr0 as any)?.primary_line_id ??
          (hdr0 as any)?.work_sheet_line_id ??
          null;

        if (!isUuid(masterId)) {
          const { data: l0 } = await supabaseAdmin
            .from("work_sheet_lines")
            .select("id")
            .eq("work_sheet_id", id)
            .or("is_deleted.is.null,is_deleted.eq.false")
            .order("created_at", { ascending: true })
            .limit(1);
          masterId = Array.isArray(l0) && l0[0] ? (l0[0] as any).id : null;
        }

        if (isUuid(masterId)) {
          const patch: any = { updated_at: new Date().toISOString() };
          if (w !== undefined) patch.work_notes = isBlank(w) ? null : safeText(w);
          if (q !== undefined) patch.qc_points = isBlank(q) ? null : safeText(q);
          if (p !== undefined) patch.packing_notes = isBlank(p) ? null : safeText(p);

          let tries = 0;
          while (true) {
            const { error } = await supabaseAdmin
              .from("work_sheet_lines")
              .update(patch)
              .eq("id", masterId)
              .eq("work_sheet_id", id);

            if (!error) break;

            const miss = isSchemaCacheMissingColumn(error);
            if (miss.ok && miss.col && (miss.col in patch) && tries < 12) {
              delete (patch as any)[miss.col];
              tries++;
              continue;
            }

            return bad(error.message, 500);
          }
        }
      }
    }
    }

    // 2) lines update (work/qc/packing + plating/spec fields)
    if (Array.isArray(linesPatch) && linesPatch.length > 0) {
      for (const lp of linesPatch) {
        const lineId = (lp as any)?.id;
        if (!isUuid(lineId)) continue;

        // ✅ Accept UI alias keys and normalize into DB column names.
// UI uses Vendor Unit Price / Vendor Currency, but DB column is vendor_unit_cost_local + vendor_currency.
// Also allow camelCase.
const incoming: any = lp as any;
if (!("vendor_unit_cost_local" in incoming)) {
  const v = pickFirst(incoming, [
    "vendor_unit_price",
    "vendorUnitPrice",
    "vendor_unit_price_local",
    "vendorUnitPriceLocal",
    "po_unit_price_vendor",
  ]);
  if (v !== null && v !== undefined && v !== "") (incoming as any).vendor_unit_cost_local = v;
}
if (!("vendor_currency" in incoming)) {
  const c = pickFirst(incoming, [
    "vendor_currency",
    "vendorCurrency",
    "vendor_currency_code",
    "vendorCurrencyCode",
  ]);
  if (c !== null && c !== undefined && c !== "") (incoming as any).vendor_currency = c;
}

const allowed = [
          "work_notes",
          "qc_points",
          "packing_notes",
          "plating_spec",
          "spec_summary",

          // ✅ production mode
          "production_mode",

          // ✅ planned vendor fields (work_sheet_lines)
          "vendor_id",
          "vendor_currency",
          "vendor_unit_cost_local",

          // ✅ actual (post) vendor cost fields
          "actual_vendor_unit_cost_local",
          "actual_vendor_unit_cost_usd",
          "actual_fx_rate",
          "actual_fx_as_of",
          "actual_fx_mode",
          "actual_cost_confirmed",
          "actual_cost_confirmed_at",
          "actual_cost_confirmed_by",
          "actual_cost_notes",
        ];

        const patch: any = {};
        for (const k of allowed) {
          if (k in lp) patch[k] = (lp as any)[k];
        }
        patch.updated_at = new Date().toISOString();
        // ✅ Safety: if production_mode is OUTSOURCED, vendor_id must exist (DB constraint may not exist yet)
        // Also: if actual cost is CONFIRMED, lock actual fields (and prevent unconfirm).
        const { data: existingLine, error: exErr } = await supabaseAdmin
          .from("work_sheet_lines")
          .select(
            "id, production_mode, vendor_id, actual_cost_confirmed, actual_vendor_unit_cost_local, actual_vendor_unit_cost_usd, actual_fx_rate, actual_fx_as_of, actual_fx_mode, actual_cost_notes"
          )
          .eq("id", lineId)
          .eq("work_sheet_id", id)
          .maybeSingle();

        if (exErr) return bad(exErr.message, 500);

        const prevConfirmed = !!(existingLine as any)?.actual_cost_confirmed;

        // If switching/being OUTSOURCED, require vendor_id
        const nextMode = (patch as any).production_mode ?? (existingLine as any)?.production_mode ?? null;
        const nextVendorId = ("vendor_id" in patch) ? (patch as any).vendor_id : (existingLine as any)?.vendor_id;

        if (nextMode === "OUTSOURCED" && !nextVendorId) {
          return bad("OUTSOURCED 라인은 vendor_id가 필수입니다.", 400);
        }

        if (prevConfirmed) {
          // prevent unconfirm
          if ("actual_cost_confirmed" in patch && !(patch as any).actual_cost_confirmed) {
            return bad("Actual cost is already CONFIRMED and cannot be reverted.", 409);
          }

          const fields = [
            "actual_vendor_unit_cost_local",
            "actual_vendor_unit_cost_usd",
            "actual_fx_rate",
            "actual_fx_as_of",
            "actual_fx_mode",
            "actual_cost_notes",
            "actual_cost_confirmed_at",
            "actual_cost_confirmed_by",
          ] as const;

          for (const f of fields) {
            if (!(f in patch)) continue;
            const a = (patch as any)[f];
            const b = (existingLine as any)?.[f];
            if (String(a ?? "") !== String(b ?? "")) {
              return bad("Actual cost is CONFIRMED. Actual fields are locked.", 409);
            }
          }
        } else {
          // if confirming now, set confirmed_at if missing
          if ((patch as any).actual_cost_confirmed === true) {
            if (!("actual_cost_confirmed_at" in patch) || !(patch as any).actual_cost_confirmed_at) {
              (patch as any).actual_cost_confirmed_at = new Date().toISOString();
            }
          }
        }



        // Defensive: if some columns don't exist yet, drop them and retry (prevents 500)
        let tries = 0;
        while (true) {
          if (Object.keys(patch).length === 0) break;

          const { error: lUpErr } = await supabaseAdmin
            .from("work_sheet_lines")
            .update(patch)
            .eq("id", lineId)
            .eq("work_sheet_id", id);

          if (!lUpErr) break;

          const miss = isSchemaCacheMissingColumn(lUpErr);
          const missingCol = miss.col;

          if (miss.ok && missingCol && (missingCol in patch) && tries < 12) {
            delete (patch as any)[missingCol];
            tries++;
            continue;
          }

          return bad(lUpErr.message, 500);
        }
      }
    }

    // 3) return fresh data (so UI keeps last values and feels like "update" not "reset")

    // 3) materials actual patch (IN_HOUSE internal)
    if (materialsPatch) {
      // Flatten incoming spec updates
      const updates: any[] = [];
      for (const [lineId, arr] of Object.entries(materialsPatch as any)) {
        if (!Array.isArray(arr)) continue;
        for (const s of arr as any[]) {
          if (!s || typeof s !== "object") continue;
          if (!isUuid(s.id)) continue;
          const u: any = {
            id: s.id,
            work_sheet_line_id: isUuid(s.work_sheet_line_id) ? s.work_sheet_line_id : lineId,
            actual_qty: s.actual_qty ?? null,
            actual_unit_cost: s.actual_unit_cost ?? null,
            actual_note: s.actual_note ?? null,
          };

          // Only apply when at least one actual field is present
          if (
            u.actual_qty !== null ||
            u.actual_unit_cost !== null ||
            !isBlank(u.actual_note)
          ) {
            updates.push(u);
          }
        }
      }

      if (updates.length > 0) {
        const lineIds = Array.from(new Set(updates.map((u) => u.work_sheet_line_id).filter(isUuid)));

        // Lock policy: if a line is confirmed, block any actual edits
        const { data: locked, error: lockErr } = await supabaseAdmin
          .from("work_sheet_lines")
          .select("id, actual_cost_confirmed")
          .in("id", lineIds);

        if (lockErr) throw new Error(lockErr.message);

        const lockedSet = new Set(
          (locked ?? [])
            .filter((r: any) => !!r.actual_cost_confirmed)
            .map((r: any) => r.id)
        );

        for (const u of updates) {
          if (lockedSet.has(u.work_sheet_line_id)) {
            return bad("Actual cost is CONFIRMED. Use revision flow.", 409);
          }
        }

        // ✅ UPDATE-ONLY: never insert new rows here.
// Some rows may have NOT NULL columns (e.g., material_name) that are not present in the payload,
// so an UPSERT would try to INSERT and fail. We only update existing ids.
for (const u of updates) {
  const patch: any = {
    updated_at: new Date().toISOString(),
  };

  // Only send fields that are explicitly provided (avoid overwriting with null unless intended)
  if (u.actual_qty !== undefined) patch.actual_qty = u.actual_qty;
  if (u.actual_unit_cost !== undefined) patch.actual_unit_cost = u.actual_unit_cost;
  if (u.actual_note !== undefined)
    patch.actual_note = isBlank(u.actual_note) ? null : safeText(u.actual_note);

  const { error: upErr } = await supabaseAdmin
    .from("work_sheet_material_specs")
    .update(patch)
    .eq("id", u.id)
    .eq("work_sheet_line_id", u.work_sheet_line_id);

  if (upErr) throw new Error(upErr.message);
}
      }
    }

    const data = await loadAll(id);
    if (!data.header) return bad("Work sheet not found", 404);

    return ok(withNoteAliases(data));
  } catch (e: any) {
    return bad(e?.message ?? "Server error", 500);
  }
}