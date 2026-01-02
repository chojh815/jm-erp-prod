// src/app/api/buyer-brands/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// GET /api/buyer-brands?companyId=...   → 회사 ID(uuid)로 브랜드 목록
// GET /api/buyer-brands?buyerCode=RED   → companies.code로 회사 찾고, 그 회사 브랜드 목록
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const companyId = searchParams.get("companyId");
    const buyerCode = searchParams.get("buyerCode");

    let resolvedCompanyId: string | null = null;

    if (companyId) {
      resolvedCompanyId = companyId;
    } else if (buyerCode) {
      const { data: company, error: companyErr } = await supabaseAdmin
        .from("companies")
        .select("id")
        .eq("code", buyerCode)
        .maybeSingle();

      if (companyErr) {
        console.error("GET /buyer-brands company error", companyErr);
        return NextResponse.json(
          {
            error:
              companyErr.message ??
              "Failed to load company for buyerCode.",
          },
          { status: 500 }
        );
      }

      if (!company) {
        return NextResponse.json({ data: [] });
      }

      resolvedCompanyId = company.id as string;
    } else {
      return NextResponse.json(
        { error: "companyId or buyerCode is required." },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("buyer_brands")
      .select("id, brand_name, dept_name, is_active, sort_order")
      .eq("company_id", resolvedCompanyId)
      .eq("is_active", true) // Soft Delete: 활성 브랜드만
      .order("sort_order", { ascending: true });

    if (error) {
      console.error("GET /buyer-brands error", error);
      return NextResponse.json(
        { error: error.message ?? "Failed to load buyer brands." },
        { status: 500 }
      );
    }

    return NextResponse.json({ data: data ?? [] });
  } catch (err: any) {
    console.error("GET /buyer-brands unexpected error", err);
    return NextResponse.json(
      {
        error:
          err?.message ??
          "Unexpected error occurred while loading buyer brands.",
      },
      { status: 500 }
    );
  }
}
