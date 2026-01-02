// src/app/api/shipments/[id]/invoice/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}
function bad(message: string, status = 400, extra?: any) {
  return NextResponse.json({ success: false, error: message, ...extra }, { status });
}

function num(v: any, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function originToCountry(origin?: string | null) {
  const o = String(origin || "").toUpperCase();
  if (o.startsWith("VN_") || o.includes("VIET")) return "VIETNAM";
  if (o.startsWith("CN_") || o.includes("CHINA")) return "CHINA";
  if (o.startsWith("KR_") || o.includes("KOREA") || o.includes("SEOUL")) return "KOREA";
  return "JM";
}

function toDate10(v: any) {
  if (!v) return null;
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

/**
 * ship_mode 컬럼이 shipment에 없으니:
 * - body.ship_mode 가 있으면 그걸 우선 사용 (AIR/SEA)
 * - 없으면 휴리스틱: cartons <= 10 또는 total_gw <= 100 이면 AIR, 아니면 SEA
 */
function decideShipMode(bodyShipMode: any, shipment: any) {
  const m = String(bodyShipMode || "").toUpperCase().trim();
  if (m === "AIR" || m === "SEA") return m;

  const cartons = num(shipment?.total_cartons, 0);
  const gw = num(shipment?.total_gw, 0);
  if (cartons > 0 && cartons <= 10) return "AIR";
  if (gw > 0 && gw <= 100) return "AIR";
  return "SEA";
}

/**
 * company_sites에서 origin_code로 Site 찾기
 * 우선순위:
 * 1) origin_code 정확히 일치 + exporter_of_record=true
 * 2) origin_code 정확히 일치 + is_default=true
 * 3) origin_code 정확히 일치 최신
 */
async function findShipperSiteByOrigin(originCode?: string | null) {
  const origin = String(originCode || "").trim();
  if (!origin) return null;

  // 1) exporter_of_record 우선
  {
    const { data, error } = await supabaseAdmin
      .from("company_sites")
      .select("*")
      .eq("origin_code", origin)
      .eq("exporter_of_record", true)
      .limit(1)
      .maybeSingle();

    if (!error && data) return data;
  }

  // 2) default 우선
  {
    const { data, error } = await supabaseAdmin
      .from("company_sites")
      .select("*")
      .eq("origin_code", origin)
      .eq("is_default", true)
      .limit(1)
      .maybeSingle();

    if (!error && data) return data;
  }

  // 3) 그냥 하나
  {
    const { data, error } = await supabaseAdmin
      .from("company_sites")
      .select("*")
      .eq("origin_code", origin)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && data) return data;
  }

  return null;
}

function buildAddress(site: any) {
  // 네 스키마상 address 컬럼도 있고 address1/2도 있음 → 있는 것 우선 조합
  const lines: string[] = [];

  const a = String(site?.address || "").trim();
  if (a) {
    lines.push(a);
  } else {
    const a1 = String(site?.address1 || "").trim();
    const a2 = String(site?.address2 || "").trim();
    if (a1) lines.push(a1);
    if (a2) lines.push(a2);
  }

  const city = String(site?.city || "").trim();
  const state = String(site?.state || "").trim();
  const zip = String(site?.zip || "").trim();
  const country = String(site?.country || site?.origin_country || "").trim();

  const cityLine = [city, state].filter(Boolean).join(", ");
  if (cityLine) lines.push(cityLine);

  if (zip) lines.push(zip);
  if (country) lines.push(country);

  return lines.filter(Boolean).join("\n");
}

/**
 * GET: 이 shipment에 연결된 최신 invoice 1개 반환
 */
export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const shipmentId = params.id;
    if (!shipmentId) return bad("Shipment ID is required", 400);

    const { data, error } = await supabaseAdmin
      .from("invoice_headers")
      .select("*")
      .eq("shipment_id", shipmentId)
      .eq("is_deleted", false)
      .eq("is_latest", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    return ok({ invoice: data ?? null });
  } catch (e: any) {
    console.error("Shipment invoice link error:", e);
    return bad(e?.message || "Failed to load linked invoice", 500);
  }
}

/**
 * POST: Shipment → Invoice 생성
 * - shipper 주소/법인명: company_sites(origin_code = shipping_origin_code)에서 자동
 * - port_of_loading: ship_mode(AIR/SEA) 자동 판단 후 company_sites의 air_port_loading/sea_port_loading 사용
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const shipmentId = params.id;
    if (!shipmentId) return bad("Shipment ID is required", 400);

    const body = await req.json().catch(() => ({}));
    const shipMode = String(body?.ship_mode || "").toUpperCase().trim(); // optional

    // 1) shipment header
    const { data: shipment, error: shErr } = await supabaseAdmin
      .from("shipments")
      .select("*")
      .eq("id", shipmentId)
      .maybeSingle();

    if (shErr) return bad(shErr.message, 500);
    if (!shipment) return bad("Shipment not found", 404);
    if ((shipment as any).is_deleted) return bad("Shipment is deleted", 409);

    // 2) 이미 invoice가 있으면 그대로 반환 (중복 생성 방지)
    const { data: existing, error: exErr } = await supabaseAdmin
      .from("invoice_headers")
      .select("*")
      .eq("shipment_id", shipmentId)
      .eq("is_deleted", false)
      .eq("is_latest", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (exErr) return bad(exErr.message, 500);
    if (existing) return ok({ invoice: existing, already_exists: true });

    // 3) shipment_lines
    const { data: sLines, error: slErr } = await supabaseAdmin
      .from("shipment_lines")
      .select("*")
      .eq("shipment_id", shipmentId)
      .eq("is_deleted", false)
      .order("line_no", { ascending: true });

    if (slErr) return bad(slErr.message, 500);

    // 4) buyer (code 포함)
    let buyerCode: string | null = null;
    if ((shipment as any).buyer_id) {
      const { data: buyer, error: bErr } = await supabaseAdmin
        .from("companies")
        .select("id,code,company_name,name,buyer_consignee,buyer_notify_party")
        .eq("id", (shipment as any).buyer_id)
        .maybeSingle();

      if (bErr) return bad(bErr.message, 500);

      buyerCode = (buyer as any)?.code ?? null;

      // consignee/notify (있으면)
      if (!(shipment as any).consignee_text && (buyer as any)?.buyer_consignee) {
        (shipment as any).consignee_text = (buyer as any).buyer_consignee;
      }
      if (!(shipment as any).notify_party_text && (buyer as any)?.buyer_notify_party) {
        (shipment as any).notify_party_text = (buyer as any).buyer_notify_party;
      }
    }

    // 5) shipper site 자동 매핑 (🔥 여기 핵심)
    const site = await findShipperSiteByOrigin((shipment as any).shipping_origin_code);

    const computedMode = decideShipMode(shipMode, shipment);
    const portOfLoading =
      computedMode === "AIR"
        ? (site as any)?.air_port_loading ?? null
        : (site as any)?.sea_port_loading ?? null;

    const shipperCompanyId = (site as any)?.company_id ?? null;
    const shipperName =
      (site as any)?.site_name ||
      (site as any)?.name ||
      null;

    const shipperAddress = site ? buildAddress(site) : null;

    // 6) invoice_no 생성 (너가 정한 포맷: JMI-{buyerCode}-{yy}-{seq4})
    // buyerCode 없으면 "BUYER"로 대체
    const bc = String(buyerCode || "BUYER").toUpperCase();
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const prefix = `JMI-${bc}-${yy}-`;

    const { data: recent, error: rErr } = await supabaseAdmin
      .from("invoice_headers")
      .select("invoice_no,created_at")
      .ilike("invoice_no", `${prefix}%`)
      .order("created_at", { ascending: false })
      .limit(300);

    if (rErr) return bad(rErr.message, 500);

    let maxSeq = 0;
    for (const row of recent || []) {
      const v = String((row as any).invoice_no || "");
      if (!v.startsWith(prefix)) continue;
      const tail = v.slice(prefix.length);
      const n = Number(tail);
      if (Number.isFinite(n)) maxSeq = Math.max(maxSeq, n);
    }
    const seq4 = String(maxSeq + 1).padStart(4, "0");
    const invoiceNo = `${prefix}${seq4}`;

    // 7) totals (invoice는 Amount 중심)
    const totalAmount = (sLines || []).reduce((s: number, l: any) => s + num(l.amount, 0), 0);

    // 8) invoice_headers insert (스키마에 맞게)
    const headerPayload: any = {
      invoice_no: invoiceNo,
      buyer_id: (shipment as any).buyer_id ?? null,
      buyer_name: (shipment as any).buyer_name ?? null,
      buyer_code: buyerCode,

      currency: (shipment as any).currency ?? null,
      incoterm: (shipment as any).incoterm ?? null,
      payment_term: (shipment as any).payment_term ?? null,
      shipping_origin_code: (shipment as any).shipping_origin_code ?? null,

      destination: (shipment as any).destination ?? null,
      final_destination: (shipment as any).destination ?? null,

      etd: toDate10((shipment as any).etd),
      eta: toDate10((shipment as any).eta),

      status: "DRAFT",
      total_amount: totalAmount,

      // Shipment 쪽 totals도 같이 복사(있으면)
      total_cartons: (shipment as any).total_cartons ?? null,
      total_gw: (shipment as any).total_gw ?? null,
      total_nw: (shipment as any).total_nw ?? null,

      remarks: (body?.remarks ?? (shipment as any).memo ?? null),

      consignee_text: (body?.consignee_text ?? (shipment as any).consignee_text ?? null),
      notify_party_text: (body?.notify_party_text ?? (shipment as any).notify_party_text ?? null),

      // ✅ shipper 자동 세팅
      shipper_company_id: shipperCompanyId,
      shipper_name: shipperName,
      shipper_address: shipperAddress,

      // ✅ port of loading 자동 세팅
      port_of_loading: body?.port_of_loading ?? portOfLoading,

      // COO 자동 (원하면 문구 더 길게 바꿔줄게)
      coo_text: `MADE IN ${originToCountry((shipment as any).shipping_origin_code)}`,

      shipment_id: shipmentId,
      invoice_date: toDate10(body?.invoice_date) ?? toDate10(now.toISOString()),

      created_by: body?.created_by ?? null,
      created_by_email: body?.created_by_email ?? null,
      is_deleted: false,
      revision_no: 0,
      is_latest: true,
    };

    const { data: invoiceHeader, error: ihErr } = await supabaseAdmin
      .from("invoice_headers")
      .insert(headerPayload)
      .select("*")
      .single();

    if (ihErr) return bad("Failed to create invoice header", 500, { detail: ihErr.message });

    // 9) invoice_lines insert (Shipment lines → Invoice lines)
    const lineRows = (sLines || []).map((l: any, idx: number) => {
      const qty = l.shipped_qty ?? l.order_qty ?? null;

      return {
        invoice_id: invoiceHeader.id,
        invoice_header_id: invoiceHeader.id,

        shipment_id: shipmentId,
        shipment_line_id: l.id ?? null,

        po_header_id: l.po_header_id ?? null,
        po_line_id: l.po_line_id ?? null,
        po_no: l.po_no ?? (shipment as any).po_no ?? null,

        line_no: l.line_no ?? idx + 1,
        style_no: l.style_no ?? null,
        description: l.description ?? null,

        // Invoice는 Amount 중심이라 color/size는 유지하되 포장정보는 null로 둠
        color: l.color ?? null,
        size: l.size ?? null,

        qty,
        unit_price: l.unit_price ?? null,
        amount: l.amount ?? (qty != null && l.unit_price != null ? num(qty) * num(l.unit_price) : null),

        cartons: null,
        gw: null,
        nw: null,

        is_deleted: false,
      };
    });

    if (lineRows.length) {
      const { error: ilErr } = await supabaseAdmin.from("invoice_lines").insert(lineRows);
      if (ilErr) {
        // header는 만들어졌으니, 라인 실패를 명확히 반환
        return bad("Invoice header created but failed to insert invoice lines", 500, {
          detail: ilErr.message,
          invoice_id: invoiceHeader.id,
        });
      }
    }

    return ok({ invoice: invoiceHeader });
  } catch (e: any) {
    console.error("Create invoice from shipment error:", e);
    return bad(e?.message || "Failed to create invoice", 500);
  }
}
