import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

// PO lookup for Expenses UI
// Query params: q, limit
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const qRaw = (searchParams.get("q") || "").trim();
    const q = qRaw;
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "20", 10) || 20, 1), 50);

    // Pre-resolve buyer_ids by searching companies (name/code)
    let buyerIds: string[] = [];
    if (q) {
      const { data: buyers, error: buyerErr } = await supabaseAdmin
        .from("companies")
        .select("id")
        .or([`name.ilike.%${q}%`, `code.ilike.%${q}%`].join(","))
        .limit(30);

      if (!buyerErr && buyers?.length) buyerIds = buyers.map((b: any) => b.id).filter(Boolean);
    }

    const orCandidates = [
      `po_no.ilike.%${q}%`,
      `buyer_brand_name.ilike.%${q}%`,
      `buyer_name.ilike.%${q}%`,
    ].filter(Boolean);

    if (buyerIds.length) {
      orCandidates.push(`buyer_id.in.(${buyerIds.join(",")})`);
    }

    async function runWithOr(orExpr: string | null) {
      let base = supabaseAdmin
        .from("po_headers")
        .select("*")
        .eq("is_deleted", false)
        .order("order_date", { ascending: false, nullsFirst: false })
        .limit(limit);

      if (orExpr) base = base.or(orExpr);
      return await base;
    }

    let data: any[] | null = null;

    if (!q) {
      const r = await runWithOr(null);
      if (r.error) throw r.error;
      data = r.data || [];
    } else {
      let r = await runWithOr(orCandidates.join(","));
      if (r.error) {
        const msg = (r.error as any)?.message || "";
        if (msg.includes("buyer_name")) {
          const or2 = orCandidates.filter((x) => !x.startsWith("buyer_name.")).join(",");
          r = await runWithOr(or2);
        }
      }
      if (r.error) {
        const or3 = [
          `po_no.ilike.%${q}%`,
          ...(buyerIds.length ? [`buyer_id.in.(${buyerIds.join(",")})`] : []),
        ].join(",");
        r = await runWithOr(or3);
      }
      if (r.error) throw r.error;
      data = r.data || [];
    }

    const rows = data || [];

    // hydrate buyer display
    const uniqBuyerIds = Array.from(new Set(rows.map((r: any) => r.buyer_id).filter(Boolean)));
    const buyerMap = new Map<string, { name: string | null; code: string | null }>();
    if (uniqBuyerIds.length) {
      const { data: buyerRows } = await supabaseAdmin
        .from("companies")
        .select("id,name,code")
        .in("id", uniqBuyerIds);
      (buyerRows || []).forEach((b: any) => {
        buyerMap.set(b.id, { name: b.name ?? null, code: b.code ?? null });
      });
    }

    // IMPORTANT:
    // company_sites in this DB does NOT have "code" column.
    // Match PO shipping/origin code against company_sites.loading_port_code / origin_code / site_name / name.
    const rawSiteKeys = Array.from(
      new Set(
        rows
          .map((r: any) =>
            String(
              r.shipping_origin_code ??
              r.site_code ??
              r.loading_port_code ??
              r.shipping_origin_site_code ??
              r.origin_code ??
              ""
            ).trim()
          )
          .filter(Boolean)
      )
    );

    const siteMap = new Map<string, { id: string | null; site_name: string | null; loading_port_code: string | null; origin_code: string | null }>();

    if (rawSiteKeys.length) {
      const siteOr = rawSiteKeys
        .flatMap((k) => [
          `loading_port_code.eq.${k}`,
          `origin_code.eq.${k}`,
          `site_name.eq.${k}`,
          `name.eq.${k}`,
        ])
        .join(",");

      const { data: siteRows, error: siteErr } = await supabaseAdmin
        .from("company_sites")
        .select("id,site_name,name,loading_port_code,origin_code,is_deleted")
        .eq("is_deleted", false)
        .or(siteOr)
        .limit(200);

      if (siteErr) throw siteErr;

      for (const s of siteRows || []) {
        const keys = [
          s.loading_port_code,
          s.origin_code,
          s.site_name,
          s.name,
        ]
          .map((x: any) => String(x || "").trim())
          .filter(Boolean);

        for (const k of keys) {
          if (!siteMap.has(k)) {
            siteMap.set(k, {
              id: s.id ?? null,
              site_name: (s.site_name ?? s.name ?? null),
              loading_port_code: s.loading_port_code ?? null,
              origin_code: s.origin_code ?? null,
            });
          }
        }
      }
    }

    const items = rows.map((r: any) => {
      const b = r.buyer_id ? buyerMap.get(r.buyer_id) : undefined;

      const visibleSiteCode =
        (r.shipping_origin_code ??
          r.site_code ??
          r.loading_port_code ??
          r.shipping_origin_site_code ??
          r.origin_code ??
          null) as string | null;

      const hydratedSite = visibleSiteCode ? siteMap.get(String(visibleSiteCode).trim()) : undefined;

      const directSiteId =
        r.site_id ??
        r.shipping_origin_site_id ??
        r.shipping_origin_site ??
        r.origin_site_id ??
        null;

      const finalSiteId = directSiteId || hydratedSite?.id || null;

      return {
        id: r.id,
        po_no: r.po_no ?? null,
        buyer_name: (r.buyer_name ?? b?.name ?? null) as string | null,
        buyer_code: (b?.code ?? null) as string | null,
        buyer_brand_name: r.buyer_brand_name ?? null,
        site_id: finalSiteId,
        site_code: visibleSiteCode ?? hydratedSite?.loading_port_code ?? hydratedSite?.origin_code ?? null,
        site_name: hydratedSite?.site_name ?? null,
        order_date: r.order_date ?? null,
      };
    });

    return NextResponse.json({ ok: true, items });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
