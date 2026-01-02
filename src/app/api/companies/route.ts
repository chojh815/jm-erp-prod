// src/app/api/companies/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ success: false, message }, { status });
}

function okResponse(data: any = {}, status = 200) {
  return NextResponse.json({ success: true, ...data }, { status });
}

/**
 * POST /api/companies
 *
 * body: {
 *   companyId?: string;
 *   companyType: string;
 *   companyName: string;
 *   code?: string | null;
 *   country?: string | null;
 *   email?: string | null;
 *   phone?: string | null;
 *   address1?: string | null;
 *   address2?: string | null;
 *   city?: string | null;
 *   state?: string | null;
 *   zip?: string | null;
 *   taxId?: string | null;
 *   bankName?: string | null;
 *   bankAccount?: string | null;
 *   accountHolderName?: string | null;
 *   swift?: string | null;
 *   currency?: string | null;
 *   buyerPaymentTerm?: string | null;
 *   buyerDefaultIncoterm?: string | null;
 *   buyerDefaultShipMode?: string | null;
 *   buyerBrand?: string | null;   // ★ 브랜들 콤마구분
 *   buyerDept?: string | null;    // ★ Dept들 콤마구분
 *   apContactName?: string | null;
 *   apEmail?: string | null;
 *   apPhone?: string | null;
 *   buyerConsignee?: string | null;
 *   buyerNotifyParty?: string | null;
 *   buyerFinalDestination?: string | null;
 *   originMark?: string | null;
 *   factoryAirPort?: string | null;
 *   factorySeaPort?: string | null;
 *   isActive: boolean;
 *   preferredOrigins?: string[];
 *   memo?: string | null;
 *   sites?: Array<{
 *     siteName: string;
 *     originCode: string;
 *     country: string;
 *     city?: string | null;
 *     address1?: string | null;
 *     address2?: string | null;
 *     phone?: string | null;
 *     taxId?: string | null;
 *     bankName?: string | null;
 *     bankAccount?: string | null;
 *     accountHolderName?: string | null;
 *     swift?: string | null;
 *     currency?: string | null;
 *     exporterOfRecord?: boolean;
 *     originCountry?: string | null;
 *     isDefault?: boolean;
 *     airPortLoading?: string | null;
 *     seaPortLoading?: string | null;
 *   }>;
 * }
 */

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const companyId: string | null = body.companyId ?? null;
    const companyType: string = body.companyType;
    const companyName: string = body.companyName;
    const code: string | null = body.code ?? null;

    if (!companyType || !companyName) {
      return errorResponse("companyType, companyName is required.", 400);
    }

    const nowIso = new Date().toISOString();

    // ==============
    // companies upsert
    // ==============
    const companyData: any = {
      company_type: companyType,
      company_name: companyName,
      name: companyName, // 예전 컬럼과 호환용
      code,
      country: body.country ?? null,
      email: body.email ?? null,
      phone: body.phone ?? null,
      address1: body.address1 ?? null,
      address2: body.address2 ?? null,
      city: body.city ?? null,
      state: body.state ?? null,
      zip: body.zip ?? null,
      tax_id: body.taxId ?? null,

      bank_name: body.bankName ?? null,
      bank_account: body.bankAccount ?? null,
      account_holder_name: body.accountHolderName ?? null,
      swift: body.swift ?? null,
      currency: body.currency ?? null,

      // Buyer 관련
      buyer_payment_term: body.buyerPaymentTerm ?? null,
      buyer_default_incoterm: body.buyerDefaultIncoterm ?? null,
      buyer_default_ship_mode: body.buyerDefaultShipMode ?? null,
      buyer_brand: body.buyerBrand ?? null, // ★ 여기서 저장
      buyer_dept: body.buyerDept ?? null,   // ★ 여기서 저장
      ap_contact_name: body.apContactName ?? null,
      ap_email: body.apEmail ?? null,
      ap_phone: body.apPhone ?? null,

      buyer_consignee: body.buyerConsignee ?? null,
      buyer_notify_party: body.buyerNotifyParty ?? null,
      buyer_final_destination: body.buyerFinalDestination ?? null,

      // Factory 관련
      origin_mark: body.originMark ?? null,
      factory_air_port: body.factoryAirPort ?? null,
      factory_sea_port: body.factorySeaPort ?? null,

      is_active: body.isActive ?? true,
      preferred_origins: body.preferredOrigins ?? [],
      memo: body.memo ?? null,

      updated_at: nowIso,
    };

    let savedCompanyId = companyId;

    if (companyId) {
      // update
      const { data, error } = await supabaseAdmin
        .from("companies")
        .update(companyData)
        .eq("id", companyId)
        .select("*")
        .maybeSingle();

      if (error) {
        console.error("UPDATE companies error:", error);
        if (error.code === "23505" && error.message.includes("code")) {
          return NextResponse.json(
            {
              success: false,
              field: "code",
              message: "Duplicate company code.",
            },
            { status: 409 }
          );
        }
        return errorResponse("Failed to update company.", 500);
      }

      if (!data) {
        return errorResponse("Company not found.", 404);
      }

      savedCompanyId = data.id;
    } else {
      // insert
      companyData.created_at = nowIso;

      const { data, error } = await supabaseAdmin
        .from("companies")
        .insert(companyData)
        .select("*")
        .maybeSingle();

      if (error) {
        console.error("INSERT companies error:", error);
        if (error.code === "23505" && error.message.includes("code")) {
          return NextResponse.json(
            {
              success: false,
              field: "code",
              message: "Duplicate company code.",
            },
            { status: 409 }
          );
        }
        return errorResponse("Failed to insert company.", 500);
      }

      savedCompanyId = data?.id;
    }

    if (!savedCompanyId) {
      return errorResponse("Failed to get company id after save.", 500);
    }

    // ==============
    // company_sites 처리 (our_company 인 경우만)
    // ==============
    if (companyType === "our_company") {
      const sites = (body.sites ?? []) as any[];

      // 기존 사이트 삭제
      const { error: delErr } = await supabaseAdmin
        .from("company_sites")
        .delete()
        .eq("company_id", savedCompanyId);

      if (delErr) {
        console.error("DELETE company_sites error:", delErr);
        return errorResponse("Failed to reset company sites.", 500);
      }

      const cleanSites = sites
        .filter((s) => (s.siteName ?? "").trim().length > 0)
        .map((s) => ({
          company_id: savedCompanyId,
          site_name: s.siteName,
          origin_code: s.originCode,
          country: s.country,
          city: s.city ?? null,
          address1: s.address1 ?? null,
          address2: s.address2 ?? null,
          phone: s.phone ?? null,
          tax_id: s.taxId ?? null,
          bank_name: s.bankName ?? null,
          bank_account: s.bankAccount ?? null,
          account_holder_name: s.accountHolderName ?? null,
          swift: s.swift ?? null,
          currency: s.currency ?? null,
          exporter_of_record: !!s.exporterOfRecord,
          origin_country: s.originCountry ?? null,
          is_default: !!s.isDefault,
          air_port_loading: s.airPortLoading ?? null,
          sea_port_loading: s.seaPortLoading ?? null,
          created_at: nowIso,
          updated_at: nowIso,
        }));

      if (cleanSites.length > 0) {
        const { error: insErr } = await supabaseAdmin
          .from("company_sites")
          .insert(cleanSites);

        if (insErr) {
          console.error("INSERT company_sites error:", insErr);
          return errorResponse("Failed to insert company sites.", 500);
        }
      }
    }

    return okResponse({ companyId: savedCompanyId });
  } catch (e: any) {
    console.error("POST /api/companies unexpected error:", e);
    return errorResponse("Unexpected server error.", 500);
  }
}
