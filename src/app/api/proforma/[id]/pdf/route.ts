import React from "react";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { renderToStream } from "@react-pdf/renderer";
import ProformaInvoicePDF, {
  ProformaHeaderPDF,
  ProformaLinePDF,
} from "@/pdf/ProformaInvoicePDF";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safe(v: any) {
  return (v ?? "").toString().trim();
}
function pickFirst(obj: any, keys: string[]) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== null && v !== undefined && safe(v) !== "") return v;
  }
  return null;
}
function safeFileName(v: any, fallback = "proforma") {
  const s = safe(v) || fallback;
  return s.replace(/[\\\/:*?"<>|]+/g, "_");
}
function num(v: any, fallback = 0) {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** ✅ 날짜 파서 */
function toISODate(v: any): string | null {
  if (!v) return null;
  const s = safe(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}

/** ✅ 헤더 방어 로드 */
async function loadHeaderAny(idOrNo: string): Promise<any | null> {
  const headerTables = [
    { table: "proforma_invoices", idKey: "id" },
    { table: "proforma_headers", idKey: "id" },
    { table: "proforma_invoice", idKey: "id" },
    { table: "proforma", idKey: "id" },
  ];

  for (const t of headerTables) {
    const { data, error } = await supabaseAdmin
      .from(t.table)
      .select("*")
      .eq(t.idKey, idOrNo)
      .maybeSingle();
    if (!error && data) return data;
  }

  for (const t of headerTables) {
    const { data, error } = await supabaseAdmin
      .from(t.table)
      .select("*")
      .eq("invoice_no", idOrNo)
      .maybeSingle();
    if (!error && data) return data;
  }

  return null;
}

function toPdfLine(r: any): ProformaLinePDF {
  const qty = num(pickFirst(r, ["qty", "quantity", "order_qty", "po_qty", "shipped_qty"]), 0);
  const unitPrice = num(pickFirst(r, ["unit_price", "price", "up", "unitPrice"]), 0);
  const amount =
    num(pickFirst(r, ["amount", "line_amount", "lineAmount"]), 0) || qty * unitPrice;

  return {
    po_no: pickFirst(r, ["po_no", "po", "po_number", "poNo"]) ?? null,
    buyer_style_no:
      pickFirst(r, ["buyer_style_no", "buyer_style", "style_no", "style", "style_no_buyer"]) ??
      pickFirst(r, ["jm_style_no", "jm_style", "jm_style_number", "jm_style_no"]) ??
      null,
    description: pickFirst(r, ["description", "desc", "item_desc", "item_description"]) ?? null,
    hs_code: pickFirst(r, ["hs_code", "hs", "hscode"]) ?? null,
    qty,
    uom: pickFirst(r, ["uom", "unit", "unit_of_measure"]) ?? "PCS",
    unit_price: unitPrice,
    amount,
  };
}

/**
 * ✅ 라인 로드:
 * 1) proforma 라인 테이블들에서 OR 검색
 * 2) 그래도 0이면 PO 라인(po_lines)에서 fallback
 */
async function loadLinesAny(opts: {
  candidateIds: string[];
  invoiceNo?: string | null;
  poNo?: string | null;
  poHeaderId?: string | null;
}): Promise<ProformaLinePDF[]> {
  const { candidateIds, invoiceNo, poNo, poHeaderId } = opts;

  // 1) proforma 쪽 라인 테이블들
  const tables = [
    "proforma_lines",
    "proforma_line_items",
    "proforma_invoice_lines",
    "proforma_invoice_line_items",
    "proforma_items",
  ];

  const fkCols = [
    "proforma_id",
    "invoice_id",
    "header_id",
    "proforma_invoice_id",
    "proforma_header_id",
    "pi_id",
    "proforma_no",
    "invoice_no",
  ];

  const ids = (candidateIds || []).map(safe).filter(Boolean);
  const inv = safe(invoiceNo);

  for (const table of tables) {
    // 후보 id로 OR
    for (const id of ids) {
      const orExpr = fkCols.map((c) => `${c}.eq.${id}`).join(",");

      // 1차: is_deleted/line_no 적용
      const r1 = await supabaseAdmin
        .from(table)
        .select("*")
        .or(orExpr)
        .eq("is_deleted", false)
        .order("line_no", { ascending: true });

      if (!r1.error && Array.isArray(r1.data) && r1.data.length > 0) {
        return r1.data.map(toPdfLine);
      }

      // 2차: 컬럼 없을 수 있으니 plain
      const r2 = await supabaseAdmin.from(table).select("*").or(orExpr);
      if (!r2.error && Array.isArray(r2.data) && r2.data.length > 0) {
        return r2.data.map(toPdfLine);
      }
    }

    // invoice_no/proforma_no로 OR
    if (inv) {
      const orExpr2 = [`invoice_no.eq.${inv}`, `proforma_no.eq.${inv}`].join(",");

      const r3 = await supabaseAdmin
        .from(table)
        .select("*")
        .or(orExpr2)
        .eq("is_deleted", false)
        .order("line_no", { ascending: true });

      if (!r3.error && Array.isArray(r3.data) && r3.data.length > 0) {
        return r3.data.map(toPdfLine);
      }

      const r4 = await supabaseAdmin.from(table).select("*").or(orExpr2);
      if (!r4.error && Array.isArray(r4.data) && r4.data.length > 0) {
        return r4.data.map(toPdfLine);
      }
    }
  }

  // 2) ✅ 최후 fallback: PO 라인에서 가져오기
  // - PI 라인이 저장되는 테이블/키가 헷갈려도 “문서 출력”은 되게 만들기
  if (poHeaderId || poNo) {
    // 우선 po_header_id로
    if (poHeaderId) {
      const r1 = await supabaseAdmin
        .from("po_lines")
        .select("*")
        .eq("po_header_id", poHeaderId)
        .eq("is_deleted", false)
        .order("line_no", { ascending: true });

      if (!r1.error && Array.isArray(r1.data) && r1.data.length > 0) {
        return r1.data.map((r: any) =>
          toPdfLine({
            ...r,
            po_no: r.po_no ?? poNo ?? null,
          })
        );
      }

      // plain fallback
      const r2 = await supabaseAdmin
        .from("po_lines")
        .select("*")
        .eq("po_header_id", poHeaderId)
        .order("line_no", { ascending: true });

      if (!r2.error && Array.isArray(r2.data) && r2.data.length > 0) {
        return r2.data.map((r: any) =>
          toPdfLine({
            ...r,
            po_no: r.po_no ?? poNo ?? null,
          })
        );
      }
    }

    // 그 다음 po_no로 (po_lines에 po_no가 있거나 view인 경우)
    if (poNo) {
      const r3 = await supabaseAdmin
        .from("po_lines")
        .select("*")
        .eq("po_no", poNo)
        .eq("is_deleted", false)
        .order("line_no", { ascending: true });

      if (!r3.error && Array.isArray(r3.data) && r3.data.length > 0) {
        return r3.data.map((r: any) => toPdfLine(r));
      }

      const r4 = await supabaseAdmin
        .from("po_lines")
        .select("*")
        .eq("po_no", poNo)
        .order("line_no", { ascending: true });

      if (!r4.error && Array.isArray(r4.data) && r4.data.length > 0) {
        return r4.data.map((r: any) => toPdfLine(r));
      }
    }
  }

  return [];
}

/** ✅ shipper 주소 조합기 */
function buildShipperAddress(site: any): string | null {
  const line1 =
    pickFirst(site, ["shipper_address", "address", "site_address", "address1", "addr1", "street", "street1"]) ??
    null;
  const line2 =
    pickFirst(site, ["address2", "addr2", "street2", "suite", "unit", "floor"]) ?? null;
  const city = pickFirst(site, ["city", "town"]) ?? null;
  const state = pickFirst(site, ["state", "province", "region"]) ?? null;
  const zip = pickFirst(site, ["zip", "zipcode", "postal_code", "post_code"]) ?? null;
  const country = pickFirst(site, ["country", "origin_country", "country_name"]) ?? null;
  const tel = pickFirst(site, ["tel", "phone", "phone_no", "phone_number"]) ?? null;

  const parts: string[] = [];
  if (line1) parts.push(safe(line1));
  if (line2) parts.push(safe(line2));

  const cityLine = [city, state, zip, country].filter((x) => safe(x)).map(safe).join(" ");
  if (cityLine) parts.push(cityLine);

  if (tel) parts.push(`TEL: ${safe(tel)}`);

  const out = parts.join("\n").trim();
  return out ? out : null;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const urlId = safe(params?.id);
    if (!urlId) {
      return NextResponse.json({ error: "Missing proforma id" }, { status: 400 });
    }

    // 1) 헤더 로드
    const headerRaw = await loadHeaderAny(urlId);
    if (!headerRaw) {
      return NextResponse.json({ error: "Proforma not found" }, { status: 404 });
    }

    const resolvedHeaderId = safe(pickFirst(headerRaw, ["id"])) || urlId;

    // 날짜 후보
    const rawDate =
      pickFirst(headerRaw, [
        "issue_date",
        "issueDate",
        "invoice_date",
        "invoiceDate",
        "date",
        "created_at",
        "createdAt",
        "updated_at",
        "updatedAt",
      ]) ?? null;

    const issueDate = toISODate(rawDate);

    const invoiceNo =
      pickFirst(headerRaw, ["invoice_no", "invoiceNo", "proforma_no", "proformaNo"]) ??
      null;

    // PO 헤더 로드
    const poNo = safe(pickFirst(headerRaw, ["po_no", "po_reference", "poNo"])) || null;

    let poHeader: any = null;
    let poHeaderId: string | null = null;

    if (poNo) {
      const { data: po, error: poErr } = await supabaseAdmin
        .from("po_headers")
        .select("*")
        .eq("po_no", poNo)
        .eq("is_deleted", false)
        .maybeSingle();
      if (!poErr && po) {
        poHeader = po;
        poHeaderId = safe(po.id) || null;
      }
    }

    // origin / site
    const originCode =
      pickFirst(headerRaw, ["origin_code", "shipping_origin_code", "origin"]) ??
      pickFirst(poHeader, ["shipping_origin_code", "origin_code", "origin"]) ??
      null;

    let site: any = null;
    if (originCode) {
      const { data: s1, error: sErr1 } = await supabaseAdmin
        .from("company_sites")
        .select("*")
        .eq("origin_code", originCode)
        .limit(1);
      if (!sErr1 && Array.isArray(s1) && s1.length > 0) site = s1[0];
    }

    const shipMode =
      pickFirst(headerRaw, ["ship_mode", "shipMode"]) ??
      pickFirst(poHeader, ["ship_mode", "shipMode"]) ??
      "SEA";

    const shipModeUpper = safe(shipMode).toUpperCase();

    const portOfLoading =
      pickFirst(headerRaw, ["port_of_loading"]) ??
      (shipModeUpper === "AIR"
        ? pickFirst(site, ["air_port_loading", "factory_air_port"])
        : pickFirst(site, ["sea_port_loading", "factory_sea_port"])) ??
      pickFirst(site, ["sea_port_loading", "air_port_loading", "factory_sea_port", "factory_air_port"]) ??
      null;

    const originCountry =
      pickFirst(site, ["origin_country", "country", "coo_country"]) ?? null;

    const cooText =
      pickFirst(headerRaw, ["coo_text", "cooText"]) ??
      (originCountry ? `MADE IN ${originCountry}` : null);

    // Buyer company
    const buyerCompanyId =
      pickFirst(headerRaw, ["buyer_company_id", "buyer_id"]) ?? null;

    let buyerCompany: any = null;
    if (buyerCompanyId) {
      const { data: b, error: bErr } = await supabaseAdmin
        .from("companies")
        .select("*")
        .eq("id", buyerCompanyId)
        .maybeSingle();
      if (!bErr) buyerCompany = b;
    }

    // ✅ Brand/Dept fallback: header -> PO -> buyer company (defensive for schema drift)
    const buyerBrandName =
      pickFirst(headerRaw, [
        "buyer_brand_name",
        "buyer_brand",
        "buyerBrandName",
        "brand_name",
        "brand",
      ]) ??
      pickFirst(poHeader, [
        "buyer_brand_name",
        "buyer_brand_name_text",
        "buyer_brand",
        "brand_name",
        "brand",
      ]) ??
      pickFirst(buyerCompany, [
        "buyer_brand_name",
        "buyer_brand",
        "default_brand_name",
        "brand_name",
        "brand",
      ]) ??
      null;

    const buyerDeptName =
      pickFirst(headerRaw, [
        "buyer_dept_name",
        "buyer_dept",
        "buyerDeptName",
        "dept_name",
        "dept",
      ]) ??
      pickFirst(poHeader, [
        "buyer_dept_name",
        "buyer_dept_name_text",
        "buyer_dept",
        "dept_name",
        "dept",
      ]) ??
      pickFirst(buyerCompany, [
        "buyer_dept_name",
        "buyer_dept",
        "default_dept_name",
        "dept_name",
        "dept",
      ]) ??
      null;

    const consigneeText =
      pickFirst(headerRaw, ["consignee_text", "consignee"]) ??
      pickFirst(buyerCompany, ["buyer_consignee"]) ??
      null;

    const notifyText =
      pickFirst(headerRaw, ["notify_party_text", "notify_party"]) ??
      pickFirst(buyerCompany, ["buyer_notify_party"]) ??
      null;

    const finalDestination =
      pickFirst(headerRaw, ["final_destination"]) ??
      pickFirst(buyerCompany, ["buyer_final_destination"]) ??
      pickFirst(headerRaw, ["destination"]) ??
      null;

    // shipper
    const shipperName =
      pickFirst(headerRaw, ["shipper_name", "exporter_name"]) ??
      pickFirst(site, ["shipper_name", "site_name", "name", "legal_name"]) ??
      "JM INTERNATIONAL";

    const shipperAddress =
      pickFirst(headerRaw, ["shipper_address", "exporter_address", "shipper_addr"]) ??
      pickFirst(site, ["shipper_address"]) ??
      buildShipperAddress(site) ??
      null;

    const headerPdf: ProformaHeaderPDF = {
      invoice_no: pickFirst(headerRaw, ["invoice_no", "invoiceNo"]) ?? null,
      issue_date: issueDate,
      po_no: poNo ?? null,

      buyer_name: pickFirst(headerRaw, ["buyer_name", "buyerName"]) ?? null,
      buyer_brand_name: buyerBrandName,
      buyer_dept_name: buyerDeptName,

      shipper_name: shipperName,
      shipper_address: shipperAddress,

      payment_term:
        pickFirst(headerRaw, ["payment_term", "buyer_payment_term", "paymentTerm"]) ??
        pickFirst(buyerCompany, ["buyer_payment_term"]) ??
        null,

      remarks: pickFirst(headerRaw, ["remarks", "memo", "note"]) ?? null,

      consignee_text: consigneeText,
      notify_party_text: notifyText,

      port_of_loading: portOfLoading,
      final_destination: finalDestination,

      incoterm:
        pickFirst(headerRaw, ["incoterm"]) ??
        pickFirst(buyerCompany, ["buyer_default_incoterm"]) ??
        null,

      ship_mode: shipMode,
      coo_text: cooText,
    };

    // ✅ 라인 후보키들(헤더 id + url id + 혹시 다른 fk)
    const candidateIds = Array.from(
      new Set(
        [
          urlId,
          resolvedHeaderId,
          safe(pickFirst(headerRaw, ["proforma_id", "header_id", "invoice_id", "proforma_invoice_id"])) || "",
        ].filter(Boolean)
      )
    );

    // ✅ 라인 로드 (proforma 라인 → 없으면 po_lines fallback)
    const lines = await loadLinesAny({
      candidateIds,
      invoiceNo,
      poNo,
      poHeaderId,
    });

    const normalizedLines = lines.map((l) => ({
      ...l,
      po_no: l.po_no ?? headerPdf.po_no ?? null,
    }));

    const element = React.createElement(ProformaInvoicePDF as any, {
      header: headerPdf,
      lines: normalizedLines,
    });

    const stream = await renderToStream(element as any);
    const fileName = safeFileName(headerPdf.invoice_no, "proforma");

    return new NextResponse(stream as any, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${fileName}.pdf"`,
      },
    });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
