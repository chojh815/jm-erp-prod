import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * Server-side Supabase client (Route Handlers / Server Actions).
 *
 * Your codebase uses two names in different places:
 * - createSupabaseServerClient (older)
 * - createClient (expected by several modules)
 *
 * This file provides BOTH, so imports stay stable.
 */

export function createSupabaseServerClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: any) {
          cookieStore.set({ name, value, ...options });
        },
        remove(name: string, options: any) {
          cookieStore.set({ name, value: "", ...options, maxAge: 0 });
        },
      },
    }
  );
}

// Backwards/forwards compatible alias
export const createClient = createSupabaseServerClient;
