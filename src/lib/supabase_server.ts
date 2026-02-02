/**
 * Compatibility shim.
 *
 * Some pages/components still import:
 *   import { createClient } from "@/lib/supabase_server";
 *
 * In this project, the *server* client lives in:
 *   - src/lib/supabaseServer.ts  (createSupabaseServerClient)
 *   - src/lib/supabase/server.ts (re-export)
 *
 * But those do NOT export `createClient()`, so client-side pages crash with:
 *   createClient is not a function
 *
 * ✅ This shim makes `createClient()` available on the CLIENT by forwarding to
 * `createSupabaseBrowserClient()` (src/lib/supabaseClient.ts).
 *
 * IMPORTANT:
 * - Use `createSupabaseServerClient()` for server/route handlers.
 * - Use `createClient()` / `createSupabaseBrowserClient()` for client components.
 */
export { createSupabaseBrowserClient, createClient } from "./supabaseClient";
