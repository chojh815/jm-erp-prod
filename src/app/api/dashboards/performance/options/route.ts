// src/app/api/dashboard/performance/options/route.ts
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/app/api/_supabase";

export const dynamic = "force-dynamic";

// Returns distinct buyers + brands observed in v_perf_monthly (within optional date range)
function asDateOnly(s: string | null | undefined) {
  if (!s) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

export async function GET(req: Request) {
  try {
    const supabase = createSupabaseServerClient();
    const url = new URL(req.url);
    const start = asDateOnly(url.searchParams.get("start")) || null;
    const end = asDateOnly(url.searchParams.get("end")) || null;

    let q = supabase
      .from("v_perf_monthly")
      .select("buyer_id,buyer_name,brand_name,month_start")
      .order("month_start", { ascending: false })
      .limit(5000);

    if (start) q = q.gte("month_start", start);
    if (end) q = q.lte("month_start", end);

    const { data, error } = await q;
    if (error) throw error;

    const buyersMap = new Map<string, { id: string; name: string }>();
    const brandsSet = new Set<string>();

    for (const r of data || []) {
      if (r.buyer_id) {
        const name = (r.buyer_name || "").trim() || "—";
        if (!buyersMap.has(r.buyer_id)) buyersMap.set(r.buyer_id, { id: r.buyer_id, name });
      }
      const bn = (r.brand_name || "").trim();
      if (bn) brandsSet.add(bn);
    }

    const buyers = Array.from(buyersMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    const brands = Array.from(brandsSet.values()).sort((a, b) => a.localeCompare(b));

    return NextResponse.json({ ok: true, buyers, brands });
  } catch (e: any) {
    console.error("[dashboard/performance/options] error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}
