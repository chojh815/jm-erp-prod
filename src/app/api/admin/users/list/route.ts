// src/app/api/admin/users/list/route.ts
import { NextRequest, NextResponse } from "next/server";
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

function safeTrim(v: any) {
  return (v ?? "").toString().trim();
}

/** Route Handler 쿠키 세션용 SSR client */
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

async function getSessionUserId() {
  const supabase = createSupabaseRouteClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) return { userId: null as string | null, error: error.message };
  return { userId: data.user?.id ?? null, error: null as string | null };
}

function escapeIlike(v: string) {
  // escape % and _ for ILIKE pattern
  return v.replace(/[%_]/g, (m) => `\\${m}`);
}

/**
 * GET /api/admin/users/list
 * Query:
 *  - q: optional search (email/name)
 *  - limit: optional (default 500, max 2000)
 */
export async function GET(req: NextRequest) {
  try {
    // 1) auth
    const { userId, error: authErr } = await getSessionUserId();
    if (authErr) return bad(authErr, 401);
    if (!userId) return bad("Not authenticated", 401);

    // 2) requester profile -> admin only
    const { data: me, error: meErr } = await supabaseAdmin
      .from("user_profiles")
      .select("user_id,role,is_active,email")
      .eq("user_id", userId)
      .maybeSingle();

    if (meErr) return bad(meErr.message, 500);
    if (!me?.user_id) return bad("Profile not found", 404);
    if (me.is_active === false) return bad("Inactive user", 403);

    const myRole = (me.role ?? "viewer").toString().toLowerCase();
    if (myRole !== "admin") {
      return bad("Admin only", 403);
    }

    // 3) parse query
    const url = new URL(req.url);
    const qRaw = safeTrim(url.searchParams.get("q"));
    const limitRaw = safeTrim(url.searchParams.get("limit"));

    let limit = 500;
    if (limitRaw) {
      const n = Number(limitRaw);
      if (Number.isFinite(n) && n > 0) limit = Math.min(2000, Math.floor(n));
    }

    // 4) query user_profiles (NO maybeSingle, NO limit(1))
    // - updated_at 컬럼이 없을 수 있으니 created_at 기준 정렬만 사용
    let query = supabaseAdmin
      .from("user_profiles")
      .select("user_id,email,name,role,is_active,created_at")
      .order("created_at", { ascending: true })
      .limit(limit);

    if (qRaw) {
      const q = escapeIlike(qRaw);
      // Supabase OR syntax
      query = query.or(`email.ilike.%${q}%,name.ilike.%${q}%`);
    }

    const { data, error } = await query;

    // 컬럼이 일부 없어서 select가 실패하는 환경이면 fallback
    if (error) {
      const msg = (error.message || "").toLowerCase();

      // select한 컬럼 중 일부가 없을 때 fallback: select("*")
      if (msg.includes("column") && msg.includes("does not exist")) {
        let q2 = supabaseAdmin
          .from("user_profiles")
          .select("*")
          .order("created_at", { ascending: true })
          .limit(limit);

        if (qRaw) {
          const q = escapeIlike(qRaw);
          q2 = q2.or(`email.ilike.%${q}%,name.ilike.%${q}%`);
        }

        const { data: data2, error: err2 } = await q2;
        if (err2) return bad(err2.message, 500);

        const users = (data2 ?? []).map((r: any) => ({
          user_id: r.user_id ?? r.id ?? null,
          email: r.email ?? null,
          name: r.name ?? null,
          role: r.role ?? "viewer",
          is_active: r.is_active ?? true,
          created_at: r.created_at ?? null,
        }));

        return ok({ users });
      }

      return bad(error.message, 500);
    }

    return ok({ users: data ?? [] });
  } catch (e: any) {
    return bad(e?.message || "Server error", 500);
  }
}
