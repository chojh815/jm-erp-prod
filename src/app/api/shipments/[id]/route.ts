// src/app/api/shipments/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}
function bad(message: string, status = 400, extra?: any) {
  return NextResponse.json(
    { success: false, error: message, ...(extra ?? {}) },
    { status }
  );
}
function s(v: any) {
  return (v ?? "").toString().trim();
}
function pickFirst(obj: any, keys: string[]) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== null && v !== undefined && s(v) !== "") return v;
  }
  return null;
}
function num(v: any, fallback = 0) {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function isTempSplitId(v: any) {
  return s(v).includes("__split__");
}
function sourceIdFromTempSplit(v: any) {
  return s(v).split("__split__")[0] || "";
}
function round2(v: number) {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}
function round1(v: number) {
  return Math.round((v + Number.EPSILON) * 10) / 10;
}
function proportionalAmount(params: {
  qty: number;
  sourceLine: any;
  poLine?: any | null;
}) {
  const poQty = num(pickFirst(params.poLine, ["qty", "order_qty", "quantity"]), 0);
  const poAmount = num(pickFirst(params.poLine, ["amount"]), NaN);
  if (Number.isFinite(poAmount) && poQty > 0) {
    return round2((poAmount * params.qty) / poQty);
  }
  return round2(params.qty * num(pickFirst(params.poLine, ["unit_price", "price"]), num(params.sourceLine?.unit_price, 0)));
}
function proportionalMetric(value: any, ratio: number, digits: 0 | 1 | 2 = 1) {
  const n0 = num(value, 0);
  const raw = n0 * ratio;
  if (digits === 0) return Math.round(raw);
  if (digits === 2) return round2(raw);
  return round1(raw);
}

function inferSiteFromOriginCode(code: string | null | undefined) {
  const c = s(code).toUpperCase();
  if (c.startsWith("VN_")) return "VN";
  if (c.startsWith("CN_")) return "CN";
  if (c.startsWith("KR_")) return "KR";
  return "VN"; // default
}

async function generateShipmentNo(params: {
  shipMode?: string | null;
  shippingOriginCode?: string | null;
  createdAt?: string | null;
}) {
  const site = inferSiteFromOriginCode(params.shippingOriginCode);
  const shipMode = s(params.shipMode || "SEA").toUpperCase();
  // YYMM from createdAt (or now)
  const d = params.createdAt ? new Date(params.createdAt) : new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const prefix = `SHP-${site}-${yy}${mm}-`;

  // sequence: count existing rows with prefix + 1
  const { count, error } = await supabaseAdmin
    .from("shipments")
    .select("id", { count: "exact", head: true })
    .ilike("shipment_no", `${prefix}%`);

  if (error) {
    // fallback without count (keep deterministic but non-blocking)
    return `${prefix}${String(Math.floor(Math.random() * 9000) + 1000)}`;
  }

  const seq = (count ?? 0) + 1;
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = s(params?.id);
    if (!id) return bad("Missing shipment id", 400);

    // 1) shipment header
    const { data: shipment, error: shipErr } = await supabaseAdmin
      .from("shipments")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (shipErr) return bad(`Failed to load shipment: ${shipErr.message}`, 500);
    if (!shipment) return bad("Shipment not found", 404);

    // 2) enrich from PO header if missing (po_header_id preferred, else po_no)
    let poHeader: any = null;
    const poHeaderId = pickFirst(shipment, ["po_header_id", "po_headerId"]);
    const poNo = pickFirst(shipment, ["po_no", "poNo"]);

    if (poHeaderId || poNo) {
      const q = supabaseAdmin.from("po_headers").select("*").limit(1);
      const { data, error } = poHeaderId
        ? await q.eq("id", poHeaderId).maybeSingle()
        : await q.eq("po_no", poNo).maybeSingle();
      if (!error) poHeader = data ?? null;
    }

    // 3) ensure shipment_no exists (otherwise generate & persist)
    let shipmentNo = pickFirst(shipment, ["shipment_no", "shipmentNo"]);
    if (!shipmentNo) {
      shipmentNo = await generateShipmentNo({
        shipMode: pickFirst(shipment, ["ship_mode", "shipMode"]),
        shippingOriginCode: pickFirst(shipment, ["shipping_origin_code", "shippingOriginCode"]) ?? pickFirst(poHeader, ["shipping_origin_code"]),
        createdAt: pickFirst(shipment, ["created_at"]),
      });

      await supabaseAdmin
        .from("shipments")
        .update({ shipment_no: shipmentNo })
        .eq("id", id);
      shipment.shipment_no = shipmentNo;
    }

    // 4) fill header fields from po_headers if missing (but do NOT overwrite existing non-empty)
    const patch: any = {};
    const want = (col: string, value: any) => {
      if (pickFirst(shipment, [col]) === null && value !== null && value !== undefined && s(value) !== "") {
        patch[col] = value;
      }
    };

    if (poHeader) {
      want("po_no", pickFirst(poHeader, ["po_no"]));
      want("buyer_id", pickFirst(poHeader, ["buyer_id"]));
      want("buyer_name", pickFirst(poHeader, ["buyer_name", "buyer_company_name", "buyer"]));
      want("currency", pickFirst(poHeader, ["currency"]));
      want("incoterm", pickFirst(poHeader, ["incoterm"]));
      want("payment_term", pickFirst(poHeader, ["payment_term", "payment_terms"]));
      want("shipping_origin_code", pickFirst(poHeader, ["shipping_origin_code"]));
      want("destination", pickFirst(poHeader, ["destination", "final_destination"]));
      // origin text (shipments.origin) fallback: if exists in po_headers as origin_text/origin_name etc.
      want("origin", pickFirst(poHeader, ["origin", "origin_text", "origin_name"]));
    }

    if (Object.keys(patch).length > 0) {
      await supabaseAdmin.from("shipments").update(patch).eq("id", id);
      Object.assign(shipment, patch);
    }

    // 5) lines + join po_lines to get style_no etc.
    let lines: any[] = [];
    let lineErrMsg: string | null = null;

    // Try FK join first
    const { data: lineRows, error: lineErr } = await supabaseAdmin
      .from("shipment_lines")
      .select("*, po_lines(*, po_headers:po_headers(po_no))")
      .eq("shipment_id", id)
      .eq("is_deleted", false);

    if (lineErr) {
      // Fallback without join
      lineErrMsg = lineErr.message;
      const { data: rawLines, error: rawErr } = await supabaseAdmin
        .from("shipment_lines")
        .select("*")
        .eq("shipment_id", id)
        .eq("is_deleted", false);

      if (rawErr) return bad(`Failed to load shipment_lines: ${rawErr.message}`, 500);

      const poLineIds = Array.from(new Set((rawLines ?? []).map((r: any) => r.po_line_id).filter(Boolean)));
      let poLineMap = new Map<string, any>();
      if (poLineIds.length > 0) {
        const { data: poLines } = await supabaseAdmin
          .from("po_lines")
          .select("*, po_headers:po_headers(po_no)")
          .in("id", poLineIds);
        (poLines ?? []).forEach((pl: any) => poLineMap.set(pl.id, pl));
      }

      lines = (rawLines ?? []).map((r: any) => ({
        ...r,
        po_lines: poLineMap.get(r.po_line_id) ?? null,
      }));
    } else {
      lines = (lineRows ?? []) as any[];
    }

    // 6) normalize fields for UI (style_no, description, color, size, ship_mode)
    const normalized = lines.map((r: any, idx: number) => {
      const pl = r.po_lines ?? null;

      const styleNo =
        pickFirst(r, ["style_no", "styleNo"]) ??
        pickFirst(pl, ["style_no", "styleNo", "style", "style_number"]) ??
        "-";

      const desc =
        pickFirst(r, ["description", "product_description", "desc"]) ??
        pickFirst(pl, ["description", "product_description", "desc"]) ??
        "-";

      const color =
        pickFirst(r, ["color"]) ??
        pickFirst(pl, ["color", "color_name"]) ??
        "-";

      const size =
        pickFirst(r, ["size"]) ??
        pickFirst(pl, ["size", "size_name"]) ??
        "-";

      // Prefer authoritative PO No from po_lines -> po_headers.po_no (prevents all-lines collapsing to shipment.po_no)
      const realPoNo =
        pickFirst(pl?.po_headers, ["po_no"]) ??
        pickFirst(pl, ["po_no"]) ??
        pickFirst(r, ["po_no"]) ??
        "-";

      // Keep what was stored in shipment_lines for debugging (optional)
      const savedPoNo = pickFirst(r, ["po_no"]) ?? "";

      return {
        ...r,
        line_no: r.line_no ?? idx + 1,
        po_no: realPoNo,
        saved_po_no: savedPoNo,
        style_no: styleNo,
        description: desc,
        color,
        size,
        ship_mode: pickFirst(r, ["ship_mode"]) ?? pickFirst(shipment, ["ship_mode"]) ?? "SEA",
        order_qty: num(pickFirst(pl, ["qty", "order_qty", "quantity"]), num(r.order_qty, 0)),
        shipped_qty: num(r.shipped_qty, num(r.qty, 0)),
        unit_price: num(pickFirst(pl, ["unit_price", "price"]), num(r.unit_price, 0)),
        amount: num(r.amount, 0),
      };
    });

    // 7) totals (fallback if header totals missing)
    const totalCartons =
      shipment.total_cartons ?? normalized.reduce((a: number, b: any) => a + num(b.cartons, 0), 0);
    const totalGw =
      shipment.total_gw ?? normalized.reduce((a: number, b: any) => a + num(b.gw, 0), 0);
    const totalNw =
      shipment.total_nw ?? normalized.reduce((a: number, b: any) => a + num(b.nw, 0), 0);

    return ok({
      shipment: {
        ...shipment,
        shipment_no: shipmentNo,
        total_cartons: totalCartons,
        total_gw: totalGw,
        total_nw: totalNw,
      },
      lines: normalized,
      _debug: lineErrMsg ? { shipment_lines_join_error: lineErrMsg } : undefined,
    });
  } catch (e: any) {
    return bad(e?.message || "Unknown error", 500);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = s(params?.id);
    if (!id) return bad("Missing shipment id", 400);

    const body = await req.json().catch(() => ({}));
    const shipmentIn = body?.shipment && typeof body.shipment === "object" ? body.shipment : {};
    const linesIn: any[] = Array.isArray(body?.lines) ? body.lines : [];

    const { data: shipment, error: shipErr } = await supabaseAdmin
      .from("shipments")
      .select("*")
      .eq("id", id)
      .eq("is_deleted", false)
      .maybeSingle();

    if (shipErr) return bad(`Failed to load shipment: ${shipErr.message}`, 500);
    if (!shipment) return bad("Shipment not found", 404);

    const status = s((shipment as any).status).toUpperCase();
    if (["CANCELLED", "CANCELED", "DELETED"].includes(status)) {
      return bad("Cancelled or deleted shipments cannot be edited.", 409);
    }

    const { data: invoices, error: invErr } = await supabaseAdmin
      .from("invoice_headers")
      .select("id, invoice_no")
      .eq("shipment_id", id)
      .eq("is_deleted", false)
      .limit(1);

    if (invErr) return bad(invErr.message, 500);
    if ((invoices || []).length > 0) {
      return bad("Shipment cannot be edited because an invoice is already linked.", 409, {
        invoice: invoices?.[0] ?? null,
      });
    }

    const { data: packingLists, error: plErr } = await supabaseAdmin
      .from("packing_list_headers")
      .select("id, packing_list_no")
      .eq("shipment_id", id)
      .eq("is_deleted", false)
      .limit(1);

    if (plErr) return bad(plErr.message, 500);
    if ((packingLists || []).length > 0) {
      return bad("Shipment cannot be edited because a packing list is already linked.", 409, {
        packing_list: packingLists?.[0] ?? null,
      });
    }

    const { data: existingLines, error: lineErr } = await supabaseAdmin
      .from("shipment_lines")
      .select("*")
      .eq("shipment_id", id)
      .eq("is_deleted", false);

    if (lineErr) return bad(lineErr.message, 500);

    const existingById = new Map<string, any>();
    const poLineIds = new Set<string>();
    for (const line of existingLines || []) {
      const lineId = s((line as any).id);
      if (lineId) existingById.set(lineId, line);
      const poLineId = s((line as any).po_line_id);
      if (poLineId) poLineIds.add(poLineId);
    }

    const { data: poLines, error: poErr } =
      poLineIds.size > 0
        ? await supabaseAdmin
            .from("po_lines")
            .select("id, qty, order_qty, quantity, unit_price, price, amount")
            .in("id", Array.from(poLineIds))
        : { data: [], error: null as any };

    if (poErr) return bad(poErr.message, 500);
    const poLineById = new Map<string, any>();
    for (const row of poLines || []) poLineById.set(s((row as any).id), row);

    const sourceRowsById = new Map<string, any[]>();
    for (const row of linesIn) {
      const rawId = s(row?.id);
      const sourceId = isTempSplitId(rawId) ? sourceIdFromTempSplit(rawId) : rawId;
      if (!sourceId || !existingById.has(sourceId)) continue;
      if (!sourceRowsById.has(sourceId)) sourceRowsById.set(sourceId, []);
      sourceRowsById.get(sourceId)!.push(row);
    }

    const now = new Date().toISOString();

    for (const [sourceId, rows] of sourceRowsById.entries()) {
      const source = existingById.get(sourceId);
      if (!source) continue;

      const originalQty = num(source.shipped_qty ?? source.qty, 0);
      const requestedQty = rows.reduce(
        (sum: number, row: any) =>
          sum + (Boolean(row?.is_deleted) ? 0 : Math.max(0, num(row?.qty ?? row?.shipped_qty, 0))),
        0
      );
      if (requestedQty > originalQty) {
        return bad("Edited shipment qty cannot exceed the original shipment qty.", 409, {
          shipment_line_id: sourceId,
          original_qty: originalQty,
          requested_qty: requestedQty,
        });
      }

      const poLine = poLineById.get(s(source.po_line_id)) ?? null;

      for (const row of rows) {
        const rawId = s(row?.id);
        const nextQty = Math.max(0, num(row?.qty ?? row?.shipped_qty, 0));
        const isDeleted = Boolean(row?.is_deleted) || nextQty <= 0;
        const ratio = originalQty > 0 ? nextQty / originalQty : 0;
        const nextAmount = isDeleted ? 0 : proportionalAmount({ qty: nextQty, sourceLine: source, poLine });

        const linePatch: any = {
          shipped_qty: nextQty,
          amount: nextAmount,
          cartons: proportionalMetric(source.cartons, ratio, 0),
          gw: proportionalMetric(source.gw, ratio, 1),
          nw: proportionalMetric(source.nw, ratio, 1),
          is_deleted: isDeleted,
          updated_at: now,
        };

        if (isTempSplitId(rawId)) {
          if (isDeleted) continue;
          const newLine = {
            ...source,
            id: undefined,
            created_at: undefined,
            updated_at: now,
            shipped_qty: nextQty,
            amount: nextAmount,
            cartons: linePatch.cartons,
            gw: linePatch.gw,
            nw: linePatch.nw,
            is_deleted: false,
          };

          delete (newLine as any).id;
          delete (newLine as any).created_at;

          const { error: insErr } = await supabaseAdmin.from("shipment_lines").insert(newLine);
          if (insErr) return bad(insErr.message, 500);
        } else {
          const { error: upErr } = await supabaseAdmin
            .from("shipment_lines")
            .update(linePatch)
            .eq("id", sourceId)
            .eq("shipment_id", id);

          if (upErr) return bad(upErr.message, 500);
        }
      }
    }

    const headerPatch: any = {
      updated_at: now,
    };
    const shipMode = s(shipmentIn.ship_mode ?? shipmentIn.shipMode);
    if (shipMode) headerPatch.ship_mode = shipMode.toUpperCase();
    if (s(shipmentIn.carrier)) headerPatch.carrier = s(shipmentIn.carrier);
    if (s(shipmentIn.tracking_no)) headerPatch.tracking_no = s(shipmentIn.tracking_no);

    const { data: currentLines, error: currentErr } = await supabaseAdmin
      .from("shipment_lines")
      .select("cartons, gw, nw")
      .eq("shipment_id", id)
      .eq("is_deleted", false);

    if (currentErr) return bad(currentErr.message, 500);

    headerPatch.total_cartons = (currentLines || []).reduce((sum: number, line: any) => sum + num(line.cartons, 0), 0);
    headerPatch.total_gw = round1((currentLines || []).reduce((sum: number, line: any) => sum + num(line.gw, 0), 0));
    headerPatch.total_nw = round1((currentLines || []).reduce((sum: number, line: any) => sum + num(line.nw, 0), 0));

    const { data: updatedShipment, error: headerErr } = await supabaseAdmin
      .from("shipments")
      .update(headerPatch)
      .eq("id", id)
      .select("*")
      .single();

    if (headerErr) return bad(headerErr.message, 500);

    return ok({ shipment: updatedShipment });
  } catch (e: any) {
    return bad(e?.message || "Unknown error", 500);
  }
}
