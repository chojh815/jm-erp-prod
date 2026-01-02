// src/lib/api-guard.ts
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabaseServer";

/**
 * API 라우트에서 호출해 role을 검사합니다.
 * 허용되지 않으면 401/403을 반환하는 NextResponse를 리턴하고,
 * 통과하면 null을 리턴합니다.
 */
export async function assertApiRole(allow: Array<"admin" | "manager" | "staff" | "viewer">) {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile, error } = await supabase
    .from("user_profiles")
    .select("role,is_active")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !profile) {
    return NextResponse.json({ ok: false, error: "Profile not found" }, { status: 401 });
  }
  if (!profile.is_active) {
    return NextResponse.json({ ok: false, error: "Inactive user" }, { status: 403 });
  }
  if (!allow.includes(profile.role as any)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  return null; // 통과
}
