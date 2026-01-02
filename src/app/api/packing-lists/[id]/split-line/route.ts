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
    const splitQty = num(body.split_qty, 0);
    if (splitCartons <= 0) return bad("split_cartons must be > 0", 400);
    if (splitQty <= 0) return bad("split_qty must be > 0", 400);

    // 1) 원본 라인 조회
    const { data: orig, error: e1 } = await supabaseAdmin
      .from("packing_list_lines")
      .select("*")
      .eq("id", lineId)
      .eq("packing_list_id", packingListId)
      .maybeSingle();

    if (e1) return bad(e1.message, 500);
    if (!orig) return bad("Packing list line not found", 404);

    const origCartons = num((orig as any).cartons, 0);
    const origQty = num((orig as any).shipped_qty, 0);

    if (splitCartons >= origCartons)
      return bad("split_cartons must be less than original cartons", 400, {
        orig_cartons: origCartons,
      });
    if (splitQty >= origQty)
      return bad("split_qty must be less than original qty", 400, {
        orig_qty: origQty,
      });

    // 2) 기존 per_ctn
    const origGwPer = num((orig as any).gw_per_ctn, 0);
    const origNwPer = num((orig as any).nw_per_ctn, 0);

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

    const newRow: any = {
      packing_list_id: packingListId,
      shipment_id: (orig as any).shipment_id ?? null,
      shipment_line_id: (orig as any).shipment_line_id ?? null,

      line_no: newLineNo,
      po_header_id: (orig as any).po_header_id ?? null,
      po_no: (orig as any).po_no ?? null,

      style_no: (orig as any).style_no ?? null,
      description: newDesc,

      shipped_qty: splitQty,
      cartons: splitCartons,

      gw_per_ctn: splitGwPer || null,
      nw_per_ctn: splitNwPer || null,

      // total은 per_ctn 기준으로 계산 저장
      gw: splitGwPer ? round3(splitGwPer * splitCartons) : null,
      nw: splitNwPer ? round3(splitNwPer * splitCartons) : null,
    };

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
      shipped_qty: remainQty,
      // 원본도 per_ctn 기준으로 total 다시 계산 저장 (있을 때)
      gw: origGwPer ? round3(origGwPer * remainCartons) : (orig as any).gw ?? null,
      nw: origNwPer ? round3(origNwPer * remainCartons) : (orig as any).nw ?? null,
    };

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
    return bad(e?.message || "Split line failed", 500);
  }
}
