import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
  "Surrogate-Control": "no-store",
};

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data }, { headers: NO_STORE_HEADERS });
}
function bad(message: string, status = 400) {
  return NextResponse.json(
    { success: false, error: message },
    { status, headers: NO_STORE_HEADERS }
  );
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(v: any) {
  return typeof v === "string" && UUID_RE.test(v);
}
function safeStr(v: any) {
  return (v ?? "").toString().trim();
}
function pickFirst(obj: any, keys: string[], fallback: any = null) {
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k)) {
      const val = obj[k];
      if (val !== undefined && val !== null && safeStr(val) !== "") return val;
    }
  }
  return fallback;
}
function toNum(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function normalizeImgRow(row: any): string | null {
  const v = pickFirst(row, ["image_url", "url", "public_url", "file_url", "path"]);
  const s = safeStr(v);
  return s ? s : null;
}
function imagesByPoLineIdsEmpty(m: Map<string, string[]>) {
  for (const v of m.values()) {
    if (Array.isArray(v) && v.length) return false;
  }
  return true;
}

/**
 * GET /api/work-sheets/[id]/enriched
 * - Work Sheet 상세 화면에서 필요한 "라인(수량/이미지/Buyer style/desc)"를
 *   po_lines + po_line_images에서 조인/보강해서 내려준다.
 *
 * ✅ 기존 /api/work-sheets/[id] 는 그대로 유지(저장/기타 로직 영향 최소화)
 * ✅ WorkSheet 상세 page.tsx는 GET만 이 엔드포인트로 호출하도록 변경
 */
export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const id = params?.id;
    if (!isUuid(id)) return bad("Invalid id", 400);

    // 1) header
    const hr: any = await supabaseAdmin
      .from("work_sheet_headers")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (hr?.error) return bad(hr.error.message || "Failed to load header", 500);
    const header = hr?.data ?? null;
    if (!header) return ok({ header: null, lines: [], materialsByLineId: {} });

    // 2) lines (raw)
    const lr: any = await supabaseAdmin
      .from("work_sheet_lines")
      .select("*")
      .eq("work_sheet_id", id)
      .order("created_at", { ascending: true });

    if (lr?.error) return bad(lr.error.message || "Failed to load lines", 500);

    const rawLines: any[] = (lr?.data ?? []).filter((l) => !l?.is_deleted);

    // 3) po_lines join (qty, buyer_style_no, description, etc)
    const poLineIds = Array.from(
      new Set(rawLines.map((l) => l.po_line_id).filter(Boolean))
    ) as string[];

    const poById = new Map<string, any>();
    if (poLineIds.length) {
      const pr: any = await supabaseAdmin
        .from("po_lines")
        .select("*")
        .in("id", poLineIds)
        .eq("is_deleted", false);

      if (!pr?.error) {
        for (const p of pr.data ?? []) poById.set(p.id, p);
      }
    }

    // 4) images by po_line_id (po_line_images 우선, 없으면 po_images fallback)
    const imagesByPoLineId = new Map<string, string[]>();
    async function loadImagesFrom(table: string) {
      if (!poLineIds.length) return;
      const r: any = await supabaseAdmin.from(table).select("*").in("po_line_id", poLineIds);
      if (r?.error) return;
      for (const row of r.data ?? []) {
        const pid = row.po_line_id;
        if (!pid) continue;
        const url = normalizeImgRow(row);
        if (!url) continue;
        const prev = imagesByPoLineId.get(pid) ?? [];
        if (!prev.includes(url)) prev.push(url);
        imagesByPoLineId.set(pid, prev);
      }
    }

    await loadImagesFrom("po_line_images");
    if (imagesByPoLineIdsEmpty(imagesByPoLineId)) {
      await loadImagesFrom("po_images");
    }

    // 5) materials specs (work_sheet_material_specs)
    const lineIds = rawLines.map((l) => l.id).filter(Boolean) as string[];
    const materialsByLineId: Record<string, any[]> = {};
    if (lineIds.length) {
      const mr: any = await supabaseAdmin
        .from("work_sheet_material_specs")
        .select("*")
        .in("work_sheet_line_id", lineIds)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });

      if (!mr?.error) {
        for (const m of mr.data ?? []) {
          if (m?.is_deleted) continue;
          const lid = m.work_sheet_line_id;
          if (!lid) continue;
          materialsByLineId[lid] = materialsByLineId[lid] ?? [];
          materialsByLineId[lid].push(m);
        }
      }
    }

    // 6) normalize/enrich lines to match UI expectations
    const enriched = rawLines.map((l) => {
      const po = l.po_line_id ? poById.get(l.po_line_id) : null;

      const qty =
        toNum(pickFirst(l, ["qty", "order_qty", "quantity"]), 0) ||
        toNum(pickFirst(po, ["qty", "order_qty", "quantity"]), 0);

      const buyer_style =
        pickFirst(l, ["buyer_style", "buyer_style_no", "buyer_style_sku"]) ??
        pickFirst(po, ["buyer_style_no", "buyer_style", "buyer_style_sku"]);

      const description =
        pickFirst(l, ["description", "desc"]) ?? pickFirst(po, ["description", "desc"]);

      const jm_style_no =
        safeStr(pickFirst(l, ["jm_style_no", "style_no"], "")) ||
        safeStr(pickFirst(po, ["jm_style_no", "style_no"], ""));

      const imgs = l.po_line_id ? imagesByPoLineId.get(l.po_line_id) ?? [] : [];
      const image_url_primary =
        pickFirst(l, ["image_url_primary", "image_url"]) ?? (imgs.length ? imgs[0] : null);

      const image_urls = pickFirst(l, ["image_urls"]) ?? (imgs.length ? imgs : null);

      return {
        ...l,
        jm_style_no,
        qty,
        buyer_style,
        description,
        image_url_primary,
        image_urls,
      };
    });

    return ok({ header, lines: enriched, materialsByLineId });
  } catch (e: any) {
    return bad(e?.message || "Server error", 500);
  }
}
