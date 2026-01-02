// src/app/api/me/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}
function bad(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function GET() {
  try {
    const cookieStore = cookies();

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) return bad("Missing NEXT_PUBLIC_SUPABASE_URL/ANON_KEY", 500);

    const supabase = createServerClient(url, anon, {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        // Route Handler에서는 set/remove가 필요 없는 케이스가 대부분이라 no-op 처리
        set() {},
        remove() {},
      },
    });

    const { data: authData, error: authErr } = await supabase.auth.getUser();
    if (authErr || !authData?.user) return bad("Not authenticated", 401);

    const user = authData.user;

    const { data: profile, error: pErr } = await supabaseAdmin
      .from("user_profiles")
      .select("user_id,email,name,role,is_active")
      .eq("user_id", user.id)
      .maybeSingle();

    if (pErr) return bad(pErr.message, 500);

    return ok({
      user: {
        id: user.id,
        email: profile?.email ?? user.email ?? null,
        name: profile?.name ?? null,
        role: profile?.role ?? "viewer",
        is_active: profile?.is_active ?? true,
      },
    });
  } catch (e: any) {
    return bad(e?.message ?? "Server error", 500);
  }
}
