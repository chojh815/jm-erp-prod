// src/lib/supabaseAdmin.ts
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase admin client.
 *
 * Goals:
 * - Server env first: SUPABASE_URL -> NEXT_PUBLIC_SUPABASE_URL
 * - Service key first: SUPABASE_SERVICE_ROLE_KEY -> SUPABASE_SERVICE_KEY
 * - Strong debug logs so production can reveal exactly which project is used
 * - Warn loudly when server/public URLs point to different projects
 */

function parseProjectRef(url: string) {
  try {
    const u = new URL(url);
    const host = u.host;
    const ref = u.hostname.split(".")[0] ?? "";
    return { host, ref };
  } catch {
    return { host: "", ref: "" };
  }
}

const serverUrl = process.env.SUPABASE_URL || "";
const publicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseUrl = serverUrl || publicUrl || "";

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

const resolved = parseProjectRef(supabaseUrl);
const serverParsed = parseProjectRef(serverUrl);
const publicParsed = parseProjectRef(publicUrl);

const shouldDebug =
  process.env.SUPABASE_ADMIN_DEBUG === "1" ||
  process.env.NODE_ENV !== "production";

const g = globalThis as any;

if (!g.__SUPABASE_ADMIN_ENV_LOGGED__) {
  g.__SUPABASE_ADMIN_ENV_LOGGED__ = true;

  const keyPrefix = serviceRoleKey.slice(0, 6);
  const keySuffix = serviceRoleKey.slice(-4);

  if (shouldDebug) {
    console.log("======================================");
    console.log("[supabaseAdmin] Resolved URL host   :", resolved.host);
    console.log("[supabaseAdmin] Resolved project    :", resolved.ref);
    console.log(
      "[supabaseAdmin] Using URL env       :",
      serverUrl ? "SUPABASE_URL" : "NEXT_PUBLIC_SUPABASE_URL"
    );
    console.log(
      "[supabaseAdmin] Service key env     :",
      process.env.SUPABASE_SERVICE_ROLE_KEY
        ? "SUPABASE_SERVICE_ROLE_KEY"
        : "SUPABASE_SERVICE_KEY"
    );
    console.log("[supabaseAdmin] Service key prefix  :", `${keyPrefix}…${keySuffix}`);
    console.log("[supabaseAdmin] SUPABASE_URL host   :", serverParsed.host || "(empty)");
    console.log("[supabaseAdmin] PUBLIC URL host     :", publicParsed.host || "(empty)");
    console.log("[supabaseAdmin] SUPABASE_URL ref    :", serverParsed.ref || "(empty)");
    console.log("[supabaseAdmin] PUBLIC URL ref      :", publicParsed.ref || "(empty)");
    console.log("======================================");
  }

  if (
    serverUrl &&
    publicUrl &&
    serverParsed.ref &&
    publicParsed.ref &&
    serverParsed.ref !== publicParsed.ref
  ) {
    console.warn("======================================");
    console.warn("[supabaseAdmin] WARNING: SUPABASE_URL and NEXT_PUBLIC_SUPABASE_URL point to different projects.");
    console.warn("[supabaseAdmin] Server project:", serverParsed.ref);
    console.warn("[supabaseAdmin] Public project:", publicParsed.ref);
    console.warn("[supabaseAdmin] The server API will use SUPABASE_URL.");
    console.warn("======================================");
  }
}

export const supabaseAdmin = createSupabaseClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

export const SupabaseAdminClient = supabaseAdmin;

export function createClient() {
  return supabaseAdmin;
}

export function createSupabaseAdminClient() {
  return supabaseAdmin;
}
