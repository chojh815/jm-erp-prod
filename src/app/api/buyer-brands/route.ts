// src/app/api/buyer-brands/route.ts
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
function safeInt(v: any, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isUuid(v: string) {
  return UUID_RE.test(v);
}

export async function GET(req: NextRequest) {
  try {
    // ✅ request.url 금지 -> req.nextUrl
    const sp = req.nextUrl.searchParams;

    // 지원 파라미터 (있으면 사용, 없어도 동작)
    const buyerId = safeTrim(sp.get("buyer_id") || sp.get("buyerId"));
    const q = safeTrim(sp.get("q"));
    const limit = Math.min(Math.max(safeInt(sp.get("limit"), 500), 1), 2000);

    // 기본 쿼리: buyer_brands 테이블
    // (컬럼이 프로젝트마다 다를 수 있어 select("*")로 안전하게)
    let query = supabaseAdmin.from("buyer_brands").select("*");

    if (buyerId) {
      // buyer_id 컬럼이 uuid가 아닐 수도 있어서 "일단 시도 -> 실패하면 fallback" 패턴
      try {
        query = query.eq("buyer_id", buyerId);
      } catch {
        // ignore
      }
    }

    if (q) {
      // name/code 등 검색: 컬럼이 없을 수도 있으니 실패해도 죽지 않게 try
      const like = `%${q.replace(/[%_]/g, (m: string) => `\\${m}`)}%`;
      try {
        query = query.or(`brand_name.ilike.${like},brand_code.ilike.${like},name.ilike.${like},code.ilike.${like}`);
      } catch {
        // ignore
      }
    }

    // 정렬도 컬럼 없으면 에러 날 수 있으니 try
    try {
      query = query.order("brand_name", { ascending: true });
    } catch {
      // ignore
    }

    const { data, error } = await query.limit(limit);

    if (error) {
      // buyer_brands 테이블/컬럼 차이로 에러가 날 수 있어서 메시지 포함
      return bad(error.message || "Failed to load buyer brands", 500);
    }

    return ok({ items: data ?? [] });
  } catch (e: any) {
    return bad(e?.message || "Unexpected error", 500);
  }
}
