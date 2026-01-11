// src/app/api/orders/[id]/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assertApiPermission } from "@/lib/api-guard";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(v: any) {
  return typeof v === "string" && UUID_RE.test(v);
}
function safeTrim(v: any) {
  return (v ?? "").toString().trim();
}
function isEmpty(v: any) {
  return safeTrim(v) === "";
}

async function loadBuyerDefaults(buyerId: string) {
  if (!buyerId || !isUuid(buyerId)) return null;

  const { data, error } = await supabaseAdmin
    .from("companies")
    .select("buyer_default_incoterm, buyer_consignee, buyer_notify_party")
    .eq("id", buyerId)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

async function resolveBrandName(brandId: string) {
  if (!brandId || !isUuid(brandId)) return "";

  // buyer_brands 테이블명은 프로젝트에 따라 다를 수 있음
  // (buyer_brands / brands / company_brands 등)
  // 현재 스키마 기준: buyer_brands 가정
  const { data, error } = await supabaseAdmin
    .from("buyer_brands")
    .select("id, brand_name, name")
    .eq("id", brandId)
    .maybeSingle();

  if (error) {
    // brand 테이블명이 다르거나 컬럼이 다를 수 있으니,
    // brand_name/name 둘 다 시도했는데도 실패하면 조용히 빈값 반환 (저장 자체는 진행)
    console.warn("resolveBrandName error:", error?.message);
    return "";
  }

  const name = safeTrim((data as any)?.brand_name ?? (data as any)?.name);
  return name;
}

/**
 * GET /api/orders/[id]
 * - PO 헤더/라인 조회 (소프트삭제 제외)
 */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    // (권한키는 프로젝트마다 다를 수 있어 최소한으로 적용)
    // 필요없으면 아래 2줄 주석 처리 가능
    const guard = await assertApiPermission("po.view");
    if (guard) return guard;

    const poHeaderId = params?.id;

    if (!poHeaderId || !isUuid(poHeaderId)) {
      return NextResponse.json(
        { success: false, error: "Valid PO Header ID (uuid) is required" },
        { status: 400 }
      );
    }

    const { data: header, error: headerErr } = await supabaseAdmin
      .from("po_headers")
      .select("*")
      .eq("id", poHeaderId)
      .eq("is_deleted", false)
      .maybeSingle();

    if (headerErr) {
      console.error("Read PO Header Error:", headerErr);
      return NextResponse.json(
        { success: false, error: headerErr.message },
        { status: 500 }
      );
    }

    if (!header?.id) {
      return NextResponse.json(
        { success: false, error: "PO Header not found" },
        { status: 404 }
      );
    }

    const { data: lines, error: linesErr } = await supabaseAdmin
      .from("po_lines")
      .select("*")
      .eq("po_header_id", poHeaderId)
      .eq("is_deleted", false)
      .order("line_no", { ascending: true });

    if (linesErr) {
      console.error("Read PO Lines Error:", linesErr);
      return NextResponse.json(
        { success: false, error: linesErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, header, lines: lines ?? [] });
  } catch (err: any) {
    console.error("Get PO Fatal:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/orders/[id]
 * - PO 저장(헤더 중심)
 * - 핵심: buyer_brand_id/name 저장 + incoterm 자동 주입(companies.buyer_default_incoterm)
 *
 * 기대 Body(유연 처리):
 *  A) { header: {...}, lines?: [...] }
 *  B) { ...headerFields, lines?: [...] }
 */
export async function PUT(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const guard = await assertApiPermission("po.edit");
    if (guard) return guard;

    const poHeaderId = params?.id;

    if (!poHeaderId || !isUuid(poHeaderId)) {
      return NextResponse.json(
        { success: false, error: "Valid PO Header ID (uuid) is required" },
        { status: 400 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const headerIn = (body?.header ?? body ?? {}) as any;
    const linesIn = (body?.lines ?? []) as any[];

    // 0) 기존 헤더 로드
    const { data: existing, error: existErr } = await supabaseAdmin
      .from("po_headers")
      .select("*")
      .eq("id", poHeaderId)
      .maybeSingle();

    if (existErr) {
      console.error("Read PO Header Error:", existErr);
      return NextResponse.json(
        { success: false, error: existErr.message },
        { status: 500 }
      );
    }

    if (!existing?.id) {
      return NextResponse.json(
        { success: false, error: "PO Header not found" },
        { status: 404 }
      );
    }

    if (existing.is_deleted === true) {
      return NextResponse.json(
        { success: false, error: "This PO is deleted." },
        { status: 409 }
      );
    }

    // ✅ 안전장치: 기존 PO의 po_no는 일반 저장(수정)에서 절대 변경하지 않는다.
    // (예: 4400003848 → 4400003848S 로 바뀌는 사고 방지)
    // PO 번호 변경이 필요하면 "Copy as New PO"(duplicate) 기능으로 새 PO를 만들도록 한다.
    const existingPoNo = safeTrim(existing?.po_no);
    const incomingPoNo = headerIn?.po_no !== undefined ? safeTrim(headerIn?.po_no) : "";
    if (!isEmpty(incomingPoNo) && !isEmpty(existingPoNo) && incomingPoNo !== existingPoNo) {
      return NextResponse.json(
        {
          success: false,
          error:
            `PO No cannot be changed (existing: ${existingPoNo}, incoming: ${incomingPoNo}). ` +
            `Use "Copy as New PO" to create a new PO instead.`,
        },
        { status: 409 }
      );
    }

    const now = new Date().toISOString();

    // 1) buyer_id 확정 (payload 우선, 없으면 기존값)
    const buyer_id = safeTrim(headerIn?.buyer_id) || safeTrim(existing?.buyer_id);

    // 2) 회사 기본값 로드 (incoterm/consignee/notify)
    const buyerDefaults = await loadBuyerDefaults(buyer_id).catch((e) => {
      console.error("loadBuyerDefaults error:", e);
      return null;
    });

    // 3) Brand 처리
    // - payload로 buyer_brand_id가 오면 그걸 우선 저장
    // - buyer_brand_name은 서버가 buyer_brands에서 찾아서 확정 저장(가능하면)
    const incomingBrandId = safeTrim(headerIn?.buyer_brand_id);
    const existingBrandId = safeTrim(existing?.buyer_brand_id);
    const brandIdToSave = incomingBrandId || existingBrandId || null;

    let brandNameToSave = safeTrim(headerIn?.buyer_brand_name);
    if (brandIdToSave) {
      const resolved = await resolveBrandName(brandIdToSave);
      if (!isEmpty(resolved)) brandNameToSave = resolved;
    }

    // 4) Incoterm 처리
    // - 화면 입력칸 없으니, payload가 비어있으면 companies 기본값을 주입
    // - 단, 이미 existing에 값이 있으면 덮어쓰지 않음(데이터 보호)
    const incomingIncoterm = safeTrim(headerIn?.incoterm);
    const existingIncoterm = safeTrim(existing?.incoterm);
    const companyDefaultIncoterm = safeTrim(buyerDefaults?.buyer_default_incoterm);

    const incotermToSave =
      !isEmpty(incomingIncoterm)
        ? incomingIncoterm
        : !isEmpty(existingIncoterm)
        ? existingIncoterm
        : companyDefaultIncoterm;

    // 5) 헤더 업데이트 payload 구성
    // - headerIn의 값들을 최대한 반영하되, 민감한 키는 우리가 확정/보정
    // - undefined는 업데이트에 넣지 않기 위해 수동으로 구성
    const patch: Record<string, any> = {
      updated_at: now,
    };

    // (a) 일반 필드 반영: 필요 필드만 선별적으로 반영 (너무 공격적으로 전체 spread 안 함)
    // - 여기서 프로젝트에 있는 컬럼들만 넣어주세요.
    // - 아래는 “대표적인 PO 헤더 필드”들만 안전하게 처리
    const allow = [
      "buyer_id",
      "buyer_name",
      "buyer_code",
      "order_date",
      "requested_ship_date",
      "origin_code",
      "payment_term_id",
      "currency",
      "final_destination",
      "port_of_loading",
      "ship_mode",
      "carrier",
      "remarks",
      "status",
    ];

    for (const k of allow) {
      if (headerIn?.[k] !== undefined) patch[k] = headerIn[k];
    }

    // (b) 보정 필드 강제 반영
    if (buyer_id) patch.buyer_id = buyer_id;

    // brand
    patch.buyer_brand_id = brandIdToSave;
    patch.buyer_brand_name = brandNameToSave;

    // incoterm
    patch.incoterm = incotermToSave;

    // 6) 헤더 업데이트
    const { data: updatedHeader, error: upErr } = await supabaseAdmin
      .from("po_headers")
      .update(patch)
      .eq("id", poHeaderId)
      .select("*")
      .maybeSingle();

    if (upErr) {
      console.error("Update PO Header Error:", upErr);
      return NextResponse.json(
        { success: false, error: upErr.message },
        { status: 500 }
      );
    }

    // 7) (옵션) 라인 업데이트는 여기서 과감히 건드리지 않음
    //    기존 프로젝트는 라인 저장 로직이 별도일 가능성이 높고,
    //    지금 이슈의 핵심은 "헤더 brand/incoterm 저장"이므로 안정성을 위해 생략.
    //    필요하면 너가 쓰는 기존 라인 저장 API로 유지하는 게 안전.

    return NextResponse.json({
      success: true,
      header: updatedHeader,
      linesReceived: Array.isArray(linesIn) ? linesIn.length : 0,
    });
  } catch (err: any) {
    console.error("Update PO Fatal:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    // ✅ A안(정석): PO 삭제 권한 체크
    const guard = await assertApiPermission("po.delete");
    if (guard) return guard;

    const poHeaderId = params?.id;

    if (!poHeaderId || !isUuid(poHeaderId)) {
      return NextResponse.json(
        { success: false, error: "Valid PO Header ID (uuid) is required" },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    // 0) 이미 삭제된 헤더인지 확인(멱등 처리)
    const { data: headerRow, error: headerGetErr } = await supabaseAdmin
      .from("po_headers")
      .select("id, is_deleted")
      .eq("id", poHeaderId)
      .maybeSingle();

    if (headerGetErr) {
      console.error("Read PO Header Error:", headerGetErr);
      return NextResponse.json(
        { success: false, error: headerGetErr.message },
        { status: 500 }
      );
    }

    if (!headerRow?.id) {
      return NextResponse.json(
        { success: false, error: "PO Header not found" },
        { status: 404 }
      );
    }

    // 이미 삭제되어 있으면 성공으로 처리(멱등)
    if (headerRow.is_deleted === true) {
      return NextResponse.json({ success: true, alreadyDeleted: true });
    }

    // 1) 라인도 소프트 삭제
    const { error: lineErr } = await supabaseAdmin
      .from("po_lines")
      .update({
        is_deleted: true,
        updated_at: now,
      })
      .eq("po_header_id", poHeaderId);

    if (lineErr) {
      console.error("Soft Delete PO Lines Error:", lineErr);
      return NextResponse.json(
        { success: false, error: lineErr.message },
        { status: 500 }
      );
    }

    // 2) 헤더 소프트 삭제 + 상태 DELETED
    const { error: headerErr } = await supabaseAdmin
      .from("po_headers")
      .update({
        is_deleted: true,
        status: "DELETED",
        updated_at: now,
      })
      .eq("id", poHeaderId);

    if (headerErr) {
      console.error("Soft Delete PO Header Error:", headerErr);
      return NextResponse.json(
        { success: false, error: headerErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("Delete PO Fatal:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
