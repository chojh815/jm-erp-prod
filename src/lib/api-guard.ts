// src/lib/api-guard.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { ROLE_DEFAULT_PERMISSIONS } from "@/config/permissions";

function bad(message: string, status = 403) {
  return NextResponse.json({ ok: false, error: message }, { status });
}
function uniq(arr: string[]) {
  return Array.from(new Set(arr));
}

/** ✅ Route Handler / Server Action 용 SSR client */
function createSupabaseRouteClient() {
  const cookieStore = cookies();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieStore.set(name, value, options);
        });
      },
    },
  });
}

async function getSessionUser() {
  const supabase = createSupabaseRouteClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) return { user: null, error: error.message };
  return { user: data.user || null, error: null };
}

async function getProfile(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_profiles")
    .select("user_id,email,name,role,is_active")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

/** row에서 permission key를 다양한 후보 컬럼명으로 추출 */
function pickPermKey(row: any): string | null {
  const candidates = [
    "perm_key",
    "permission_key",
    "permission",
    "perm",
    "key",
    "permKey",
    "permissionKey",
  ];
  for (const k of candidates) {
    const v = row?.[k];
    if (v !== null && v !== undefined && String(v).trim() !== "") return String(v);
  }
  return null;
}

async function loadPermRows(
  table: "user_permission_grants" | "user_permission_revokes",
  userId: string
) {
  // 1) perm_key로 시도
  const first = await supabaseAdmin.from(table).select("perm_key").eq("user_id", userId);
  if (!first.error) {
    return (first.data || [])
      .map((r: any) => r?.perm_key)
      .filter((v: any) => v !== null && v !== undefined && String(v).trim() !== "")
      .map((v: any) => String(v));
  }

  // 2) 컬럼명이 다르면 select("*") 후 후보키에서 추출
  const second = await supabaseAdmin.from(table).select("*").eq("user_id", userId);
  if (second.error) {
    const msg = (second.error.message || "").toLowerCase();
    // 테이블이 아직 없으면(초기 단계) 빈 배열로 처리
    if (msg.includes("does not exist") || msg.includes("relation")) return [];
    throw new Error(second.error.message);
  }

  return (second.data || [])
    .map((r: any) => pickPermKey(r))
    .filter(Boolean) as string[];
}

async function getEffectivePermissions(userId: string, role: string) {
  const base = (ROLE_DEFAULT_PERMISSIONS[role] ||
    ROLE_DEFAULT_PERMISSIONS["viewer"] ||
    []) as string[];

  const [grants, revokes] = await Promise.all([
    loadPermRows("user_permission_grants", userId),
    loadPermRows("user_permission_revokes", userId),
  ]);

  const revokeSet = new Set(revokes);
  const merged = uniq([...base, ...grants]).filter((k) => !revokeSet.has(k));
  return merged;
}

/**
 * ✅ 기존 방식 유지: role 기반 접근 제어
 * 사용 예: const guard = await assertApiRole(["admin"]); if (guard) return guard;
 */
export async function assertApiRole(allowedRoles: string[]) {
  const { user, error } = await getSessionUser();
  if (error) return bad(error, 401);
  if (!user) return bad("Not authenticated", 401);

  const prof = await getProfile(user.id);
  if (!prof?.user_id) return bad("Profile not found", 404);
  if (prof.is_active === false) return bad("Inactive user", 403);

  const role = (prof.role || "viewer").toString();
  if (!allowedRoles.includes(role)) return bad("Forbidden", 403);

  return null;
}

/**
 * ✅ 권한 기반 접근 제어 (정석 A안)
 * 사용 예:
 *   const guard = await assertApiPermission(["po.delete"]);
 *   if (guard) return guard;
 */
export async function assertApiPermission(required: string[] | string) {
  const reqList = Array.isArray(required) ? required : [required];

  const { user, error } = await getSessionUser();
  if (error) return bad(error, 401);
  if (!user) return bad("Not authenticated", 401);

  const prof = await getProfile(user.id);
  if (!prof?.user_id) return bad("Profile not found", 404);
  if (prof.is_active === false) return bad("Inactive user", 403);

  const role = (prof.role || "viewer").toString();
  const perms = await getEffectivePermissions(user.id, role);

  const missing = reqList.filter((p) => !perms.includes(p));
  if (missing.length) return bad(`Missing permission: ${missing.join(", ")}`, 403);

  return null;
}
