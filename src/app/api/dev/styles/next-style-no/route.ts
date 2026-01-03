// src/app/api/dev/styles/next-style-no/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}
function bad(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function safeTrim(v: any) {
  return (v ?? "").toString().trim();
}

function resolveCategoryCode(raw: string) {
  const v = safeTrim(raw).toUpperCase();

  // 이미 N/E/B/H 같은 코드면 그대로
  if (["N", "E", "B", "H", "A", "R"].includes(v)) return v;

  // 텍스트면 매핑 (필요시 추가)
  if (v.includes("NECK")) return "N";
  if (v.includes("EARR")) return "E";
  if (v.includes("BRAC")) return "B";
  if (v.includes("HAIR")) return "H";
  if (v.includes("ANK")) return "A";
  if (v.includes("RING")) return "R";

  // 기본값
  return "N";
}

/**
 * Generates next JM style no:
 *  - Format: J{CategoryCode}{YY}{SEQ4}
 *  - Example: JN250001
 *
 * Query params accepted:
 *  - category / category_code / code : "Necklace" | "N" | ...
 */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;

    const categoryRaw =
      sp.get("category") || sp.get("category_code") || sp.get("code") || "N";
    const catCode = resolveCategoryCode(categoryRaw);

    const yy = new Date().getFullYear().toString().slice(-2);
    const basePrefix = `J${catCode}${yy}`; // e.g. JN25

    // ✅ 여러 테이블/컬럼 fallback (환경마다 다를 수 있어서)
    const candidateTables = [
      { table: "product_development_products", col: "style_no" },
      { table: "product_development_products", col: "jm_style_no" },
      { table: "dev_products", col: "style_no" },
      { table: "products", col: "style_no" },
    ];

    let lastStyleNo: string | null = null;

    for (const c of candidateTables) {
      const { data, error } = await supabaseAdmin
        .from(c.table)
        .select(c.col)
        .ilike(c.col, `${basePrefix}%`)
        .order(c.col, { ascending: false })
        .limit(1);

      if (error) {
        // 테이블/컬럼이 없을 수 있으니 무시하고 다음 후보로
        continue;
      }

      const row = data?.[0] as any;
      const v = row?.[c.col];
      if (v) {
        lastStyleNo = v.toString();
        break;
      }
    }

    // lastStyleNo 예: JN250123
    let nextSeq = 1;
    if (lastStyleNo && lastStyleNo.startsWith(basePrefix)) {
      const tail = lastStyleNo.slice(basePrefix.length); // "0123"
      const n = Number(tail);
      if (!Number.isNaN(n) && n >= 0) nextSeq = n + 1;
    }

    const nextStyleNo = `${basePrefix}${String(nextSeq).padStart(4, "0")}`;

    return ok({
      style_no: nextStyleNo,
      prefix: basePrefix,
      seq: nextSeq,
      category_code: catCode,
    });
  } catch (e: any) {
    return bad(e?.message || "Failed to generate next style no", 500);
  }
}
