// src/app/api/admin/users/[id]/permissions/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { ROLE_DEFAULT_PERMISSIONS } from "@/config/permissions";

export const dynamic = "force-dynamic";

function ok(data: any = {}) {
  return NextResponse.json({ ok: true, success: true, ...data });
}
function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, success: false, error: message }, { status });
}

function createSupabaseRouteClient() {
  const cookieStore = cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
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

async function requireAdmin() {
  const supabase = createSupabaseRouteClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) return { ok: false as const, status: 401, error: error.message };
  const user = data.user;
  if (!user) return { ok: false as const, status: 401, error: "Not authenticated" };

  const { data: prof, error: pErr } = await supabaseAdmin
    .from("user_profiles")
    .select("user_id, role, is_active")
    .eq("user_id", user.id)
    .maybeSingle();

  if (pErr) return { ok: false as const, status: 500, error: pErr.message };
  if (!prof?.user_id) return { ok: false as const, status: 403, error: "Profile not found" };
  if (prof.is_active === false) return { ok: false as const, status: 403, error: "Inactive user" };

  const role = String(prof.role || "viewer").toLowerCase();
  if (role !== "admin") return { ok: false as const, status: 403, error: "Admin only" };

  return { ok: true as const };
}

function uniq(arr: string[]) {
  return Array.from(new Set(arr));
}

function normalizeRole(r: any) {
  return String(r || "viewer").toLowerCase();
}

async function loadUserProfile(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_profiles")
    .select("user_id,email,name,role,is_active,created_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function loadOverrides(userId: string) {
  // 테이블 스키마가 약간 달라도 대응: select("*") 후 키 추출
  const { data, error } = await supabaseAdmin
    .from("user_permission_overrides")
    .select("*")
    .eq("user_id", userId);
  if (error) {
    const msg = (error.message || "").toLowerCase();
    if (msg.includes("does not exist") || msg.includes("relation")) return [];
    throw new Error(error.message);
  }
  return (data || []).map((r: any) => ({
    user_id: r.user_id,
    perm_key: r.perm_key ?? r.permission_key ?? r.permission ?? r.perm ?? r.key,
    allowed: r.allowed,
    updated_at: r.updated_at ?? null,
    created_at: r.created_at ?? null,
  })).filter((r: any) => !!r.perm_key);
}

function calcEffective(role: string, overrides: Array<{ perm_key: string; allowed: boolean }>) {
  const base = (ROLE_DEFAULT_PERMISSIONS[role] ||
    ROLE_DEFAULT_PERMISSIONS["viewer"] ||
    []) as string[];

  const allow = new Set(overrides.filter(o => o.allowed === true).map(o => String(o.perm_key)));
  const deny = new Set(overrides.filter(o => o.allowed === false).map(o => String(o.perm_key)));

  const merged = uniq([...base, ...Array.from(allow)]).filter(p => !deny.has(p));
  return { base, allow: Array.from(allow), deny: Array.from(deny), effective: merged };
}

export async function GET(_: Request, ctx: { params: { id: string } }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return bad(auth.error, auth.status);

    const userId = ctx.params.id;
    if (!userId) return bad("Missing user id", 400);

    const prof = await loadUserProfile(userId);
    if (!prof?.user_id) return bad("User not found", 404);

    const role = normalizeRole(prof.role);
    const overrides = await loadOverrides(userId);
    const effective = calcEffective(role, overrides as any);

    return ok({
      user: {
        user_id: prof.user_id,
        email: prof.email ?? null,
        name: prof.name ?? null,
        role,
        is_active: prof.is_active ?? true,
      },
      overrides,
      base_permissions: effective.base,
      effective_permissions: effective.effective,
      summary: {
        allow: effective.allow,
        deny: effective.deny,
      },
    });
  } catch (e: any) {
    return bad(e?.message || "Server error", 500);
  }
}

export async function POST(req: Request, ctx: { params: { id: string } }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return bad(auth.error, auth.status);

    const userId = ctx.params.id;
    if (!userId) return bad("Missing user id", 400);

    const body = await req.json().catch(() => ({}));
    const perm_key = String(body?.perm_key || "").trim();
    const allowed = body?.allowed;

    if (!perm_key) return bad("perm_key is required", 400);
    if (allowed !== true && allowed !== false) return bad("allowed must be boolean", 400);

    // ✅ upsert (user_id, perm_key) 유니크가 없으면 충돌나므로,
    // 먼저 있으면 update, 없으면 insert (안전 방식)
    const { data: existing, error: exErr } = await supabaseAdmin
      .from("user_permission_overrides")
      .select("user_id, perm_key")
      .eq("user_id", userId)
      .eq("perm_key", perm_key)
      .maybeSingle();

    if (exErr && !String(exErr.message || "").toLowerCase().includes("0 rows")) {
      // maybeSingle은 없으면 data null + error null이 정상이라 여기 거의 안 옴
    }

    if (existing?.user_id) {
      const { error: uErr } = await supabaseAdmin
        .from("user_permission_overrides")
        .update({ allowed })
        .eq("user_id", userId)
        .eq("perm_key", perm_key);
      if (uErr) throw new Error(uErr.message);
    } else {
      const { error: iErr } = await supabaseAdmin
        .from("user_permission_overrides")
        .insert({ user_id: userId, perm_key, allowed });
      if (iErr) throw new Error(iErr.message);
    }

    return ok({ user_id: userId, perm_key, allowed });
  } catch (e: any) {
    return bad(e?.message || "Server error", 500);
  }
}

export async function DELETE(req: Request, ctx: { params: { id: string } }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return bad(auth.error, auth.status);

    const userId = ctx.params.id;
    if (!userId) return bad("Missing user id", 400);

    const { searchParams } = new URL(req.url);
    const perm_key = String(searchParams.get("perm_key") || "").trim();
    if (!perm_key) return bad("perm_key is required", 400);

    const { error } = await supabaseAdmin
      .from("user_permission_overrides")
      .delete()
      .eq("user_id", userId)
      .eq("perm_key", perm_key);

    if (error) throw new Error(error.message);

    return ok({ user_id: userId, perm_key, deleted: true });
  } catch (e: any) {
    return bad(e?.message || "Server error", 500);
  }
}
