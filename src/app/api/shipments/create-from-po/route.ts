// src/app/api/shipments/create-from-po/route.ts
// 부분선적 잔량 기준 버전
// - 기존 shipment_lines 누적수량을 차감해 remaining 기준 검증
// - 기존 DRAFT shipment 재사용/덮어쓰기 제거
// - split 허용: 같은 po_line_id 여러 줄 허용
// - mode(SEA/AIR/COURIER)별로 새 shipment 생성

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}
function bad(message: string, status = 400, extra?: any) {
  return NextResponse.json(
    { success: false, error: message, ...(extra ?? {}) },
    { status }
  );
}

function safeStr(v: any) {
  return (v ?? "").toString().trim();
}
function num(v: any, fallback = 0) {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function pickFirst(obj: any, keys: string[]) {
  for (const k of keys) {
    const val = obj?.[k];
    if (val !== null && val !== undefined && safeStr(val) !== "") return val;
  }
  return null;
}
function normalizeMode(v: any): "SEA" | "AIR" | "COURIER" {
  const s = safeStr(v).toUpperCase();
  if (s.includes("AIR")) return "AIR";
  if (s.includes("COURIER") || s.includes("DHL") || s.includes("FEDEX") || s.includes("UPS")) {
    return "COURIER";
  }
  return "SEA";
}

function extractMissingColumn(message: string): string | null {
  const m1 = message.match(/has no field\s+"([^"]+)"/i);
  if (m1?.[1]) return m1[1];
  const m2 = message.match(/Could not find the '([^']+)' column/i);
  if (m2?.[1]) return m2[1];
  return null;
}

async function insertWithAutoDrop(table: string, rowOrRows: any, returning = "*") {
  let payload: any = rowOrRows;
  if (!Array.isArray(payload)) payload = [payload];

  let tries = 0;
  const dropped: string[] = [];
  while (tries < 8) {
    tries++;
    const { data, error } = await supabaseAdmin.from(table).insert(payload).select(returning);
    if (!error) return { data, dropped };

    const msg = error.message || "";
    const col = extractMissingColumn(msg);
    if (!col) return { data: null, dropped, error };

    const hadCol = payload.some(
      (r: any) => r && typeof r === "object" && Object.prototype.hasOwnProperty.call(r, col)
    );
    if (!hadCol) return { data: null, dropped, error };

    payload = payload.map((r: any) => {
      if (!r || typeof r !== "object") return r;
      const { [col]: _removed, ...rest } = r;
      return rest;
    });
    dropped.push(col);
  }
  return { data: null, dropped, error: new Error("insert retry exceeded") as any };
}

type IncomingLine = {
  po_line_id?: string | null;
  shipped_qty?: any;
  shippedQty?: any;
  use?: boolean;
  mode?: string | null;
  ship_mode?: string | null;
  shipMode?: string | null;
  carrier?: string | null;
  tracking_no?: string | null;
  trackingNo?: string | null;
  cartons?: any;
  gw_per_ctn?: any;
  nw_per_ctn?: any;
};

type NormalizedIncomingLine = {
  po_line_id: string;
  shipped_qty: number;
  mode: "SEA" | "AIR" | "COURIER";
  carrier: string;
  tracking_no: string;
  cartons: number;
  gw_per_ctn: number;
  nw_per_ctn: number;
};

const EXCLUDED_STATUSES = new Set(["CANCELLED", "DELETED"]);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const poIds: string[] = Array.isArray(body?.po_ids) ? body.po_ids.map((x: any) => safeStr(x)).filter(Boolean) : [];
    const incomingLines: IncomingLine[] = Array.isArray(body?.lines) ? body.lines : [];

    if (!poIds.length) return bad("po_ids is required.", 400);

    const normalizedIncoming: NormalizedIncomingLine[] = incomingLines
      .map((r) => {
        const po_line_id = safeStr(r?.po_line_id);
        const use = r?.use === undefined ? true : Boolean(r?.use);
        const shipped_qty = num(r?.shipped_qty ?? r?.shippedQty, 0);
        const mode = normalizeMode(r?.mode ?? r?.ship_mode ?? r?.shipMode ?? "SEA");
        return {
          po_line_id,
          shipped_qty,
          mode,
          carrier: safeStr(r?.carrier),
          tracking_no: safeStr(r?.tracking_no ?? r?.trackingNo),
          cartons: num(r?.cartons, 0),
          gw_per_ctn: num(r?.gw_per_ctn, 0),
          nw_per_ctn: num(r?.nw_per_ctn, 0),
          use,
        } as any;
      })
      .filter((r: any) => r.use && r.po_line_id && r.shipped_qty > 0)
      .map((r: any) => ({
        po_line_id: r.po_line_id,
        shipped_qty: r.shipped_qty,
        mode: r.mode,
        carrier: r.carrier,
        tracking_no: r.tracking_no,
        cartons: r.cartons,
        gw_per_ctn: r.gw_per_ctn,
        nw_per_ctn: r.nw_per_ctn,
      }));

    if (!normalizedIncoming.length) return bad("No lines with shipped_qty > 0.", 400);

    const { data: poHeaders, error: poErr } = await supabaseAdmin
      .from("po_headers")
      .select("*")
      .in("id", poIds);

    if (poErr) return bad(poErr.message, 500);
    if (!poHeaders || poHeaders.length === 0) return bad("PO not found.", 404);

    const base = poHeaders[0];
    const buyerId = pickFirst(base, ["buyer_id"]) ?? null;

    const buyerIdSet = new Set(
      (poHeaders ?? [])
        .map((h: any) => safeStr(pickFirst(h, ["buyer_id", "buyer_company_id", "company_id"])))
        .filter(Boolean)
    );
    if (buyerIdSet.size > 1) {
      return bad("Selected POs must belong to the same buyer.", 400);
    }

    const poNoByHeaderId = new Map<string, string>();
    for (const h of poHeaders) {
      const hid = safeStr((h as any)?.id);
      if (!hid) continue;
      const pno = pickFirst(h, ["po_no", "po_number", "poNo"]) ?? null;
      if (pno) poNoByHeaderId.set(hid, safeStr(pno));
    }

    const { data: poLines, error: linesErr } = await supabaseAdmin
      .from("po_lines")
      .select("*")
      .in("po_header_id", poIds)
      .order("line_no", { ascending: true });

    if (linesErr) return bad(linesErr.message, 500);
    if (!poLines || poLines.length === 0) return bad("PO lines not found.", 404);

    const poLineById = new Map<string, any>();
    for (const l of poLines) {
      const id = safeStr((l as any)?.id);
      if (!id) continue;
      if ((l as any)?.is_deleted === true) continue;
      poLineById.set(id, l);
    }

    const effectiveIncoming = normalizedIncoming.filter((r) => poLineById.has(r.po_line_id));
    if (!effectiveIncoming.length) return bad("Selected lines not found in PO lines.", 400);

    let buyerName = pickFirst(base, ["buyer_name", "buyer_company_name", "buyer"]) ?? null;
    if (!buyerName && buyerId) {
      const { data: buyer, error: buyerErr } = await supabaseAdmin
        .from("companies")
        .select("company_name, name")
        .eq("id", buyerId)
        .maybeSingle();
      if (!buyerErr) {
        buyerName = pickFirst(buyer, ["company_name", "name"]) ?? null;
      }
    }

    const requestedByLineId = new Map<string, number>();
    for (const row of effectiveIncoming) {
      requestedByLineId.set(
        row.po_line_id,
        num(requestedByLineId.get(row.po_line_id), 0) + num(row.shipped_qty, 0)
      );
    }

    const effectiveLineIds = Array.from(new Set(effectiveIncoming.map((r) => r.po_line_id)));

    const { data: rawShipmentLines, error: slErr } = await supabaseAdmin
      .from("shipment_lines")
      .select("shipment_id, po_line_id, shipped_qty, is_deleted")
      .in("po_line_id", effectiveLineIds)
      .eq("is_deleted", false);

    if (slErr) return bad(`Load existing shipment lines failed: ${slErr.message}`, 500);

    const shipmentLines = rawShipmentLines ?? [];
    const shipmentIds = Array.from(
      new Set(
        shipmentLines
          .map((r: any) => safeStr(r?.shipment_id))
          .filter(Boolean)
      )
    );

    const allowedShipmentIdSet = new Set<string>();
    if (shipmentIds.length) {
      const { data: shipments, error: shErr } = await supabaseAdmin
        .from("shipments")
        .select("id, status, is_deleted")
        .in("id", shipmentIds);

      if (shErr) return bad(`Load existing shipments failed: ${shErr.message}`, 500);

      for (const sh of shipments ?? []) {
        const id = safeStr((sh as any)?.id);
        if (!id) continue;
        if (Boolean((sh as any)?.is_deleted)) continue;
        const status = safeStr((sh as any)?.status).toUpperCase();
        if (EXCLUDED_STATUSES.has(status)) continue;
        allowedShipmentIdSet.add(id);
      }
    }

    const alreadyShippedByLineId = new Map<string, number>();
    for (const row of shipmentLines) {
      const shipmentId = safeStr((row as any)?.shipment_id);
      if (allowedShipmentIdSet.size && !allowedShipmentIdSet.has(shipmentId)) continue;
      const poLineId = safeStr((row as any)?.po_line_id);
      if (!poLineId) continue;
      alreadyShippedByLineId.set(
        poLineId,
        num(alreadyShippedByLineId.get(poLineId), 0) + num((row as any)?.shipped_qty, 0)
      );
    }

    for (const lineId of effectiveLineIds) {
      const poLine = poLineById.get(lineId);
      const orderQty = num(
        pickFirst(poLine, ["order_qty", "qty", "quantity", "po_qty", "po_quantity"]) ?? 0,
        0
      );
      const alreadyShipped = num(alreadyShippedByLineId.get(lineId), 0);
      const remaining = Math.max(0, orderQty - alreadyShipped);
      const requested = num(requestedByLineId.get(lineId), 0);

      if (remaining <= 0) {
        const styleNo = pickFirst(poLine, ["buyer_style_no", "style_no", "jm_style_no"]) ?? lineId;
        return bad(`No remaining qty to ship for style ${styleNo}.`, 400, {
          po_line_id: lineId,
          remaining_qty: remaining,
        });
      }
      if (requested > remaining) {
        const styleNo = pickFirst(poLine, ["buyer_style_no", "style_no", "jm_style_no"]) ?? lineId;
        return bad(
          `Requested shipped qty (${requested}) exceeds remaining qty (${remaining}) for style ${styleNo}.`,
          400,
          {
            po_line_id: lineId,
            requested_qty: requested,
            remaining_qty: remaining,
            order_qty: orderQty,
            already_shipped_qty: alreadyShipped,
          }
        );
      }
    }

    const modeGroups = new Map<string, NormalizedIncomingLine[]>();
    for (const row of effectiveIncoming) {
      const mode = row.mode || "SEA";
      if (!modeGroups.has(mode)) modeGroups.set(mode, []);
      modeGroups.get(mode)!.push(row);
    }

    const createdShipments: any[] = [];

    for (const [mode, group] of modeGroups.entries()) {
      const shipping_origin_code =
        pickFirst(base, ["shipping_origin_code", "shipping_origin", "origin", "origin_code"]) ?? null;
      const destination = pickFirst(base, ["final_destination", "destination"]) ?? null;
      const poNo = poIds.length === 1 ? pickFirst(base, ["po_no", "po_number", "poNo"]) ?? null : null;

      const headerInsert: any = {
        po_header_id: poIds.length === 1 ? base?.id ?? null : null,
        po_no: poNo,
        buyer_id: buyerId,
        buyer_name: buyerName,
        currency: pickFirst(base, ["currency"]) ?? null,
        incoterm: pickFirst(base, ["incoterm", "incoterms", "inco_term", "inco_terms"]) ?? null,
        payment_term: pickFirst(base, ["payment_term", "payment_terms"]) ?? null,
        shipping_origin_code,
        origin: shipping_origin_code,
        destination,
        ship_mode: mode,
        mode,
        status: "DRAFT",
        is_deleted: false,
      };

      const insHeader = await insertWithAutoDrop("shipments", headerInsert, "*");
      if ((insHeader as any).error) {
        const e = (insHeader as any).error;
        return bad(`Save failed: ${e?.message ?? e}`, 400);
      }
      const shipment = (insHeader.data as any[])?.[0];
      if (!shipment?.id) return bad("Save failed: could not create shipment.", 500);

      const lineRows = group.map((row) => {
        const poLine = poLineById.get(row.po_line_id);
        const unitPrice = num(
          pickFirst(poLine, ["unit_price", "unitPrice", "price", "unit_cost"]) ?? 0,
          0
        );
        const orderQty = num(
          pickFirst(poLine, ["order_qty", "qty", "quantity", "po_qty", "po_quantity"]) ?? 0,
          0
        );
        const styleNo =
          pickFirst(poLine, [
            "buyer_style_no",
            "buyer_style_number",
            "buyer_style",
            "buyerStyleNo",
            "buyerStyleNumber",
            "style_no",
            "style",
            "style_number",
            "styleNo",
            "jm_style_no",
            "jmStyleNo",
          ]) ?? null;
        const desc = pickFirst(poLine, ["description", "item_description", "desc"]) ?? null;
        const color = pickFirst(poLine, ["color", "plating_color", "color_name"]) ?? null;
        const size = pickFirst(poLine, ["size"]) ?? null;
        const amount = unitPrice * num(row.shipped_qty, 0);

        return {
          shipment_id: shipment.id,
          po_line_id: poLine?.id ?? null,
          po_header_id: poLine?.po_header_id ?? base?.id ?? null,
          po_no:
            poNoByHeaderId.get(safeStr(poLine?.po_header_id ?? "")) ??
            poNoByHeaderId.get(safeStr(base?.id ?? "")) ??
            poNo,
          line_no: pickFirst(poLine, ["line_no", "line", "lineNo"]) ?? null,
          style_no: styleNo,
          description: desc,
          color,
          size,
          order_qty: orderQty,
          shipped_qty: num(row.shipped_qty, 0),
          unit_price: unitPrice,
          amount,
          ship_mode: mode,
          mode,
          carrier: row.carrier || null,
          tracking_no: row.tracking_no || null,
          cartons: num(row.cartons, 0),
          gw_per_ctn: num(row.gw_per_ctn, 0),
          nw_per_ctn: num(row.nw_per_ctn, 0),
          cbm_per_ctn: 0,
          is_deleted: false,
        };
      });

      const insLines = await insertWithAutoDrop("shipment_lines", lineRows, "*");
      if ((insLines as any).error) {
        const e = (insLines as any).error;
        return bad(`Save failed: ${e?.message ?? e}`, 400);
      }

      createdShipments.push({
        shipment_id: shipment.id,
        ship_mode: mode,
        header: shipment,
        lines: (insLines.data as any[]) ?? [],
      });
    }

    return ok({ created: createdShipments });
  } catch (e: any) {
    return bad(e?.message ?? "Unknown error", 500);
  }
}
