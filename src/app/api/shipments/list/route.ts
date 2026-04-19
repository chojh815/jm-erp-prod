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

function safe(v: any) {
  return (v ?? "").toString().trim();
}
function lc(v: any) {
  return safe(v).toLowerCase();
}
function uniqStrings(values: any[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values || []) {
    const s = safe(raw);
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}
function sortPo(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}
function buildPoDisplay(poNos: string[]) {
  if (!poNos.length) return "-";
  if (poNos.length === 1) return poNos[0];
  return `Multiple (${poNos.length})`;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const shipmentNo = safe(searchParams.get("shipment_no"));
    const poNo = safe(searchParams.get("po_no"));
    const buyer = safe(searchParams.get("buyer"));
    const q = safe(searchParams.get("q"));
    const status = safe(searchParams.get("status")).toUpperCase();

    let qb = supabaseAdmin
      .from("shipments")
      .select("*", { count: "exact" })
      .or("is_deleted.is.null,is_deleted.eq.false");

    if (status && status !== "ALL") qb = qb.eq("status", status);
    if (shipmentNo) qb = qb.ilike("shipment_no", `%${shipmentNo}%`);

    // buyer_code 컬럼은 shipments 테이블에 없으므로 참조하지 않음
    // 현재 구조에서는 buyer_name 기준 검색이 가장 안전함.
    if (buyer) {
      qb = qb.ilike("buyer_name", `%${buyer}%`);
    }

    qb = qb.order("created_at", { ascending: false }).order("shipment_no", { ascending: false });

    const { data, error, count } = await qb.limit(500);
    if (error) return bad(error.message, 500);

    const baseItems = (data || []) as any[];
    if (!baseItems.length) return ok({ items: [], total: 0 });

    const shipmentIds = uniqStrings(baseItems.map((x) => x?.id));
    const poMap = new Map<string, string[]>();

    try {
      const { data: spRows, error: spErr } = await supabaseAdmin
        .from("shipment_pos")
        .select("*")
        .in("shipment_id", shipmentIds)
        .or("is_deleted.is.null,is_deleted.eq.false");

      if (!spErr && Array.isArray(spRows)) {
        for (const row of spRows) {
          const shipmentId = safe((row as any)?.shipment_id);
          const po = safe((row as any)?.po_no ?? (row as any)?.po);
          if (!shipmentId || !po) continue;
          const arr = poMap.get(shipmentId) || [];
          arr.push(po);
          poMap.set(shipmentId, arr);
        }
      }
    } catch {}

    try {
      const { data: lineRows, error: lineErr } = await supabaseAdmin
        .from("shipment_lines")
        .select("*")
        .in("shipment_id", shipmentIds)
        .or("is_deleted.is.null,is_deleted.eq.false");

      if (!lineErr && Array.isArray(lineRows)) {
        for (const row of lineRows) {
          const shipmentId = safe((row as any)?.shipment_id);
          const po = safe((row as any)?.po_no ?? (row as any)?.po);
          if (!shipmentId || !po) continue;
          const arr = poMap.get(shipmentId) || [];
          arr.push(po);
          poMap.set(shipmentId, arr);
        }
      }
    } catch {}

    const invoiceMap = new Map<string, any>();
    try {
      const { data: invRows, error: invErr } = await supabaseAdmin
        .from("invoice_headers")
        .select("*")
        .in("shipment_id", shipmentIds)
        .or("is_deleted.is.null,is_deleted.eq.false");

      if (!invErr && Array.isArray(invRows)) {
        for (const row of invRows) {
          const shipmentId = safe((row as any)?.shipment_id);
          if (!shipmentId) continue;
          const prev = invoiceMap.get(shipmentId);
          if (!prev) {
            invoiceMap.set(shipmentId, row);
          } else {
            const prevTs = safe(prev?.created_at);
            const curTs = safe((row as any)?.created_at);
            if (curTs > prevTs) invoiceMap.set(shipmentId, row);
          }
        }
      }
    } catch {}

    const packingMap = new Map<string, any>();
    try {
      const { data: plRows, error: plErr } = await supabaseAdmin
        .from("packing_list_headers")
        .select("*")
        .in("shipment_id", shipmentIds)
        .or("is_deleted.is.null,is_deleted.eq.false");

      if (!plErr && Array.isArray(plRows)) {
        for (const row of plRows) {
          const shipmentId = safe((row as any)?.shipment_id);
          if (!shipmentId) continue;
          const prev = packingMap.get(shipmentId);
          if (!prev) {
            packingMap.set(shipmentId, row);
          } else {
            const prevTs = safe(prev?.created_at);
            const curTs = safe((row as any)?.created_at);
            if (curTs > prevTs) packingMap.set(shipmentId, row);
          }
        }
      }
    } catch {}

    let items = baseItems.map((row) => {
      const shipmentId = safe(row?.id);
      const poNos = uniqStrings([...(poMap.get(shipmentId) || []), row?.po_no]).sort(sortPo);

      const invoice = invoiceMap.get(shipmentId) || null;
      const packing = packingMap.get(shipmentId) || null;

      return {
        ...row,
        po_nos: poNos,
        po_display: buildPoDisplay(poNos),
        invoice_id: invoice?.id ?? null,
        invoice_no: invoice?.invoice_no ?? invoice?.invoiceNo ?? null,
        packing_list_id: packing?.id ?? null,
        packing_list_no: packing?.packing_list_no ?? packing?.packingListNo ?? null,
      };
    });

    if (poNo) {
      const needle = lc(poNo);
      items = items.filter((row) => {
        const poNos = Array.isArray(row?.po_nos) ? row.po_nos : [];
        return poNos.some((po: any) => lc(po).includes(needle));
      });
    }

    if (q) {
      const needle = lc(q);
      items = items.filter((row) => {
        const hay = [
          row?.shipment_no,
          row?.buyer_name,
          row?.destination,
          row?.final_destination,
          row?.invoice_no,
          row?.packing_list_no,
          ...(Array.isArray(row?.po_nos) ? row.po_nos : []),
        ].map(lc).join(" | ");
        return hay.includes(needle);
      });
    }

    return ok({ items, total: items.length, base_total: count ?? baseItems.length });
  } catch (e: any) {
    return bad(e?.message || "Server error", 500);
  }
}
