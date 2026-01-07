// src/app/api/proforma/detail/route.ts

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function safeStr(v: any) {
  return (v ?? "").toString().trim();
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const invoiceNo = searchParams.get("invoiceNo");

    if (!invoiceNo) {
      return errorResponse("invoiceNo is required.", 400);
    }

    // =======================================================
    // 1) Proforma Header + Buyer 정보 JOIN
    // =======================================================
    const { data: headerRow, error: headerErr } = await supabaseAdmin
      .from("proforma_headers")
      .select(
        `
        id,
        invoice_no,
        po_no,
        buyer_id,
        buyer_name,
        currency,
        payment_term,
        ship_mode,
        destination,
        incoterm,
        created_at,
        buyers:buyer_id (
          name,
          buyer_consignee,
          buyer_notify_party,
          buyer_final_destination,
          buyer_brand,
          buyer_dept,
          buyer_payment_term,
          buyer_default_incoterm,
          buyer_default_ship_mode
        )
      `
      )
      .eq("invoice_no", invoiceNo)
      .maybeSingle();

    if (headerErr) {
      console.error("Failed to load proforma header:", headerErr);
      return errorResponse("Failed to load proforma header.", 500);
    }
    if (!headerRow) {
      return errorResponse("Proforma header not found.", 404);
    }

    // ✅ 핵심: buyers 조인 결과가 배열로 잡히는 TS 추론을 막기 위해 단일 객체로 정규화
    const buyerRows: unknown = (headerRow as any).buyers ?? null;
    const buyer: any = Array.isArray(buyerRows)
      ? (buyerRows[0] ?? null)
      : (buyerRows ?? null);

    // =======================================================
    // 2) Proforma Lines 조회
    // =======================================================
    const { data: lineRows, error: lineErr } = await supabaseAdmin
      .from("proforma_lines")
      .select(
        `
        id,
        proforma_header_id,
        line_no,
        buyer_style_no,
        jm_style_no,
        description,
        color,
        size,
        hs_code,
        qty,
        uom,
        unit_price,
        currency,
        amount,
        upc_code
      `
      )
      .eq("proforma_header_id", (headerRow as any).id)
      .order("line_no", { ascending: true });

    if (lineErr) {
      console.error("Failed to load proforma lines:", lineErr);
      return errorResponse("Failed to load proforma lines.", 500);
    }

    // =======================================================
    // 3) PO 헤더 + PO 라인 조회 (Brand / Dept 포함)
    // =======================================================
    let poLineRows: any[] | null = null;
    let poHeaderRow: any | null = null;

    const poNo = (headerRow as any).po_no ?? null;

    if (poNo) {
      const { data: poHeader, error: poHeaderErr } = await supabaseAdmin
        .from("po_headers")
        .select(
          `
          id,
          po_no,
          buyer_id,
          brand_name,
          dept_name
        `
        )
        .eq("po_no", poNo)
        .maybeSingle();

      if (!poHeaderErr && poHeader) {
        poHeaderRow = poHeader;

        const { data: poLines, error: poErr } = await supabaseAdmin
          .from("po_lines")
          .select(
            `
            po_header_id,
            line_no,
            buyer_style_no,
            jm_style_no,
            description,
            color,
            size,
            hs_code,
            qty,
            unit_price,
            amount
          `
          )
          .eq("po_header_id", poHeader.id);

        if (!poErr) {
          poLineRows = poLines || [];
        }
      }
    }

    // line_no, buyer_style_no 기반 매칭 Map 준비
    const poByLineNo = new Map<number, any>();
    const poByBuyerStyle = new Map<string, any>();

    if (poLineRows) {
      for (const pl of poLineRows) {
        if (pl.line_no != null) poByLineNo.set(pl.line_no, pl);
        if (pl.buyer_style_no) poByBuyerStyle.set(String(pl.buyer_style_no), pl);
      }
    }

    // =======================================================
    // 헬퍼: PI 값 → PO 값 fallback
    // =======================================================
    const prefer = <T,>(
      primary: T | null | undefined,
      fallback: T | null | undefined
    ): T | null => {
      if (primary === null || primary === undefined) return fallback ?? null;
      if (typeof primary === "string" && safeStr(primary) === "")
        return fallback ?? null;
      return primary;
    };

    // =======================================================
    // 4) Header 변환 + Consignee / Notify / Final Dest + Brand/Dept
    // =======================================================
    const poBrandName: string | null = (poHeaderRow as any)?.brand_name ?? null;
    const poDeptName: string | null = (poHeaderRow as any)?.dept_name ?? null;

    const header = {
      id: (headerRow as any).id,
      invoiceNo: (headerRow as any).invoice_no,
      poNo: (headerRow as any).po_no,
      buyerId: (headerRow as any).buyer_id,
      buyerName: (headerRow as any).buyer_name,

      currency: (headerRow as any).currency,

      paymentTerm: (headerRow as any).payment_term || buyer?.buyer_payment_term || null,
      shipMode: (headerRow as any).ship_mode || buyer?.buyer_default_ship_mode || null,
      destination: (headerRow as any).destination || buyer?.buyer_final_destination || null,
      incoterm: (headerRow as any).incoterm || buyer?.buyer_default_incoterm || null,

      createdAt: (headerRow as any).created_at,

      // ★ Consignee / Notify Party / Final Destination
      consigneeText: buyer?.buyer_consignee || null,
      notifyPartyText: buyer?.buyer_notify_party || null,
      finalDestinationText: buyer?.buyer_final_destination || null,

      // ★ Brand / Dept : PO 값 우선, 없으면 Buyer 기본값
      buyerBrand: poBrandName || buyer?.buyer_brand || null,
      buyerDept: poDeptName || buyer?.buyer_dept || null,
    };

    // =======================================================
    // 5) 라인 아이템 매핑 (PO → PI 합성)
    // =======================================================
    const lines =
      (lineRows || []).map((l: any) => {
        const poLine =
          (l.line_no != null && poByLineNo.get(l.line_no)) ||
          (l.buyer_style_no && poByBuyerStyle.get(String(l.buyer_style_no))) ||
          null;

        const description = prefer(l.description, poLine?.description);
        const color = prefer(l.color, poLine?.color);
        const size = prefer(l.size, poLine?.size);
        const hs_code = prefer(l.hs_code, poLine?.hs_code);

        const qty = Number(l.qty ?? poLine?.qty ?? 0);

        const amount = Number(
          l.amount ??
            (poLine?.amount && !isNaN(Number(poLine.amount)) ? poLine.amount : 0)
        );

        let unit_price = Number(
          l.unit_price ??
            (poLine?.unit_price && !isNaN(Number(poLine.unit_price))
              ? poLine.unit_price
              : 0)
        );

        if ((!unit_price || isNaN(unit_price)) && qty) {
          unit_price = amount / qty;
        }

        return {
          line_no: l.line_no,
          buyer_style_no: l.buyer_style_no,
          jm_style_no: l.jm_style_no,
          description,
          color,
          size,
          hs_code,
          qty,
          uom: l.uom,
          unit_price,
          amount,
          upc_code: l.upc_code,
        };
      }) ?? [];

    return NextResponse.json({ header, lines });
  } catch (err) {
    console.error("Unexpected error in /api/proforma/detail:", err);
    return errorResponse("Unexpected server error.", 500);
  }
}
