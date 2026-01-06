// src/app/api/admin/users/permission-overrides/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function ok(data: any = {}) {
  return NextResponse.json({ ok: true, success: true, ...data });
}
function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, success: false, error: message }, { status });
}

/** Route Handler (cookie session) */
function createSupabaseRouteClient() {
  const cookieStore = cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("Missing Supabase env");
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

async function getSessionUserId() {
  const supabase = createSupabaseRouteClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) return { userId: null, error: error.message };
  return { userId: data.user?.id ?? null, error: null };
}

async function requireAdmin() {
  const { userId, error } = await getSessionUserId();
  if (error) return { ok: false as const, status: 401, error };
  if (!userId) return { ok: false as const, status: 401, error: "Not authenticated" };

  const { data: prof, error: pErr } = await supabaseAdmin
    .from("user_profiles")
    .select("user_id, role, is_active")
    .eq("user_id", userId)
    .maybeSingle();

  if (pErr) return { ok: false as const, status: 500, error: pErr.message };
  if (!prof?.user_id) return { ok: false as const, status: 403, error: "Profile not found" };
  if (prof.is_active === false) return { ok: false as const, status: 403, error: "Inactive user" };

  const role = String(prof.role || "").toLowerCase();
  if (role !== "admin") return { ok: false as const, status: 403, error: "Admin only" };

  return { ok: true as const, adminUserId: userId };
}

function safeStr(v: any) {
  return (v ?? "").toString().trim();
}

export async function GET(req: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return bad(auth.error, auth.status);

    const { searchParams } = new URL(req.url);
    const user_id = safeStr(searchParams.get("user_id"));
    if (!user_id) return bad("Missing user_id", 400);

    const { data, error } = await supabaseAdmin
      .from("user_permission_overrides")
      .select("user_id, perm_key, allowed, updated_at")
      .eq("user_id", user_id)
      .order("perm_key", { ascending: true });

    if (error) return bad(error.message, 500);

    return ok({ user_id, overrides: data || [] });
  } catch (e: any) {
    return bad(e?.message || "Server error", 500);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return bad(auth.error, auth.status);

    const body = await req.json().catch(() => ({}));

    const user_id = safeStr(body.user_id);
    const perm_key = safeStr(body.perm_key);
    const allowed = body.allowed;

    if (!user_id) return bad("Missing user_id", 400);
    if (!perm_key) return bad("Missing perm_key", 400);
    if (allowed !== true && allowed !== false) return bad("allowed must be boolean", 400);

    const { data, error } = await supabaseAdmin
      .from("user_permission_overrides")
      .upsert(
        {
          user_id,
          perm_key,
          allowed,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,perm_key" }
      )
      .select("user_id, perm_key, allowed, updated_at")
      .maybeSingle();

    if (error) return bad(error.message, 500);

    return ok({ override: data });
  } catch (e: any) {
    return bad(e?.message || "Server error", 500);
  }
}

export async function DELETE(req: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return bad(auth.error, auth.status);

    const { searchParams } = new URL(req.url);
    const user_id = safeStr(searchParams.get("user_id"));
    const perm_key = safeStr(searchParams.get("perm_key"));
    if (!user_id) return bad("Missing user_id", 400);
    if (!perm_key) return bad("Missing perm_key", 400);

    const { error } = await supabaseAdmin
      .from("user_permission_overrides")
      .delete()
      .eq("user_id", user_id)
      .eq("perm_key", perm_key);

    if (error) return bad(error.message, 500);

    return ok({ deleted: true, user_id, perm_key });
  } catch (e: any) {
    return bad(e?.message || "Server error", 500);
  }
}
