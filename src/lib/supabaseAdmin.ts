// src/lib/supabaseAdmin.ts
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// 서비스키는 서버에서만 사용 (절대 브라우저에 노출 X)
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL is missing");
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing");
}

// --------------------------------------------------
// ✅ DEBUG: 서버가 실제로 사용하는 Supabase URL 확인
// --------------------------------------------------
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

// project ref 추출 (xxxxx.supabase.co → xxxxx)
let projectRef = "";
let host = "";
try {
  const u = new URL(supabaseUrl);
  host = u.host;
  projectRef = u.hostname.split(".")[0] ?? "";
} catch {}

// dev 서버에서만 1회 출력 (중복 로그 방지)
if (process.env.NODE_ENV !== "production") {
  const g = globalThis as any;
  if (!g.__SUPABASE_ADMIN_URL_LOGGED__) {
    g.__SUPABASE_ADMIN_URL_LOGGED__ = true;
    console.log("======================================");
    console.log("[supabaseAdmin] Supabase URL host :", host);
    console.log("[supabaseAdmin] Supabase project :", projectRef);
    console.log("======================================");
  }
}

// --------------------------------------------------
// ✅ 단일 Admin Client 인스턴스
// --------------------------------------------------
export const supabaseAdmin = createSupabaseClient(
  supabaseUrl,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

// ----------------------------------------------
// ✅ Compatibility exports (기존 코드 호환용)
// ----------------------------------------------
export const SupabaseAdminClient = supabaseAdmin;

export function createClient() {
  return supabaseAdmin;
}

export function createSupabaseAdminClient() {
  return supabaseAdmin;
}
