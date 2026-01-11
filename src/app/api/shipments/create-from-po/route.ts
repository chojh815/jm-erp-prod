// src/app/api/shipments/create-from-po/route.ts
// Create Shipment(s) from selected PO(s) + shipped_qty input.
// - Does NOT trust UI payload for style/desc/color/size.
// - Always refetches po_headers/po_lines (and buyer company name) from DB.
// - Groups by mode (SEA/AIR/COURIER) and creates 1 shipment per mode.
// - Uses auto-drop retry to survive schema drift (missing columns).

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

// ---------------- auto-drop insert helper ----------------
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
  while (tries < 6) {
    tries++;
    const { data, error } = await supabaseAdmin.from(table).insert(payload).select(returning);
    if (!error) return { data, dropped: [] as string[] };

    const msg = error.message || "";
    const col = extractMissingColumn(msg);
    if (!col) return { data: null, error };

    const hadCol = payload.some(
      (r: any) => r && typeof r === "object" && Object.prototype.hasOwnProperty.call(r, col)
    );
    // If error is from a trigger/function and the missing col isn't in payload,
    // auto-drop cannot help.
    if (!hadCol) return { data: null, error };

    payload = payload.map((r: any) => {
      if (!r || typeof r !== "object") return r;
      const { [col]: _removed, ...rest } = r;
      return rest;
    });
  }
  return { data: null, error: new Error("insert retry exceeded") as any };
}

type IncomingLine = {
  po_line_id?: string | null;
  shipped_qty?: any;
  shippedQty?: any;
  use?: boolean;
  mode?: string | null;
  ship_mode?: string | null;
  shipMode?: string | null;
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const poIds: string[] = Array.isArray(body?.po_ids) ? body.po_ids : [];
    const incomingLines: IncomingLine[] = Array.isArray(body?.lines) ? body.lines : [];

    if (!poIds.length) return bad("po_ids is required.", 400);

    // 1) Load PO headers
    const { data: poHeaders, error: poErr } = await supabaseAdmin
      .from("po_headers")
      .select("*")
      .in("id", poIds);

    if (poErr) return bad(poErr.message, 500);
    if (!poHeaders || poHeaders.length === 0) return bad("PO not found.", 404);

    // Use the first header as base (UI should keep same buyer for combined shipment)
    const base = poHeaders[0];

    // 2) Create shipped_qty + mode map keyed by po_line_id
    const byLineId = new Map<
      string,
      { shipped_qty: number; mode: string;  }
    >();

    for (const r of incomingLines) {
      const lineId = safeStr((r as any)?.po_line_id);
      if (!lineId) continue;

      const use = (r as any).use === undefined ? true : Boolean((r as any).use);
      if (!use) continue;

      const shipped = num((r as any).shipped_qty ?? (r as any).shippedQty, 0);
      if (shipped <= 0) continue;

      const mode = safeStr((r as any).mode ?? (r as any).ship_mode ?? (r as any).shipMode ?? "SEA").toUpperCase();

      byLineId.set(lineId, {
        shipped_qty: shipped,
        mode: mode || "SEA",
      });
    }

    if (byLineId.size === 0) return bad("No lines with shipped_qty > 0.", 400);

    // 3) Load PO lines from DB so we always have style/desc/color/size
    const { data: poLines, error: linesErr } = await supabaseAdmin
      .from("po_lines")
      .select("*")
      .in("po_header_id", poIds)
      .order("line_no", { ascending: true });

    if (linesErr) return bad(linesErr.message, 500);
    if (!poLines || poLines.length === 0) return bad("PO lines not found.", 404);

    const effectivePoLines = poLines.filter((l: any) => {
      const id = safeStr(l?.id);
      return id && byLineId.has(id);
    });

    if (effectivePoLines.length === 0) return bad("Selected lines not found in PO lines.", 400);

    // 4) Resolve buyer name if missing in po_headers
    const buyerId = pickFirst(base, ["buyer_id"]) ?? null;
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

    // 5) Group by mode
    const modeGroups = new Map<string, any[]>();
    for (const l of effectivePoLines) {
      const meta = byLineId.get(safeStr(l.id))!;
      const m = meta.mode || "SEA";
      if (!modeGroups.has(m)) modeGroups.set(m, []);
      modeGroups.get(m)!.push({ poLine: l, meta });
    }

    const createdShipments: any[] = [];

    for (const [mode, group] of modeGroups.entries()) {
      const shipping_origin_code =
        pickFirst(base, ["shipping_origin_code", "shipping_origin", "origin", "origin_code"]) ?? null;
      const destination = pickFirst(base, ["final_destination", "destination"]) ?? null;
      const poNo = pickFirst(base, ["po_no", "po_number", "poNo"]) ?? null;

      // Some environments have shipments.origin (text) in addition to shipping_origin_code.
      // We write both; auto-drop handles missing columns.
      const headerInsert: any = {
        po_header_id: base?.id ?? null,
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

      // Header insert
      const insHeader = await insertWithAutoDrop("shipments", headerInsert, "*");
      if ((insHeader as any).error) {
        const e = (insHeader as any).error;
        return bad(`Save failed: ${e?.message ?? e}`, 400);
      }
      const shipment = (insHeader.data as any[])?.[0];
      if (!shipment?.id) return bad("Save failed: could not create shipment.", 500);

      // Lines insert
      const lineRows = group.map(({ poLine, meta }: any) => {
        const shippedQty = num(meta.shipped_qty, 0);
        const unitPrice = num(
          pickFirst(poLine, ["unit_price", "unitPrice", "price", "unit_cost"]) ?? 0,
          0
        );
        const orderQty = num(
          pickFirst(poLine, ["order_qty", "qty", "quantity", "po_qty", "po_quantity"]) ?? 0,
          0
        );

        const styleNo = pickFirst(poLine, ["style_no", "style", "style_number", "styleNo"]) ?? null;
        const desc = pickFirst(poLine, ["description", "item_description", "desc"]) ?? null;
        const color = pickFirst(poLine, ["color", "plating_color", "color_name"]) ?? null;
        const size = pickFirst(poLine, ["size"]) ?? null;

        const amount = unitPrice * shippedQty;

        return {
          shipment_id: shipment.id,
          po_line_id: poLine?.id ?? null,
          po_header_id: poLine?.po_header_id ?? base?.id ?? null,
          po_no: poNo,

          line_no: pickFirst(poLine, ["line_no", "line", "lineNo"]) ?? null,

          style_no: styleNo,
          description: desc,
          color,
          size,

          order_qty: orderQty,
          shipped_qty: shippedQty,
          unit_price: unitPrice,
          amount,

          ship_mode: mode,
          mode,

          // packing numbers (optional; leave 0)
          cartons: 0,
          gw_per_ctn: 0,
          nw_per_ctn: 0,
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
