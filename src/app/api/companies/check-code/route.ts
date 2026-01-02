// /src/app/api/companies/check-code/route.ts
import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: NextRequest) {
  try {
    const code = req.nextUrl.searchParams.get("code")?.trim() || "";
    if (!code) {
      return Response.json(
        { ok: false, message: "code is required" },
        { status: 400 }
      );
    }

    const { data: existing, error } = await supabaseAdmin
      .from("companies")
      .select("id, company_name, code")
      .eq("code", code)
      .maybeSingle();

    if (error) {
      throw error;
    }

    // available: 사용 가능 여부 (없으면 true)
    return Response.json({
      ok: true,
      available: !existing,
      existing: existing || null,
      code,
    });
  } catch (err: any) {
    return Response.json(
      { ok: false, message: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
