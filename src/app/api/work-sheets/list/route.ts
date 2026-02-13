/**
 * src/app/api/work-sheets/list/route.ts
 *
 * Goals:
 * 1) Never reference optional/missing columns directly (ex: ws_no) -> avoid 500
 * 2) buyer_name / buyer_code backfill using buyer_id -> companies (and optionally patch DB)
 * 3) Avoid showing duplicate PO rows in list (default: keep latest row per po_no)
 * 4) IMPORTANT: Hide work sheets whose PO has been soft-deleted (po_headers.is_deleted=true)
 *    or status=DELETED (if you use status as a delete marker too).
 * 5) IMPORTANT: Hide "broken" rows (missing po_no / buyer_id) so UI won't show '-' rows.
 *
 * Query params:
 * - q: search by po_no / buyer_name / buyer_code
 * - status: ALL | DRAFT | ... (case-insensitive)
 * - all=1 : return all rows (no dedupe)
 * - include_empty=1 : include rows with missing po_no/buyer_id (default: hidden)
 * - debug=1 : include debug flags to compare local/prod env
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}
function bad(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function safeTrim(v: any) {
  return (v ?? "").toString().trim();
}

function hasServiceRoleEnv() {
  const v = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  return !!v && safeTrim(v).length >= 30;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const qRaw = safeTrim(searchParams.get("q"));
    const status = safeTrim(searchParams.get("status")).toUpperCase();
    const all = safeTrim(searchParams.get("all")) === "1";
    const includeEmpty = safeTrim(searchParams.get("include_empty")) === "1";
    const debugOn = safeTrim(searchParams.get("debug")) === "1";

    let query = supabaseAdmin
      .from("work_sheet_headers")
      .select("*")
      .eq("is_deleted", false);

    if (status && status !== "ALL") {
      query = query.eq("status", status);
    }

    if (qRaw) {
      // Keep it simple: search stable columns only.
      const q = qRaw.replace(/,/g, " ").trim();
      query = query.or(
        `po_no.ilike.%${q}%,buyer_name.ilike.%${q}%,buyer_code.ilike.%${q}%`
      );
    }

    const { data, error } = await query
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) return bad(error.message, 500);

    let rows: any[] = Array.isArray(data) ? data : [];

    // --- NEW: Filter out rows whose PO is deleted ---
    try {
      const poNos = Array.from(
        new Set(
          rows
            .map((r: any) => safeTrim(r?.po_no))
            .filter((x: string) => x)
        )
      );

      if (poNos.length > 0) {
        const { data: pos, error: poErr } = await supabaseAdmin
          .from("po_headers")
          .select("po_no, is_deleted, status")
          .in("po_no", poNos);

        if (!poErr && Array.isArray(pos)) {
          const alive = new Set<string>();
          for (const p of pos) {
            const poNo = safeTrim((p as any)?.po_no);
            const isDel = !!(p as any)?.is_deleted;
            const st = safeTrim((p as any)?.status).toUpperCase();
            if (!poNo) continue;
            if (isDel) continue;
            if (st === "DELETED") continue;
            alive.add(poNo);
          }

          rows = rows.filter((r: any) => {
            const key = safeTrim(r?.po_no);
            if (!key) return true; // handled later by includeEmpty flag
            return alive.has(key);
          });
        }
      }
    } catch {
      // do not break
    }

    // --- buyer_name / buyer_code backfill (response + optional DB patch) ---
    const need = rows.filter((r: any) => {
      const hasBuyerId = !!r?.buyer_id;
      const missName = !safeTrim(r?.buyer_name);
      const missCode = !safeTrim(r?.buyer_code);
      return hasBuyerId && (missName || missCode);
    });

    if (need.length > 0) {
      const buyerIds = Array.from(
        new Set(need.map((r: any) => r.buyer_id).filter(Boolean))
      );

      const { data: comps, error: cErr } = await supabaseAdmin
        .from("companies")
        .select("id, company_name, code")
        .in("id", buyerIds);

      if (!cErr && Array.isArray(comps)) {
        const map = new Map<string, any>();
        for (const c of comps) map.set((c as any).id, c);

        // patch in-memory
        for (const r of rows) {
          const c = r?.buyer_id ? map.get(r.buyer_id) : null;
          if (!c) continue;
          if (!safeTrim(r.buyer_name)) r.buyer_name = (c as any).company_name ?? r.buyer_name;
          if (!safeTrim(r.buyer_code)) r.buyer_code = (c as any).code ?? r.buyer_code;
        }

        // Optional DB backfill (small batch) — updates only rows that were missing.
        const toUpdate = rows
          .filter((r: any) => r?.id && need.some((n: any) => n.id === r.id))
          .slice(0, 50);

        for (const r of toUpdate) {
          await supabaseAdmin
            .from("work_sheet_headers")
            .update({
              buyer_name: safeTrim(r.buyer_name) ? r.buyer_name : null,
              buyer_code: safeTrim(r.buyer_code) ? r.buyer_code : null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", r.id);
        }
      }
    }

    // --- Hide broken rows (missing po_no / buyer_id) unless include_empty=1 ---
    if (!includeEmpty) {
      rows = rows.filter((r: any) => {
        const poNo = safeTrim(r?.po_no);
        const buyerId = safeTrim(r?.buyer_id);
        // poNo + buyerId are minimum requirements to render a meaningful list row
        if (!poNo) return false;
        if (!buyerId) return false;
        return true;
      });
    }

    // --- De-dupe by po_no (default: keep latest row per po_no) ---
    let out = rows;
    if (!all) {
      const seen = new Set<string>();
      const deduped: any[] = [];
      for (const r of rows) {
        const key = safeTrim(r?.po_no);
        if (!key) continue; // if includeEmpty=1, still don't dedupe on empty keys
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(r);
      }
      out = deduped;
    }

    // Provide camelCase aliases too (helps if UI accidentally expects camelCase)
    const normalized = out.map((r: any) => ({
      ...r,
      poNo: r.po_no,
      buyerName: r.buyer_name,
      buyerCode: r.buyer_code,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    const debug = debugOn
      ? {
          has_service_role: hasServiceRoleEnv(),
          node_env: process.env.NODE_ENV ?? null,
          supabase_url_set: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
          supabase_anon_set: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
          now: new Date().toISOString(),
        }
      : undefined;

    return ok({ rows: normalized, total: normalized.length, ...(debugOn ? { debug } : {}) });
  } catch (e: any) {
    console.error(e);
    return bad(e?.message ?? "Server error", 500);
  }
}
