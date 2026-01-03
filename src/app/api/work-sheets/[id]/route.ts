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

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}
function bad(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isUuid(v: any) {
  return typeof v === "string" && UUID_RE.test(v);
}
function safeText(v: any) {
  if (v === null || v === undefined) return "";
  return String(v);
}
function isBlank(v: any) {
  return !safeText(v).trim();
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
    .eq("is_deleted", false)
    .order("created_at", { ascending: true });

  if (lErr) throw new Error(lErr.message);
  const safeLines = Array.isArray(lines) ? lines : [];
  const lineIds = safeLines.map((l: any) => l.id).filter(isUuid);

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

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const id = params?.id;
    if (!isUuid(id)) return bad("Invalid id", 400);

    const data = await loadAll(id);
    if (!data.header) return bad("Work sheet not found", 404);

    return ok(data);
  } catch (e: any) {
    return bad(e?.message ?? "Server error", 500);
  }
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = params?.id;
    if (!isUuid(id)) return bad("Invalid id", 400);

    const body = await req.json().catch(() => null);
    if (!body) return bad("Invalid JSON body", 400);

    const headerPatch = body?.header ?? null;
    const linesPatch = Array.isArray(body?.lines) ? body.lines : [];

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
    }

    // 2) lines update (work/qc/packing + plating/spec fields)
    if (Array.isArray(linesPatch) && linesPatch.length > 0) {
      for (const lp of linesPatch) {
        const lineId = (lp as any)?.id;
        if (!isUuid(lineId)) continue;

        const allowed = [
          "work_notes",
          "qc_points",
          "packing_notes",
          "plating_spec",
          "spec_summary",
          // ✅ vendor price fields (work_sheet_lines)
          "vendor_id",
          "vendor_currency",
          "vendor_unit_cost_local",
        ];

        const patch: any = {};
        for (const k of allowed) {
          if (k in lp) patch[k] = (lp as any)[k];
        }
        patch.updated_at = new Date().toISOString();

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
    const data = await loadAll(id);
    if (!data.header) return bad("Work sheet not found", 404);

    return ok(data);
  } catch (e: any) {
    return bad(e?.message ?? "Server error", 500);
  }
}
