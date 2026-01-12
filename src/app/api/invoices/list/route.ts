import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}
function bad(message: string, status = 400, extra: any = {}) {
  return NextResponse.json({ success: false, error: message, ...extra }, { status });
}

function safe(v: any) {
  return (v ?? "").toString().trim();
}
function toNumber(v: any, fallback = 0) {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const keyword = safe(url.searchParams.get("keyword"));
    const buyerId = safe(url.searchParams.get("buyer_id"));
    const status = safe(url.searchParams.get("status"));
    const validate = safe(url.searchParams.get("validate")) === "1"; // ✅ 필요할 때만 검증쿼리 실행

    // ✅ 핵심 원칙: List Total은 invoice_headers.total_amount만 사용
    let q = supabaseAdmin
      .from("invoice_headers")
      .select(
        [
          "id",
          "invoice_no",
          "buyer_id",
          "buyer_name",
          "buyer_code",
          "currency",
          "total_amount",
          "status",
          "etd",
          "eta",
          "shipment_id",
          "created_at",
          "is_deleted",
        ].join(",")
      )
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .limit(500);

    if (keyword) {
      const k = `%${keyword}%`;
      q = q.or(`invoice_no.ilike.${k},buyer_name.ilike.${k},buyer_code.ilike.${k}`);
    }

    if (buyerId) q = q.eq("buyer_id", buyerId);
    if (status && status !== "ALL") q = q.eq("status", status);

    const { data, error } = await q;
    if (error) return bad(error.message, 500, { code: error.code });

    const rowsRaw = (data ?? []) as any[];

    // ✅ 방어: total_amount가 null/문자열이어도 숫자로 통일
    const rows = rowsRaw.map((r) => ({
      ...r,
      total_amount: toNumber(r.total_amount, 0),
    }));

    // ✅ 선택 검증: invoice_lines 합계와 header.total_amount 불일치 감지 (validate=1일 때만)
    // - 성능 보호: header를 건드리지 않고 "표시용 경고"만 내려줌
    if (validate && rows.length > 0) {
      const ids = rows.map((r) => r.id).filter(Boolean);
      // invoice_lines 컬럼/테이블명이 다를 가능성도 있으므로 "invoice_lines" 기준(현재 ERP 구조 가정)
      // amount 컬럼이 없다면 이 쿼리는 에러가 날 수 있음 -> 그 경우 error를 meta로만 내려주고 list 자체는 유지
      const { data: sums, error: sumErr } = await supabaseAdmin
        .from("invoice_lines")
        .select("invoice_header_id, amount, is_deleted")
        .in("invoice_header_id", ids)
        .eq("is_deleted", false);

      if (!sumErr && sums) {
        const map = new Map<string, number>();
        for (const s of sums as any[]) {
          const hid = s.invoice_header_id;
          const amt = toNumber(s.amount, 0);
          map.set(hid, (map.get(hid) ?? 0) + amt);
        }

        let mismatchCount = 0;
        const out = rows.map((r) => {
          const linesTotal = map.get(r.id) ?? 0;
          const headerTotal = toNumber(r.total_amount, 0);
          const diff = Math.abs(linesTotal - headerTotal);
          const mismatched = diff > 0.01; // cents 기준
          if (mismatched) mismatchCount += 1;
          return {
            ...r,
            _validate: {
              lines_total: Number(linesTotal.toFixed(2)),
              header_total: Number(headerTotal.toFixed(2)),
              diff: Number(diff.toFixed(2)),
              mismatched,
            },
          };
        });

        return ok({
          rows: out,
          meta: { validated: true, mismatchCount },
        });
      } else {
        // 검증쿼리 실패해도 list는 살아야 함
        return ok({
          rows,
          meta: {
            validated: false,
            validate_error: sumErr?.message ?? "validate query failed",
          },
        });
      }
    }

    return ok({ rows });
  } catch (e: any) {
    return bad(e?.message ?? "Failed to load invoices list", 500);
  }
}
