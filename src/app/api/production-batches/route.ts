// src/app/api/production-batches/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { makeRedBatchCode } from "@/lib/redBatchCode";

type CreateBody = {
  mfg_date: string; // YYYY-MM-DD
  po_no?: string | null;
  vendor_initial?: string | null; // default J
  label_type?: "M" | "V" | string | null; // default M
  version?: number | null; // OPTIONAL; if omitted => auto next version
};

type UpdatePoBody = {
  id: string;
  po_no: string | null;
};

function jsonError(status: number, message: string, extra?: any) {
  return NextResponse.json({ success: false, message, ...(extra ? { extra } : {}) }, { status });
}

function getSupabase() {
  const cookieStore = cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in env.");
  }

  return createServerClient(url, anon, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set() {},
      remove() {},
    },
  });
}

export async function GET(req: Request) {
  try {
    const supabase = getSupabase();
    const { searchParams } = new URL(req.url);

    const poNo = searchParams.get("po_no");
    const mfgDate = searchParams.get("mfg_date");
    const dateFrom = searchParams.get("date_from");
    const dateTo = searchParams.get("date_to");

    let q = supabase.from("production_batches").select("*").eq("buyer_code", "RED");

    if (poNo) q = q.eq("po_no", poNo);
    if (mfgDate) q = q.eq("mfg_date", mfgDate);
    if (dateFrom) q = q.gte("mfg_date", dateFrom);
    if (dateTo) q = q.lte("mfg_date", dateTo);

    q = q.order("mfg_date", { ascending: false }).order("version", { ascending: false });

    const { data, error } = await q;
    if (error) return jsonError(500, error.message, { code: error.code });

    return NextResponse.json({ success: true, rows: data ?? [] });
  } catch (e: any) {
    console.error("[production-batches GET] FATAL:", e);
    return jsonError(500, e?.message ?? String(e));
  }
}

async function computeNextVersion(args: { mfg_date: string }) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("production_batches")
    .select("version")
    .eq("buyer_code", "RED")
    .eq("mfg_date", args.mfg_date)
    .order("version", { ascending: false })
    .limit(1);

  if (error) throw new Error(error.message);
  const maxV = data && data[0] ? Number(data[0].version) : -1;
  return (Number.isFinite(maxV) ? maxV : -1) + 1;
}

export async function POST(req: Request) {
  try {
    const supabase = getSupabase();

    let body: CreateBody;
    try {
      body = (await req.json()) as CreateBody;
    } catch {
      return jsonError(400, "Invalid JSON body.");
    }

    const mfg_date = (body.mfg_date ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(mfg_date)) {
      return jsonError(400, "mfg_date must be YYYY-MM-DD.");
    }

    const vendorInitial = (body.vendor_initial ?? "J").trim().toUpperCase() || "J";
    const labelType = ((body.label_type ?? "M") as string).trim().toUpperCase() || "M";

    let version: number;
    if (typeof body.version === "number" && Number.isFinite(body.version) && body.version >= 0) {
      version = Math.floor(body.version);
    } else {
      version = await computeNextVersion({ mfg_date });
    }

    const batch_code = makeRedBatchCode({
      vendorInitial,
      mfgDate: mfg_date,
      labelType,
      version,
    });

    const insertRow = {
      buyer_code: "RED" as const,
      mfg_date,
      label_type: labelType,
      version,
      batch_code,
      po_no: body.po_no ?? null,
    };

    const attemptInsert = async (row: any) => {
      return await supabase.from("production_batches").insert(row).select("*").single();
    };

    let { data, error } = await attemptInsert(insertRow);

    if (error && (error.code === "23505" || String(error.message).toLowerCase().includes("duplicate"))) {
      const next = await computeNextVersion({ mfg_date });
      const row2 = {
        ...insertRow,
        version: next,
        batch_code: makeRedBatchCode({ vendorInitial, mfgDate: mfg_date, labelType, version: next }),
      };
      const retry = await attemptInsert(row2);
      data = retry.data;
      error = retry.error;
    }

    if (error) return jsonError(500, error.message, { code: error.code });

    return NextResponse.json({ success: true, row: data });
  } catch (e: any) {
    console.error("[production-batches POST] FATAL:", e);
    return jsonError(500, e?.message ?? String(e));
  }
}

export async function PUT(req: Request) {
  try {
    const supabase = getSupabase();

    let body: UpdatePoBody;
    try {
      body = (await req.json()) as UpdatePoBody;
    } catch {
      return jsonError(400, "Invalid JSON body.");
    }

    const id = (body.id ?? "").trim();
    if (!id) return jsonError(400, "Missing id.");

    const po_no = body.po_no ? String(body.po_no).trim() : null;

    const { data, error } = await supabase
      .from("production_batches")
      .update({ po_no })
      .eq("id", id)
      .eq("buyer_code", "RED")
      .select("*")
      .single();

    // If RLS blocks update, PostgREST can return 200 with empty data in some setups. Guard it.
    if (error) return jsonError(500, error.message, { code: error.code });
    if (!data) return jsonError(404, "Row not updated (not found or no permission).");

    return NextResponse.json({ success: true, row: data });
  } catch (e: any) {
    console.error("[production-batches PUT] FATAL:", e);
    return jsonError(500, e?.message ?? String(e));
  }
}

export async function DELETE(req: Request) {
  try {
    const supabase = getSupabase();
    const { searchParams } = new URL(req.url);

    const id = (searchParams.get("id") ?? "").trim();
    if (!id) return jsonError(400, "Missing id.");

    // IMPORTANT: verify affected rows.
    const { data, error } = await supabase
      .from("production_batches")
      .delete()
      .eq("id", id)
      .eq("buyer_code", "RED")
      .select("id");

    if (error) return jsonError(500, error.message, { code: error.code });

    if (!data || data.length === 0) {
      return jsonError(404, "Row not deleted (not found or no permission).", { hint: "Check Supabase RLS for DELETE." });
    }

    return NextResponse.json({ success: true, deleted_ids: data.map((x) => x.id) });
  } catch (e: any) {
    console.error("[production-batches DELETE] FATAL:", e);
    return jsonError(500, e?.message ?? String(e));
  }
}
