// src/app/api/proforma/list/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// 공통 응답 헬퍼
function errorResponse(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function okResponse(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}

// 숫자 변환 유틸
function toNumber(v: any, fallback = 0): number {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isNaN(n) ? fallback : n;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    // 프론트에서 q 또는 keyword 둘 중 무엇을 쓰더라도 대응
    const q =
      searchParams.get("keyword")?.trim() ||
      searchParams.get("q")?.trim() ||
      "";

    const page = Number(searchParams.get("page") ?? 1) || 1;
    const pageSize = Number(searchParams.get("pageSize") ?? 20) || 20;

    // ------------------------------------------------
    // 1) Proforma Header 리스트 조회
    // ------------------------------------------------
    let headerQuery = supabaseAdmin
      .from("proforma_headers")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false });

    if (q) {
      headerQuery = headerQuery.or(
        `invoice_no.ilike.%${q}%,po_no.ilike.%${q}%,buyer_name.ilike.%${q}%`
      );
    }

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const {
      data: headers,
      error: headerErr,
      count,
    } = await headerQuery.range(from, to);

    if (headerErr) {
      console.error("GET /proforma/list(headers) error:", headerErr);
      return errorResponse(
        headerErr.message ?? "Failed to load proforma header list."
      );
    }

    const headerList = headers ?? [];
    const headerIds = headerList.map((h: any) => h.id as string);

    // ------------------------------------------------
    // 2) 해당 헤더들의 라인들을 한 번에 가져와서
    //    header_id 별 Subtotal 합계 계산
    // ------------------------------------------------
    let subtotalByHeaderId: Record<string, number> = {};

    if (headerIds.length > 0) {
      const { data: lineRows, error: lineErr } = await supabaseAdmin
        .from("proforma_lines")
        .select("proforma_header_id, qty, unit_price, amount")
        .in("proforma_header_id", headerIds);

      if (lineErr) {
        console.error("GET /proforma/list(lines) error:", lineErr);
        return errorResponse(
          lineErr.message ?? "Failed to load proforma lines."
        );
      }

      for (const ln of lineRows ?? []) {
        const hid = ln.proforma_header_id as string;
        if (!subtotalByHeaderId[hid]) subtotalByHeaderId[hid] = 0;

        const qty = toNumber((ln as any).qty, 0);
        const price = toNumber((ln as any).unit_price, 0);

        const rawAmount =
          (ln as any).amount !== null && (ln as any).amount !== undefined
            ? toNumber((ln as any).amount, 0)
            : qty * price;

        subtotalByHeaderId[hid] += rawAmount;
      }
    }

    // ------------------------------------------------
    // 3) 프론트에 내려줄 리스트 형태로 매핑
    //    (Subtotal은 우리가 방금 계산한 값 사용)
    // ------------------------------------------------
    const items = headerList.map((h: any) => {
      const subtotal = subtotalByHeaderId[h.id] || 0;
      const subtotalFixed = Number(subtotal.toFixed(2));

      return {
        id: h.id,
        invoiceNo: h.invoice_no,
        poNo: h.po_no,
        buyerName: h.buyer_name,
        currency: h.currency,
        createdAt: h.created_at,
        subtotal: subtotalFixed,
      };
    });

    return okResponse({
      items,
      total: count ?? items.length,
      page,
      pageSize,
    });
  } catch (err: any) {
    console.error("GET /proforma/list(unexpected) error:", err);
    return errorResponse(
      err?.message ?? "Unexpected error in proforma list API."
    );
  }
}
