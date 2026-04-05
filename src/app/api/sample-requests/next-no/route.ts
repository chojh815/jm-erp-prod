import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function asText(v: any) { return v === null || v === undefined ? "" : String(v).trim(); }
function asDate(v: any): string | null { const s = asText(v); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; }
function normalizeBuyerCode(v: any) { const s = asText(v).toUpperCase().replace(/[^A-Z0-9]/g, ""); return s || "GEN"; }
function yymmdd(dateText?: string | null) { const d = asDate(dateText) || new Date().toISOString().slice(0, 10); return `${d.slice(2,4)}${d.slice(5,7)}${d.slice(8,10)}`; }
function seqFromValue(v: any) { const raw = asText(v); const seq = Number(raw.split("-").pop() || 0); return Number.isFinite(seq) ? seq : 0; }

async function generateNo(field: "request_no" | "temp_style_no", prefix: string) {
  const { data, error } = await supabaseAdmin
    .from("sample_requests")
    .select(field)
    .eq("is_deleted", false)
    .ilike(field, `${prefix}%`);
  if (error) throw error;

  let maxSeq = 0;
  for (const row of data || []) {
    const seq = seqFromValue((row as any)?.[field]);
    if (seq > maxSeq) maxSeq = seq;
  }
  return `${prefix}${String(maxSeq + 1).padStart(3, "0")}`;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const buyerCode = normalizeBuyerCode(searchParams.get("buyerCode"));
    const dateCode = yymmdd(searchParams.get("requestDate"));
    const requestPrefix = `SR-${buyerCode}-${dateCode}-`;
    const tempPrefix = `TMP-${buyerCode}-${dateCode}-`;

    const request_no = await generateNo("request_no", requestPrefix);
    const temp_style_no = await generateNo("temp_style_no", tempPrefix);

    return NextResponse.json(
      {
        ok: true,
        buyer_code: buyerCode,
        date_code: dateCode,
        request_no,
        temp_style_no,
        preview_only: true,
        message: "Preview only. Final Request No is assigned again on save.",
      },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Unknown error" },
      { status: 500, headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } }
    );
  }
}
