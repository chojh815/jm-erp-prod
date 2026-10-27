import { validatePackingSave } from "@/lib/shippingQuantityGuard";
import { quantity } from "@/lib/shippingQuantityRules";
// src/app/api/packing-lists/[id]/split-line/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function bad(message: string, status = 400, extra?: any) {
  return NextResponse.json({ success: false, error: message, ...extra }, { status });
}
function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isUuid(v: any) {
  return UUID_RE.test(String(v || ""));
}
function num(v: any, fallback = 0) {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function round3(v: number) {
  return Math.round(v * 1000) / 1000;
}

/**
 * POST /api/packing-lists/[id]/split-line
 * body:
 * {
 *   line_id: string,
 *   split_cartons: number,
 *   split_qty: number,
 *   split_gw_per_ctn?: number,
 *   split_nw_per_ctn?: number,
 *   split_description_suffix?: string
 * }
 */
export async function POST(req: Request, ctx: { params: { id: string } }) {
  try {
    const packingListId = ctx?.params?.id;
    if (!isUuid(packingListId)) return bad("Invalid packing list id", 400);

    const body = await req.json().catch(() => null);
    if (!body) return bad("Invalid JSON body", 400);

    const lineId = String(body.line_id || "");
    if (!isUuid(lineId)) return bad("Invalid line_id", 400);

    const splitCartons = num(body.split_cartons, 0);
    const splitQty = quantity(body.split_qty);
    if (splitCartons <= 0) return bad("split_cartons must be > 0", 400);
    if (splitQty <= 0) return bad("split_qty must be > 0", 400);

    // 1) 원본 라인 조회
    const { data: orig, error: e1 } = await supabaseAdmin
      .from("packing_list_lines")
      .select("*")
      .eq("id", lineId)
      .eq("packing_list_id", packingListId)
      .eq("is_deleted", false)
      .maybeSingle();

    if (e1) return bad(e1.message, 500);
    if (!orig) return bad("Packing list line not found", 404);

    const origCartons = num((orig as any).cartons, 0);
    const origQty = quantity((orig as any).qty ?? (orig as any).shipped_qty);

    if (splitCartons >= origCartons)
      return bad("split_cartons must be less than original cartons", 400, {
        orig_cartons: origCartons,
      });
    if (splitQty >= origQty)
      return bad("split_qty must be less than original qty", 400, {
        orig_qty: origQty,
      });

    // 2) 기존 per_ctn
    const origGwPer = num(orig.gw_per_ctn ?? orig.gw_per_carton, 0);
    const origNwPer = num(orig.nw_per_ctn ?? orig.nw_per_carton, 0);

    // split per_ctn이 오면 그걸 사용, 아니면 원본 per_ctn 사용
    const splitGwPer = body.split_gw_per_ctn !== undefined ? num(body.split_gw_per_ctn, 0) : origGwPer;
    const splitNwPer = body.split_nw_per_ctn !== undefined ? num(body.split_nw_per_ctn, 0) : origNwPer;

    // 3) 새 라인 번호 = max(line_no)+1
    const { data: maxRows, error: eMax } = await supabaseAdmin
      .from("packing_list_lines")
      .select("line_no")
      .eq("packing_list_id", packingListId)
      .order("line_no", { ascending: false })
      .limit(1);

    if (eMax) return bad(eMax.message, 500);
    const maxLineNo = num(maxRows?.[0]?.line_no, 0);
    const newLineNo = maxLineNo + 1;

    // 4) 새 라인 insert (예외 카톤)
    const suffix = String(body.split_description_suffix || "").trim(); // 예: "(LAST CTN)"
    const newDesc =
      (orig as any).description ? String((orig as any).description) + (suffix ? ` ${suffix}` : "") : null;

    const newRow: any = { ...orig, line_no: newLineNo, description: newDesc, cartons: splitCartons,
      is_deleted: false, updated_at: new Date().toISOString() };
    delete newRow.id;
    delete newRow.created_at;
    if ("qty" in orig) newRow.qty = splitQty;
    if ("shipped_qty" in orig) newRow.shipped_qty = splitQty;
    for (const key of ["gw_per_ctn", "gw_per_carton"]) if (key in orig) newRow[key] = splitGwPer || null;
    for (const key of ["nw_per_ctn", "nw_per_carton"]) if (key in orig) newRow[key] = splitNwPer || null;

    for (const key of ["gw", "total_gw"]) if (key in orig) newRow[key] = round3(splitGwPer * splitCartons);
    for (const key of ["nw", "total_nw"]) if (key in orig) newRow[key] = round3(splitNwPer * splitCartons);
    for (const key of ["cbm", "total_cbm"]) if (key in orig) newRow[key] = round3(num(orig[key]) * splitCartons / origCartons);
    for (const key of ["carton_no_from", "carton_no_to"]) if (key in orig) newRow[key] = null;

    const { data: header, error: headerError } = await supabaseAdmin.from("packing_list_headers")
      .select("*").eq("id", packingListId).eq("is_deleted", false).maybeSingle();
    if (headerError) throw new Error(headerError.message);
    if (!header) return bad("Packing list not found", 404);
    const { data: current, error: currentError } = await supabaseAdmin.from("packing_list_lines")
      .select("*").eq("packing_list_id", packingListId).eq("is_deleted", false);
    if (currentError) throw new Error(currentError.message);
    const remainingLine = { ...orig, ...( "qty" in orig ? { qty: origQty - splitQty } : {}),
      ...( "shipped_qty" in orig ? { shipped_qty: origQty - splitQty } : {}) };
    await validatePackingSave(header, [...(current ?? []).map((r: any) => r.id === lineId ? remainingLine : r), newRow]);

    const { data: inserted, error: e2 } = await supabaseAdmin
      .from("packing_list_lines")
      .insert(newRow)
      .select("*")
      .maybeSingle();

    if (e2) return bad(e2.message, 500);

    // 5) 원본 라인 update (남은 수량/카톤)
    const remainCartons = origCartons - splitCartons;
    const remainQty = origQty - splitQty;

    const upd: any = {
      cartons: remainCartons,
      ...( "qty" in orig ? { qty: remainQty } : {}),
      ...( "shipped_qty" in orig ? { shipped_qty: remainQty } : {}),
      // 원본도 per_ctn 기준으로 total 다시 계산 저장 (있을 때)
      ...( "gw" in orig ? { gw: origGwPer ? round3(origGwPer * remainCartons) : orig.gw } : {}),
      ...( "nw" in orig ? { nw: origNwPer ? round3(origNwPer * remainCartons) : orig.nw } : {}),
    };

    for (const key of ["total_gw"]) if (key in orig) upd[key] = round3(origGwPer * remainCartons);
    for (const key of ["total_nw"]) if (key in orig) upd[key] = round3(origNwPer * remainCartons);
    for (const key of ["cbm", "total_cbm"]) if (key in orig) upd[key] = round3(num(orig[key]) * remainCartons / origCartons);

    const { data: updated, error: e3 } = await supabaseAdmin
      .from("packing_list_lines")
      .update(upd)
      .eq("id", lineId)
      .select("*")
      .maybeSingle();

    if (e3) return bad(e3.message, 500);

    return ok({
      packing_list_id: packingListId,
      original_line: updated,
      split_line: inserted,
    });
  } catch (e: any) {
    console.error(e);
    return bad(e?.message || "Split line failed", e?.status ?? 500);
  }
}
