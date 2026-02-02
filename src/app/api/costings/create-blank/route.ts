import { NextResponse } from "next/server";

/**
 * Costings Create Blank
 *
 * Why this file exists:
 * - We want a single API endpoint that creates a new costing header row and
 *   returns the new UUID so the UI can route to /costings/[id].
 *
 * Important implementation detail:
 * - We intentionally DO NOT use @supabase/auth-helpers-nextjs here.
 *   In many repos the installed version does not export createRouteHandlerClient,
 *   which causes runtime errors like:
 *   "createRouteHandlerClient is not a function".
 *
 * Instead, we call PostgREST directly using env keys.
 */

type CreateBlankBody = {
  style_no?: string | null;
  stage?: string | null;
  base_currency?: string | null;
  // future-safe: extra fields may be passed by the UI
  [key: string]: any;
};

function jsonError(message: string, status = 400, details?: any) {
  return NextResponse.json(
    { success: false, message, details: details ?? null },
    { status }
  );
}

function safeText(v: any) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function extractMissingColumn(err: any): string | null {
  const s = typeof err === "string" ? err : JSON.stringify(err ?? "");
  // Typical PostgREST message:
  // "Could not find the 'currency' column of 'costing_headers' in the schema cache"
  const m = s.match(/Could not find the '([^']+)' column/i);
  return m?.[1] ?? null;
}

function getSupabaseRestConfig() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    "";

  // Prefer service role on server (best), fallback to anon if that's all we have.
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    "";

  if (!url || !key) {
    throw new Error(
      "Missing Supabase env vars. Need NEXT_PUBLIC_SUPABASE_URL and either SUPABASE_SERVICE_ROLE_KEY (recommended) or NEXT_PUBLIC_SUPABASE_ANON_KEY."
    );
  }

  return { url, key };
}

async function postgrestInsert(table: string, payload: any) {
  const { url, key } = getSupabaseRestConfig();
  const endpoint = `${url}/rest/v1/${table}?select=id`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    throw data ?? { message: `PostgREST error (${res.status})` };
  }

  // With return=representation, PostgREST returns an array of rows.
  const row = Array.isArray(data) ? data[0] : data;
  const id = row?.id;
  if (!id) throw { message: "Insert succeeded but no id returned", data };
  return { id };
}

async function insertWithSchemaFallback(table: string, payload: any) {
  // If UI sends fields that don't exist, PostgREST returns schema-cache errors.
  // We'll remove missing columns and retry (same strategy used elsewhere in JMI ERP).
  let p: any = { ...payload };
  for (let i = 0; i < 30; i++) {
    try {
      return await postgrestInsert(table, p);
    } catch (e: any) {
      const missing = extractMissingColumn(e);
      if (missing && Object.prototype.hasOwnProperty.call(p, missing)) {
        delete p[missing];
        continue;
      }
      throw e;
    }
  }
  throw new Error("Too many retries while removing missing columns");
}

export async function POST(req: Request) {
  let body: CreateBlankBody = {};
  try {
    body = (await req.json()) as CreateBlankBody;
  } catch {
    // Some callers may POST without body. That's OK.
    body = {};
  }

  const rawStyle = safeText(body.style_no);
  const style_no = rawStyle || `TMP-${Date.now()}`;
  const stage = safeText(body.stage) || "SAMPLE";
  const base_currency = safeText(body.base_currency) || "CNY";

  // Keep payload conservative: only send columns that are very likely to exist.
  // If your DB has more columns, you can extend this safely later.
  const payload: any = {
    style_no,
    stage,
    status: "DRAFT",
    base_currency,
  };

  try {
    const { id } = await insertWithSchemaFallback("costing_headers", payload);
    return NextResponse.json({ success: true, id });
  } catch (e: any) {
    // PostgREST error objects typically include {message, details, hint, code}
    const msg = e?.message || "Create failed";
    return jsonError(msg, 400, e);
  }
}

export async function OPTIONS() {
  return NextResponse.json({ ok: true });
}
