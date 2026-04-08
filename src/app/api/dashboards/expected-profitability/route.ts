// src/app/api/dashboards/expected-profitability/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function num(v: string | null, fallback?: number) {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const q = (sp.get("q") ?? "").trim();
    const buyerId = (sp.get("buyer_id") ?? "").trim();
    const brand = (sp.get("brand") ?? "").trim();
    const start = (sp.get("start") ?? "").trim();
    const end = (sp.get("end") ?? "").trim();
    const marginMin = num(sp.get("margin_min"));
    const marginMax = num(sp.get("margin_max"));
    const missingOnly = (sp.get("missing_only") ?? "false") === "true";

    let query = supabaseAdmin
      .from("v_expected_profitability")
      .select("*")
      .order("order_date", { ascending: false, nullsFirst: false })
      .order("po_no", { ascending: true })
      .order("line_no", { ascending: true });

    if (buyerId) query = query.eq("buyer_id", buyerId);
    if (brand) query = query.ilike("buyer_brand_name", `%${brand}%`);
    if (start) query = query.gte("order_date", start);
    if (end) query = query.lte("order_date", end);
    if (missingOnly) query = query.eq("has_planned_cost", false);

    // frontend sends whole numbers like 20, 60 -> DB margin_pct is ratio, so divide by 100
    if (marginMin != null) query = query.gte("margin_pct", marginMin / 100);
    if (marginMax != null) query = query.lte("margin_pct", marginMax / 100);

    if (q) {
      query = query.or(
        [
          `po_no.ilike.%${q}%`,
          `jm_style_no.ilike.%${q}%`,
          `buyer_style_no.ilike.%${q}%`,
          `buyer_name.ilike.%${q}%`,
          `description.ilike.%${q}%`,
        ].join(",")
      );
    }

    const [{ data, error }, buyersRes] = await Promise.all([
      query,
      supabaseAdmin
        .from("po_headers")
        .select("buyer_id,buyer_name")
        .eq("is_deleted", false)
        .not("buyer_id", "is", null)
        .order("buyer_name", { ascending: true }),
    ]);

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }
    if (buyersRes.error) {
      return NextResponse.json(
        { success: false, error: buyersRes.error.message },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    const rows = Array.isArray(data) ? data : [];

    // IMPORTANT: keep summary field names aligned with existing page.tsx
    const summary = rows.reduce(
      (acc: any, r: any) => {
        acc.revenue_usd += Number(r.revenue_usd ?? 0);
        acc.expected_cogs += Number(r.expected_cogs ?? 0);
        acc.expected_margin += Number(r.expected_margin ?? 0);
        acc.missing_count += r.has_planned_cost ? 0 : 1;
        return acc;
      },
      { revenue_usd: 0, expected_cogs: 0, expected_margin: 0, missing_count: 0 }
    );

    summary.margin_pct =
      summary.revenue_usd > 0 ? summary.expected_margin / summary.revenue_usd : null;
    summary.row_count = rows.length;

    const buyerMap = new Map<string, { id: string; name: string }>();
    for (const row of buyersRes.data ?? []) {
      const id = String((row as any).buyer_id ?? "").trim();
      const name = String((row as any).buyer_name ?? "").trim();
      if (!id || !name) continue;
      if (!buyerMap.has(id)) buyerMap.set(id, { id, name });
    }
    const buyers = Array.from(buyerMap.values()).sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json(
      { success: true, rows, summary, buyers },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e?.message ?? "Failed to load expected profitability" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
