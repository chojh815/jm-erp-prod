// src/lib/supabaseAdmin.ts
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// 서비스키는 서버에서만 사용 (절대 브라우저에 노출 X)
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL is missing");
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing");
}

// ✅ 단일 Admin Client 인스턴스
export const supabaseAdmin = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

// ----------------------------------------------
// ✅ Compatibility exports (기존 코드 호환용)
// 여러 파일에서 제각각 다른 이름으로 import하는 걸 전부 살려줌
// ----------------------------------------------

// type/alias처럼 쓰는 코드 대비
export const SupabaseAdminClient = supabaseAdmin;

// 어떤 파일은 createClient 라고 import함 (admin client 반환)
export function createClient() {
  return supabaseAdmin;
}

// 어떤 파일은 createSupabaseAdminClient 라고 import함
export function createSupabaseAdminClient() {
  return supabaseAdmin;
}
