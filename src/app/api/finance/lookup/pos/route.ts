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

    // Pre-resolve buyer_ids by searching companies (name/code) so user can type "RED"
    let buyerIds: string[] = [];
    if (q) {
      const { data: buyers, error: buyerErr } = await supabaseAdmin
        .from("companies")
        .select("id")
        .or([`name.ilike.%${q}%`, `code.ilike.%${q}%`].join(","))
        .limit(30);

      if (!buyerErr && buyers?.length) buyerIds = buyers.map((b: any) => b.id).filter(Boolean);
    }

    // Build OR filters progressively; remove ones that may reference missing columns.
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
      // Try 1: full OR (po_no + brand + buyer_name + buyer_ids)
      let r = await runWithOr(orCandidates.join(","));
      if (r.error) {
        const msg = (r.error as any)?.message || "";
        // Common schema: po_headers may NOT have buyer_name; drop it and retry
        if (msg.includes("buyer_name")) {
          const or2 = orCandidates.filter((x) => !x.startsWith("buyer_name.")).join(",");
          r = await runWithOr(or2);
        }
      }
      if (r.error) {
        // Last fallback: search only by po_no + buyer_ids (most stable)
        const or3 = [
          `po_no.ilike.%${q}%`,
          ...(buyerIds.length ? [`buyer_id.in.(${buyerIds.join(",")})`] : []),
        ].join(",");
        r = await runWithOr(or3);
      }
      if (r.error) throw r.error;
      data = r.data || [];
    }

    // Hydrate buyer_name / buyer_code from companies for display
    const rows = data || [];
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

    const items = rows.map((r: any) => {
      const b = r.buyer_id ? buyerMap.get(r.buyer_id) : undefined;

      // site id is not stable across earlier schema versions
      const siteId =
        r.site_id ??
        r.shipping_origin_site_id ??
        r.shipping_origin_site ??
        r.origin_site_id ??
        null;

      return {
        id: r.id,
        po_no: r.po_no ?? null,
        buyer_name: (r.buyer_name ?? b?.name ?? null) as string | null,
        buyer_code: (b?.code ?? null) as string | null,
        buyer_brand_name: r.buyer_brand_name ?? null,
        site_id: siteId,
        site_code: (r.shipping_origin_code ?? r.site_code ?? null) as string | null,
        order_date: r.order_date ?? null,
      };
    });

    return NextResponse.json({ ok: true, items });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
