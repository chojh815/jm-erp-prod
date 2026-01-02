"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * 브라우저(클라이언트)에서 쓰는 Supabase 클라이언트
 * - 로그인/로그아웃, auth 상태 등을 처리
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
