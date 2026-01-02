// /src/app/api/companies/route.ts
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

/** 현재 스키마에 맞춘 최소 SELECT */
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("companies")
    .select("id, company_name, code, company_type, is_active, created_at, updated_at")
    .order("created_at", { ascending: false });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** 현재 테이블 컬럼에 100% 맞춘 최소 INSERT/UPDATE */
export async function POST(req: Request) {
  try {
    const payload: any = await req.json();

    // 현재 스키마에 존재하는 컬럼만 사용
    const unifiedName =
      payload.companyName || payload.company_name || payload.name || "(no name)";

    const companyInput: any = {
      company_name: unifiedName,                  // NOT NULL 필드 필수 채움
      code: payload.code ?? null,                 // nullable
      company_type: payload.companyType ?? null,  // nullable
      is_active: payload.isActive ?? true,        // NOT NULL
    };

    let companyId: string | null = payload.id ?? null;

    if (companyId) {
      const { error } = await supabaseAdmin
        .from("companies")
        .update(companyInput)
        .eq("id", companyId);
      if (error) throw error;
    } else {
      const { data, error } = await supabaseAdmin
        .from("companies")
        .insert(companyInput)
        .select("id")
        .single();
      if (error) throw error;
      companyId = data!.id;
    }

    // 최신 데이터 반환
    const { data: result, error: fetchErr } = await supabaseAdmin
      .from("companies")
      .select("id, company_name, code, company_type, is_active, created_at, updated_at")
      .eq("id", companyId)
      .single();
    if (fetchErr) throw fetchErr;

    return new Response(JSON.stringify({ success: true, data: result }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, message: err?.message || "Unknown error" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
}
