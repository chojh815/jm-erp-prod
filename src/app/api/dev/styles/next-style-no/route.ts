// src/app/api/dev/styles/next-style-no/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}
function bad(message: string, status = 400, extra: any = {}) {
  return NextResponse.json({ success: false, error: message, ...extra }, { status });
}

/**
 * category/prefix 입력을 최대한 관대하게 처리:
 * - "Keyring (JK)" -> "JK"
 * - "JK" -> "JK"
 * - "K" -> "JK" (단일 문자면 "J" + 문자)
 * - "Hair (JH)" -> "JH"
 */
function normalizePrefix(input?: string | null) {
  const raw = String(input ?? "").trim();
  if (!raw) return "";

  // 괄호 안의 2글자 prefix 우선 추출: "Keyring (JK)" -> "JK"
  const m = raw.match(/\(([A-Za-z]{2})\)/);
  if (m?.[1]) return m[1].toUpperCase();

  // 이미 2글자면 그대로
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();

  // 1글자면 "J" + 글자 (N -> JN, K -> JK)
  if (/^[A-Za-z]{1}$/.test(raw)) return `J${raw}`.toUpperCase();

  // 앞 2글자라도 추정
  const guess = raw.replace(/[^A-Za-z]/g, "").slice(0, 2);
  return guess.toUpperCase();
}

function yearSuffix2(d: Date) {
  // 2025 -> "25"
  return String(d.getFullYear()).slice(-2);
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    // 프론트에서 category=... 또는 prefix=... 어느 쪽으로 보내도 받게 함
    const category = url.searchParams.get("category");
    const prefixParam = url.searchParams.get("prefix");
    const prefix = normalizePrefix(prefixParam || category);

    if (!prefix) {
      return bad(`Missing prefix/category (expected like JK or 'Keyring (JK)')`, 400);
    }
    if (!/^[A-Z]{2}$/.test(prefix)) {
      return bad(`Invalid prefix '${prefix}' (expected 2 letters like JK/JN/JH)`, 400);
    }

    const now = new Date();
    const yy = yearSuffix2(now); // "25"
    const base = `${prefix}${yy}`; // "JK25"

    // ✅ 여기서부터가 핵심: dev_products의 실제 스타일 컬럼명 사용
    // 대부분 dev_products에는 jm_style_no가 있습니다 (당신 스키마 화면 기준).
    const styleCol = "jm_style_no";

    const { data, error } = await supabaseAdmin
      .from("dev_products")
      .select(styleCol)
      .ilike(styleCol, `${base}%`)
      .order(styleCol, { ascending: false })
      .limit(1);

    if (error) {
      console.error("next-style-no DB error:", error);
      return bad("DB error", 500, { detail: error.message });
    }

    let nextSerial = 1;

    const lastVal = data?.[0]?.[styleCol];
    if (lastVal) {
      const last = String(lastVal);
      const numericPart = last.slice(base.length); // 뒤 4자리
      const parsed = parseInt(numericPart, 10);
      if (!Number.isNaN(parsed)) nextSerial = parsed + 1;
    }

    const serialStr = String(nextSerial).padStart(4, "0"); // "0001"
    const styleNo = `${base}${serialStr}`; // "JK250001"

    return ok({ prefix, base, styleNo });
  } catch (e: any) {
    console.error(e);
    return bad("Server error", 500, { detail: e?.message || String(e) });
  }
}
