// src/app/api/shipments/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function bad(message: string, status = 400, extra?: any) {
  return NextResponse.json({ success: false, error: message, ...extra }, { status });
}
function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
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

function num(v: any, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function pickFirst(obj: any, keys: string[], fallback: any = null) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return fallback;
}

function normalizeShipMode(v: any) {
  const s = String(v || "").toUpperCase().trim();
  if (!s) return null;
  if (s === "A" || s === "AIR") return "AIR";
  if (s === "S" || s === "SEA" || s === "OCEAN") return "SEA";
  return s;
}

/**
 * ship_mode 자동 결정 (기존 B안 유지)
 */
async function resolveShipMode(
  shippingOriginCode: string | null,
  explicit?: any
): Promise<"SEA" | "AIR"> {
  const fromReq = normalizeShipMode(explicit);
  if (fromReq === "AIR" || fromReq === "SEA") return fromReq;

  if (!shippingOriginCode) return "SEA";

  const { data: site, error } = await supabaseAdmin
    .from("company_sites")
    .select("id,origin_code,air_port_loading,sea_port_loading")
    .eq("origin_code", shippingOriginCode)
    .order("is_default", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("resolveShipMode company_sites error:", error);
    return "SEA";
  }

  if (site?.air_port_loading) return "AIR";
  return "SEA";
}

/**
 * shipments.shipment_no: SHP-{CC}-{YYMM}-{seq4}
 */
async function generateShipmentNo(shippingOriginCode?: string | null, shipDate?: string | null) {
  const cc = originToCountryCode(shippingOriginCode);

  const d = shipDate ? new Date(shipDate) : new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yymm = `${yy}${mm}`;

  const prefix = `SHP-${cc}-${yymm}-`;

  const { data, error } = await supabaseAdmin
    .from("shipments")
    .select("shipment_no,created_at")
    .ilike("shipment_no", `${prefix}%`)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) throw new Error(error.message);

  let maxSeq = 0;
  for (const row of data || []) {
    const v = String((row as any).shipment_no || "");
    if (!v.startsWith(prefix)) continue;
    const tail = v.slice(prefix.length);
    const n = Number(tail);
    if (Number.isFinite(n)) maxSeq = Math.max(maxSeq, n);
  }
  const next = String(maxSeq + 1).padStart(4, "0");
  return `${prefix}${next}`;
}

/**
 * GET /api/shipments (기존 유지)
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const poNo = (url.searchParams.get("po_no") || "").trim();
    const buyer = (url.searchParams.get("buyer") || "").trim();
    const from = (url.searchParams.get("from") || "").trim();
    const to = (url.searchParams.get("to") || "").trim();
    const includeDeleted = url.searchParams.get("include_deleted") === "1";

    let q = supabaseAdmin
      .from("shipments")
      .select(
        [
          "id",
          "shipment_no",
          "po_header_id",
          "po_no",
          "buyer_id",
          "buyer_name",
          "currency",
          "incoterm",
          "payment_term",
          "shipping_origin_code",
          "destination",
          "etd",
          "eta",
          "status",
          "ship_mode",
          "total_cartons",
          "total_gw",
          "total_nw",
          "created_at",
          "updated_at",
          "created_by",
          "created_by_email",
          "is_deleted",
        ].join(",")
      )
      .order("created_at", { ascending: false })
      .limit(200);

    if (!includeDeleted) q = q.eq("is_deleted", false);

    if (poNo) q = q.ilike("po_no", `%${poNo}%`);
    if (buyer) q = q.ilike("buyer_name", `%${buyer}%`);

    if (from) q = q.gte("created_at", `${from}T00:00:00.000Z`);
    if (to) q = q.lte("created_at", `${to}T23:59:59.999Z`);

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    return ok({ shipments: data || [] });
  } catch (e: any) {
    console.error(e);
    return bad(e?.message || "Failed to load shipments", 500);
  }
}

/**
 * POST /api/shipments
 * - 단일 PO: 기존 FROM_PO 유지
 * - 다중 PO(A안): po_header_ids[] + shipment_pos insert + shipment_lines는 라인별 po_header_id/po_no 저장
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return bad("Invalid JSON", 400);

    const mode = String(body.mode || "FROM_PO").toUpperCase();
    const created_by = body.created_by ?? null;
    const created_by_email = body.created_by_email ?? null;

    const shipmentHeader =
      body.shipmentHeader && typeof body.shipmentHeader === "object" ? body.shipmentHeader : {};
    let shipmentLines = Array.isArray(body.shipmentLines) ? body.shipmentLines : [];

    // ✅ A안: po_header_ids (UI에서 보냄)
    const poHeaderIdsRaw = Array.isArray(body.po_header_ids) ? body.po_header_ids : null;
    const poHeaderIds =
      poHeaderIdsRaw?.filter((x: any) => typeof x === "string" && x.trim()).map((x: string) => x.trim()) ??
      [];

    const isMulti = poHeaderIds.length >= 2 || mode === "FROM_PO_MULTI";

    // 1) snapshot 구성
    let snapshot: any = null;

    if (!isMulti && mode === "FROM_PO") {
      // ===== 기존 단일 PO 모드 =====
      const poHeaderId = body.po_header_id ?? shipmentHeader.po_header_id ?? null;
      if (!poHeaderId) return bad("po_header_id is required for FROM_PO", 400);

      const { data: po, error: poErr } = await supabaseAdmin
        .from("po_headers")
        .select("*")
        .eq("id", poHeaderId)
        .maybeSingle();

      if (poErr) throw new Error(poErr.message);
      if (!po) return bad("PO header not found", 400);

      const poAny: any = po;

      const buyerId = pickFirst(poAny, ["buyer_id", "buyerId"], null);
      let buyerName = pickFirst(poAny, ["buyer_name", "buyer", "buyer_company_name"], null);

      if (!buyerName && buyerId) {
        const { data: buyer, error: bErr } = await supabaseAdmin
          .from("companies")
          .select("company_name,name")
          .eq("id", buyerId)
          .maybeSingle();
        if (!bErr) buyerName = (buyer as any)?.company_name ?? (buyer as any)?.name ?? null;
      }

      snapshot = {
        // 단일
        po_header_id: poAny.id,
        po_no: poAny.po_no ?? body.po_no ?? null,

        buyer_id: buyerId,
        buyer_name: buyerName,

        currency: pickFirst(poAny, ["currency", "po_currency"], null),
        incoterm: pickFirst(poAny, ["incoterm"], null),
        payment_term: pickFirst(poAny, ["payment_term", "payment_terms", "payment"], null),

        shipping_origin_code: pickFirst(
          poAny,
          ["shipping_origin_code", "origin_code", "shipping_origin"],
          null
        ),
        destination: pickFirst(poAny, ["destination", "final_destination", "ship_to"], null),

        etd: toDate10(
          pickFirst(poAny, ["requested_ship_date", "ship_date", "etd"], null) ||
            shipmentHeader.etd ||
            body.etd
        ),
        eta: toDate10(
          pickFirst(poAny, ["eta", "requested_eta"], null) || shipmentHeader.eta || body.eta
        ),

        po_header_ids: [poAny.id],
        po_nos: [poAny.po_no ?? null].filter(Boolean),
      };

      // shipmentLines가 비어있으면 po_lines에서 자동 생성 (기존 유지)
      if (!shipmentLines.length) {
        const { data: poLines, error: plErr } = await supabaseAdmin
          .from("po_lines")
          .select("*")
          .eq("po_header_id", poAny.id)
          .or("is_deleted.is.null,is_deleted.eq.false")
          .order("line_no", { ascending: true });

        if (plErr) throw new Error(plErr.message);

        shipmentLines = (poLines || []).map((l: any, idx: number) => {
          const orderQty = l.order_qty ?? l.qty ?? l.quantity ?? l.pcs ?? null;
          const shippedQty = l.shipped_qty ?? l.ship_qty ?? orderQty ?? null;
          const unitPrice = l.unit_price ?? l.price ?? null;
          const amount =
            l.amount ??
            (unitPrice != null && shippedQty != null ? num(unitPrice) * num(shippedQty) : null);

          return {
            po_header_id: poAny.id,
            po_no: poAny.po_no ?? null,

            po_line_id: l.id ?? null,
            line_no: l.line_no ?? idx + 1,
            style_no: l.style_no ?? l.style ?? l.jm_style_no ?? null,
            description: l.description ?? l.item_desc ?? null,
            color: l.color ?? null,
            size: l.size ?? null,
            order_qty: orderQty,
            shipped_qty: shippedQty,
            unit_price: unitPrice,
            amount,
            cartons: l.cartons ?? null,
            gw_per_ctn: null,
            nw_per_ctn: null,
            gw: null,
            nw: null,
          };
        });
      }
    } else {
      // ===== A안: 다중 PO 모드 =====
      if (!poHeaderIds.length) {
        return bad("po_header_ids[] is required for multi-PO shipment", 400);
      }

      // PO headers 조회
      const { data: pos, error: posErr } = await supabaseAdmin
        .from("po_headers")
        .select("*")
        .in("id", poHeaderIds);

      if (posErr) throw new Error(posErr.message);
      const poRows = (pos || []) as any[];
      if (poRows.length !== poHeaderIds.length) {
        return bad("Some PO headers not found", 400, {
          requested: poHeaderIds.length,
          found: poRows.length,
        });
      }

      // 같은 buyer 검증
      const buyerIds = Array.from(
        new Set(
          poRows
            .map((p) => pickFirst(p, ["buyer_id", "buyerId"], null))
            .filter((x) => !!x)
        )
      );

      if (buyerIds.length !== 1) {
        return bad("Only same buyer POs can be grouped into one shipment", 400, {
          buyer_ids: buyerIds,
        });
      }

      const buyerId = buyerIds[0];
      let buyerName =
        pickFirst(poRows[0], ["buyer_name", "buyer", "buyer_company_name"], null) ?? null;

      if (!buyerName && buyerId) {
        const { data: buyer, error: bErr } = await supabaseAdmin
          .from("companies")
          .select("company_name,name")
          .eq("id", buyerId)
          .maybeSingle();
        if (!bErr) buyerName = (buyer as any)?.company_name ?? (buyer as any)?.name ?? null;
      }

      // 대표값은 “첫 PO” 기준 (혼합 가능성은 있지만 ship_mode/번호 생성 때문에 기준값이 필요)
      const base = poRows[0];

      snapshot = {
        // 레거시 호환용: 첫 PO를 대표로 넣음 (canonical은 shipment_pos)
        po_header_id: base.id,
        po_no: base.po_no ?? null,

        buyer_id: buyerId,
        buyer_name: buyerName,

        // 헤더 메타는 우선 shipmentHeader가 있으면 사용, 없으면 base PO 값
        currency: shipmentHeader.currency ?? pickFirst(base, ["currency", "po_currency"], null),
        incoterm: shipmentHeader.incoterm ?? pickFirst(base, ["incoterm"], null),
        payment_term:
          shipmentHeader.payment_term ??
          pickFirst(base, ["payment_term", "payment_terms", "payment"], null),

        shipping_origin_code:
          shipmentHeader.shipping_origin_code ??
          pickFirst(base, ["shipping_origin_code", "origin_code", "shipping_origin"], null),

        destination:
          shipmentHeader.destination ??
          pickFirst(base, ["destination", "final_destination", "ship_to"], null),

        etd: toDate10(shipmentHeader.etd ?? pickFirst(base, ["requested_ship_date", "ship_date", "etd"], null)),
        eta: toDate10(shipmentHeader.eta ?? pickFirst(base, ["eta", "requested_eta"], null)),

        po_header_ids: poHeaderIds,
        po_nos: poRows.map((p) => p.po_no ?? null).filter(Boolean),
      };

      // shipmentLines가 비어있으면 여러 PO의 po_lines를 합쳐서 자동 생성
      if (!shipmentLines.length) {
        const { data: poLines, error: plErr } = await supabaseAdmin
          .from("po_lines")
          .select("*")
          .in("po_header_id", poHeaderIds)
          .or("is_deleted.is.null,is_deleted.eq.false")
          .order("po_header_id", { ascending: true })
          .order("line_no", { ascending: true });

        if (plErr) throw new Error(plErr.message);

        // po_no 매핑
        const poNoById = new Map<string, string>();
        for (const p of poRows) poNoById.set(String(p.id), String(p.po_no ?? ""));

        shipmentLines = (poLines || []).map((l: any, idx: number) => {
          const poId = String(l.po_header_id);
          const orderQty = l.order_qty ?? l.qty ?? l.quantity ?? l.pcs ?? null;
          const shippedQty = l.shipped_qty ?? l.ship_qty ?? orderQty ?? null;
          const unitPrice = l.unit_price ?? l.price ?? null;
          const amount =
            l.amount ??
            (unitPrice != null && shippedQty != null ? num(unitPrice) * num(shippedQty) : null);

          return {
            po_header_id: poId,
            po_no: poNoById.get(poId) ?? null,

            po_line_id: l.id ?? null,
            line_no: l.line_no ?? idx + 1,
            style_no: l.style_no ?? l.style ?? l.jm_style_no ?? null,
            description: l.description ?? l.item_desc ?? null,
            color: l.color ?? null,
            size: l.size ?? null,
            order_qty: orderQty,
            shipped_qty: shippedQty,
            unit_price: unitPrice,
            amount,
            cartons: l.cartons ?? null,
            gw_per_ctn: null,
            nw_per_ctn: null,
            gw: null,
            nw: null,
          };
        });
      }
    }

    // 2) ship_mode 결정 (대표 origin 기준)
    const ship_mode = await resolveShipMode(
      snapshot.shipping_origin_code ?? null,
      shipmentHeader.ship_mode ?? body.ship_mode ?? null
    );

    // 3) shipment_no
    const shipDateForNo = snapshot?.etd || shipmentHeader?.ship_date || body?.ship_date || null;

    let shipmentNo = body.shipment_no ?? shipmentHeader.shipment_no ?? null;
    if (!shipmentNo || String(shipmentNo).trim() === "") {
      shipmentNo = await generateShipmentNo(snapshot.shipping_origin_code, shipDateForNo);
    }

    // 4) totals (라인 기반이 최우선)
    const totalsFromLines = (() => {
      if (!shipmentLines.length) return null;

      let totalCartons = 0;
      let totalGw = 0;
      let totalNw = 0;

      for (const l of shipmentLines) {
        const cartons = num(l.cartons ?? 0);

        const gwTotal = num(
          l.gw ??
            l.gw_total ??
            (l.gw_per_ctn != null ? num(l.gw_per_ctn) * cartons : 0),
          0
        );

        const nwTotal = num(
          l.nw ??
            l.nw_total ??
            (l.nw_per_ctn != null ? num(l.nw_per_ctn) * cartons : 0),
          0
        );

        totalCartons += cartons;
        totalGw += gwTotal;
        totalNw += nwTotal;
      }

      return { total_cartons: totalCartons, total_gw: totalGw, total_nw: totalNw };
    })();

    const headerTotals = {
      total_cartons: num(shipmentHeader.total_cartons ?? body.total_cartons ?? 0),
      total_gw: num(shipmentHeader.total_gw ?? body.total_gw ?? 0),
      total_nw: num(shipmentHeader.total_nw ?? body.total_nw ?? 0),
    };

    // 5) shipments insert payload
    const shipmentPayload: any = {
      shipment_no: shipmentNo,

      // 레거시: 대표 PO만 저장 (canonical은 shipment_pos)
      po_header_id: snapshot.po_header_id ?? null,
      po_no: snapshot.po_no ?? null,

      buyer_id: snapshot.buyer_id ?? null,
      buyer_name: snapshot.buyer_name ?? null,

      currency: snapshot.currency ?? null,
      incoterm: snapshot.incoterm ?? null,
      payment_term: snapshot.payment_term ?? null,

      shipping_origin_code: snapshot.shipping_origin_code ?? null,
      destination: snapshot.destination ?? null,

      etd: snapshot.etd ?? null,
      eta: snapshot.eta ?? null,

      status: shipmentHeader.status ?? body.status ?? "DRAFT",

      ship_mode,

      ...(totalsFromLines ? totalsFromLines : headerTotals),

      memo: shipmentHeader.memo ?? body.memo ?? null,

      created_by,
      created_by_email,

      is_deleted: false,
    };

    const { data: insertedShipment, error: insErr } = await supabaseAdmin
      .from("shipments")
      .insert(shipmentPayload)
      .select("*")
      .single();

    if (insErr) throw new Error(insErr.message);
    if (!insertedShipment) return bad("Failed to create shipment", 500);

    // 6) ✅ shipment_pos insert (A안 핵심)
    const poIdsToLink: string[] = Array.isArray(snapshot.po_header_ids) ? snapshot.po_header_ids : [];
    const poNosToLink: string[] = Array.isArray(snapshot.po_nos) ? snapshot.po_nos : [];

    if (poIdsToLink.length) {
      // po_no 매핑이 없으면 null로 들어가도 OK
      const poNoById = new Map<string, string | null>();
      // 단일: 대표값
      if (!isMulti && snapshot.po_header_id && snapshot.po_no) poNoById.set(String(snapshot.po_header_id), String(snapshot.po_no));
      // 다중: UI가 po_nos를 같이 주기도 하고, DB 조회 때도 이미 채워짐
      // 여기서는 shipmentLines에서 po_no를 뽑아 매핑 보강
      for (const l of shipmentLines) {
        const pid = l.po_header_id ?? null;
        const pno = l.po_no ?? null;
        if (pid && pno && !poNoById.has(String(pid))) poNoById.set(String(pid), String(pno));
      }

      const linkRows = poIdsToLink.map((pid: string) => ({
        shipment_id: insertedShipment.id,
        po_header_id: pid,
        po_no: poNoById.get(String(pid)) ?? null,
      }));

      const { error: linkErr } = await supabaseAdmin.from("shipment_pos").insert(linkRows);
      if (linkErr) {
        return bad("Shipment created but failed to link POs (shipment_pos)", 500, {
          detail: linkErr.message,
          shipment_id: insertedShipment.id,
          sample_row: linkRows?.[0] ?? null,
        });
      }
    }

    // 7) shipment_lines insert
    if (!shipmentLines.length) {
      return bad("Shipment created but no lines to insert", 500, {
        shipment_id: insertedShipment.id,
        po_header_id: insertedShipment.po_header_id,
      });
    }

    const rows = shipmentLines.map((l: any, idx: number) => {
      const cartons = num(l.cartons ?? 0);

      const gwPer =
        l.gw_per_ctn ??
        l.gwPerCtn ??
        (cartons > 0 ? num(l.gw ?? l.gw_total ?? 0) / cartons : null);

      const nwPer =
        l.nw_per_ctn ??
        l.nwPerCtn ??
        (cartons > 0 ? num(l.nw ?? l.nw_total ?? 0) / cartons : null);

      const gwTotal =
        l.gw ??
        l.gw_total ??
        (gwPer != null && cartons > 0 ? num(gwPer) * cartons : null);

      const nwTotal =
        l.nw ??
        l.nw_total ??
        (nwPer != null && cartons > 0 ? num(nwPer) * cartons : null);

      return {
        shipment_id: insertedShipment.id,

        // ✅ A안: 라인별 po_header_id / po_no 저장 (여기가 핵심 변경!)
        po_header_id: l.po_header_id ?? l.poHeaderId ?? insertedShipment.po_header_id ?? null,
        po_no: l.po_no ?? l.poNo ?? insertedShipment.po_no ?? null,

        po_line_id: l.po_line_id ?? l.poLineId ?? null,
        line_no: l.line_no ?? l.lineNo ?? idx + 1,

        style_no: l.style_no ?? null,
        description: l.description ?? null,
        color: l.color ?? null,
        size: l.size ?? null,

        order_qty: l.order_qty ?? l.orderQty ?? null,
        shipped_qty: l.shipped_qty ?? l.shippedQty ?? null,

        unit_price: l.unit_price ?? l.unitPrice ?? null,
        amount: l.amount ?? null,

        cartons: l.cartons ?? null,

        gw: gwTotal,
        nw: nwTotal,
        gw_per_ctn: gwPer,
        nw_per_ctn: nwPer,

        is_deleted: false,
      };
    });

    const { error: lineErr } = await supabaseAdmin.from("shipment_lines").insert(rows);
    if (lineErr) {
      return bad("Failed to insert shipment_lines", 500, {
        detail: lineErr.message,
        shipment_id: insertedShipment.id,
        sample_row: rows?.[0] ?? null,
      });
    }

    return ok({
      shipment: insertedShipment,
      po_links: { inserted: poIdsToLink.length },
      lines: { inserted: rows.length },
    });
  } catch (e: any) {
    console.error(e);
    return bad(e?.message || "Failed to create shipment", 500);
  }
}
