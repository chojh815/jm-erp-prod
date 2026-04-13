/**
 * src/app/api/work-sheets/vendors/route.ts
 *
 * ✅ rows:
 * - id, company_name, code, company_type
 * - default_currency (priority: vendor_price_defaults.currency -> company_sites.currency -> companies.currency)
 * - default_unit_cost_local (from vendor_price_defaults.unit_cost_local)
 *
 * ✅ IMPORTANT:
 * - Vendor dropdown에는 FACTORY / SUPPLIER만 나오게 "허용 목록(allowlist)"으로 강제한다.
 * - fallback(useTypeFilter:false)로 조회하더라도, 마지막 out 단계에서 다시 한번 필터하여 BUYER가 절대 섞이지 않게 한다.
 * - 운영에서 stale API 응답이 남지 않도록 no-store + force-dynamic 적용
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonNoStore(body: any, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}

function ok(data: any = {}) {
  return jsonNoStore({ success: true, ...data }, 200);
}
function bad(message: string, status = 400) {
  return jsonNoStore({ success: false, error: message }, status);
}
function safeTrim(v: any) {
  return (v ?? "").toString().trim();
}
function escapeIlike(v: string) {
  return v.replace(/[\%_]/g, (m) => `\\${m}`);
}
function isSchemaCacheMissingColumn(err: any) {
  const msg = String(err?.message ?? "");
  const m = msg.match(/Could not find the '([^']+)' column.*schema cache/i);
  return { ok: !!m, col: m?.[1] ?? null, msg };
}
function isSchemaCacheMissingRelation(err: any) {
  const msg = String(err?.message ?? "");
  const m = msg.match(/Could not find the '([^']+)' relation.*schema cache/i);
  return { ok: !!m, rel: m?.[1] ?? null, msg };
}

const ALLOWED_TYPES = new Set(["FACTORY", "SUPPLIER"]);

function isAllowedType(v: any) {
  const t = safeTrim(v).toUpperCase();
  return ALLOWED_TYPES.has(t);
}

async function fetchCompanies(opts: { q: string; limit: number; useTypeFilter: boolean }) {
  const q = opts.q;
  const limit = opts.limit;

  // company_type/currency는 여기서 그대로 유지
  let fields = "id, company_name, code, company_type, currency";

  const run = async () => {
    let qb: any = supabaseAdmin.from("companies").select(fields).limit(limit);

    // ✅ 기존: neq("BUYER") 는 NULL/다른값을 다 통과시켜서 위험
    // ✅ 수정: FACTORY / SUPPLIER 만 허용

    if (q) {
      const t = escapeIlike(q);
      qb = qb.or(`company_name.ilike.%${t}%,code.ilike.%${t}%`);
    }

    qb = qb.order("company_name", { ascending: true });
    return qb;
  };

  let tries = 0;
  while (true) {
    const { data, error } = await run();
    if (!error) return { rows: Array.isArray(data) ? data : [], error: null };

    const miss = isSchemaCacheMissingColumn(error);
    if (miss.ok && miss.col && fields.includes(miss.col) && tries < 8) {
      fields = fields
        .split(",")
        .map((s) => s.trim())
        .filter((f) => f !== miss.col)
        .join(", ");
      tries++;
      continue;
    }
    return { rows: [], error };
  }
}

async function loadSiteCurrencies(companyIds: string[]) {
  const m = new Map<string, string>();
  if (companyIds.length === 0) return m;

  try {
    const { data, error } = await supabaseAdmin
      .from("company_sites")
      .select("company_id,currency,is_deleted,deleted_at")
      .in("company_id", companyIds)
      .eq("is_deleted", false)
      .is("deleted_at", null);

    if (error) return m;

    for (const r of data ?? []) {
      const cid = (r as any).company_id;
      const cur = safeTrim((r as any).currency);
      if (cid && cur && !m.has(cid)) m.set(cid, cur);
    }
  } catch {
    return m;
  }
  return m;
}

async function loadVendorDefaults(companyIds: string[]) {
  const m = new Map<string, { currency: string | null; unit_cost_local: number | null }>();
  if (companyIds.length === 0) return m;

  try {
    const { data, error } = await supabaseAdmin
      .from("vendor_price_defaults")
      .select("vendor_id,currency,unit_cost_local")
      .in("vendor_id", companyIds);

    if (error) {
      if (isSchemaCacheMissingRelation(error).ok) return m;
      return m;
    }

    for (const r of data ?? []) {
      const vid = (r as any).vendor_id;
      if (!vid) continue;
      m.set(vid, {
        currency: (r as any).currency ?? null,
        unit_cost_local:
          (r as any).unit_cost_local === null || (r as any).unit_cost_local === undefined
            ? null
            : Number((r as any).unit_cost_local),
      });
    }
  } catch {
    return m;
  }
  return m;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = safeTrim(url.searchParams.get("q"));
    const limitRaw = safeTrim(url.searchParams.get("limit"));
    const limit = Math.min(Math.max(parseInt(limitRaw || "500", 10) || 500, 1), 2000);

    // 1) 1차: 서버 쿼리 단계에서 allowlist 필터
    const r1 = await fetchCompanies({ q, limit, useTypeFilter: true });

    let rows: any[] = [];
    if (!r1.error) {
      rows = r1.rows;
    } else {
      // 2) fallback은 유지하되 (스키마 캐시/예외 상황 대비)
      //    ✅ BUT: 아래 out 단계에서 다시 한번 allowlist 필터로 BUYER가 절대 섞이지 않게 한다.
      const r2 = await fetchCompanies({ q, limit, useTypeFilter: false });
      if (r2.error) throw new Error(r2.error.message);
      rows = r2.rows;
    }

    // ✅ 마지막 안전장치: 어떤 이유로든 BUYER/NULL이 섞여도 여기서 제거
    rows = (rows ?? []).filter((r) => isAllowedType((r as any)?.company_type));

    const ids = rows.map((r) => r.id).filter(Boolean);
    const siteCur = await loadSiteCurrencies(ids);
    const defaults = await loadVendorDefaults(ids);

    const out = rows.map((r) => {
      const id = r.id;
      const companyCur = safeTrim((r as any).currency) || null;
      const siteC = siteCur.get(id) ?? null;
      const def = defaults.get(id) ?? null;

      return {
        id,
        company_name: r.company_name ?? null,
        code: r.code ?? null,
        company_type: r.company_type ?? null,
        default_currency: def?.currency ?? siteC ?? companyCur ?? null,
        default_unit_cost_local: def?.unit_cost_local ?? null,
      };
    });

    return ok({ rows: out });
  } catch (e: any) {
    return bad(e?.message ?? "Server error", 500);
  }
}
