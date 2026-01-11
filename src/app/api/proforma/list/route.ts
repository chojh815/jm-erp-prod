// src/app/api/proforma/list/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}
function okResponse(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}
function toNumber(v: any, fallback = 0): number {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isNaN(n) ? fallback : n;
}
function escapeIlike(v: string) {
  return v.replace(/[%_]/g, (m) => `\\${m}`);
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const qRaw =
      searchParams.get("keyword")?.trim() ||
      searchParams.get("q")?.trim() ||
      "";
    const q = qRaw ? escapeIlike(qRaw) : "";

    const page = Number(searchParams.get("page") ?? 1) || 1;
    const pageSize = Number(searchParams.get("pageSize") ?? 20) || 20;

    // 1) ✅ headers에서 (삭제 제외) 리스트 조회
    let headerQuery = supabaseAdmin
      .from("proforma_headers")
      .select("*", { count: "exact" })
      .eq("is_deleted", false)
      .order("created_at", { ascending: false });

    if (q) {
      headerQuery = headerQuery.or(
        `invoice_no.ilike.%${q}%,po_no.ilike.%${q}%,buyer_name.ilike.%${q}%`
      );
    }

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const { data: headers, error: headerErr, count } = await headerQuery.range(
      from,
      to
    );

    if (headerErr) {
      console.error("GET /proforma/list(headers) error:", headerErr);
      return errorResponse(
        headerErr.message ?? "Failed to load proforma header list."
      );
    }

    const headerList = headers ?? [];
    const headerIds = headerList.map((h: any) => h.id as string);

    // 2) ✅ 라인으로 subtotal 계산 (삭제 제외)
    const subtotalByHeaderId: Record<string, number> = {};

    if (headerIds.length > 0) {
      const { data: lineRows, error: lineErr } = await supabaseAdmin
        .from("proforma_lines")
        .select("proforma_header_id, qty, unit_price, amount, is_deleted")
        .in("proforma_header_id", headerIds)
        .eq("is_deleted", false);

      if (lineErr) {
        console.error("GET /proforma/list(lines) error:", lineErr);
        return errorResponse(lineErr.message ?? "Failed to load proforma lines.");
      }

      for (const ln of lineRows ?? []) {
        const hid = (ln as any).proforma_header_id as string;
        if (!hid) continue;
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

    // 3) 내려줄 items
    const items = headerList.map((h: any) => {
      const subtotal = subtotalByHeaderId[h.id] || 0;
      return {
        id: h.id,
        invoiceNo: h.invoice_no,
        poNo: h.po_no,
        buyerName: h.buyer_name,
        currency: h.currency,
        createdAt: h.created_at,
        subtotal: Number(subtotal.toFixed(2)),
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
    return errorResponse(err?.message ?? "Unexpected error in proforma list API.");
  }
}
