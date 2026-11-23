import { NextResponse } from "next/server";
import { ApiIdentityError, getApiIdentity } from "@/lib/apiIdentity";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const actor = await getApiIdentity();
    if (actor.role !== "admin" && !actor.permissions.includes("proforma.delete")) {
      return NextResponse.json({ error: "PI 삭제 권한이 없습니다." }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const action = body?.action;
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    if (action !== "delete" && action !== "void") {
      return NextResponse.json({ error: "발송 여부에 맞는 처리 방법을 선택해 주세요." }, { status: 400 });
    }
    if (action === "void" && (!reason || reason.length > 500)) {
      return NextResponse.json({ error: "폐기 사유를 1~500자로 입력해 주세요." }, { status: 400 });
    }
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(params.id)) {
      return NextResponse.json({ error: "PI를 찾을 수 없습니다." }, { status: 404 });
    }

    const { error } = await supabaseAdmin.rpc("retire_proforma", {
      p_id: params.id,
      p_action: action,
      p_reason: action === "void" ? reason : null,
      p_actor: actor.user.id,
    });

    if (error?.code === "P0002") {
      return NextResponse.json({ error: "PI를 찾을 수 없습니다." }, { status: 404 });
    }
    if (error?.code === "55000") {
      return NextResponse.json({ error: "이미 삭제 또는 폐기된 PI입니다." }, { status: 409 });
    }
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ApiIdentityError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Failed to retire PI", error);
    return NextResponse.json({ error: "PI를 처리하지 못했습니다. 다시 시도해 주세요." }, { status: 500 });
  }
}
