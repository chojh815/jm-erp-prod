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
 * - q: search by po_no / buyer_name / buyer_code / work_sheet_no (ws_no)
 *      + buyer_style_no (header) + buyer_style (line)
 *      + jm_style_no (line)
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

    // --- If q includes style keywords, we also search lines (buyer_style / jm_style_no) ---
    let styleMatchWsIds: string[] = [];
    if (qRaw) {
      const q = qRaw.replace(/,/g, " ").trim();

      // 1) Header-side search (PO / Buyer / Code / WS No / Buyer Style No)
      query = query.or(
        `po_no.ilike.%${q}%,buyer_name.ilike.%${q}%,buyer_code.ilike.%${q}%,work_sheet_no.ilike.%${q}%,ws_no.ilike.%${q}%,buyer_style_no.ilike.%${q}%`
      );

      // 2) Line-side search (Buyer Style / JM Style)
      // NOTE: We do this in a separate query and merge in-memory for simplicity & safety.
      const { data: lineHits, error: lineHitErr } = await supabaseAdmin
        .from("work_sheet_lines")
        .select("work_sheet_id")
        .eq("is_deleted", false)
        .or(`buyer_style.ilike.%${q}%,jm_style_no.ilike.%${q}%`)
        .limit(500);

      if (!lineHitErr && Array.isArray(lineHits)) {
        styleMatchWsIds = Array.from(
          new Set(
            lineHits
              .map((x: any) => safeTrim(x?.work_sheet_id))
              .filter((x: string) => x)
          )
        );
      }
    }

    const { data, error } = await query
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) return bad(error.message, 500);

    let rows: any[] = Array.isArray(data) ? data : [];

    // Merge-in rows that matched only on line-side style search.
    if (qRaw && styleMatchWsIds.length > 0) {
      const existing = new Set(rows.map((r: any) => safeTrim(r?.id)).filter(Boolean));
      const missingIds = styleMatchWsIds.filter((id) => !existing.has(id));
      if (missingIds.length > 0) {
        const { data: more, error: moreErr } = await supabaseAdmin
          .from("work_sheet_headers")
          .select("*")
          .eq("is_deleted", false)
          .in("id", missingIds)
          .order("created_at", { ascending: false })
          .limit(500);
        if (!moreErr && Array.isArray(more) && more.length > 0) {
          rows = [...rows, ...more];
          // keep newest first
          rows.sort((a: any, b: any) => {
            const ta = new Date(a?.created_at ?? 0).getTime();
            const tb = new Date(b?.created_at ?? 0).getTime();
            return tb - ta;
          });
        }
      }
    }

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

    // --- Attach line-derived fields for list display (style/qty/lp/mode) ---
    const wsIds = Array.from(
      new Set(out.map((r: any) => safeTrim(r?.id)).filter((x: string) => x))
    );

    // Aggregate per WS because one PO can have multiple lines/styles
    let aggMap = new Map<
      string,
      {
        qty: number;
        buyer_style: string | null;
        jm_style: string | null;
        lp_unit: number | null;
        lp_currency: string | null;
        production_mode: string | null;
        vendor_id: string | null;
      }
    >();
    if (wsIds.length > 0) {
      const { data: lines, error: lErr } = await supabaseAdmin
        .from("work_sheet_lines")
        .select(
          "work_sheet_id, jm_style_no, buyer_style, qty, vendor_id, vendor_currency, vendor_unit_cost_local, production_mode, created_at, is_deleted"
        )
        // older rows can have is_deleted NULL -> treat as not deleted
        .or("is_deleted.is.null,is_deleted.eq.false")
        .in("work_sheet_id", wsIds)
        .order("created_at", { ascending: true })
        .limit(2000);

      if (!lErr && Array.isArray(lines)) {
        for (const ln of lines) {
          const wid = safeTrim((ln as any)?.work_sheet_id);
          if (!wid) continue;

          const cur =
            aggMap.get(wid) ??
            {
              qty: 0,
              buyer_style: null,
              jm_style: null,
              lp_unit: null,
              lp_currency: null,
              production_mode: null,
              vendor_id: null,
            };

          const qn =
            typeof (ln as any)?.qty === "number"
              ? (ln as any).qty
              : Number((ln as any)?.qty);
          if (Number.isFinite(qn)) cur.qty += qn;

          const bs = safeTrim((ln as any)?.buyer_style);
          if (!cur.buyer_style && bs) cur.buyer_style = bs;

          const js = safeTrim((ln as any)?.jm_style_no);
          if (!cur.jm_style && js) cur.jm_style = js;

          const vid = safeTrim((ln as any)?.vendor_id);
          if (!cur.vendor_id && vid) cur.vendor_id = vid;

          const lp =
            typeof (ln as any)?.vendor_unit_cost_local === "number"
              ? (ln as any).vendor_unit_cost_local
              : Number((ln as any)?.vendor_unit_cost_local);
          if (cur.lp_unit == null && Number.isFinite(lp)) {
            cur.lp_unit = lp;
            const c = safeTrim((ln as any)?.vendor_currency);
            // If currency missing but LP exists, default to CNY (your vendor majority)
            cur.lp_currency = c || "CNY";
          }

          const pm = safeTrim((ln as any)?.production_mode);
          if (!cur.production_mode && pm) cur.production_mode = pm;

          aggMap.set(wid, cur);
        }
      }
    }

    // Provide camelCase aliases + derived list fields
    const normalized = out.map((r: any) => {
      const a = aggMap.get(safeTrim(r?.id)) || null;

      const wsNo = safeTrim(r?.work_sheet_no) || safeTrim(r?.ws_no) || null;
      const buyerStyle =
        safeTrim(r?.buyer_style_no) || safeTrim(a?.buyer_style) || null;
      const jmStyle = safeTrim(a?.jm_style) || null;
      const qty = a ? a.qty : null;

      const modeRaw = safeTrim(a?.production_mode) || safeTrim(r?.production_mode) || "";
      const mode = modeRaw || (a?.vendor_id ? "OUTSOURCED" : "IN_HOUSE");

      const lpUnit =
        typeof (a as any)?.lp_unit === "number"
          ? (a as any).lp_unit
          : typeof r?.vendor_unit_cost_local === "number"
            ? r.vendor_unit_cost_local
            : null;

      const lpCurRaw =
        safeTrim((a as any)?.lp_currency) || safeTrim(r?.vendor_currency) || "";
      // If currency missing but LP exists, default to CNY (avoid silently forcing USD)
      const lpCur = lpCurRaw || (lpUnit != null ? "CNY" : "");

      const delivery = safeTrim(r?.requested_ship_date) || null;

      return {
        ...r,
        // camel
        poNo: r.po_no,
        buyerName: r.buyer_name,
        buyerCode: r.buyer_code,
        createdAt: r.created_at,
        updatedAt: r.updated_at,

        // list-friendly derived fields
        ws_no: wsNo,
        buyer_style: buyerStyle,
        jm_style: jmStyle,
        qty,
        lp_currency: lpCur || null,
        lp_unit: lpUnit,
        production_mode: mode,
        delivery_date: delivery,
      };
    });

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
