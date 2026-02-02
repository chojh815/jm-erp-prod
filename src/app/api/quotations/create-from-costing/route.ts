import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type Json = Record<string, any>;

function jsonOk(data: Json, status = 200) {
  return NextResponse.json(data, { status });
}
function jsonErr(error: string, status = 400, extra?: Json) {
  return NextResponse.json({ ok: false, error, ...(extra || {}) }, { status });
}

function getAdminSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function nextQuotationNo(supabase: any) {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const prefix = `QUO-${yy}-`;

  const { data, error } = await supabase
    .from("quotation_headers")
    .select("quotation_no")
    .like("quotation_no", `${prefix}%`)
    .order("quotation_no", { ascending: false })
    .limit(1);

  if (error) throw error;

  let seq = 1;
  const last = (data?.[0]?.quotation_no as string | undefined) || "";
  if (last && last.startsWith(prefix)) {
    const tail = last.slice(prefix.length);
    const m = tail.match(/(\d+)$/);
    if (m) seq = Number(m[1]) + 1;
  }
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

/**
 * POST /api/quotations/create-from-costing
 *
 * Body:
 *  - costing_id | costingId : UUID (preferred)
 *  - style_no | styleNo : string (fallback: partial match on costing_headers.style_no)
 *
 * Creates:
 *  - quotation_headers
 *  - quotation_lines (A안: UI가 조회하는 base lines)
 *
 * DB NOTE:
 *  - costing_headers.costing_version 컬럼이 없을 수 있음 => 절대 조회하지 않음
 *  - quotation_lines.qty 가 NOT NULL 인 스키마가 있음 => 기본 qty=1로 생성
 */
export async function POST(req: Request) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {}

  const inputCostingId =
    (typeof body?.costing_id === "string" && body.costing_id) ||
    (typeof body?.costingId === "string" && body.costingId) ||
    null;

  const inputStyle =
    (typeof body?.style_no === "string" && body.style_no.trim()) ||
    (typeof body?.styleNo === "string" && body.styleNo.trim()) ||
    (typeof body?.query === "string" && body.query.trim()) ||
    null;

  const supabase = getAdminSupabase();

  // 1) Resolve costing (NO costing_version read)
  let costing: { id: string; style_no?: string | null } | null = null;

  if (inputCostingId) {
    const { data, error } = await supabase
      .from("costing_headers")
      .select("id, style_no")
      .eq("id", inputCostingId)
      .limit(1)
      .maybeSingle();
    if (error) return jsonErr(error.message, 500);
    if (!data) return jsonErr("Costing not found", 404, { costing_id: inputCostingId });
    costing = data as any;
  } else if (inputStyle) {
    const { data, error } = await supabase
      .from("costing_headers")
      .select("id, style_no, created_at")
      .ilike("style_no", `%${inputStyle}%`)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) return jsonErr(error.message, 500);
    const row = data?.[0];
    if (!row) return jsonErr("Costing not found by style_no", 404, { style_no: inputStyle });
    costing = row as any;
  } else {
    return jsonErr("costing_id (or style_no) is required", 400);
  }

  const costing_id = costing!.id;
  const style_no = (costing!.style_no ?? inputStyle ?? null) as string | null;

  // default values (safe)
  const costing_version = 1;
  const qtyDefault = 1;

  // 2) Create quotation header
  let quotation_no: string;
  try {
    quotation_no = await nextQuotationNo(supabase);
  } catch (e: any) {
    return jsonErr(String(e?.message || e), 500);
  }

  const headerInsert: any = {
    quotation_no,
    costing_id,
    status: "DRAFT",
  };

  const { data: headerData, error: headerErr } = await supabase
    .from("quotation_headers")
    .insert(headerInsert)
    .select("id")
    .single();

  if (headerErr) return jsonErr(headerErr.message, 500);

  const quotation_id = headerData.id as string;

  // 3) Create quotation_lines (A안)
  const tryInsert = async (payload: any) => await supabase.from("quotation_lines").insert(payload);

  // Attempt 1: include common columns (style_no, costing_id, costing_version, qty)
  const full: any = {
    quotation_id,
    line_no: 1,
    costing_id,
    costing_version,
    style_no,
    qty: qtyDefault,
  };

  const { error: e1 } = await tryInsert(full);
  if (e1) {
    // Attempt 2: minimal but satisfies NOT NULL qty
    const minimal: any = {
      quotation_id,
      line_no: 1,
      costing_id,
      style_no,
      qty: qtyDefault,
    };
    const { error: e2 } = await tryInsert(minimal);
    if (e2) return jsonErr(`Failed to create quotation_lines: ${e1.message} | ${e2.message}`, 500);
  }

  return jsonOk(
    {
      ok: true,
      quotation_id,
      quotation_no,
      costing_id,
      style_no: style_no ?? inputStyle ?? null,
    },
    200
  );
}
