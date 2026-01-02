// src/app/api/admin/users/reset/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assertApiRole } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const guard = await assertApiRole(["admin"]);
  if (guard) return guard;

  const { email, tempPassword } = await req.json();
  if (!email) return NextResponse.json({ ok: false, error: "Email required" }, { status: 400 });

  // email → user_id 조회
  const { data: prof, error: selErr } = await supabaseAdmin
    .from("user_profiles")
    .select("user_id")
    .eq("email", email)
    .maybeSingle();

  if (selErr || !prof?.user_id)
    return NextResponse.json({ ok: false, error: "User not found" }, { status: 404 });

  // 임시 비밀번호로 강제 재설정 (내부용)
  const newPw = tempPassword || process.env.TEMP_PASSWORD_DEFAULT || "Temp1234!";

  const { error: upErr } = await supabaseAdmin.auth.admin.updateUserById(prof.user_id, { password: newPw });
  if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
