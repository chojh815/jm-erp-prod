/**
 * src/app/api/fx/management/route.ts
 *
 * GET  /api/fx/management?quote=CNY
 *   - quote 없으면: active 목록 + 최근 히스토리 일부 반환
 *
 * POST /api/fx/management
 * body: { quote, rate, effective_from?, note? }
 *   - 해당 quote의 기존 active -> false 처리 후
 *   - 새 레코드 insert (active=true)
 *
 * PUT /api/fx/management
 * body: { id, rate?, effective_from?, note?, is_active? }
 *   - 특정 row 편집 (보통 note 수정용)
 *
 * Delete는 기본 비추천(감사/히스토리 유지).
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}
function bad(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}
function safeTrim(v: any) {
  return (v ?? "").toString().trim();
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isIsoDate(v: string) {
  return ISO_DATE_RE.test(v);
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const quote = safeTrim(url.searchParams.get("quote")) || null;

    if (quote) {
      // active + history
      const { data, error } = await supabaseAdmin
        .from("fx_management_rates")
        .select("*")
        .eq("quote", quote)
        .order("is_active", { ascending: false })
        .order("effective_from", { ascending: false })
        .limit(50);

      if (error) return bad(error.message, 500);
      const rows = Array.isArray(data) ? data : [];
      const active = rows.find((r) => r.is_active) ?? null;

      return ok({ quote, active, rows });
    }

    // 전체 active 목록
    const { data: act, error: e1 } = await supabaseAdmin
      .from("fx_management_rates")
      .select("*")
      .eq("is_active", true)
      .order("quote", { ascending: true });

    if (e1) return bad(e1.message, 500);

    // 히스토리(최근 일부)도 같이 주면 화면 UX 좋음
    const { data: hist, error: e2 } = await supabaseAdmin
      .from("fx_management_rates")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(100);

    if (e2) return bad(e2.message, 500);

    return ok({
      active: Array.isArray(act) ? act : [],
      recent: Array.isArray(hist) ? hist : [],
    });
  } catch (e: any) {
    return bad(e?.message ?? "Server error", 500);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return bad("Invalid JSON body", 400);

    const quote = safeTrim(body.quote).toUpperCase();
    const rateRaw = body.rate;
    const rate = Number(rateRaw);

    if (!quote) return bad("quote is required", 400);
    if (!Number.isFinite(rate) || rate <= 0) return bad("rate must be a positive number", 400);

    const effective_from = safeTrim(body.effective_from) || null;
    if (effective_from && !isIsoDate(effective_from)) {
      return bad("effective_from must be YYYY-MM-DD", 400);
    }

    const note = safeTrim(body.note) || null;

    // 1) 기존 active false
    const { error: e1 } = await supabaseAdmin
      .from("fx_management_rates")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("quote", quote)
      .eq("is_active", true);

    // e1이 있어도 insert는 진행 가능(대부분 권한/테이블 문제 외엔 큰 이슈 없음)
    if (e1) {
      // 그래도 알려주기
      console.warn("fx_management_rates deactivate error:", e1.message);
    }

    // 2) 새 active insert
    const { data: inserted, error: e2 } = await supabaseAdmin
      .from("fx_management_rates")
      .insert({
        base: "USD",
        quote,
        rate,
        effective_from: effective_from ?? undefined,
        is_active: true,
        note,
        updated_at: new Date().toISOString(),
      })
      .select("*")
      .maybeSingle();

    if (e2) return bad(e2.message, 500);

    return ok({ row: inserted });
  } catch (e: any) {
    return bad(e?.message ?? "Server error", 500);
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return bad("Invalid JSON body", 400);

    const id = safeTrim(body.id);
    if (!id) return bad("id is required", 400);

    const patch: any = { updated_at: new Date().toISOString() };

    if (body.rate !== undefined) {
      const r = Number(body.rate);
      if (!Number.isFinite(r) || r <= 0) return bad("rate must be a positive number", 400);
      patch.rate = r;
    }
    if (body.effective_from !== undefined) {
      const d = safeTrim(body.effective_from);
      if (d && !isIsoDate(d)) return bad("effective_from must be YYYY-MM-DD", 400);
      patch.effective_from = d || null;
    }
    if (body.note !== undefined) {
      patch.note = safeTrim(body.note) || null;
    }
    if (body.is_active !== undefined) {
      patch.is_active = !!body.is_active;
    }

    const { data, error } = await supabaseAdmin
      .from("fx_management_rates")
      .update(patch)
      .eq("id", id)
      .select("*")
      .maybeSingle();

    if (error) return bad(error.message, 500);
    return ok({ row: data });
  } catch (e: any) {
    return bad(e?.message ?? "Server error", 500);
  }
}
