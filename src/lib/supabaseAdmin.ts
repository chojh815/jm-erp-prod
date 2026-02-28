// src/lib/supabaseAdmin.ts
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase admin client.
 * - Prefers server env (SUPABASE_URL) and falls back to NEXT_PUBLIC_SUPABASE_URL.
 * - Prefers SUPABASE_SERVICE_ROLE_KEY and falls back to SUPABASE_SERVICE_KEY.
 * - Can optionally log resolved project ref when SUPABASE_ADMIN_DEBUG=1.
 */

// ------------------------------
// ✅ Resolve env (server-first)
// ------------------------------
const supabaseUrl =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";

const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";

if (!supabaseUrl) {
  throw new Error(
    "Supabase URL is missing. Set SUPABASE_URL (recommended) or NEXT_PUBLIC_SUPABASE_URL."
  );
}

if (!serviceRoleKey) {
  throw new Error(
    "Supabase service role key is missing. Set SUPABASE_SERVICE_ROLE_KEY (recommended) or SUPABASE_SERVICE_KEY."
  );
}

// ------------------------------
// ✅ Optional DEBUG (safe)
// ------------------------------
const shouldDebug =
  process.env.SUPABASE_ADMIN_DEBUG === "1" ||
  (process.env.NODE_ENV !== "production" && process.env.SUPABASE_ADMIN_DEBUG !== "0");

let projectRef = "";
let host = "";
try {
  const u = new URL(supabaseUrl);
  host = u.host;
  projectRef = u.hostname.split(".")[0] ?? "";
} catch {
  // ignore
}

if (shouldDebug) {
  const g = globalThis as any;
  if (!g.__SUPABASE_ADMIN_ENV_LOGGED__) {
    g.__SUPABASE_ADMIN_ENV_LOGGED__ = true;

    const keyPrefix = serviceRoleKey.slice(0, 6);
    const keySuffix = serviceRoleKey.slice(-4);

    console.log("======================================");
    console.log("[supabaseAdmin] Supabase URL host  :", host);
    console.log("[supabaseAdmin] Supabase project   :", projectRef);
    console.log("[supabaseAdmin] Using URL env      :", process.env.SUPABASE_URL ? "SUPABASE_URL" : "NEXT_PUBLIC_SUPABASE_URL");
    console.log("[supabaseAdmin] Service key env    :", process.env.SUPABASE_SERVICE_ROLE_KEY ? "SUPABASE_SERVICE_ROLE_KEY" : "SUPABASE_SERVICE_KEY");
    console.log("[supabaseAdmin] Service key prefix :", `${keyPrefix}…${keySuffix}`);
    console.log("======================================");
  }
}

// ------------------------------
// ✅ Single Admin Client
// ------------------------------
export const supabaseAdmin = createSupabaseClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// ----------------------------------------------
// ✅ Compatibility exports (existing code)
// ----------------------------------------------
export const SupabaseAdminClient = supabaseAdmin;

export function createClient() {
  return supabaseAdmin;
}

export function createSupabaseAdminClient() {
  return supabaseAdmin;
}
