// src/app/api/admin/users/permissions/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function ok(data: any = {}) {
  return NextResponse.json({ ok: true, ...data });
}
function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function safeTrim(v: any) {
  return (v ?? "").toString().trim();
}
function toBool(v: any): boolean | null {
  if (v === true || v === false) return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return null;
}

/**
 * GET /api/admin/users/permissions?user_id=UUID
 * -> returns user_permission_overrides rows
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const user_id = safeTrim(url.searchParams.get("user_id"));
    if (!user_id) return bad("user_id is required", 400);

    const { data, error } = await supabaseAdmin
      .from("user_permission_overrides")
      .select("perm_key, allowed, updated_at")
      .eq("user_id", user_id)
      .order("perm_key", { ascending: true });

    if (error) {
      const msg = (error.message || "").toLowerCase();
      // 테이블이 아직 없다면 빈 배열로 처리
      if (msg.includes("does not exist") || msg.includes("relation")) {
        return ok({ user_id, overrides: [] });
      }
      return bad(error.message, 500);
    }

    return ok({ user_id, overrides: data ?? [] });
  } catch (e: any) {
    return bad(e?.message ?? "Server error", 500);
  }
}

/**
 * POST /api/admin/users/permissions
 * body:
 * {
 *   user_id: "UUID",
 *   overrides: [
 *     { perm_key: "po.create", allowed: true },
 *     { perm_key: "roles.manage", allowed: false }
 *   ]
 * }
 *
 * 정책: user_id 기준 덮어쓰기(삭제 후 재삽입)
 * - UI 저장을 단순하게 유지
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const user_id = safeTrim(body?.user_id);
    const overrides = Array.isArray(body?.overrides) ? body.overrides : [];

    if (!user_id) return bad("user_id is required", 400);

    // 정규화
    const rows: Array<{ user_id: string; perm_key: string; allowed: boolean }> =
      [];

    for (const o of overrides) {
      const perm_key = safeTrim(o?.perm_key);
      const allowed = toBool(o?.allowed);
      if (!perm_key || allowed === null) continue;
      rows.push({ user_id, perm_key, allowed });
    }

    // 기존 삭제
    const del = await supabaseAdmin
      .from("user_permission_overrides")
      .delete()
      .eq("user_id", user_id);

    // 테이블 없으면 명확히 에러
    if (del.error) return bad(del.error.message, 500);

    // 삽입
    if (rows.length > 0) {
      const ins = await supabaseAdmin.from("user_permission_overrides").insert(rows);
      if (ins.error) return bad(ins.error.message, 500);
    }

    return ok({ user_id, saved: rows.length });
  } catch (e: any) {
    return bad(e?.message ?? "Server error", 500);
  }
}
