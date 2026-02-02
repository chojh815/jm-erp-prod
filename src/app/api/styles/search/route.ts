import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * GET /api/styles/search?q=
 *
 * Tries to search style numbers for Quotation lines autocomplete.
 * We intentionally query multiple candidate tables to fit your evolving schema:
 * 1) dev_products (style_no)
 * 2) po_lines (buyer_style_no OR style_no)
 * 3) costings headers (if table exists): costing_headers (style_no)
 *
 * Returns: [{ style_no, name? }]
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const qRaw = (url.searchParams.get("q") || "").trim();
    const q = qRaw.replace(/[%_]/g, ""); // basic safety for ilike
    if (!q) return NextResponse.json({ success: true, items: [] });

    const sb = supabaseAdmin;
    const items: { style_no: string; name?: string | null }[] = [];

    // 1) dev_products
    try {
      const { data, error } = await sb
        .from("dev_products")
        .select("*")
        .ilike("style_no", `%${q}%`)
        .limit(20);
      if (!error && data) {
        for (const r of data as any[]) {
          const style_no = (r.style_no ?? "").toString().trim();
          if (!style_no) continue;
          const name = (r.product_name ?? r.name ?? r.title ?? null) as any;
          items.push({ style_no, name: name ? String(name) : null });
        }
      }
    } catch {}

    // 2) po_lines (fallback)
    if (items.length < 20) {
      try {
        const { data, error } = await sb
          .from("po_lines")
          .select("*")
          .or(`buyer_style_no.ilike.%${q}%,style_no.ilike.%${q}%`)
          .limit(30);
        if (!error && data) {
          for (const r of data as any[]) {
            const style_no = (r.buyer_style_no ?? r.style_no ?? "").toString().trim();
            if (!style_no) continue;
            items.push({ style_no, name: null });
          }
        }
      } catch {}
    }

    // 3) costing_headers (optional)
    if (items.length < 20) {
      try {
        const { data, error } = await sb
          .from("costing_headers")
          .select("*")
          .ilike("style_no", `%${q}%`)
          .limit(20);
        if (!error && data) {
          for (const r of data as any[]) {
            const style_no = (r.style_no ?? "").toString().trim();
            if (!style_no) continue;
            items.push({ style_no, name: null });
          }
        }
      } catch {}
    }

    // de-dup
    const seen = new Set<string>();
    const out = [];
    for (const it of items) {
      const key = it.style_no.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(it);
      if (out.length >= 20) break;
    }

    return NextResponse.json({ success: true, items: out });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || String(e) }, { status: 500 });
  }
}
