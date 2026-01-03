/**
 * src/app/api/production/status/list/route.ts
 *
 * Production Status list API
 * - Adds vendor_name resolved from companies table using po_lines.vendor_id
 * - Adds order_date (best-effort from po_headers: order_date / po_date / created_at)
 * - Adds work_sheet_id resolved from work_sheet_lines using po_lines.id -> work_sheet_lines.po_line_id
 * - Filters: q, ship_mode, courier_carrier, from, to
 *
 * Notes:
 * - Uses conservative select('*') to avoid hard dependency on optional column names.
 * - Resolves vendor_name with a second query to companies (no FK required).
 * - Resolves work_sheet_id with a second query to work_sheet_lines (no FK required).
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}
function bad(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}
function safeStr(v: any) {
  return (v ?? "").toString().trim();
}
function upper(v: any) {
  return safeStr(v).toUpperCase();
}

function pickFirst(obj: any, keys: string[], fallback: any = null) {
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k)) {
      const val = obj[k];
      if (val !== undefined) return val;
    }
  }
  return fallback;
}

function toISODateOnly(v: any): string | null {
  const s = safeStr(v);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10);
  return s;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const q = safeStr(searchParams.get("q"));
    const ship_mode = upper(searchParams.get("ship_mode"));
    const courier_carrier = upper(searchParams.get("courier_carrier"));
    const from = toISODateOnly(searchParams.get("from"));
    const to = toISODateOnly(searchParams.get("to"));

    // ✅ admin 여부(프론트에서 x-role 헤더로 전달)
    const role = safeStr(req.headers.get("x-role")).toLowerCase();
    const isAdmin = role === "admin";

    // 1) Load PO lines
    // ✅ 1) 여기서부터 query를 any로 끊는다 (핵심!)
let lineQ: any = supabaseAdmin
  .from("po_lines")
  .select("*")
  .eq("is_deleted", false);

// ✅ 2) 필터는 그냥 문자열로 사용 (as any 필요 없음)
if (ship_mode && ship_mode !== "ALL") {
  lineQ = lineQ.eq("ship_mode", ship_mode);
}

if (courier_carrier && courier_carrier !== "ALL") {
  lineQ = lineQ.eq("courier_carrier", courier_carrier);
}

// ✅ 3) 실행
let lineRes: any = await lineQ;

    // retry without optional filters if column missing
    if (lineRes?.error) {
      const msg = lineRes.error?.message || "";
      const needsRetry =
        msg.includes("column") && (msg.includes("ship_mode") || msg.includes("courier_carrier"));
      if (needsRetry) {
        lineRes = await supabaseAdmin.from("po_lines").select("*").eq("is_deleted", false);
      }
    }
    if (lineRes?.error) return bad(lineRes.error.message, 500);

    const lines: any[] = lineRes.data || [];
    if (!lines.length) return ok({ rows: [] });

    // 2) Load headers
    const headerIds = Array.from(new Set(lines.map((l) => l.po_header_id).filter(Boolean)));
    const headersById = new Map<string, any>();
    if (headerIds.length) {
      const hdrRes: any = await supabaseAdmin
        .from("po_headers")
        .select("*")
        .in("id", headerIds)
        .eq("is_deleted", false);
      if (hdrRes?.error) return bad(hdrRes.error.message, 500);
      for (const h of hdrRes.data || []) headersById.set(h.id, h);
    }

    // 2.5) Resolve work_sheet_id by po_line_id (from work_sheet_lines)
    // ✅ 너 스샷에서 확인된 구조: work_sheet_lines.po_line_id -> work_sheet_lines.work_sheet_id
    const poLineIds = Array.from(new Set(lines.map((l) => l.id).filter(Boolean)));
    const wsByPoLineId = new Map<string, string>();

    if (poLineIds.length) {
      const wsRes: any = await supabaseAdmin
        .from("work_sheet_lines")
        .select("po_line_id, work_sheet_id")
        .in("po_line_id", poLineIds);

      // 테이블/컬럼이 없거나 권한 문제면 조용히 스킵(WS 버튼은 new?po_line_id로 fallback)
      if (!wsRes?.error) {
        for (const w of wsRes.data || []) {
          if (w?.po_line_id && w?.work_sheet_id) {
            wsByPoLineId.set(w.po_line_id, w.work_sheet_id);
          }
        }
      }
    }

    // 3) Resolve vendor_name
    const vendorIds = Array.from(new Set(lines.map((l) => l.vendor_id).filter(Boolean)));
    const vendorsById = new Map<string, any>();
    if (vendorIds.length) {
      const vRes: any = await supabaseAdmin
        .from("companies")
        .select("id, company_name, code, company_type")
        .in("id", vendorIds);
      if (vRes?.error) return bad(vRes.error.message, 500);
      for (const v of vRes.data || []) vendorsById.set(v.id, v);
    }

    // 4) Build rows
    const rows = lines.map((l) => {
      const h = l.po_header_id ? headersById.get(l.po_header_id) : null;

      const po_no = pickFirst(l, ["po_no"], null) ?? pickFirst(h, ["po_no"], null);
      const buyer_name = pickFirst(h, ["buyer_name"], null) ?? pickFirst(l, ["buyer_name"], null);
      const buyer_id = pickFirst(h, ["buyer_id"], null) ?? pickFirst(l, ["buyer_id"], null);

      const brand =
        pickFirst(h, ["buyer_brand_name", "brand"], null) ?? pickFirst(l, ["brand"], null);

      const shipMode = upper(pickFirst(h, ["ship_mode"], null) ?? pickFirst(l, ["ship_mode"], null));
      const carrier = upper(
        pickFirst(h, ["courier_carrier"], null) ?? pickFirst(l, ["courier_carrier"], null)
      );

      const requested_ship_date =
        pickFirst(h, ["requested_ship_date"], null) ??
        pickFirst(l, ["requested_ship_date", "delivery_date"], null);

      // Order date (best effort)
      const order_date =
        pickFirst(h, ["order_date", "po_date"], null) ??
        pickFirst(l, ["order_date", "po_date"], null) ??
        pickFirst(h, ["created_at"], null);

      const status = pickFirst(h, ["status"], null) ?? pickFirst(l, ["status"], null);

      const style =
        pickFirst(l, ["style_no", "style", "jm_style_no", "style_number"], null) ??
        pickFirst(h, ["style_no", "style"], null);

      const qty = pickFirst(l, ["qty", "quantity"], null);
      const unit_price_usd = pickFirst(l, ["unit_price", "unit_price_usd"], null);

      const vendor_id = l.vendor_id ?? null;
      const v = vendor_id ? vendorsById.get(vendor_id) : null;
      const vendor_name = v?.company_name ?? (vendor_id ? "(Unknown Vendor)" : "In-house");

      // ✅ work_sheet_id resolve (po_line_id 기준)
      const work_sheet_id = wsByPoLineId.get(l.id) ?? null;

      // ✅ ADMIN only: unit_cost_usd best-effort
      const unit_cost_usd = isAdmin
        ? pickFirst(l, ["unit_cost_usd", "unit_cost", "vendor_unit_cost_usd"], null)
        : undefined;

      return {
        po_line_id: l.id,
        po_header_id: l.po_header_id ?? null,
        po_no: po_no ?? null,
        buyer_id,
        buyer_name: buyer_name ?? null,
        brand: brand ?? null,
        ship_mode: shipMode || null,
        courier_carrier: carrier || null,
        order_date: toISODateOnly(order_date),
        requested_ship_date: toISODateOnly(requested_ship_date),
        status: status ?? null,
        style_no: style ?? null,
        qty: qty ?? null,
        unit_price_usd: unit_price_usd ?? null,
        vendor_id,
        vendor_name,

        // ✅ WS direct jump data
        work_sheet_id,

        ...(isAdmin ? { unit_cost_usd } : {}),
      };
    });

    // filters in-memory
    let filtered = rows;

    if (ship_mode && ship_mode !== "ALL") {
      filtered = filtered.filter((r) => upper(r.ship_mode) === ship_mode);
    }
    if (courier_carrier && courier_carrier !== "ALL") {
      filtered = filtered.filter((r) => upper(r.courier_carrier) === courier_carrier);
    }
    if (from) {
      filtered = filtered.filter((r) => safeStr(r.requested_ship_date) >= from);
    }
    if (to) {
      filtered = filtered.filter((r) => safeStr(r.requested_ship_date) <= to);
    }
    if (q) {
      const qq = q.toLowerCase();
      filtered = filtered.filter((r) => {
        const hay = [
          r.po_no,
          r.buyer_name,
          r.brand,
          r.style_no,
          r.status,
          r.ship_mode,
          r.courier_carrier,
          r.vendor_name,
          r.order_date,
          r.requested_ship_date,
        ]
          .map((x) => safeStr(x).toLowerCase())
          .join(" | ");
        return hay.includes(qq);
      });
    }

    return ok({ rows: filtered });
  } catch (e: any) {
    return bad(e?.message || "Server error", 500);
  }
}
