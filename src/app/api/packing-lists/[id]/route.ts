// src/app/api/packing-lists/[id]/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}
function bad(message: string, status = 400, extra?: any) {
  return NextResponse.json(
    { success: false, error: message, ...(extra ?? {}) },
    { status }
  );
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isUuid(v: string) {
  return UUID_RE.test(v);
}

function num(v: any, fallback = 0): number {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function isEmptyNumber(v: any) {
  // 프로젝트에서는 0도 “미입력”으로 취급하는 케이스가 많음
  return v === null || v === undefined || v === "" || Number(v) === 0;
}
function pickIfEmpty(cur: any, fallback: any) {
  return isEmptyNumber(cur) ? fallback : cur;
}

function calcPerCtn(total: any, cartons: any): number | null {
  const c = num(cartons, 0);
  const t = num(total, 0);
  if (c <= 0) return null;
  const v = t / c;
  return Number.isFinite(v) ? v : null;
}

/**
 * shipment_lines에서 gw/nw/cbm per-ctn 값 찾아오기
 * - 변형 흡수
 * - 없으면 total_* / * 를 cartons로 나눠 계산
 */
function readShipmentPerCtn(sl: any, cartons: number) {
  const slNwPer =
    sl?.nw_per_ctn ?? sl?.nw_per_carton ?? sl?.nw_per_cartons ?? null;
  const slGwPer =
    sl?.gw_per_ctn ?? sl?.gw_per_carton ?? sl?.gw_per_cartons ?? null;
  const slCbmPer = sl?.cbm_per_carton ?? sl?.cbm_per_carton ?? null;

  const nwPer =
    slNwPer != null
      ? num(slNwPer, 0)
      : sl?.total_nw != null
      ? calcPerCtn(sl.total_nw, cartons)
      : sl?.nw != null
      ? calcPerCtn(sl.nw, cartons)
      : null;

  const gwPer =
    slGwPer != null
      ? num(slGwPer, 0)
      : sl?.total_gw != null
      ? calcPerCtn(sl.total_gw, cartons)
      : sl?.gw != null
      ? calcPerCtn(sl.gw, cartons)
      : null;

  const cbmPer =
    slCbmPer != null
      ? num(slCbmPer, 0)
      : sl?.total_cbm != null
      ? calcPerCtn(sl.total_cbm, cartons)
      : null;

  return { nwPer, gwPer, cbmPer };
}

/**
 * DB row -> API 응답 정규화
 * - qty fallback
 * - per_ctn normalize
 * - UI 호환 alias 제공: *_per_carton / ct_no_* (동일값)
 */
function normalizeLine(row: any) {
  const cartons = num(row?.cartons, 0);

  const qty =
    row?.qty !== undefined && row?.qty !== null
      ? num(row.qty, 0)
      : row?.shipped_qty !== undefined && row?.shipped_qty !== null
      ? num(row.shipped_qty, 0)
      : row?.order_qty !== undefined && row?.order_qty !== null
      ? num(row.order_qty, 0)
      : 0;

  const nwPer =
    row?.nw_per_ctn !== undefined && row?.nw_per_ctn !== null
      ? num(row.nw_per_ctn, 0)
      : row?.nw_per_carton !== undefined && row?.nw_per_carton !== null
      ? num(row.nw_per_carton, 0)
      : null;

  const gwPer =
    row?.gw_per_ctn !== undefined && row?.gw_per_ctn !== null
      ? num(row.gw_per_ctn, 0)
      : row?.gw_per_carton !== undefined && row?.gw_per_carton !== null
      ? num(row.gw_per_carton, 0)
      : null;

  const cbmPer =
    row?.cbm_per_carton !== undefined && row?.cbm_per_carton !== null
      ? num(row.cbm_per_carton, 0)
      : row?.cbm_per_carton !== undefined && row?.cbm_per_carton !== null
      ? num(row.cbm_per_carton, 0)
      : null;

  // ✅ DB는 carton_no_from/to 사용 (ct_no_*는 alias로만 내려줌)
  const from =
    row?.carton_no_from !== undefined && row?.carton_no_from !== null
      ? num(row.carton_no_from, 0)
      : row?.ct_no_from !== undefined && row?.ct_no_from !== null
      ? num(row.ct_no_from, 0)
      : null;

  const to =
    row?.carton_no_to !== undefined && row?.carton_no_to !== null
      ? num(row.carton_no_to, 0)
      : row?.ct_no_to !== undefined && row?.ct_no_to !== null
      ? num(row.ct_no_to, 0)
      : null;

  return {
    ...row,
    cartons,
    qty,

    // canonical (db)
    nw_per_carton: nwPer,
    gw_per_carton: gwPer,
    cbm_per_carton: cbmPer,

    carton_no_from: from,
    carton_no_to: to,

    // aliases for UI / legacy
    nw_per_carton: nwPer,
    gw_per_carton: gwPer,
    cbm_per_carton: cbmPer,
    ct_no_from: from,
    ct_no_to: to,
  };
}

/**
 * ✅ 보강: packing_list_lines가 “있어도”
 * qty/nw/gw/cbm이 비어(0/NULL)이면 shipment_lines 값으로 채움
 */
function enrichFromShipment(lines: any[], shipmentLines: any[]) {
  const keyFull = (po: any, st: any, desc: any) =>
    `${String(po ?? "").trim()}||${String(st ?? "").trim()}||${String(
      desc ?? ""
    ).trim()}`;
  const keyLite = (po: any, st: any) =>
    `${String(po ?? "").trim()}||${String(st ?? "").trim()}`;

  const mapFull = new Map<string, any>();
  const mapLite = new Map<string, any>();
  for (const sl of shipmentLines) {
    mapFull.set(keyFull(sl.po_no, sl.style_no, sl.description), sl);
    mapLite.set(keyLite(sl.po_no, sl.style_no), sl);
  }

  return lines.map((l) => {
    const sl =
      mapFull.get(keyFull(l.po_no, l.style_no, l.description)) ??
      mapLite.get(keyLite(l.po_no, l.style_no));

    if (!sl) return l;

    const cartons = num(l.cartons, 0) || num(sl.cartons, 0) || 0;
    const { nwPer, gwPer, cbmPer } = readShipmentPerCtn(sl, cartons);

    return {
      ...l,
      shipped_qty: l.shipped_qty ?? sl.shipped_qty ?? null,
      order_qty: l.order_qty ?? sl.order_qty ?? null,
      qty: pickIfEmpty(l.qty, sl.shipped_qty ?? sl.order_qty ?? l.qty),

      nw_per_carton: pickIfEmpty(l.nw_per_carton, nwPer),
      gw_per_carton: pickIfEmpty(l.gw_per_carton, gwPer),
      cbm_per_carton: pickIfEmpty(l.cbm_per_carton, cbmPer),

      cartons: pickIfEmpty(l.cartons, cartons),
    };
  });
}

function computeTotals(lines: any[]) {
  let total_cartons = 0;
  let total_qty = 0;
  let total_nw = 0;
  let total_gw = 0;
  let total_cbm = 0;

  for (const r of lines) {
    const cartons = num(r.cartons, 0);
    total_cartons += cartons;
    total_qty += num(r.qty, 0);
    total_nw += cartons * num(r.nw_per_carton, 0);
    total_gw += cartons * num(r.gw_per_carton, 0);
    total_cbm += cartons * num(r.cbm_per_carton, 0);
  }

  return { total_cartons, total_qty, total_nw, total_gw, total_cbm };
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    if (!id || !isUuid(id)) return bad("Invalid id", 400);

    const { data: header, error: hErr } = await supabaseAdmin
      .from("packing_list_headers")
      .select("*")
      .eq("id", id)
      .eq("is_deleted", false)
      .maybeSingle();

    if (hErr) return bad(hErr.message, 500);
    if (!header) return bad("Packing list not found", 404);

    const H = header as any;

    // 1) packing_list_lines (DB 컬럼: carton_no_from/to)
    const { data: plLines, error: plErr } = await supabaseAdmin
      .from("packing_list_lines")
      .select("*")
      .eq("packing_list_id", id)
      .eq("is_deleted", false)
      .order("carton_no_from", { ascending: true })
      .order("po_no", { ascending: true })
      .order("style_no", { ascending: true });

    if (plErr) return bad(plErr.message, 500);

    let rawLines: any[] = plLines ?? [];

    // 2) shipment_lines (보강/폴백)
    let shLines: any[] = [];
    if (H.shipment_id && isUuid(String(H.shipment_id))) {
      const { data: sData, error: sErr } = await supabaseAdmin
        .from("shipment_lines")
        .select("*")
        .eq("shipment_id", H.shipment_id)
        .eq("is_deleted", false)
        .order("po_no", { ascending: true });

      if (sErr) return bad(sErr.message, 500);
      shLines = sData ?? [];
    }

    // 3) 폴백: PL lines가 비면 shipment_lines로 생성
    if ((!rawLines || rawLines.length === 0) && shLines.length > 0) {
      rawLines = shLines.map((sl) => {
        const cartons = num(sl.cartons, 0);
        const { nwPer, gwPer, cbmPer } = readShipmentPerCtn(sl, cartons);

        return {
          po_no: sl.po_no ?? null,
          style_no: sl.style_no ?? null,
          description: sl.description ?? null,
          cartons,

          shipped_qty: sl.shipped_qty ?? null,
          order_qty: sl.order_qty ?? null,
          qty: sl.shipped_qty ?? sl.order_qty ?? 0,

          nw_per_carton: nwPer,
          gw_per_carton: gwPer,
          cbm_per_carton: cbmPer,

          carton_no_from: null,
          carton_no_to: null,
        };
      });
    }

    // 4) ✅ 보강: rawLines가 있어도 shipment로 채워 넣기
    if (rawLines.length > 0 && shLines.length > 0) {
      rawLines = enrichFromShipment(rawLines, shLines);
    }

    const lines = rawLines.map(normalizeLine);
    const totals = computeTotals(lines);

    return ok({ header: H, lines, totals });
  } catch (e: any) {
    return bad(e?.message || "Server error", 500);
  }
}

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    if (!id || !isUuid(id)) return bad("Invalid id", 400);

    const { data: header, error: hErr } = await supabaseAdmin
      .from("packing_list_headers")
      .select("*")
      .eq("id", id)
      .eq("is_deleted", false)
      .maybeSingle();

    if (hErr) return bad(hErr.message, 500);
    if (!header) return bad("Packing list not found", 404);

    const body = await req.json().catch(() => ({}));
    const headerIn = body?.header || {};
    const linesIn: any[] = Array.isArray(body?.lines) ? body.lines : [];

    // header update
    const { error: upErr } = await supabaseAdmin
      .from("packing_list_headers")
      .update({
        packing_date: headerIn.packing_date ?? header.packing_date ?? null,
        memo: headerIn.memo ?? header.memo ?? null,
        consignee_text: headerIn.consignee_text ?? header.consignee_text ?? null,
        notify_party_text:
          headerIn.notify_party_text ?? header.notify_party_text ?? null,
        shipper_name: headerIn.shipper_name ?? header.shipper_name ?? null,
        shipper_address:
          headerIn.shipper_address ?? header.shipper_address ?? null,
        port_of_loading:
          headerIn.port_of_loading ?? header.port_of_loading ?? null,
        final_destination:
          headerIn.final_destination ?? header.final_destination ?? null,
        coo_text: headerIn.coo_text ?? header.coo_text ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (upErr) return bad(upErr.message, 500);

    // 기존 lines soft delete
    const { error: delErr } = await supabaseAdmin
      .from("packing_list_lines")
      .update({ is_deleted: true, updated_at: new Date().toISOString() })
      .eq("packing_list_id", id)
      .eq("is_deleted", false);

    if (delErr) return bad(delErr.message, 500);

    // ✅ 입력키 흡수: *_per_ctn / *_per_carton 둘 다 OK
    // ✅ CT range는 DB 컬럼 carton_no_from/to 로 저장
    const toInsert = linesIn
      .filter((x) => x && x.is_deleted !== true)
      .map((x) => {
        const cartons = num(x.cartons, 0);
        const qty = num(x.qty ?? x.shipped_qty ?? x.order_qty, 0);

        const nwRaw = x.nw_per_carton ?? x.nw_per_carton ?? null;
        const gwRaw = x.gw_per_carton ?? x.gw_per_carton ?? null;
        const cbmRaw = x.cbm_per_carton ?? x.cbm_per_carton ?? null;

        const fromRaw = x.carton_no_from ?? x.ct_no_from ?? null;
        const toRaw = x.carton_no_to ?? x.ct_no_to ?? null;

        return {
          packing_list_id: id,

          po_no: x.po_no ?? null,
          style_no: x.style_no ?? null,
          description: x.description ?? null,

          cartons,
          qty,

          // 비워둔 값은 NULL 저장(그래야 GET에서 shipment로 보강됨)
          nw_per_carton: isEmptyNumber(nwRaw) ? null : num(nwRaw, 0),
          gw_per_carton: isEmptyNumber(gwRaw) ? null : num(gwRaw, 0),
          cbm_per_carton: isEmptyNumber(cbmRaw) ? null : num(cbmRaw, 0),

          carton_no_from:
            fromRaw !== undefined && fromRaw !== null && fromRaw !== ""
              ? num(fromRaw, 0)
              : null,
          carton_no_to:
            toRaw !== undefined && toRaw !== null && toRaw !== ""
              ? num(toRaw, 0)
              : null,

          is_deleted: false,
        };
      });

    if (toInsert.length > 0) {
      const { error: insErr } = await supabaseAdmin
        .from("packing_list_lines")
        .insert(toInsert);

      if (insErr) return bad(insErr.message, 500);
    }

    // 최신 header 재조회
    const { data: newHeader, error: nhErr } = await supabaseAdmin
      .from("packing_list_headers")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (nhErr) return bad(nhErr.message, 500);

    // 최신 lines 재조회
    const { data: outLines, error: outErr } = await supabaseAdmin
      .from("packing_list_lines")
      .select("*")
      .eq("packing_list_id", id)
      .eq("is_deleted", false)
      .order("carton_no_from", { ascending: true })
      .order("po_no", { ascending: true })
      .order("style_no", { ascending: true });

    if (outErr) return bad(outErr.message, 500);

    const lines = (outLines ?? []).map(normalizeLine);
    const totals = computeTotals(lines);

    return ok({ header: newHeader, lines, totals });
  } catch (e: any) {
    return bad(e?.message || "Server error", 500);
  }
}
