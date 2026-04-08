/**
 * src/app/api/work-sheets/list/route.ts
 *
 * Fixes:
 * 1) Qty fallback: prefer aggregated work_sheet_lines.qty, but if 0/null use po_lines qty
 * 2) Better de-dupe: prefer rows with ws_no and qty > 0 before falling back to newest created_at
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

    let styleMatchWsIds: string[] = [];
    if (qRaw) {
      const q = qRaw.replace(/,/g, " ").trim();

      query = query.or(
        `po_no.ilike.%${q}%,buyer_name.ilike.%${q}%,buyer_code.ilike.%${q}%,work_sheet_no.ilike.%${q}%,ws_no.ilike.%${q}%,buyer_style_no.ilike.%${q}%`
      );

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
          rows.sort((a: any, b: any) => {
            const ta = new Date(a?.created_at ?? 0).getTime();
            const tb = new Date(b?.created_at ?? 0).getTime();
            return tb - ta;
          });
        }
      }
    }

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
            if (!key) return true;
            return alive.has(key);
          });
        }
      }
    } catch {}

    const need = rows.filter((r: any) => {
      const hasBuyerId = !!r?.buyer_id;
      const missName = !safeTrim(r?.buyer_name);
      const missCode = !safeTrim(r?.buyer_code);
      return hasBuyerId && (missName || missCode);
    });

    if (need.length > 0) {
      const buyerIds = Array.from(new Set(need.map((r: any) => r.buyer_id).filter(Boolean)));
      const { data: comps, error: cErr } = await supabaseAdmin
        .from("companies")
        .select("id, company_name, code")
        .in("id", buyerIds);

      if (!cErr && Array.isArray(comps)) {
        const map = new Map<string, any>();
        for (const c of comps) map.set((c as any).id, c);

        for (const r of rows) {
          const c = r?.buyer_id ? map.get(r.buyer_id) : null;
          if (!c) continue;
          if (!safeTrim(r.buyer_name)) r.buyer_name = (c as any).company_name ?? r.buyer_name;
          if (!safeTrim(r.buyer_code)) r.buyer_code = (c as any).code ?? r.buyer_code;
        }
      }
    }

    if (!includeEmpty) {
      rows = rows.filter((r: any) => {
        const poNo = safeTrim(r?.po_no);
        const buyerId = safeTrim(r?.buyer_id);
        if (!poNo) return false;
        if (!buyerId) return false;
        return true;
      });
    }

    // Aggregate line-derived fields
    const wsIds = Array.from(new Set(rows.map((r: any) => safeTrim(r?.id)).filter((x: string) => x)));

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
        .select("work_sheet_id, po_line_id, jm_style_no, buyer_style, qty, vendor_id, vendor_currency, vendor_unit_cost_local, production_mode, created_at, is_deleted")
        .or("is_deleted.is.null,is_deleted.eq.false")
        .in("work_sheet_id", wsIds)
        .order("created_at", { ascending: true })
        .limit(4000);

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

          const qn = typeof (ln as any)?.qty === "number" ? (ln as any).qty : Number((ln as any)?.qty);
          if (Number.isFinite(qn)) cur.qty += qn;

          const bs = safeTrim((ln as any)?.buyer_style);
          if (!cur.buyer_style && bs) cur.buyer_style = bs;

          const js = safeTrim((ln as any)?.jm_style_no);
          if (!cur.jm_style && js) cur.jm_style = js;

          const vid = safeTrim((ln as any)?.vendor_id);
          if (!cur.vendor_id && vid) cur.vendor_id = vid;

          const lp = typeof (ln as any)?.vendor_unit_cost_local === "number"
            ? (ln as any).vendor_unit_cost_local
            : Number((ln as any)?.vendor_unit_cost_local);
          if (cur.lp_unit == null && Number.isFinite(lp)) {
            cur.lp_unit = lp;
            const c = safeTrim((ln as any)?.vendor_currency);
            cur.lp_currency = c || "CNY";
          }

          const pm = safeTrim((ln as any)?.production_mode);
          if (!cur.production_mode && pm) cur.production_mode = pm;

          aggMap.set(wid, cur);
        }
      }
    }

    // PO qty fallback by header.po_line_id / header.po_header_id
    const poLineIds = Array.from(new Set(rows.map((r: any) => safeTrim(r?.po_line_id)).filter(Boolean)));
    const poHeaderIds = Array.from(new Set(rows.map((r: any) => safeTrim(r?.po_header_id)).filter(Boolean)));

    const poLineQtyMap = new Map<string, number>();
    if (poLineIds.length > 0) {
      const { data: poLines } = await supabaseAdmin
        .from("po_lines")
        .select("id, qty")
        .in("id", poLineIds);
      for (const pl of poLines ?? []) {
        const id = safeTrim((pl as any)?.id);
        const q = Number((pl as any)?.qty);
        if (id && Number.isFinite(q)) poLineQtyMap.set(id, q);
      }
    }

    const poHeaderQtyMap = new Map<string, number>();
    if (poHeaderIds.length > 0) {
      const { data: poLinesByHeader } = await supabaseAdmin
        .from("po_lines")
        .select("po_header_id, qty, is_deleted")
        .in("po_header_id", poHeaderIds);
      for (const pl of poLinesByHeader ?? []) {
        if ((pl as any)?.is_deleted === true) continue;
        const hid = safeTrim((pl as any)?.po_header_id);
        const q = Number((pl as any)?.qty);
        if (!hid || !Number.isFinite(q)) continue;
        poHeaderQtyMap.set(hid, (poHeaderQtyMap.get(hid) ?? 0) + q);
      }
    }

    const normalizedAll = rows.map((r: any) => {
      const a = aggMap.get(safeTrim(r?.id)) || null;
      const wsNo = safeTrim(r?.work_sheet_no) || safeTrim(r?.ws_no) || null;
      const buyerStyle = safeTrim(r?.buyer_style_no) || safeTrim(a?.buyer_style) || null;
      const jmStyle = safeTrim(a?.jm_style) || null;

      const aggQty = a ? a.qty : null;
      const poLineQty = poLineQtyMap.get(safeTrim(r?.po_line_id)) ?? null;
      const poHeaderQty = poHeaderQtyMap.get(safeTrim(r?.po_header_id)) ?? null;
      const qty =
        typeof aggQty === "number" && aggQty > 0
          ? aggQty
          : typeof poLineQty === "number" && poLineQty > 0
          ? poLineQty
          : typeof poHeaderQty === "number" && poHeaderQty > 0
          ? poHeaderQty
          : 0;

      const modeRaw = safeTrim(a?.production_mode) || safeTrim(r?.production_mode) || "";
      const mode = modeRaw || (a?.vendor_id ? "OUTSOURCED" : "IN_HOUSE");

      const lpUnit =
        typeof (a as any)?.lp_unit === "number"
          ? (a as any).lp_unit
          : typeof r?.vendor_unit_cost_local === "number"
          ? r.vendor_unit_cost_local
          : null;

      const lpCurRaw = safeTrim((a as any)?.lp_currency) || safeTrim(r?.vendor_currency) || "";
      const lpCur = lpCurRaw || (lpUnit != null ? "CNY" : "");
      const delivery = safeTrim(r?.requested_ship_date) || null;

      const completenessScore =
        (wsNo ? 100 : 0) +
        (qty > 0 ? 50 : 0) +
        (safeTrim(jmStyle) ? 10 : 0) +
        (safeTrim(buyerStyle) ? 5 : 0);

      return {
        ...r,
        ws_no: wsNo,
        buyer_style: buyerStyle,
        jm_style: jmStyle,
        qty,
        lp_currency: lpCur || null,
        lp_unit: lpUnit,
        production_mode: mode,
        delivery_date: delivery,
        _score: completenessScore,
      };
    });

    let out = normalizedAll;
    if (!all) {
      const grouped = new Map<string, any[]>();
      for (const r of normalizedAll) {
        const key = safeTrim(r?.po_no);
        if (!key) continue;
        const arr = grouped.get(key) ?? [];
        arr.push(r);
        grouped.set(key, arr);
      }
      const deduped: any[] = [];
      for (const [, arr] of grouped) {
        arr.sort((a: any, b: any) => {
          const sa = Number(a?._score ?? 0);
          const sb = Number(b?._score ?? 0);
          if (sb !== sa) return sb - sa;
          const ta = new Date(a?.updated_at ?? a?.created_at ?? 0).getTime();
          const tb = new Date(b?.updated_at ?? b?.created_at ?? 0).getTime();
          return tb - ta;
        });
        deduped.push(arr[0]);
      }
      deduped.sort((a: any, b: any) => {
        const ta = new Date(a?.updated_at ?? a?.created_at ?? 0).getTime();
        const tb = new Date(b?.updated_at ?? b?.created_at ?? 0).getTime();
        return tb - ta;
      });
      out = deduped;
    }

    const finalRows = out.map(({ _score, ...r }: any) => r);

    const debug = debugOn
      ? {
          has_service_role: hasServiceRoleEnv(),
          node_env: process.env.NODE_ENV ?? null,
          supabase_url_set: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
          supabase_anon_set: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
          now: new Date().toISOString(),
        }
      : undefined;

    return ok({ rows: finalRows, total: finalRows.length, ...(debugOn ? { debug } : {}) });
  } catch (e: any) {
    console.error(e);
    return bad(e?.message ?? "Server error", 500);
  }
}
