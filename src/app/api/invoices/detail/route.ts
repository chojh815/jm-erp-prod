// src/app/api/invoices/detail/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}
function bad(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function safeTrim(v: any) {
  return (v ?? "").toString().trim();
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isUuid(v: string) {
  return UUID_RE.test(v);
}

export async function GET(req: NextRequest) {
  try {
    // ✅ request.url 사용 금지 -> req.nextUrl 사용
    const sp = req.nextUrl.searchParams;

    const id = safeTrim(sp.get("id"));
    const invoiceNo = safeTrim(sp.get("invoice_no"));
    const shipmentId = safeTrim(sp.get("shipment_id"));

    if (!id && !invoiceNo && !shipmentId) {
      return bad("Missing query. Provide one of: id | invoice_no | shipment_id", 400);
    }

    // 1) invoice header 찾기
    let header: any = null;

    // (A) id가 있으면 우선 id로
    if (id) {
      const { data, error } = await supabaseAdmin
        .from("invoice_headers")
        .select("*")
        .eq("id", id)
        .limit(1)
        .maybeSingle();

      if (error) {
        // fallback로 계속 진행
      } else if (data) {
        header = data;
      }
    }

    // (B) invoice_no로
    if (!header && invoiceNo) {
      const { data, error } = await supabaseAdmin
        .from("invoice_headers")
        .select("*")
        .eq("invoice_no", invoiceNo)
        .limit(1)
        .maybeSingle();

      if (error) {
        // fallback
      } else if (data) {
        header = data;
      }
    }

    // (C) shipment_id로
    if (!header && shipmentId) {
      const { data, error } = await supabaseAdmin
        .from("invoice_headers")
        .select("*")
        .eq("shipment_id", shipmentId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        // fallback
      } else if (data) {
        header = data;
      }
    }

    if (!header) {
      return bad("Invoice not found.", 404);
    }

    // 2) lines 가져오기
    // line 테이블명이 invoice_lines 가 맞다는 전제 (JM ERP 기존 흐름)
    // 만약 환경에 따라 다를 수 있으니, 실패 시 빈 배열로라도 반환
    let lines: any[] = [];
    try {
      // ✅ 1) invoice_id로 조회
      {
        const { data, error } = await supabaseAdmin
          .from("invoice_lines")
          .select("*")
          .eq("invoice_id", header.id)
          .order("line_no", { ascending: true });

        if (!error && Array.isArray(data) && data.length) {
          lines = data;
        }
      }

      // ✅ 2) (fallback) invoice_header_id로 조회 (구버전/저장 꼬임 대비)
      if (!lines.length) {
        const { data, error } = await supabaseAdmin
          .from("invoice_lines")
          .select("*")
          .eq("invoice_header_id", header.id)
          .order("line_no", { ascending: true });

        if (!error && Array.isArray(data) && data.length) {
          lines = data;
        }
      }

      // ✅ 3) (fallback) invoice_no로 조회 (아주 구버전/백필용)
      // invoice_lines에 invoice_no 컬럼이 없으면 이 단계는 자연스럽게 실패하고 무시됨
      if (!lines.length && header.invoice_no) {
        const { data, error } = await supabaseAdmin
          .from("invoice_lines")
          .select("*")
          .eq("invoice_no", header.invoice_no)
          .order("line_no", { ascending: true });

        if (!error && Array.isArray(data) && data.length) {
          lines = data;
        }
      }
    } catch {
      // ignore
    }

// 3) (선택) buyer/company 정보 같이 붙이기 - 있으면 좋고 없어도 OK
    let buyer: any = null;
    try {
      const buyerId = header.buyer_id;
      if (buyerId && isUuid(String(buyerId))) {
        const { data } = await supabaseAdmin
          .from("companies")
          .select("*")
          .eq("id", buyerId)
          .limit(1)
          .maybeSingle();
        if (data) buyer = data;
      }
    } catch {
      // ignore
    }

    return ok({
      header,
      lines,
      buyer,
    });
  } catch (e: any) {
    return bad(e?.message || "Failed to load invoice detail", 500);
  }
}
