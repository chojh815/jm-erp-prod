import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * GET /api/companies/buyers
 * - companies 테이블에서 company_type='buyer' 목록을 내려줍니다.
 * - buyer_brand(콤마 구분 문자열)도 함께 내려줍니다.
 *
 * ⚠️ 이 라우트는 "서비스 롤 키"가 있으면 RLS를 우회해 확실히 조회합니다.
 *    (SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SERVICE_KEY / SERVICE_ROLE_KEY 중 하나)
 *    키가 없으면 anon 키로 시도합니다. (RLS가 막으면 빈 배열/에러 가능)
 */
export async function GET() {
  try {
    const url =
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_PROJECT_URL;

    const anon =
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_KEY;

    const service =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_KEY ||
      process.env.SERVICE_ROLE_KEY;

    if (!url || !(service || anon)) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Missing Supabase env vars. Need SUPABASE_URL + (SERVICE_ROLE_KEY or ANON_KEY).",
        },
        { status: 500 }
      );
    }

    const supabase = createClient(url, (service || anon) as string, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await supabase
      .from("companies")
      .select("id, company_name, company_type, buyer_brand, buyer_dept, code")
      .eq("company_type", "buyer")
      .order("company_name", { ascending: true });

    if (error) throw error;

    const rows = (data || []).map((r: any) => ({
      id: r.id,
      company_name: r.company_name ?? "",
      code: r.code ?? null,
      buyer_brand: r.buyer_brand ?? null, // 예: "GUESS, AEO, CHICO'S"
      buyer_dept: r.buyer_dept ?? null,
    }));

    return NextResponse.json({ success: true, rows });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
