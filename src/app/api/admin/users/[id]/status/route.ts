// src/app/api/admin/users/[id]/status/route.ts
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

  return { ok: true as const, adminUserId: user.id };
}

export async function PATCH(req: Request, ctx: { params: { id: string } }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return bad(auth.error, auth.status);

    const userId = String(ctx.params.id || "").trim();
    if (!userId) return bad("Missing user id", 400);

    const body = await req.json().catch(() => ({}));
    if (body?.is_active !== true && body?.is_active !== false) {
      return bad("is_active must be boolean", 400);
    }

    if (auth.adminUserId === userId && body.is_active === false) {
      return bad("You cannot deactivate your own account.", 400);
    }

    const { data, error } = await supabaseAdmin
      .from("user_profiles")
      .update({
        is_active: body.is_active,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .select("user_id,email,name,role,is_active,created_at")
      .maybeSingle();

    if (error) {
      const msg = String(error.message || "");
      const lowerMsg = msg.toLowerCase();
      if (
        lowerMsg.includes("updated_at") &&
        (lowerMsg.includes("does not exist") || lowerMsg.includes("schema cache"))
      ) {
        const retry = await supabaseAdmin
          .from("user_profiles")
          .update({ is_active: body.is_active })
          .eq("user_id", userId)
          .select("user_id,email,name,role,is_active,created_at")
          .maybeSingle();
        if (retry.error) return bad(retry.error.message, 500);
        return ok({ user: retry.data });
      }
      return bad(error.message, 500);
    }

    if (!data?.user_id) return bad("User not found", 404);

    return ok({ user: data });
  } catch (e: any) {
    return bad(e?.message || "Server error", 500);
  }
}
