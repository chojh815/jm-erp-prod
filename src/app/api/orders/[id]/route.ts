// src/app/api/orders/[id]/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(v: any) {
  return typeof v === "string" && UUID_RE.test(v);
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
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

    // 1) 라인도 소프트 삭제
    // - po_lines에 is_deleted 컬럼이 존재한다는 전제(너 정책상 이미 사용중)
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
