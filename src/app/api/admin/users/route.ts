// src/app/api/admin/users/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

// 공통 응답 헬퍼
function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function okResponse(data: any = {}) {
  return NextResponse.json({ success: true, ...data }, { status: 200 });
}

/**
 * 현재 user_profiles 테이블 구조 (스크린샷 기준)
 *  - user_id (uuid, PK, auth.users.id 외래키)
 *  - email  (text)
 *  - name   (text)
 *  - role   (text)
 *  - created_at (timestamptz) 있을 수 있음
 *
 * 프론트에서는 user.id 를 사용하지만,
 * 이 값 = user_id 로 취급한다.
 */

// ==========================
// GET  /api/admin/users
// → 유저 리스트
// ==========================
export async function GET(_req: NextRequest) {
  try {
    const { data, error } = await supabaseAdmin
      .from("user_profiles")
      .select("user_id, email, name, role, created_at")
      .order("created_at", { ascending: true });

    if (error) {
      console.error("GET /admin/users error:", error);
      return errorResponse(error.message, 500);
    }

    const users =
      (data ?? []).map((row: any) => ({
        id: row.user_id, // 프론트에서 사용하는 id
        user_id: row.user_id,
        email: row.email,
        name: row.name,
        role: row.role,
        created_at: row.created_at,
      })) ?? [];

    return NextResponse.json({ users });
  } catch (err: any) {
    console.error("GET /admin/users exception:", err);
    return errorResponse("Failed to load users.", 500);
  }
}

// ==========================
// POST  /api/admin/users
// body: { email, name, role, invite?, tempPassword? }
// - 현재는 항상 Supabase Auth 의 inviteUserByEmail 사용
// - Auth 에서 받은 user.id 를 user_profiles.user_id 로 upsert
// ==========================
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const email = (body.email || "").trim();
    const name = (body.name || "").trim() || null;
    const role = (body.role || "viewer") as string;

    if (!email) return errorResponse("email is required.");

    // 1) Supabase Auth에서 유저 생성 + 초대 메일 발송
    const { data: inviteData, error: inviteError } =
      await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        data: { role },
      });

    if (inviteError) {
      console.error("POST /admin/users inviteUserByEmail error:", inviteError);

      const msg = String(inviteError.message || "");

      // 이미 등록된 이메일인 경우 → 한국어 메시지로 변환
      if (
        msg.includes(
          "A user with this email address has already been registered"
        )
      ) {
        return errorResponse("이미 등록된 이메일입니다.", 400);
      }

      return errorResponse(msg, 400);
    }

    const authUserId = inviteData?.user?.id;
    if (!authUserId) {
      console.error("POST /admin/users: inviteUserByEmail returned no user id");
      return errorResponse("Failed to create auth user.", 500);
    }

    // 2) user_profiles 에 upsert (중복 user_id 일 때 update)
    const { data, error } = await supabaseAdmin
      .from("user_profiles")
      .upsert(
        {
          user_id: authUserId,
          email,
          name,
          role,
        },
        { onConflict: "user_id" }
      )
      .select("user_id, email, name, role, created_at")
      .single();

    if (error) {
      console.error("POST /admin/users upsert user_profiles error:", error);
      return errorResponse(error.message, 500);
    }

    const user = {
      id: data.user_id,
      user_id: data.user_id,
      email: data.email,
      name: data.name,
      role: data.role,
      created_at: data.created_at,
    };

    return okResponse({ user });
  } catch (err: any) {
    console.error("POST /admin/users exception:", err);
    return errorResponse("Failed to create user.", 500);
  }
}

// ==========================
// PUT  /api/admin/users
// body: { id, name, role }
// id = user_id 로 사용
// ==========================
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const id = body.id as string | undefined;
    if (!id) return errorResponse("id is required.", 400);

    const updates: any = {};
    if ("name" in body) updates.name = body.name ?? null;
    if ("role" in body) updates.role = body.role ?? "viewer";

    const { data, error } = await supabaseAdmin
      .from("user_profiles")
      .update(updates)
      .eq("user_id", id)
      .select("user_id, email, name, role, created_at")
      .single();

    if (error) {
      console.error("PUT /admin/users update error:", error);
      return errorResponse(error.message, 500);
    }

    const user = {
      id: data.user_id,
      user_id: data.user_id,
      email: data.email,
      name: data.name,
      role: data.role,
      created_at: data.created_at,
    };

    return okResponse({ user });
  } catch (err: any) {
    console.error("PUT /admin/users exception:", err);
    return errorResponse("Failed to update user.", 500);
  }
}

// ==========================
// DELETE  /api/admin/users
// body: { id }  (page.tsx 에서 이렇게 보냄)
// id = user_id 로 사용
// ==========================
export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const id = body.id as string | undefined;
    if (!id) return errorResponse("id is required.", 400);

    // 1) Supabase Auth 유저 삭제 시도
    const { error: authErr } =
      await supabaseAdmin.auth.admin.deleteUser(id);
    if (
      authErr &&
      !String(authErr.message || "")
        .toLowerCase()
        .includes("user not found")
    ) {
      console.error("DELETE /admin/users auth deleteUser error:", authErr);
      return errorResponse(authErr.message, 500);
    }

    // 2) user_profiles 삭제
    const { error } = await supabaseAdmin
      .from("user_profiles")
      .delete()
      .eq("user_id", id);

    if (error) {
      console.error("DELETE /admin/users delete user_profiles error:", error);
      return errorResponse(error.message, 500);
    }

    return okResponse();
  } catch (err: any) {
    console.error("DELETE /admin/users exception:", err);
    return errorResponse("Failed to delete user.", 500);
  }
}
