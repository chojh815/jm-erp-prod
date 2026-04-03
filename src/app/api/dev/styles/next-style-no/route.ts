// src/app/api/dev/styles/next-style-no/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}

function bad(message: string, status = 400, extra: any = {}) {
  return NextResponse.json(
    { success: false, error: message, ...extra },
    { status }
  );
}

function normalizeCategory(raw: string | null) {
  const v = String(raw ?? "").trim().toUpperCase();
  if (!v) return "N";
  if (v.startsWith("J") && v.length >= 2) return v[1];
  return v[0];
}

function yyNow() {
  return String(new Date().getFullYear()).slice(-2);
}

function pad4(n: number) {
  return String(n).padStart(4, "0");
}

function parseSeq(styleNo: string) {
  const s = String(styleNo ?? "").trim().toUpperCase();
  const m = s.match(/^J([A-Z])(\d{2})(\d{4})[A-Z]?$/);
  if (!m) return null;
  return {
    category: m[1],
    yy: m[2],
    seq: Number(m[3]),
  };
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const rawCategory = url.searchParams.get("category");

    const categoryCode = normalizeCategory(rawCategory);
    const yy = yyNow();
    const prefix = `J${categoryCode}${yy}`;

    // 실제 개발 마스터 테이블에서 마지막 번호를 찾음
    const TABLE = "product_development_headers";
    const COL = "style_no";

    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .select(COL)
      .ilike(COL, `${prefix}%`)
      .order(COL, { ascending: false })
      .limit(20);

    if (error) {
      return bad("DB query failed.", 500, { detail: error.message });
    }

    let nextSeq = 1;

    for (const row of data ?? []) {
      const lastStyleNo = String((row as any)?.[COL] ?? "").trim();
      if (!lastStyleNo) continue;

      const parsed = parseSeq(lastStyleNo);
      if (
        parsed &&
        parsed.category === categoryCode &&
        parsed.yy === yy &&
        Number.isFinite(parsed.seq)
      ) {
        nextSeq = parsed.seq + 1;
        break;
      }
    }

    const styleNo = `${prefix}${pad4(nextSeq)}`;

    return ok({
      styleNo,
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
