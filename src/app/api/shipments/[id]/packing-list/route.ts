// src/app/api/shipments/[id]/packing-list/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * ✅ v5
 * - PO# resolution priority changed:
 *    1) po_header_id -> po_headers.po_no  (authoritative)
 *    2) po_line_id   -> nested po_headers.po_no
 *    3) shipment_lines.po_no (fallback only; may be wrong in your DB)
 *    4) shipment.po_no
 * - Buyer Style first for Style# (buyer_style_* preferred)
 * - If PL exists, POST rebuilds lines (same as v4)
 */

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

function pickFirst(obj: any, keys: string[]) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
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

function pickPoLineStyleBuyerFirst(poLine: any) {
  return (
    pickFirst(poLine, [
      "buyer_style_no",
      "buyer_style_number",
      "buyer_style",
      "buyer_style_code",
      "buyer_style_name",
      "buyer_style_no_text",
      "jm_style_no",
      "jm_style",
      "jm_style_number",
      "jm_style_code",
      "style_no",
      "style",
      "style_number",
      "style_code",
    ]) ?? null
  );
}

function pickPoLineDesc(poLine: any) {
  return (
    pickFirst(poLine, [
      "description",
      "item_description",
      "item_desc",
      "product_name",
      "style_desc",
      "name",
    ]) ?? null
  );
}

async function clearPackingListLinesBestEffort(packingListId: string) {
  const soft = await supabaseAdmin
    .from("packing_list_lines")
    .update({ is_deleted: true })
    .eq("packing_list_id", packingListId);

  if (!soft.error) return { cleared: true, mode: "soft" as const };

  const msg = String(soft.error.message || "");
  if (extractMissingColumn(msg) === "is_deleted" || msg.toLowerCase().includes("is_deleted")) {
    const hard = await supabaseAdmin
      .from("packing_list_lines")
      .delete()
      .eq("packing_list_id", packingListId);
    if (hard.error) return { cleared: false, mode: "hard" as const, error: hard.error };
    return { cleared: true, mode: "hard" as const };
  }

  return { cleared: false, mode: "soft" as const, error: soft.error };
}

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

export async function POST(_req: Request, ctx: { params: { id: string } }) {
  try {
    const shipmentId = ctx?.params?.id;
    if (!isUuid(shipmentId)) return bad("Invalid shipment id", 400);

    const shipment = await getShipmentOr404(shipmentId);
    if (!shipment) return bad("Shipment not found", 404);

    const inv = await getLatestInvoiceHeaderByShipment(shipmentId);
    if (!inv?.id || !inv?.invoice_no) {
      return bad("Invoice must be created first for this shipment.", 409, { shipment_id: shipmentId });
    }

    const sLines = await loadShipmentLines(shipmentId);

    const poLineIds = Array.from(
      new Set(
        sLines
          .map((r: any) => pickFirst(r, ["po_line_id", "poLineId", "po_line_uuid"]))
          .filter(Boolean)
      )
    ) as string[];

    const poLineToHeader = new Map<string, string>();
    const poHeaderToNo = new Map<string, string>();
    const poLineToNestedPoNo = new Map<string, string>();
    const poLineToBuyerStyle = new Map<string, string>();
    const poLineToDesc = new Map<string, string>();

    const headerIdsFromShipment = Array.from(
      new Set(
        sLines
          .map((r: any) => pickFirst(r, ["po_header_id", "poHeaderId"]))
          .filter(Boolean)
      )
    ) as string[];

    if (poLineIds.length > 0) {
      const { data: poLineRows, error: poLineErr } = await supabaseAdmin
        .from("po_lines")
        .select("*, po_headers:po_header_id(po_no)")
        .in("id", poLineIds)
        .limit(5000);

      if (poLineErr) throw new Error(poLineErr.message);

      const headerIds: string[] = [];
      for (const r of poLineRows ?? []) {
        const id = (r as any)?.id;
        if (!id) continue;

        const headerId = (r as any)?.po_header_id ?? null;
        if (headerId) {
          poLineToHeader.set(id, headerId);
          headerIds.push(headerId);
        }

        const nestedPoNo = (r as any)?.po_headers?.po_no ?? null;
        if (nestedPoNo) poLineToNestedPoNo.set(id, nestedPoNo);

        const buyerStyle = pickPoLineStyleBuyerFirst(r);
        if (buyerStyle) poLineToBuyerStyle.set(id, buyerStyle);

        const desc = pickPoLineDesc(r);
        if (desc) poLineToDesc.set(id, desc);
      }

      for (const hid of headerIdsFromShipment) headerIds.push(hid);
      const uniqHeaderIds = Array.from(new Set(headerIds));

      if (uniqHeaderIds.length > 0) {
        const { data: poHeaderRows, error: poHeaderErr } = await supabaseAdmin
          .from("po_headers")
          .select("id, po_no")
          .in("id", uniqHeaderIds)
          .limit(5000);

        if (poHeaderErr) throw new Error(poHeaderErr.message);

        for (const r of poHeaderRows ?? []) {
          if ((r as any)?.id && (r as any)?.po_no) poHeaderToNo.set((r as any).id, (r as any).po_no);
        }
      }
    } else if (headerIdsFromShipment.length > 0) {
      const { data: poHeaderRows, error: poHeaderErr } = await supabaseAdmin
        .from("po_headers")
        .select("id, po_no")
        .in("id", headerIdsFromShipment)
        .limit(5000);

      if (poHeaderErr) throw new Error(poHeaderErr.message);

      for (const r of poHeaderRows ?? []) {
        if ((r as any)?.id && (r as any)?.po_no) poHeaderToNo.set((r as any).id, (r as any).po_no);
      }
    }

    const totalCartonsCalc = sLines.reduce((a, r: any) => a + num(r.cartons, 0), 0);
    const totalGwCalc = sLines.reduce((a, r: any) => a + num(r.gw, 0), 0);
    const totalNwCalc = sLines.reduce((a, r: any) => a + num(r.nw, 0), 0);

    const existing = await findExistingPackingList(shipmentId);

    const buildLineRows = (packingListId: string) =>
      sLines.map((r: any, idx: number) => {
        const poLineId = pickFirst(r, ["po_line_id", "poLineId", "po_line_uuid"]) ?? null;

        const poHeaderId =
          pickFirst(r, ["po_header_id", "poHeaderId"]) ||
          (poLineId ? poLineToHeader.get(poLineId) : null) ||
          null;

        const poNoByHeader = poHeaderId ? poHeaderToNo.get(poHeaderId) : null;
        const poNoByNested = poLineId ? poLineToNestedPoNo.get(poLineId) : null;
        const savedPoNo = pickFirst(r, ["po_no", "poNo", "po_number", "po#", "po"]) ?? null;

        const resolvedPoNo = poNoByHeader || poNoByNested || savedPoNo || null;

        const buyerStyle =
          (poLineId ? poLineToBuyerStyle.get(poLineId) : null) ||
          pickFirst(r, ["buyer_style_no", "buyerStyleNo", "buyer_style_number", "buyerStyleNumber"]) ||
          null;

        const fallbackStyle = pickFirst(r, ["style_no", "style", "style#", "style_no_text"]) || null;
        const resolvedStyle = buyerStyle || fallbackStyle;

        const resolvedDesc =
          pickFirst(r, ["description", "item_desc", "product_name", "style_desc"]) ||
          (poLineId ? poLineToDesc.get(poLineId) : null) ||
          null;

        return {
          packing_list_id: packingListId,
          shipment_id: shipment.id,
          shipment_line_id: r.id ?? null,
          line_no: r.line_no ?? idx + 1,

          po_header_id: poHeaderId ?? shipment.po_header_id ?? null,
          po_no: resolvedPoNo ?? shipment.po_no ?? null,
          po_line_id: poLineId,

          style_no: resolvedStyle,
          description: resolvedDesc,

          shipped_qty: pickFirst(r, ["shipped_qty", "shippedQty"]) ?? 0,

          cartons: pickFirst(r, ["cartons"]) ?? 0,
          gw: pickFirst(r, ["gw"]) ?? null,
          nw: pickFirst(r, ["nw"]) ?? null,

          gw_per_ctn: pickFirst(r, ["gw_per_ctn", "gw_per_carton", "gwPerCtn", "gwPerCarton"]) ?? null,
          nw_per_ctn: pickFirst(r, ["nw_per_ctn", "nw_per_carton", "nwPerCtn", "nwPerCarton"]) ?? null,
          cbm_per_ctn: pickFirst(r, ["cbm_per_ctn", "cbm_per_carton", "cbmPerCtn", "cbmPerCarton"]) ?? null,

          is_deleted: false,
        };
      });

    if (existing) {
      await safeUpdateOne("packing_list_headers", existing.id, {
        updated_at: new Date().toISOString(),
        invoice_id: existing.invoice_id ?? inv.id,
        invoice_no: existing.invoice_no ?? inv.invoice_no,
        total_cartons: existing.total_cartons ?? totalCartonsCalc,
        total_gw: existing.total_gw ?? totalGwCalc,
        total_nw: existing.total_nw ?? totalNwCalc,
      });

      const cleared = await clearPackingListLinesBestEffort(existing.id);

      const lineRows = buildLineRows(existing.id);
      const insLines = await safeInsertMany("packing_list_lines", lineRows);
      if (insLines.error) return bad("Failed to rebuild packing list lines.", 500, { packing_list_id: existing.id });

      return ok({
        already_exists: true,
        rebuilt: true,
        packing_list_id: existing.id,
        cleared_lines_mode: cleared.mode,
        rebuilt_lines: insLines.data.length,
      });
    }

    const genNo = await generatePackingListNo(
      shipment.shipping_origin_code ?? null,
      shipment.etd ?? shipment.created_at ?? null
    );
    const packingListNo = genNo || null;

    const headerPayload: Record<string, any> = {
      shipment_id: shipment.id,
      shipment_no: shipment.shipment_no ?? null,
      po_header_id: shipment.po_header_id ?? null,
      po_no: shipment.po_no ?? null,

      buyer_id: shipment.buyer_id ?? inv?.buyer_id ?? null,
      buyer_name: shipment.buyer_name ?? inv?.buyer_name ?? null,
      buyer_code: inv?.buyer_code ?? shipment.buyer_code ?? null,

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

      invoice_id: inv.id,
      invoice_no: inv.invoice_no,

      remarks: inv?.remarks ?? null,
      consignee_text: inv?.consignee_text ?? null,
      notify_party_text: inv?.notify_party_text ?? null,
      shipper_name: inv?.shipper_name ?? null,
      shipper_address: inv?.shipper_address ?? null,
      port_of_loading: inv?.port_of_loading ?? null,
      final_destination: inv?.final_destination ?? null,
      coo_text: inv?.coo_text ?? null,

      packing_list_no: packingListNo,
    };

    const ins = await safeInsertOne("packing_list_headers", headerPayload);
    if (ins.error) return bad(ins.error.message || "Failed to create packing list", 500);

    const header = ins.data as any;
    const packingListId = header?.id;
    if (!packingListId) return bad("packing_list_headers insert succeeded but id missing", 500);

    if (!header?.packing_list_no) {
      const finalNo = packingListNo || `PL-${String(packingListId).slice(0, 8)}`;
      await safeUpdateOne("packing_list_headers", packingListId, {
        packing_list_no: finalNo,
        updated_at: new Date().toISOString(),
      });
    }

    const lineRows = buildLineRows(packingListId);
    const insLines = await safeInsertMany("packing_list_lines", lineRows);
    if (insLines.error) {
      return bad("Packing List header created, but failed to copy lines.", 500, { packing_list_id: packingListId });
    }

    return ok({
      already_exists: false,
      packing_list_id: packingListId,
      copied_lines: insLines.data.length,
      invoice: { id: inv.id, invoice_no: inv.invoice_no },
    });
  } catch (e: any) {
    console.error(e);
    return bad(e?.message || "Failed to create packing list", 500);
  }
}
