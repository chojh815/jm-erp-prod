// src/app/api/me/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function ok(data: any = {}, res?: NextResponse) {
  const r = res ?? NextResponse.json({ success: true, ...data });
  return r;
}
function bad(message: string, status = 400, res?: NextResponse) {
  const r =
    res ?? NextResponse.json({ success: false, error: message }, { status });
  return r;
}

export async function GET(req: NextRequest) {
  // ✅ 여기서 응답 객체를 먼저 만들고, 쿠키 set/remove를 여기에 연결
  const res = NextResponse.json({ success: true });

  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon)
      return bad("Missing NEXT_PUBLIC_SUPABASE_URL/ANON_KEY", 500, res);

    const supabase = createServerClient(url, anon, {
      cookies: {
        get(name: string) {
          return req.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: any) {
          // @supabase/ssr 가 넘기는 옵션 그대로 적용
          res.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: any) {
          res.cookies.set({ name, value: "", ...options, maxAge: 0 });
        },
      },
    });

    // ✅ 여기서 세션/유저 확인
    const { data: authData, error: authErr } = await supabase.auth.getUser();

    // refresh_token_not_found 같이 “정상적으로는 401이어야 하는 케이스”는 조용히 401로 반환
    if (authErr || !authData?.user) {
      return bad("Not authenticated", 401, res);
    }

    const user = authData.user;

    const { data: profile, error: pErr } = await supabaseAdmin
      .from("user_profiles")
      .select("user_id,email,name,role,is_active")
      .eq("user_id", user.id)
      .maybeSingle();

    if (pErr) return bad(pErr.message, 500, res);

    return ok(
      {
        user: {
          id: user.id,
          email: profile?.email ?? user.email ?? null,
          name: profile?.name ?? null,
          role: profile?.role ?? "viewer",
          is_active: profile?.is_active ?? true,
        },
      },
      res
    );
  } catch (e: any) {
    return bad(e?.message ?? "Server error", 500, res);
  }
}
