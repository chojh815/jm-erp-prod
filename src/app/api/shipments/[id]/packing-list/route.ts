// src/app/api/shipments/[id]/packing-list/route.ts
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
function originToCountryCode(origin?: string | null) {
  const o = String(origin || "").toUpperCase();
  if (o.startsWith("VN_") || o.includes("VIET")) return "VN";
  if (o.startsWith("CN_") || o.includes("CHINA")) return "CN";
  if (o.startsWith("KR_") || o.includes("KOREA") || o.includes("SEOUL")) return "KR";
  return "JM";
}
function toDate10(v?: any) {
  if (!v) return null;
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function extractMissingColumn(msg: string) {
  const m1 = msg.match(/column "([^"]+)" of relation "[^"]+" does not exist/i);
  if (m1?.[1]) return m1[1];
  const m2 = msg.match(/Could not find the '([^']+)' column of '([^']+)'/i);
  if (m2?.[1]) return m2[1];
  return null;
}

async function safeInsertOne(table: string, payload: Record<string, any>) {
  let p = { ...payload };
  for (let attempt = 0; attempt < 15; attempt++) {
    const { data, error } = await supabaseAdmin.from(table).insert(p).select("*").maybeSingle();
    if (!error) return { data, error: null, finalPayload: p };

    const col = extractMissingColumn(String(error.message || ""));
    if (col && Object.prototype.hasOwnProperty.call(p, col)) {
      delete (p as any)[col];
      continue;
    }
    return { data: null, error, finalPayload: p };
  }
  return { data: null, error: new Error("safeInsertOne: too many retries"), finalPayload: p };
}

async function safeInsertMany(table: string, rows: Record<string, any>[]) {
  if (!rows.length) return { data: [], error: null };

  let keys = Object.keys(rows[0] || {});
  let working = rows.map((r) => ({ ...r }));

  for (let attempt = 0; attempt < 15; attempt++) {
    const { data, error } = await supabaseAdmin.from(table).insert(working).select("*");
    if (!error) return { data: data || [], error: null };

    const col = extractMissingColumn(String(error.message || ""));
    if (col && keys.includes(col)) {
      keys = keys.filter((k) => k !== col);
      working = working.map((r) => {
        const nr: any = {};
        for (const k of keys) nr[k] = r[k];
        return nr;
      });
      continue;
    }
    return { data: [], error };
  }

  return { data: [], error: new Error("safeInsertMany: too many retries") };
}

async function safeUpdateOne(table: string, id: string, patch: Record<string, any>) {
  let p = { ...patch };

  for (let attempt = 0; attempt < 15; attempt++) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .update(p)
      .eq("id", id)
      .select("*")
      .maybeSingle();

    if (!error) return { data, error: null, finalPatch: p };

    const col = extractMissingColumn(String(error.message || ""));
    if (col && Object.prototype.hasOwnProperty.call(p, col)) {
      delete (p as any)[col];
      continue;
    }
    return { data: null, error, finalPatch: p };
  }

  return { data: null, error: new Error("safeUpdateOne: too many retries"), finalPatch: p };
}

async function generatePackingListNo(shippingOriginCode?: string | null, baseDate?: string | null) {
  // ✅ DB 컬럼명: packing_list_no (너 스샷 기준)
  const cc = originToCountryCode(shippingOriginCode);
  const d = baseDate ? new Date(baseDate) : new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yymm = `${yy}${mm}`;
  const prefix = `PL-${cc}-${yymm}-`;

  const { data, error } = await supabaseAdmin
    .from("packing_list_headers")
    .select("packing_list_no,created_at")
    .ilike("packing_list_no", `${prefix}%`)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return null;

  let maxSeq = 0;
  for (const row of data || []) {
    const v = String((row as any).packing_list_no || "");
    if (!v.startsWith(prefix)) continue;
    const tail = v.slice(prefix.length);
    const n = Number(tail);
    if (Number.isFinite(n)) maxSeq = Math.max(maxSeq, n);
  }
  return `${prefix}${String(maxSeq + 1).padStart(4, "0")}`;
}

async function getShipmentOr404(shipmentId: string) {
  const { data, error } = await supabaseAdmin
    .from("shipments")
    .select("*")
    .eq("id", shipmentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

async function getLatestInvoiceHeaderByShipment(shipmentId: string) {
  const { data, error } = await supabaseAdmin
    .from("invoice_headers")
    .select("*")
    .eq("shipment_id", shipmentId)
    .eq("is_deleted", false)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) return null;
  return data?.[0] ?? null;
}

async function findExistingPackingList(shipmentId: string) {
  const { data, error } = await supabaseAdmin
    .from("packing_list_headers")
    .select("*")
    .eq("shipment_id", shipmentId)
    .eq("is_deleted", false)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw new Error(error.message);
  return data?.[0] ?? null;
}

async function loadShipmentLines(shipmentId: string) {
  const { data, error } = await supabaseAdmin
    .from("shipment_lines")
    .select("*")
    .eq("shipment_id", shipmentId)
    .eq("is_deleted", false)
    .order("line_no", { ascending: true })
    .limit(5000);

  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

/**
 * GET: 링크 상태 조회
 */
export async function GET(_req: Request, ctx: { params: { id: string } }) {
  try {
    const shipmentId = ctx?.params?.id;
    if (!isUuid(shipmentId)) return bad("Invalid shipment id", 400);

    const pl = await findExistingPackingList(shipmentId);
    return ok({ packing_list: pl });
  } catch (e: any) {
    console.error(e);
    return bad(e?.message || "Failed to load packing list link", 500);
  }
}

/**
 * POST: 생성(없으면) / 있으면 유지
 * ✅ 핵심: 기존 PL이 있어도 packing_list_no가 NULL이면 즉시 채우고 반환
 */
export async function POST(_req: Request, ctx: { params: { id: string } }) {
  try {
    const shipmentId = ctx?.params?.id;
    if (!isUuid(shipmentId)) return bad("Invalid shipment id", 400);

    // 0) 기존 PL 있으면 그대로 반환 (단, 번호 NULL이면 채우기)
    const existing = await findExistingPackingList(shipmentId);
    if (existing) {
      if (!existing.packing_list_no) {
        const finalNo = `PL-${String(existing.id).slice(0, 8)}`;
        const upd = await safeUpdateOne("packing_list_headers", existing.id, {
          packing_list_no: finalNo,
          updated_at: new Date().toISOString(),
        });

        if (upd.error) {
          console.error("existing packing_list_no fill error:", upd.error, {
            finalPatch: upd.finalPatch,
          });
          // 번호 채우기 실패해도 기존 PL은 반환 (업무 진행 우선)
          return ok({
            already_exists: true,
            packing_list_id: existing.id,
            packing_list: existing,
            warn: "packing_list_no was null but auto-fill failed",
          });
        }

        return ok({
          already_exists: true,
          packing_list_id: existing.id,
          packing_list: upd.data ?? existing,
          auto_filled_packing_list_no: true,
        });
      }

      return ok({
        already_exists: true,
        packing_list_id: existing.id,
        packing_list: existing,
      });
    }

    // 1) shipment
    const shipment = await getShipmentOr404(shipmentId);
    if (!shipment) return bad("Shipment not found", 404);

    // 2) invoice(optional)
    const inv = await getLatestInvoiceHeaderByShipment(shipmentId);

    // 3) shipment_lines
    const sLines = await loadShipmentLines(shipmentId);

    const totalCartonsCalc = sLines.reduce((a, r: any) => a + num(r.cartons, 0), 0);
    const totalGwCalc = sLines.reduce((a, r: any) => a + num(r.gw, 0), 0);
    const totalNwCalc = sLines.reduce((a, r: any) => a + num(r.nw, 0), 0);

    // 4) packing_list_no 생성(실패해도 fallback)
    const genNo = await generatePackingListNo(
      shipment.shipping_origin_code ?? null,
      shipment.etd ?? shipment.created_at ?? null
    );
    const packingListNo = genNo || null;

    // 5) header insert
    const headerPayload: Record<string, any> = {
      shipment_id: shipment.id,
      shipment_no: shipment.shipment_no ?? null,
      po_header_id: shipment.po_header_id ?? null,
      po_no: shipment.po_no ?? null,

      buyer_id: shipment.buyer_id ?? inv?.buyer_id ?? null,
      buyer_name: shipment.buyer_name ?? inv?.buyer_name ?? null,
      buyer_code: inv?.buyer_code ?? null,

      currency: shipment.currency ?? inv?.currency ?? null,
      incoterm: shipment.incoterm ?? inv?.incoterm ?? null,
      payment_term: shipment.payment_term ?? inv?.payment_term ?? null,
      shipping_origin_code: shipment.shipping_origin_code ?? inv?.shipping_origin_code ?? null,
      destination: shipment.destination ?? inv?.destination ?? null,
      ship_mode: shipment.ship_mode ?? null,
      etd: toDate10(shipment.etd ?? inv?.etd ?? null),
      eta: toDate10(shipment.eta ?? inv?.eta ?? null),

      total_cartons: shipment.total_cartons ?? totalCartonsCalc,
      total_gw: shipment.total_gw ?? totalGwCalc,
      total_nw: shipment.total_nw ?? totalNwCalc,

      // invoice_headers → PL 복사(있으면)
      remarks: inv?.remarks ?? null,
      consignee_text: inv?.consignee_text ?? null,
      notify_party_text: inv?.notify_party_text ?? null,
      shipper_name: inv?.shipper_name ?? null,
      shipper_address: inv?.shipper_address ?? null,
      port_of_loading: inv?.port_of_loading ?? null,
      final_destination: inv?.final_destination ?? null,
      coo_text: inv?.coo_text ?? null,

      // ✅ DB 컬럼명: packing_list_no
      packing_list_no: packingListNo,
    };

    const ins = await safeInsertOne("packing_list_headers", headerPayload);
    if (ins.error) {
      console.error("packing_list_headers insert error:", ins.error, { final: ins.finalPayload });
      return bad(ins.error.message || "Failed to create packing list", 500);
    }

    let header = ins.data as any;
    const packingListId = header?.id;
    if (!packingListId) return bad("packing_list_headers insert succeeded but id missing", 500);

    // 6) 번호 NULL 금지: insert 결과가 NULL이면 즉시 채움
    if (!header?.packing_list_no) {
      const finalNo = packingListNo || `PL-${String(packingListId).slice(0, 8)}`;
      const upd = await safeUpdateOne("packing_list_headers", packingListId, {
        packing_list_no: finalNo,
        updated_at: new Date().toISOString(),
      });
      if (upd.error) {
        console.error("packing_list_no update error:", upd.error, { finalPatch: upd.finalPatch });
        return bad(upd.error.message || "Failed to set packing_list_no", 500);
      }
      header = upd.data ?? header;
    }

    // 7) 라인 복사
    const lineRows: Record<string, any>[] = sLines.map((r: any, idx: number) => ({
      packing_list_id: packingListId,
      shipment_id: shipment.id,
      shipment_line_id: r.id ?? null,

      line_no: r.line_no ?? idx + 1,
      po_header_id: r.po_header_id ?? shipment.po_header_id ?? null,
      po_no: r.po_no ?? shipment.po_no ?? null,

      style_no: r.style_no ?? null,
      description: r.description ?? null,

      shipped_qty: r.shipped_qty ?? r.order_qty ?? null,

      cartons: r.cartons ?? null,
      gw: r.gw ?? null,
      nw: r.nw ?? null,
      gw_per_ctn: r.gw_per_ctn ?? null,
      nw_per_ctn: r.nw_per_ctn ?? null,
    }));

    const insLines = await safeInsertMany("packing_list_lines", lineRows);
    if (insLines.error) {
      console.error("packing_list_lines insert error:", insLines.error);
      return bad(
        "Packing List header created, but failed to copy lines. Check packing_list_lines schema.",
        500,
        { packing_list_id: packingListId }
      );
    }

    return ok({
      already_exists: false,
      packing_list_id: packingListId,
      packing_list: header,
      copied_lines: insLines.data.length,
    });
  } catch (e: any) {
    console.error(e);
    return bad(e?.message || "Failed to create packing list", 500);
  }
}
