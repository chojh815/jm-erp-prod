// src/app/api/invoices/create-from-shipment/route.ts
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
function isUuid(v: string) {
  return UUID_RE.test(v);
}

function safeNumber(v: any, fallback = 0) {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function pad4(n: number) {
  return String(n).padStart(4, "0");
}
function toDate10(v?: any) {
  if (!v) return null;
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function originCountryFromCode(origin?: string | null) {
  const o = String(origin || "").toUpperCase();
  if (o.startsWith("VN_") || o.includes("VIET")) return "VN";
  if (o.startsWith("CN_") || o.includes("CHINA")) return "CN";
  if (o.startsWith("KR_") || o.includes("KOREA") || o.includes("SEOUL")) return "KR";
  return "JM";
}
function cooTextFromOrigin(origin?: string | null) {
  const cc = originCountryFromCode(origin);
  if (cc === "VN") return "MADE IN VIETNAM";
  if (cc === "CN") return "MADE IN CHINA";
  if (cc === "KR") return "MADE IN KOREA";
  return "MADE IN JM";
}

// ship_mode 컬럼이 shipment에 없으니,
// 1) po_headers.ship_mode를 우선 참고
// 2) 없으면 SEA로 처리 (기본)
function normalizeShipMode(v: any): "AIR" | "SEA" {
  const s = String(v || "").toUpperCase();
  if (s.includes("AIR")) return "AIR";
  return "SEA";
}

async function getBuyerDefaults(buyerId: string) {
  const { data, error } = await supabaseAdmin
    .from("companies")
    .select(
      `
      code,
      buyer_consignee,
      buyer_notify_party,
      buyer_payment_term,
      buyer_final_destination,
      buyer_default_incoterm
    `
    )
    .eq("id", buyerId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Buyer company not found.");
  return data;
}

async function getBuyerCode(buyerId: string) {
  const { data, error } = await supabaseAdmin
    .from("companies")
    .select("code")
    .eq("id", buyerId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data?.code) throw new Error("Buyer code not found.");
  return String(data.code).trim();
}

async function generateInvoiceNo(buyerCode: string) {
  const yy = pad2(new Date().getFullYear() % 100);
  const prefix = `JMI-${buyerCode}-${yy}-`;

  const { data, error } = await supabaseAdmin
    .from("invoice_headers")
    .select("invoice_no")
    .like("invoice_no", `${prefix}%`)
    .order("invoice_no", { ascending: false })
    .limit(1);

  if (error) throw new Error(error.message);

  let nextSeq = 1;
  const last = data?.[0]?.invoice_no;
  if (last?.startsWith(prefix)) {
    const n = parseInt(last.slice(prefix.length), 10);
    if (!Number.isNaN(n)) nextSeq = n + 1;
  }

  return `${prefix}${pad4(nextSeq)}`;
}

function buildSiteAddress(site: any): string | null {
  // company_sites에 address(text)도 있고 address1/2, city...도 있으니 가능한 걸로 조립
  const direct = site?.address ? String(site.address).trim() : "";
  if (direct) return direct;

  const parts = [
    site?.address1,
    site?.address2,
    site?.city,
    site?.state,
    site?.zip,
    site?.country,
  ]
    .map((x: any) => (x == null ? "" : String(x).trim()))
    .filter((x: string) => x);

  return parts.length ? parts.join(", ") : null;
}

/**
 * shipment.shipping_origin_code 기준으로 shipper site 선택:
 *  1) company_sites.origin_code == shipping_origin_code 우선
 *  2) 없으면 is_default == true fallback
 */
async function getShipperSiteByOrigin(shippingOriginCode: string | null) {
  // 1) origin_code 매칭 우선
  if (shippingOriginCode) {
    const { data, error } = await supabaseAdmin
      .from("company_sites")
      .select("*")
      .eq("origin_code", shippingOriginCode)
      .limit(1);

    if (error) throw new Error(error.message);
    if (data?.[0]) return data[0];
  }

  // 2) default site fallback
  {
    const { data, error } = await supabaseAdmin
      .from("company_sites")
      .select("*")
      .eq("is_default", true)
      .limit(1);

    if (error) throw new Error(error.message);
    if (data?.[0]) return data[0];
  }

  return null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const shipmentId = body?.shipmentId;
    if (!shipmentId || !isUuid(shipmentId)) {
      return bad("Valid shipmentId is required.", 400);
    }

    // 1) shipment
    const { data: shipment, error: shErr } = await supabaseAdmin
      .from("shipments")
      .select("*")
      .eq("id", shipmentId)
      .maybeSingle();

    if (shErr) throw new Error(shErr.message);
    if (!shipment) return bad("Shipment not found.", 404);
    if (!shipment.buyer_id) return bad("buyer_id is required in Shipment.", 400);

    const buyerId = shipment.buyer_id;

    // 2) buyer defaults + invoice no
    const buyerDefaults = await getBuyerDefaults(buyerId);
    const buyerCode = await getBuyerCode(buyerId);
    const invoiceNo = await generateInvoiceNo(buyerCode);

    // 3) ship_mode (shipment에는 없으니 po_headers에서 가져오고, 없으면 SEA)
    let shipMode: "AIR" | "SEA" = "SEA";
    if (shipment.po_header_id) {
      const { data: po, error: poErr } = await supabaseAdmin
        .from("po_headers")
        .select("ship_mode")
        .eq("id", shipment.po_header_id)
        .maybeSingle();

      if (!poErr && po) shipMode = normalizeShipMode((po as any).ship_mode);
    }

    // 4) shipper site (origin_code 매칭)
    const shippingOriginCode = shipment.shipping_origin_code ?? null;
    const shipperSite = await getShipperSiteByOrigin(shippingOriginCode);

    const shipper_company_id = shipperSite?.company_id ?? null;
    const shipper_name =
      (shipperSite?.name ? String(shipperSite.name).trim() : "") ||
      (shipperSite?.site_name ? String(shipperSite.site_name).trim() : "") ||
      "JM International Co.,Ltd";

    const shipper_address = buildSiteAddress(shipperSite);

    // Port of Loading: AIR면 air_port_loading, 아니면 sea_port_loading
    const port_of_loading =
      shipMode === "AIR"
        ? (shipperSite?.air_port_loading ?? null)
        : (shipperSite?.sea_port_loading ?? null);

    // 5) shipment lines
    const { data: shipLines, error: slErr } = await supabaseAdmin
      .from("shipment_lines")
      .select(`
        *,
        po_lines:po_lines (
          buyer_style_no,
          buyer_style_code,
          jm_style_no,
          jm_style_code,
          plating_color,
          color,
          size,
          description
        )
      `)
      .eq("shipment_id", shipmentId)
      .or("is_deleted.is.null,is_deleted.eq.false")
      .order("line_no", { ascending: true });

    if (slErr) throw new Error(slErr.message);

    const totalAmount = (shipLines ?? []).reduce((s, l) => s + safeNumber((l as any).amount), 0);

    // shipment header totals (이미 shipment에 total_* 들어있음)
    const total_cartons = safeNumber(shipment.total_cartons, 0);
    const total_gw = safeNumber(shipment.total_gw, 0);
    const total_nw = safeNumber(shipment.total_nw, 0);

    // 6) invoice header insert (스키마에 있는 컬럼 최대한 채움)
    const invoiceDate = toDate10(body?.invoice_date) ?? toDate10(new Date().toISOString());

    const { data: header, error: ihErr } = await supabaseAdmin
      .from("invoice_headers")
      .insert({
        invoice_no: invoiceNo,
        invoice_date: invoiceDate,
        status: "DRAFT",

        buyer_id: buyerId,
        buyer_name: shipment.buyer_name ?? null,
        buyer_code: buyerCode,

        shipment_id: shipmentId,

        currency: shipment.currency ?? null,
        shipping_origin_code: shippingOriginCode,
        incoterm: buyerDefaults.buyer_default_incoterm ?? shipment.incoterm ?? null,
        payment_term: buyerDefaults.buyer_payment_term ?? shipment.payment_term ?? null,

        destination: buyerDefaults.buyer_final_destination ?? shipment.destination ?? null,
        final_destination: buyerDefaults.buyer_final_destination ?? shipment.destination ?? null,

        etd: shipment.etd ?? null,
        eta: shipment.eta ?? null,

        total_amount: totalAmount,
        total_cartons,
        total_gw,
        total_nw,

        // Buyer text blocks
        consignee_text: buyerDefaults.buyer_consignee ?? null,
        notify_party_text: buyerDefaults.buyer_notify_party ?? null,

        // Shipper / exporter (사이트별 자동)
        shipper_company_id,
        shipper_name,
        shipper_address,

        // AIR/SEA 자동
        port_of_loading,

        // COO
        coo_text: `COO: ${cooTextFromOrigin(shippingOriginCode)}\nWE CERTIFY THERE IS NO WOOD PACKING MATERIAL USED IN THIS SHIPMENT.`,

        remarks: null,
      })
      .select()
      .single();

    if (ihErr) {
      return bad("Failed to create invoice header", 500, { detail: ihErr.message });
    }
    if (!header?.id) return bad("Failed to create invoice header", 500);

    const invoiceId = header.id;

    // 7) link invoice_shipments
    const { error: linkErr } = await supabaseAdmin.from("invoice_shipments").insert({
      shipment_id: shipmentId,
      invoice_id: invoiceId,
    });
    if (linkErr) {
      return bad("Failed to link invoice_shipments", 500, { detail: linkErr.message });
    }

    // 8) invoice lines insert (스키마에 맞게 최대한 채움)
    const lineRows = (shipLines ?? []).map((l: any) => ({
      invoice_id: invoiceId,
      invoice_header_id: invoiceId,

      shipment_id: shipmentId,
      shipment_line_id: l.id ?? null,

      po_header_id: l.po_header_id ?? null,
      po_line_id: l.po_line_id ?? null,
      po_no: l.po_no ?? null,

      line_no: l.line_no ?? null,
      style_no: pickStyleNo(l),
      description: (l.description ?? l.po_lines?.description ?? null),
      color: (l.color ?? l.po_lines?.plating_color ?? l.po_lines?.color ?? null),
      size: (l.size ?? l.po_lines?.size ?? null),

      qty: safeNumber(l.shipped_qty),
      unit_price: safeNumber(l.unit_price),
      amount: safeNumber(l.amount),

      cartons: l.cartons ?? null,
      gw: l.gw ?? null,
      nw: l.nw ?? null,

      material_content: null,
      hs_code: null,

      is_deleted: false,
    }));

    if (lineRows.length) {
      const { error: ilErr } = await supabaseAdmin.from("invoice_lines").insert(lineRows);
      if (ilErr) {
        return bad("Failed to create invoice lines", 500, {
          detail: ilErr.message,
          sample_row: lineRows?.[0] ?? null,
        });
      }
    }

    return ok({ invoice_id: invoiceId, invoice_no: invoiceNo });
  } catch (e: any) {
    console.error("create-from-shipment error:", e);
    return bad(e.message ?? "Internal Server Error", 500);
  }
}
