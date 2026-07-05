// src/app/api/dashboards/expected-profitability/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function num(v: string | null, fallback?: number) {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function styleKey(v: unknown) {
  return String(v ?? "").trim().toUpperCase();
}

function developmentFxToUsd(currency: unknown, cnyPerUsd: number) {
  switch (styleKey(currency)) {
    case "USD":
      return 1;
    case "CNY":
      return 1 / cnyPerUsd;
    default:
      return null;
  }
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
    const requestedCnyPerUsd = num(sp.get("cny_per_usd"), 6.8) ?? 6.8;
    const cnyPerUsd = requestedCnyPerUsd > 0 ? requestedCnyPerUsd : 6.8;

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

    const sourceRows = Array.isArray(data) ? data : [];
    const productStyles = Array.from(
      new Set(
        sourceRows
          .map((row: any) => styleKey(row.jm_style_no))
          .filter(Boolean)
      )
    );

    const developmentCostByStyle = new Map<
      string,
      { costUsd: number; currency: string; fxToUsd: number }
    >();
    if (productStyles.length > 0) {
      const { data: productRows, error: productError } = await supabaseAdmin
        .from("product_development_headers")
        .select("id,style_no,currency")
        .eq("is_deleted", false)
        .in("style_no", productStyles);

      if (productError) {
        return NextResponse.json(
          { success: false, error: productError.message },
          { status: 500, headers: { "Cache-Control": "no-store" } }
        );
      }

      const productIds = (productRows ?? []).map((row: any) => row.id);
      if (productIds.length > 0) {
        const [materialsResult, operationsResult] = await Promise.all([
          supabaseAdmin
            .from("product_development_materials")
            .select("product_id,qty,unit_cost")
            .in("product_id", productIds)
            .eq("is_deleted", false),
          supabaseAdmin
            .from("product_development_operations")
            .select("product_id,qty,unit_cost")
            .in("product_id", productIds)
            .eq("is_deleted", false),
        ]);

        const childError = materialsResult.error ?? operationsResult.error;
        if (childError) {
          return NextResponse.json(
            { success: false, error: childError.message },
            { status: 500, headers: { "Cache-Control": "no-store" } }
          );
        }

        const localCostByProduct = new Map<string, number>();
        for (const line of [...(materialsResult.data ?? []), ...(operationsResult.data ?? [])]) {
          const productId = String((line as any).product_id ?? "");
          const amount = Number((line as any).qty ?? 0) * Number((line as any).unit_cost ?? 0);
          if (!productId || !Number.isFinite(amount)) continue;
          localCostByProduct.set(productId, (localCostByProduct.get(productId) ?? 0) + amount);
        }

        for (const product of productRows ?? []) {
          const key = styleKey((product as any).style_no);
          const currency = styleKey((product as any).currency) || "CNY";
          const fxToUsd = developmentFxToUsd(currency, cnyPerUsd);
          const localCost = localCostByProduct.get(String((product as any).id));
          if (!key || fxToUsd === null || localCost === undefined) continue;
          developmentCostByStyle.set(key, {
            costUsd: localCost * fxToUsd,
            currency,
            fxToUsd,
          });
        }
      }
    }

    const enrichedRows = sourceRows.map((row: any) => {
      const hasWorksheetCost = row.planned_unit_cost !== null && row.planned_unit_cost !== undefined;
      const developmentCost = developmentCostByStyle.get(styleKey(row.jm_style_no));
      const hasDevelopmentCost = developmentCost !== undefined;
      if (!hasDevelopmentCost) {
        return { ...row, has_planned_cost: hasWorksheetCost };
      }

      const qty = Number(row.qty ?? 0);
      const revenue = Number(row.revenue_usd ?? 0);
      const optionalUnitCost = Number(row.optional_unit_cost ?? 0);
      const totalUnitCost = developmentCost.costUsd + optionalUnitCost;
      const expectedCogs = qty * totalUnitCost;
      const expectedMargin = revenue - expectedCogs;

      return {
        ...row,
        planned_unit_cost: developmentCost.costUsd,
        total_unit_cost: totalUnitCost,
        expected_cogs: expectedCogs,
        expected_margin: expectedMargin,
        margin_pct: revenue > 0 ? expectedMargin / revenue : null,
        has_planned_cost: true,
        source_cost_currency: `${developmentCost.currency} (PRODUCT DEVELOPMENT)`,
        source_fx_rate_to_usd: developmentCost.fxToUsd,
        source_cny_per_usd: developmentCost.currency === "CNY" ? cnyPerUsd : null,
      };
    });

    // These filters must run after Product Development fallback costs are applied.
    const rows = enrichedRows.filter((row: any) => {
      if (missingOnly && row.has_planned_cost) return false;
      const margin = row.margin_pct === null || row.margin_pct === undefined ? null : Number(row.margin_pct);
      if (marginMin != null && (margin === null || margin < marginMin / 100)) return false;
      if (marginMax != null && (margin === null || margin > marginMax / 100)) return false;
      return true;
    });

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
      { success: true, rows, summary, buyers, cny_per_usd: cnyPerUsd },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e?.message ?? "Failed to load expected profitability" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
