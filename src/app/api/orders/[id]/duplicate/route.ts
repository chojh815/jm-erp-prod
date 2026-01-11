// src/app/api/orders/[id]/duplicate/route.ts
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

function bad(message: string, status = 400, extra?: any) {
  return NextResponse.json({ success: false, error: message, ...(extra ?? {}) }, { status });
}
function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}

/**
 * POST /api/orders/[id]/duplicate
 * - 기존 PO(헤더 + 라인)를 "새 PO"로 복사 생성
 * - 포인트: 기존 PO는 절대 UPDATE 하지 않고, 무조건 INSERT 한다.
 *
 * Body:
 * {
 *   new_po_no: string (required),
 *   override?: {
 *     order_date?: string,
 *     requested_ship_date?: string,
 *     ship_mode?: string,
 *     final_destination?: string,
 *     port_of_loading?: string,
 *     carrier?: string,
 *     remarks?: string,
 *     status?: string
 *   },
 *   apply_delivery_to_lines?: boolean, // requested_ship_date를 po_lines.delivery_date에 덮어쓸지
 *   apply_shipmode_to_lines?: boolean  // ship_mode를 po_lines.ship_mode에 덮어쓸지
 * }
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    // 복사는 "새 PO 생성" 성격이므로 create 권한이 이상적.
    // 프로젝트에 따라 create 권한이 없을 수 있어 edit 권한으로도 허용.
    const guardCreate = await assertApiPermission("po.create");
    if (guardCreate) {
      const guardEdit = await assertApiPermission("po.edit");
      if (guardEdit) return guardCreate; // create도 edit도 없으면 차단
    }

    const srcId = params?.id;
    if (!srcId || !isUuid(srcId)) {
      return bad("Valid source PO Header ID (uuid) is required", 400);
    }

    const body = await req.json().catch(() => ({}));
    const newPoNo = safeTrim(body?.new_po_no);
    const override = (body?.override ?? {}) as Record<string, any>;
    const applyDeliveryToLines = body?.apply_delivery_to_lines !== false; // default true
    const applyShipmodeToLines = body?.apply_shipmode_to_lines === true; // default false

    if (isEmpty(newPoNo)) {
      return bad("new_po_no is required", 400);
    }

    // 1) 원본 헤더 로드
    const { data: srcHeader, error: srcErr } = await supabaseAdmin
      .from("po_headers")
      .select("*")
      .eq("id", srcId)
      .eq("is_deleted", false)
      .maybeSingle();

    if (srcErr) return bad(srcErr.message, 500);
    if (!srcHeader?.id) return bad("Source PO not found", 404);

    // 2) 새 po_no 중복 체크(완전 일치)
    const { data: dupRow, error: dupErr } = await supabaseAdmin
      .from("po_headers")
      .select("id")
      .eq("po_no", newPoNo)
      .eq("is_deleted", false)
      .maybeSingle();

    if (dupErr) return bad(dupErr.message, 500);
    if (dupRow?.id) {
      return bad(`PO No already exists: ${newPoNo}`, 409, { po_no: newPoNo });
    }

    const now = new Date().toISOString();

    // 3) 새 헤더 INSERT (절대 UPDATE 금지)
    const headerToInsert: Record<string, any> = { ...srcHeader };
    delete headerToInsert.id;
    delete headerToInsert.created_at;
    delete headerToInsert.updated_at;

    headerToInsert.po_no = newPoNo;
    headerToInsert.is_deleted = false;
    headerToInsert.updated_at = now;

    // status 기본값: DRAFT (원본이 CONFIRMED여도 새 복사본은 draft로)
    headerToInsert.status = safeTrim(override?.status) || "DRAFT";

    // override 반영(존재하는 컬럼만)
    const headerOverrideKeys = [
      "order_date",
      "requested_ship_date",
      "ship_mode",
      "final_destination",
      "port_of_loading",
      "carrier",
      "remarks",
      "currency",
      "incoterm",
    ];
    for (const k of headerOverrideKeys) {
      if (override?.[k] !== undefined) headerToInsert[k] = override[k];
    }

    const { data: newHeader, error: insHErr } = await supabaseAdmin
      .from("po_headers")
      .insert(headerToInsert)
      .select("*")
      .maybeSingle();

    if (insHErr) return bad(insHErr.message, 500);
    if (!newHeader?.id) return bad("Failed to create new PO header", 500);

    // 4) 라인 로드 후 새 라인 INSERT
    const { data: srcLines, error: srcLinesErr } = await supabaseAdmin
      .from("po_lines")
      .select("*")
      .eq("po_header_id", srcId)
      .eq("is_deleted", false)
      .order("line_no", { ascending: true });

    if (srcLinesErr) return bad(srcLinesErr.message, 500);

    const newLines = (srcLines ?? []).map((ln: any, idx: number) => {
      const row: Record<string, any> = { ...ln };
      delete row.id;
      delete row.created_at;
      delete row.updated_at;

      row.po_header_id = newHeader.id;
      row.is_deleted = false;
      row.line_no = idx + 1;
      row.updated_at = now;

      // 요청 시: 헤더 requested_ship_date를 라인 delivery_date에 반영
      const newReqShipDate = safeTrim(override?.requested_ship_date);
      if (applyDeliveryToLines && !isEmpty(newReqShipDate)) {
        // po_lines에 delivery_date 컬럼이 존재함(스크린샷 기준)
        row.delivery_date = override.requested_ship_date;
      }

      // 요청 시: 헤더 ship_mode를 라인 ship_mode에 반영
      const newShipMode = safeTrim(override?.ship_mode);
      if (applyShipmodeToLines && !isEmpty(newShipMode)) {
        row.ship_mode = override.ship_mode;
      }

      return row;
    });

    if (newLines.length > 0) {
      const { error: insLErr } = await supabaseAdmin.from("po_lines").insert(newLines);
      if (insLErr) {
        // 헤더는 이미 생성됐으니, 라인 삽입 실패를 명확히 보여줌
        return bad(insLErr.message, 500, { new_po_header_id: newHeader.id });
      }
    }

    return ok({ header: newHeader, lines_copied: newLines.length });
  } catch (e: any) {
    console.error("Duplicate PO Fatal:", e);
    return bad(e?.message || "Unknown error", 500);
  }
}
