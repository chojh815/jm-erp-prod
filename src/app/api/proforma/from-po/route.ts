// src/app/api/proforma/from-po/route.ts
import { NextRequest, NextResponse } from "next/server";
import { renderToStream } from "@react-pdf/renderer";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import ProformaInvoicePDF, {
  ProformaHeader,
  ProformaLine,
} from "@/pdf/ProformaInvoicePDF";

// =======================
// 유틸
// =======================

function buildInvoiceNo(poNo: string): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  const yyyy = now.getFullYear().toString();
  const mm = pad(now.getMonth() + 1);
  const dd = pad(now.getDate());
  const hh = pad(now.getHours());
  const mi = pad(now.getMinutes());
  const ss = pad(now.getSeconds());
  return `PI-${poNo}-${yyyy}${mm}${dd}${hh}${mi}${ss}`;
}

function safeNumber(v: any, fallback = 0): number {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  if (Number.isNaN(n)) return fallback;
  return n;
}

// company_sites 또는 header 텍스트를 합쳐서 주소 문자열 만드는 함수
function buildAddressString(options: {
  site?: any | null;
  nameFallbacks?: (string | null | undefined)[];
  addr1Candidates?: (string | null | undefined)[];
  addr2Candidates?: (string | null | undefined)[];
  cityCandidates?: (string | null | undefined)[];
  stateCandidates?: (string | null | undefined)[];
  postalCandidates?: (string | null | undefined)[];
  countryCandidates?: (string | null | undefined)[];
}): string {
  const {
    site,
    nameFallbacks = [],
    addr1Candidates = [],
    addr2Candidates = [],
    cityCandidates = [],
    stateCandidates = [],
    postalCandidates = [],
    countryCandidates = [],
  } = options;

  const lines: string[] = [];

  // 1) site 에서 먼저 name + address
  if (site) {
    const siteName =
      site.company_name ??
      site.site_name ??
      site.english_name ??
      site.name ??
      null;

    if (siteName && String(siteName).trim().length > 0) {
      lines.push(String(siteName).trim());
    }

    const addr1 =
      site.address_line1 ?? site.address1 ?? site.addr1 ?? site.address ?? null;
    const addr2 =
      site.address_line2 ?? site.address2 ?? site.addr2 ?? null;
    const city = site.city ?? null;
    const state = site.state ?? site.province ?? null;
    const postal = site.postal_code ?? site.zip ?? null;
    const country =
      site.country_name ?? site.country_code ?? site.country ?? null;

    const addrLine = [addr1, addr2]
      .filter((v) => v && String(v).trim().length > 0)
      .join(" ");
    if (addrLine) lines.push(addrLine);

    const cityLine = [city, state, postal]
      .filter((v) => v && String(v).trim().length > 0)
      .join(" ");
    if (cityLine) lines.push(cityLine);

    if (country && String(country).trim().length > 0) {
      lines.push(String(country).trim());
    }
  }

  // 2) header / buyer 텍스트 기반 보완
  if (lines.length === 0) {
    const primaryName = nameFallbacks.find(
      (v) => v && String(v).trim().length > 0
    );
    if (primaryName) {
      lines.push(String(primaryName).trim());
    }
  }

  const addr1 =
    addr1Candidates.find((v) => v && String(v).trim().length > 0) ?? null;
  const addr2 =
    addr2Candidates.find((v) => v && String(v).trim().length > 0) ?? null;
  const city =
    cityCandidates.find((v) => v && String(v).trim().length > 0) ?? null;
  const state =
    stateCandidates.find((v) => v && String(v).trim().length > 0) ?? null;
  const postal =
    postalCandidates.find((v) => v && String(v).trim().length > 0) ?? null;
  const country =
    countryCandidates.find((v) => v && String(v).trim().length > 0) ?? null;

  const addrLine = [addr1, addr2].filter(Boolean).join(" ");
  if (addrLine) lines.push(addrLine);

  const cityLine = [city, state, postal].filter(Boolean).join(" ");
  if (cityLine) lines.push(cityLine);

  if (country) lines.push(country);

  return lines.join("\n");
}

// header 에서 shipper site id 뽑기
function getSiteIdFromHeader(header: any): number | null {
  const keys = ["shipper_site_id", "shipper_company_site_id"];
  for (const key of keys) {
    const v = header?.[key];
    if (typeof v === "number") return v;
  }
  return null;
}

// =======================
// POST
// =======================

export async function POST(req: NextRequest) {
  try {
    const supabase = createSupabaseAdminClient();

    // poNo 받기
    const url = new URL(req.url);
    const poNoFromQuery = url.searchParams.get("poNo");
    let poNo = poNoFromQuery;
    if (!poNo) {
      try {
        const body = await req.json();
        poNo = body?.poNo ?? null;
      } catch {
        // body 없을 수 있음
      }
    }

    if (!poNo) {
      return NextResponse.json(
        { error: "poNo is required." },
        { status: 400 }
      );
    }

    // 1) HEADER & LINES
    const { data: header, error: headerErr } = await supabase
      .from("po_headers")
      .select("*")
      .eq("po_no", poNo)
      .maybeSingle();

    if (headerErr) {
      console.error("PI from PO - header error", headerErr);
      return NextResponse.json(
        { error: headerErr.message ?? "Failed to load PO header." },
        { status: 500 }
      );
    }
    if (!header) {
      return NextResponse.json(
        { error: `PO not found for poNo = ${poNo}` },
        { status: 404 }
      );
    }

    const { data: lines, error: linesErr } = await supabase
      .from("po_lines")
      .select("*")
      .eq("po_header_id", header.id)
      .order("line_no", { ascending: true });

    if (linesErr) {
      console.error("PI from PO - lines error", linesErr);
      return NextResponse.json(
        { error: linesErr.message ?? "Failed to load PO lines." },
        { status: 500 }
      );
    }

    // 2) shipper site
    const shipperSiteId = getSiteIdFromHeader(header);
    let shipperSite: any = null;

    if (shipperSiteId) {
      const { data: s, error: sErr } = await supabase
        .from("company_sites")
        .select("*")
        .eq("id", shipperSiteId)
        .maybeSingle();
      if (sErr) {
        console.error("PI from PO - shipper site error", sErr);
      } else {
        shipperSite = s;
      }
    }

    // 3) ★ 핵심: buyer_code 로 companies 찾기
    let buyerCompany: any = null;

    if (header.buyer_code) {
      const { data: comp, error: compErr } = await supabase
        .from("companies")
        .select("*")
        .eq("code", header.buyer_code)
        .maybeSingle();

      if (compErr) {
        console.error("PI from PO - companies by code error", compErr);
      } else {
        buyerCompany = comp;
      }
    }

    // (보조) buyer_company_id 같은게 있으면 한 번 더 시도
    if (!buyerCompany) {
      const candidateKeys = ["buyer_company_id", "buyer_companyid"];
      for (const key of candidateKeys) {
        const idVal = header[key];
        if (idVal) {
          const { data: comp2, error: compErr2 } = await supabase
            .from("companies")
            .select("*")
            .eq("id", idVal)
            .maybeSingle();
          if (!compErr2 && comp2) {
            buyerCompany = comp2;
            break;
          }
        }
      }
    }

    // 4) 주소들 만들기

    const shipperAddress = buildAddressString({
      site: shipperSite,
      nameFallbacks: [
        header.shipper_name,
        header.shipper_display_name,
        header.our_company_name,
      ],
      addr1Candidates: [
        header.shipper_address_line1,
        header.shipper_addr1,
        header.shipper_address1,
      ],
      addr2Candidates: [
        header.shipper_address_line2,
        header.shipper_addr2,
        header.shipper_address2,
      ],
      cityCandidates: [header.shipper_city],
      stateCandidates: [header.shipper_state],
      postalCandidates: [header.shipper_postal_code, header.shipper_zip],
      countryCandidates: [header.shipper_country],
    });

    const consigneeAddress =
      (buyerCompany?.buyer_consignee &&
        String(buyerCompany.buyer_consignee).trim()) ||
      buildAddressString({
        site: null,
        nameFallbacks: [
          header.consignee_name,
          buyerCompany?.company_name,
          header.buyer_name,
          header.buyer_display_name,
        ],
        addr1Candidates: [
          header.consignee_address_line1,
          header.consignee_addr1,
        ],
        addr2Candidates: [
          header.consignee_address_line2,
          header.consignee_addr2,
        ],
        cityCandidates: [header.consignee_city],
        stateCandidates: [header.consignee_state],
        postalCandidates: [
          header.consignee_postal_code,
          header.consignee_zip,
        ],
        countryCandidates: [header.consignee_country],
      });

    const notifyAddressRaw =
      (buyerCompany?.buyer_notify_party &&
        String(buyerCompany.buyer_notify_party).trim()) ||
      buildAddressString({
        site: null,
        nameFallbacks: [
          header.notify_party_name,
          header.notify_name,
          header.notify_party_display_name,
        ],
        addr1Candidates: [
          header.notify_party_address_line1,
          header.notify_addr1,
          header.notify_address1,
        ],
        addr2Candidates: [
          header.notify_party_address_line2,
          header.notify_addr2,
          header.notify_address2,
        ],
        cityCandidates: [header.notify_party_city, header.notify_city],
        stateCandidates: [header.notify_party_state, header.notify_state],
        postalCandidates: [
          header.notify_party_postal_code,
          header.notify_zip,
        ],
        countryCandidates: [header.notify_party_country, header.notify_country],
      });

    const notifyAddress =
      notifyAddressRaw && notifyAddressRaw.trim().length > 0
        ? notifyAddressRaw
        : "-";

    const finalDestinationText =
      (buyerCompany?.buyer_final_destination &&
        String(buyerCompany.buyer_final_destination).trim()) ||
      header.final_destination ||
      header.final_destination_text ||
      "";

    // 5) ProformaHeader / Line 구성
    const today = new Date();
    const invoiceDate = today.toISOString().slice(0, 10); // YYYY-MM-DD

    const proformaHeader: ProformaHeader & {
      finalDestination?: string;
    } = {
      invoiceNo: buildInvoiceNo(poNo),
      invoiceDate,
      poNo,
      buyerName:
        buyerCompany?.company_name ??
        header.buyer_name ??
        header.buyer_display_name ??
        "",
      buyerCode: header.buyer_code ?? buyerCompany?.code ?? "",
      shipperAddress,
      consigneeAddress,
      notifyAddress,
      paymentTerm:
        header.payment_term_name ??
        header.payment_term_text ??
        "-",
      incoterm: header.incoterm ?? header.incoterm_text ?? "-",
      origin:
        header.shipping_origin_text ??
        header.shipping_origin_code ??
        header.origin ??
        "",
      destination:
        header.destination_port_name ??
        header.destination_port ??
        header.ship_to_port ??
        "",
      currency: header.currency_code ?? header.currency ?? "USD",
      remarks: header.pi_remarks ?? header.remarks ?? "",
      finalDestination: finalDestinationText,
    };

    const proformaLines: ProformaLine[] =
      (lines ?? []).map((row: any, idx: number) => {
        const qty = safeNumber(row.order_qty ?? row.qty ?? row.quantity, 0);
        const unitPrice = safeNumber(row.unit_price ?? row.price, 0);
        const amount =
          safeNumber(row.amount, 0) || Number((qty * unitPrice).toFixed(4));

        return {
          lineNo: row.line_no ?? idx + 1,
          jmStyleNo: row.jm_style_no ?? row.style_no ?? "",
          buyerStyleNo: row.buyer_style_no ?? "",
          description: row.description ?? row.item_description ?? "",
          hsCode: row.hs_code ?? "",
          origin: row.origin ?? proformaHeader.origin ?? "",
          qty,
          unitPrice,
          amount,
          uom: row.uom ?? row.unit ?? "PCS",
          color: row.color ?? row.colour ?? "",
          size: row.size ?? "",
          upc: row.upc ?? "",
        } as ProformaLine;
      }) ?? [];

    // 6) PDF 생성
    const pdfStream = await renderToStream(
      <ProformaInvoicePDF header={proformaHeader} lines={proformaLines} />
    );

    return new NextResponse(pdfStream as any, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="PI-${poNo}.pdf"`,
      },
    });
  } catch (err: any) {
    console.error("PI from PO - unexpected error", err);
    return NextResponse.json(
      {
        error:
          err?.message ??
          "Unexpected error occurred while generating Proforma Invoice.",
      },
      { status: 500 }
    );
  }
}
