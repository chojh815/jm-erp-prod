import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type Json = Record<string, any>;

function jsonOk(data: Json, status = 200) {
  return NextResponse.json(data, { status });
}

function jsonErr(error: string, status = 400, extra?: Json) {
  return NextResponse.json({ success: false, error, ...(extra || {}) }, { status });
}

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

function parseCostingIds(body: any): string[] {
  const a: string[] = [];
  const add = (v: any) => {
    if (!v) return;
    if (Array.isArray(v)) {
      for (const x of v) add(x);
      return;
    }
    if (typeof v === "string") a.push(v);
  };

  add(body?.costing_ids);
  add(body?.costingIds);
  add(body?.costing_id);
  add(body?.costingId);

  return uniq(a).filter(Boolean);
}

function parseQtyTiers(body: any): number[] {
  const addNums = (v: any, out: number[]) => {
    if (!v) return;
    if (Array.isArray(v)) {
      for (const x of v) addNums(x, out);
      return;
    }
    const n = Number(String(v).replace(/[^0-9.]/g, ""));
    if (Number.isFinite(n) && n > 0) out.push(Math.round(n));
  };

  const out: number[] = [];
  addNums(body?.moq_tiers, out);

  if (!out.length && typeof body?.moq_tiers_text === "string") {
    for (const part of body.moq_tiers_text.split(/[,\s]+/g)) addNums(part.trim(), out);
  }

  const uniqOut = uniq(out).filter((n) => Number.isFinite(n) && n > 0);
  uniqOut.sort((a, b) => a - b);
  return uniqOut.length ? uniqOut : [100, 500, 1000, 3000];
}

function getAdminSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRole) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function nextQuotationNo(supabase: any) {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const prefix = `Q-${yy}${mm}-`;

  const { data, error } = await supabase
    .from("quotation_headers")
    .select("quotation_no")
    .like("quotation_no", `${prefix}%`)
    .order("quotation_no", { ascending: false })
    .limit(1);

  if (error) throw error;

  let seq = 1;
  const last = data?.[0]?.quotation_no as string | undefined;
  if (last && last.startsWith(prefix)) {
    const tail = last.slice(prefix.length);
    const m = tail.match(/(\d+)$/);
    if (m) seq = Number(m[1]) + 1;
  }

  return `${prefix}${String(seq).padStart(4, "0")}`;
}

/**
 * POST /api/quotations/from-costings
 * body:
 *  - costing_ids: string[] (or costing_id: string)
 *  - moq_tiers: number[] (optional)
 *
 * Creates:
 *  - quotation_headers (quotation_no is required)
 *  - quotation_lines (one base line per costing_id)
 */
export async function POST(req: Request) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {}

  const costingIds = parseCostingIds(body);
  if (!costingIds.length) return jsonErr("costing_ids is required", 400);

  const qtyTiers = parseQtyTiers(body);

  try {
    const supabase = getAdminSupabase();

    // 1) pick basic info from first costing (best-effort, ignore if columns don't exist)
    let firstCosting: any = null;
    let offerUsd: number | null = null;
    try {
      const { data } = await supabase
        .from("costing_headers")
        .select("id, buyer_id, currency, style_no")
        .in("id", [costingIds[0]])
        .maybeSingle();
      firstCosting = data || null;

      // Try to read offer/unit price from costing_headers (column names may differ by version)
      const offerCandidates = [
        "offer_usd",
        "offer_price_usd",
        "offer_price",
        "offer",
        "unit_price_usd",
        "unit_price",
      ];

      for (const col of offerCandidates) {
        try {
          const { data: d } = await supabase
            .from("costing_headers")
            .select(`id, ${col}`)
            .in("id", [costingIds[0]])
            .maybeSingle();
          const v: any = d ? (d as any)[col] : null;
          if (v !== null && v !== undefined && v !== "" && !Number.isNaN(Number(v))) {
            offerUsd = Number(v);
            break;
          }
        } catch {
          // ignore "column does not exist" errors and try next candidate
        }
      }

    } catch {}

    // 2) create header (ONLY columns that are very likely to exist)
    const quotation_no = await nextQuotationNo(supabase);

    const headerInsert: any = {
      quotation_no,
      status: "DRAFT",
    };
    if (firstCosting?.buyer_id) headerInsert.buyer_id = firstCosting.buyer_id;
    if (firstCosting?.currency) headerInsert.currency = firstCosting.currency;

    const { data: header, error: headerErr } = await supabase
      .from("quotation_headers")
      .insert(headerInsert)
      .select("id, quotation_no")
      .single();

    if (headerErr) throw headerErr;

    const quotation_id = header.id as string;

    
    // 3) create quotation_lines (A안: Lines is the canonical base rows)
    //    NOTE: UI reads from quotation_lines (NOT quotation_items).
    //    We create one line per costing_id (each costing represents a style).
    let costingRows: any[] = [];
    try {
      const { data } = await supabase
        .from("costing_headers")
        .select("id, style_no, stage")
        .in("id", costingIds);
      costingRows = Array.isArray(data) ? data : [];
    } catch {
      costingRows = [];
    }

    const byCostingId = new Map<string, any>();
    for (const r of costingRows) {
      if (r?.id) byCostingId.set(String(r.id), r);
    }

    const lineInserts: any[] = [];
    let lineNo = 1;

    for (const costing_id of costingIds) {
      const r = byCostingId.get(String(costing_id)) || {};
      const styleNo = r?.style_no ?? firstCosting?.style_no ?? null;
      const stage = r?.stage ?? null;

      // build insert payload (best-effort columns)
      const rowBase: any = {
        quotation_id,
        line_no: lineNo,
        costing_id,
      };
      if (styleNo) rowBase.style_no = styleNo;
      if (stage) rowBase.stage = stage;

      // costing_version column exists in some schemas; try to include but don't fail if absent
      rowBase.costing_version = 1;

      lineInserts.push(rowBase);
      lineNo += 1;
    }

    // Insert lines with fallback if some columns don't exist
    async function insertLinesWithFallback(rows: any[]) {
      // 1) try full payload
      let { error } = await supabase.from("quotation_lines").insert(rows);
      if (!error) return;

      const msg = String((error as any)?.message || "");
      // If unknown column, progressively remove optional columns and retry
      const tryVariants: ((r: any) => any)[] = [
        // drop stage
        (r) => {
          const x = { ...r };
          delete x.stage;
          return x;
        },
        // drop costing_version
        (r) => {
          const x = { ...r };
          delete x.costing_version;
          return x;
        },
        // drop both stage + costing_version
        (r) => {
          const x = { ...r };
          delete x.stage;
          delete x.costing_version;
          return x;
        },
      ];

      for (const mapper of tryVariants) {
        const mapped = rows.map(mapper);
        const res = await supabase.from("quotation_lines").insert(mapped);
        if (!res.error) return;
        error = res.error as any;
      }

      throw error;
    }

    if (lineInserts.length) {
      await insertLinesWithFallback(lineInserts);
    }

    // 4) update header with costing_id (single) + snapshot_json (best-effort)
    const headerPatch: any = {};
    if (costingIds.length === 1) headerPatch.costing_id = costingIds[0];

    // minimal snapshot (do not depend on costing line tables here)
    headerPatch.snapshot_json = {
      primary_costing_id: costingIds[0],
      costing_ids: costingIds,
      style_nos: costingIds.map((cid) => {
        const r = byCostingId.get(String(cid)) || {};
        return r?.style_no ?? null;
      }),
      offer_usd: offerUsd ?? null,
      qty_tiers: qtyTiers.length ? qtyTiers : null,
      created_at: new Date().toISOString(),
    };

    // best-effort patch (ignore "column does not exist")
    try {
      await supabase.from("quotation_headers").update(headerPatch).eq("id", quotation_id);
    } catch {}

    return jsonOk(
return jsonOk({
      success: true,
      quotation_id,
      quotation_no: header.quotation_no,
      redirect_url: `/quotations/${quotation_id}`,
    });
  } catch (e: any) {
    return jsonErr(e?.message || String(e), 500);
  }
}