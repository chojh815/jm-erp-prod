// src/app/api/dev/styles/next-style-no/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Response helpers
 */
function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}
function bad(message: string, status = 400, extra: any = {}) {
  return NextResponse.json(
    { success: false, error: message, ...extra },
    { status }
  );
}

/**
 * Normalize category input
 * - "E"  -> "E"
 * - "JE" -> "E"
 * - "JN" -> "N"
 */
function normalizeCategory(raw: string | null) {
  const v = (raw ?? "").toString().trim().toUpperCase();
  if (!v) return "N";
  if (v.startsWith("J") && v.length >= 2) return v[1];
  return v[0];
}

/**
 * Current year (YY)
 */
function yyNow() {
  return String(new Date().getFullYear()).slice(-2);
}

/**
 * Pad sequence to 4 digits
 */
function pad4(n: number) {
  return String(n).padStart(4, "0");
}

/**
 * Parse style_no from DB
 * Expected:
 *   JN250001
 *   JE260123A
 */
function parseSeq(styleNo: string) {
  const s = styleNo.trim().toUpperCase();
  const m = s.match(/^J([A-Z])(\d{2})(\d{4})/);
  if (!m) return null;
  return {
    category: m[1],
    yy: m[2],
    seq: Number(m[3]),
  };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const rawCategory = url.searchParams.get("category");

    const categoryCode = normalizeCategory(rawCategory); // E, N, B...
    const yy = yyNow();
    const prefix = `J${categoryCode}${yy}`; // ex) JE26

    /**
     * ⚠️ DB 정보 (그대로 유지)
     */
    const TABLE = "product_development_products";
    const COL = "style_no";

    /**
     * Get last style_no with same prefix
     */
    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .select(COL)
      .ilike(COL, `${prefix}%`)
      .order(COL, { ascending: false })
      .limit(1);

    if (error) {
      return bad("DB query failed.", 500, { detail: error.message });
    }

    let nextSeq = 1;

    const lastStyleNo = data?.[0]?.[COL] as string | undefined;
    if (lastStyleNo) {
      const parsed = parseSeq(lastStyleNo);
      if (
        parsed &&
        parsed.category === categoryCode &&
        parsed.yy === yy &&
        Number.isFinite(parsed.seq)
      ) {
        nextSeq = parsed.seq + 1;
      }
    }

    const styleNo = `${prefix}${pad4(nextSeq)}`;

    /**
     * ✅ camelCase 응답으로 통일
     * (프론트에서 json.styleNo 만 쓰면 됨)
     */
    return ok({
      styleNo,           // ⭐ 핵심
      prefix,
      seq: nextSeq,
      categoryCode,
    });
  } catch (e: any) {
    return bad("Unexpected error while generating style number.", 500, {
      detail: e?.message ?? String(e),
    });
  }
}
