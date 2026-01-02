/**
 * src/app/api/work-sheets/vendor-prices/route.ts
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}
function bad(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isUuid(v: any) {
  return typeof v === "string" && UUID_RE.test(v);
}
function safeTrim(v: any) {
  return (v ?? "").toString().trim();
}
function isSchemaCacheMissingRelation(err: any) {
  const msg = String(err?.message ?? "");
  const m = msg.match(/Could not find the '([^']+)' relation.*schema cache/i);
  return { ok: !!m, rel: m?.[1] ?? null, msg };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const vendor_id = safeTrim(url.searchParams.get("vendor_id"));
    const limitRaw = safeTrim(url.searchParams.get("limit"));
    const limit = Math.min(Math.max(parseInt(limitRaw || "8", 10) || 8, 1), 50);

    if (!isUuid(vendor_id)) return bad("Invalid vendor_id", 400);

    let def: any = null;
    try {
      const { data, error } = await supabaseAdmin
        .from("vendor_price_defaults")
        .select("vendor_id,currency,unit_cost_local,updated_at")
        .eq("vendor_id", vendor_id)
        .maybeSingle();

      if (!error) def = data ?? null;
      else if (isSchemaCacheMissingRelation(error).ok) def = null;
    } catch {
      def = null;
    }

    let history: any[] = [];
    try {
      const { data, error } = await supabaseAdmin
        .from("vendor_price_history")
        .select("id,vendor_id,currency,unit_cost_local,effective_at,source,work_sheet_id,work_sheet_line_id,created_at")
        .eq("vendor_id", vendor_id)
        .order("effective_at", { ascending: false })
        .limit(limit);

      if (!error) history = Array.isArray(data) ? data : [];
      else if (isSchemaCacheMissingRelation(error).ok) history = [];
    } catch {
      history = [];
    }

    return ok({
      vendor_id,
      default: def
        ? {
            currency: def.currency ?? null,
            unit_cost_local:
              def.unit_cost_local === null || def.unit_cost_local === undefined
                ? null
                : Number(def.unit_cost_local),
            updated_at: def.updated_at ?? null,
          }
        : null,
      history: history.map((h) => ({
        ...h,
        unit_cost_local:
          h.unit_cost_local === null || h.unit_cost_local === undefined
            ? null
            : Number(h.unit_cost_local),
      })),
    });
  } catch (e: any) {
    return bad(e?.message ?? "Server error", 500);
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return bad("Invalid JSON body", 400);

    const vendor_id = safeTrim(body.vendor_id);
    if (!isUuid(vendor_id)) return bad("Invalid vendor_id", 400);

    const currency = safeTrim(body.currency) || null;
    const raw = body.unit_cost_local;
    const unit_cost_local =
      raw === null || raw === undefined || raw === "" ? null : Number(raw);

    if (unit_cost_local === null || Number.isNaN(unit_cost_local)) {
      return bad("unit_cost_local is required", 400);
    }

    try {
      const { error } = await supabaseAdmin.from("vendor_price_defaults").upsert(
        {
          vendor_id,
          currency,
          unit_cost_local,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "vendor_id" }
      );
      if (error) {
        if (isSchemaCacheMissingRelation(error).ok) {
          return ok({ vendor_id, saved: false, reason: "vendor_price_defaults missing" });
        }
        return bad(error.message, 500);
      }
    } catch (e: any) {
      return ok({ vendor_id, saved: false, reason: e?.message ?? "defaults error" });
    }

    try {
      const { error } = await supabaseAdmin.from("vendor_price_history").insert({
        vendor_id,
        currency,
        unit_cost_local,
        source: "MANUAL",
        effective_at: new Date().toISOString(),
      });
      if (error && isSchemaCacheMissingRelation(error).ok) {
        // ignore
      }
    } catch {
      // ignore
    }

    return ok({ vendor_id, saved: true });
  } catch (e: any) {
    return bad(e?.message ?? "Server error", 500);
  }
}
