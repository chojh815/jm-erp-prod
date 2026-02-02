import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * This project historically imported `createSupabaseServerClient` from `src/app/api/_supabase`.
 * Some routes still reference it via relative paths like `../../_supabase`.
 *
 * We provide a single stable shim here so any API route can import it.
 *
 * Env vars required:
 * - NEXT_PUBLIC_SUPABASE_URL
 * - NEXT_PUBLIC_SUPABASE_ANON_KEY
 */
export function createSupabaseServerClient() {
  const cookieStore = cookies();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      get(name) {
        return cookieStore.get(name)?.value;
      },
      set(name, value, options) {
        // `cookies()` in Next route handlers is mutable
        cookieStore.set({ name, value, ...options });
      },
      remove(name, options) {
        cookieStore.set({ name, value: "", ...options, maxAge: 0 });
      },
    },
  });
}

// Back-compat alias (some codebases used this name)
export const createSupabaseRouteClient = createSupabaseServerClient;
