import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * GET  /api/admin/roles/permissions?role=admin
 * POST /api/admin/roles/permissions
 */

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}

function bad(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

/**
 * GET: role의 allowed permission 목록 반환
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const role = searchParams.get("role");

  if (!role) {
    return bad("role is required");
  }

  const { data, error } = await supabaseAdmin
    .from("role_permission_defaults")
    .select("perm_key, allowed")
    .eq("role", role)
    .eq("allowed", true)
    .order("perm_key");

  if (error) {
    return bad(error.message, 500);
  }

  return ok({
    role,
    permissions: (data ?? []).map((r) => r.perm_key),
  });
}

/**
 * POST: role 권한 저장
 * body: { role: string, permissions: string[] }
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const role: string | undefined = body?.role;
  const permissions: string[] = Array.isArray(body?.permissions)
    ? body.permissions
    : [];

  if (!role) {
    return bad("role is required");
  }

  // 1) 기존 role rows 전체 삭제
  const { error: delErr } = await supabaseAdmin
    .from("role_permission_defaults")
    .delete()
    .eq("role", role);

  if (delErr) {
    return bad(delErr.message, 500);
  }

  // 2) 다시 insert (allowed=true)
  if (permissions.length > 0) {
    const rows = permissions.map((perm) => ({
      role,
      perm_key: perm,
      allowed: true,
    }));

    const { error: insErr } = await supabaseAdmin
      .from("role_permission_defaults")
      .insert(rows);

    if (insErr) {
      return bad(insErr.message, 500);
    }
  }

  return ok({ role, permissions });
}
