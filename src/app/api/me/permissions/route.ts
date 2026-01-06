// src/app/api/me/permissions/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { ROLE_DEFAULT_PERMISSIONS, type PermissionKey } from "@/config/permissions";

export const dynamic = "force-dynamic";

function ok(data: any = {}) {
  // ✅ 구/신 포맷 호환: ok + success 둘다 제공
  return NextResponse.json({ ok: true, success: true, ...data });
}
function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, success: false, error: message }, { status });
}
function uniq(arr: string[]) {
  return Array.from(new Set(arr));
}

/** ✅ Route Handler용 Supabase SSR Client (쿠키 기반 세션) */
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

/** row에서 permission key를 여러 후보 컬럼명으로 추출 */
function pickPermKey(row: any): string | null {
  const candidates = ["perm_key", "permission_key", "permission", "perm", "key", "permKey", "permissionKey"];
  for (const k of candidates) {
    const v = row?.[k];
    if (v !== null && v !== undefined && String(v).trim() !== "") return String(v);
  }
  return null;
}

/** row에서 allowed(또는 grant/revoke) boolean 추출 */
function pickAllowed(row: any): boolean | null {
  const candidates = ["allowed", "is_allowed", "grant", "enabled", "value"];
  for (const k of candidates) {
    const v = row?.[k];
    if (v === true) return true;
    if (v === false) return false;
    if (v === "true") return true;
    if (v === "false") return false;
  }
  return null;
}

/**
 * ✅ (레거시 호환) user_permission_grants / user_permission_revokes 로드
 * - 테이블/컬럼 없으면 빈 배열로 처리
 */
async function loadLegacyPermRows(
  table: "user_permission_grants" | "user_permission_revokes",
  userId: string
) {
  const first = await supabaseAdmin.from(table).select("perm_key").eq("user_id", userId);
  if (!first.error) {
    return (first.data || [])
      .map((r: any) => r?.perm_key)
      .filter((v: any) => v !== null && v !== undefined && String(v).trim() !== "")
      .map((v: any) => String(v));
  }

  const second = await supabaseAdmin.from(table).select("*").eq("user_id", userId);
  if (second.error) {
    const msg = (second.error.message || "").toLowerCase();
    if (msg.includes("does not exist") || msg.includes("relation")) return [];
    return [];
  }

  return (second.data || [])
    .map((r: any) => pickPermKey(r))
    .filter(Boolean) as string[];
}

/**
 * ✅ 역할 권한 로드: role_permission_defaults (role, perm_key, allowed)
 * - 없으면 [] 반환 → fallback으로 ROLE_DEFAULT_PERMISSIONS 사용
 */
async function loadRoleDefaults(role: string) {
  const first = await supabaseAdmin
    .from("role_permission_defaults")
    .select("perm_key, allowed")
    .eq("role", role);

  if (!first.error) {
    return ((first.data || []) as any[])
      .map((r) => ({
        perm_key: r?.perm_key ? String(r.perm_key) : "",
        allowed: Boolean(r?.allowed),
      }))
      .filter((r) => r.perm_key);
  }

  const second = await supabaseAdmin.from("role_permission_defaults").select("*").eq("role", role);
  if (second.error) {
    const msg = (second.error.message || "").toLowerCase();
    if (msg.includes("does not exist") || msg.includes("relation")) return [];
    return [];
  }

  return ((second.data || []) as any[])
    .map((r) => {
      const perm_key = pickPermKey(r);
      const allowed = pickAllowed(r);
      return perm_key && allowed !== null ? { perm_key, allowed } : null;
    })
    .filter(Boolean) as Array<{ perm_key: string; allowed: boolean }>;
}

/**
 * ✅ 개인 권한 override 로드: user_permission_overrides (user_id, perm_key, allowed)
 * - 없으면 [] 반환
 */
async function loadUserOverrides(userId: string) {
  const first = await supabaseAdmin
    .from("user_permission_overrides")
    .select("perm_key, allowed")
    .eq("user_id", userId);

  if (!first.error) {
    return ((first.data || []) as any[])
      .map((r) => ({
        perm_key: r?.perm_key ? String(r.perm_key) : "",
        allowed: Boolean(r?.allowed),
      }))
      .filter((r) => r.perm_key);
  }

  const second = await supabaseAdmin.from("user_permission_overrides").select("*").eq("user_id", userId);
  if (second.error) {
    const msg = (second.error.message || "").toLowerCase();
    if (msg.includes("does not exist") || msg.includes("relation")) return [];
    return [];
  }

  return ((second.data || []) as any[])
    .map((r) => {
      const perm_key = pickPermKey(r);
      const allowed = pickAllowed(r);
      return perm_key && allowed !== null ? { perm_key, allowed } : null;
    })
    .filter(Boolean) as Array<{ perm_key: string; allowed: boolean }>;
}

async function getEffectivePermissions(userId: string, role: string) {
  // A) 역할 기본: role_permission_defaults 우선
  const roleRows = await loadRoleDefaults(role);

  // B) role_permission_defaults가 비어있으면 마지막 fallback: ROLE_DEFAULT_PERMISSIONS
  const baseFromConst = (ROLE_DEFAULT_PERMISSIONS[role] ||
    ROLE_DEFAULT_PERMISSIONS["viewer"] ||
    []) as PermissionKey[];

  const baseSet = new Set<string>();

  if (roleRows.length > 0) {
    for (const r of roleRows) {
      if (r.allowed) baseSet.add(String(r.perm_key));
      else baseSet.delete(String(r.perm_key));
    }
  } else {
    for (const k of baseFromConst as any) baseSet.add(String(k));
  }

  // C) 개인 override: user_permission_overrides (allowed true/false)
  const userOverrides = await loadUserOverrides(userId);
  const userGrantList: string[] = [];
  const userRevokeList: string[] = [];
  for (const o of userOverrides) {
    if (o.allowed) {
      baseSet.add(String(o.perm_key));
      userGrantList.push(String(o.perm_key));
    } else {
      baseSet.delete(String(o.perm_key));
      userRevokeList.push(String(o.perm_key));
    }
  }

  // D) 레거시 호환: grants / revokes (있으면 추가 반영)
  const [legacyGrants, legacyRevokes] = await Promise.all([
    loadLegacyPermRows("user_permission_grants", userId),
    loadLegacyPermRows("user_permission_revokes", userId),
  ]);

  for (const g of legacyGrants) baseSet.add(String(g));
  for (const r of legacyRevokes) baseSet.delete(String(r));

  return {
    permissions: Array.from(baseSet),
    overrides: {
      role_defaults_used: roleRows.length > 0,
      role_defaults: roleRows,
      user_overrides: userOverrides,
      grants: uniq([...userGrantList, ...legacyGrants]),
      revokes: uniq([...userRevokeList, ...legacyRevokes]),
    },
  };
}

export async function GET() {
  try {
    const { user, error: authErr } = await getSessionUser();
    if (authErr) return bad(authErr, 401);
    if (!user) return bad("Not authenticated", 401);

    const { data: prof, error: pErr } = await supabaseAdmin
      .from("user_profiles")
      .select("user_id,email,name,role,is_active")
      .eq("user_id", user.id)
      .maybeSingle();

    if (pErr) return bad(pErr.message, 500);
    if (!prof?.user_id) return bad("Profile not found", 404);
    if (prof.is_active === false) return bad("Inactive user", 403);

    const role = (prof.role || "viewer").toString().trim().toLowerCase() || "viewer";
    const { permissions, overrides } = await getEffectivePermissions(user.id, role);

    // ✅ 구형 클라이언트 호환 필드도 같이 제공: role / permissions 최상단
    return ok({
      role,
      permissions,
      user: {
        id: user.id,
        email: prof.email || user.email || null,
        name: prof.name || null,
        role,
      },
      overrides,
    });
  } catch (e: any) {
    return bad(e?.message || "Server error", 500);
  }
}
