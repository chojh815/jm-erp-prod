/* A-안: robust quotation list API (schema-tolerant)
   - Works even if some optional columns (is_deleted, buyer_brand_name, etc.) don't exist.
   - Avoids excluding rows when is_deleted is NULL (common when no default is set).
*/
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AnyRow = Record<string, any>;

function s(v: any) {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();

  const supabase = createClient();

  // Base select: be conservative (only columns we are confident exist OR are safe to ignore if missing).
  // If a column doesn't exist, PostgREST will error; so we will retry with slimmer selects when needed.
  const baseSelect =
    "id,quotation_no,status,received_date,updated_at,created_at,sent_at,is_sent,buyer_id,buyer_code,buyer_name,buyer_brand_name,buyer_brand,brand,subject,style_no";

  async function fetchHeaders(selectStr: string) {
    let qb = supabase.from("quotation_headers").select(selectStr).order("updated_at", { ascending: false }).limit(500);

    // Search filter (best-effort)
    if (q) {
      // Use OR across common text fields (best-effort; missing columns are handled by retry).
      qb = qb.or(
        [
          `quotation_no.ilike.%${q}%`,
          `subject.ilike.%${q}%`,
          `style_no.ilike.%${q}%`,
          `buyer_code.ilike.%${q}%`,
          `buyer_name.ilike.%${q}%`,
          `buyer_brand_name.ilike.%${q}%`,
          `buyer_brand.ilike.%${q}%`,
          `brand.ilike.%${q}%`,
        ].join(",")
      );
    }

    // Soft-delete filter: do NOT exclude NULLs.
    // Many tables have is_deleted default NULL; eq.false would hide rows.
    qb = qb.or("is_deleted.is.null,is_deleted.eq.false");

    // Also avoid status=DELETED if that convention exists
    qb = qb.not("status", "eq", "DELETED");

    const r = await qb;
    return r;
  }

  // 1) Try full select + tolerant delete filter
  let headers: AnyRow[] = [];
  {
    const r1 = await fetchHeaders(baseSelect);
    if (!r1.error) headers = (r1.data as AnyRow[]) || [];
    else {
      const msg = String(r1.error.message || "").toLowerCase();

      // If schema mismatch (missing columns OR missing is_deleted), retry with slimmer selects and/or without is_deleted filter.
      // Retry #1: remove optional brand/buyer columns (common mismatch)
      const slimSelect = "id,quotation_no,status,received_date,updated_at,created_at,sent_at,is_sent,buyer_id,subject,style_no";
      const r2 = await supabase
        .from("quotation_headers")
        .select(slimSelect)
        .order("updated_at", { ascending: false })
        .limit(500);

      if (!r2.error) headers = (r2.data as AnyRow[]) || [];
      else {
        // Retry #2: minimal select
        const r3 = await supabase
          .from("quotation_headers")
          .select("id,quotation_no,status,updated_at,created_at,buyer_id")
          .order("updated_at", { ascending: false })
          .limit(500);

        if (r3.error) {
          return NextResponse.json({ ok: false, error: r3.error.message }, { status: 500 });
        }
        headers = (r3.data as AnyRow[]) || [];
      }
    }
  }

  // 2) Add buyer info (best-effort join via companies)
  // If buyer_id exists and is a UUID referencing companies, enrich.
  const buyerIds = Array.from(new Set(headers.map((h) => s(h.buyer_id)).filter((x) => x)));
  let buyerMap: Record<string, { code?: string; name?: string }> = {};
  if (buyerIds.length) {
    const r = await supabase
      .from("companies")
      .select("id,code,name,company_name")
      .in("id", buyerIds)
      .limit(1000);
    if (!r.error) {
      for (const row of (r.data as AnyRow[]) || []) {
        buyerMap[s(row.id)] = {
          code: s(row.code) || undefined,
          name: s(row.name || row.company_name) || undefined,
        };
      }
    }
  }

  // 3) Line counts (best-effort)
  const ids = headers.map((h) => s(h.id)).filter(Boolean);
  let lineCountMap: Record<string, number> = {};
  if (ids.length) {
    const r = await supabase
      .from("quotation_lines")
      .select("quotation_id")
      .in("quotation_id", ids)
      .limit(20000);

    if (!r.error) {
      for (const row of (r.data as AnyRow[]) || []) {
        const k = s(row.quotation_id);
        lineCountMap[k] = (lineCountMap[k] || 0) + 1;
      }
    }
  }

  // 4) Normalize response for UI
  const out = headers.map((h) => {
    const id = s(h.id);
    const buyerId = s(h.buyer_id);
    const buyer = buyerMap[buyerId] || {};
    const brand =
      s(h.buyer_brand_name) ||
      s(h.brand) ||
      s(h.buyer_brand) ||
      ""; // last resort; UI can show empty

    return {
      id,
      quotation_no: s(h.quotation_no),
      status: s(h.status) || "DRAFT",
      updated_at: h.updated_at || h.created_at || null,
      sent_at: h.sent_at || null,
      is_sent: !!h.is_sent || !!h.sent_at,
      received_date: h.received_date || null,
      buyer_id: buyerId || null,
      buyer_code: s(h.buyer_code) || buyer.code || "",
      buyer_name: s(h.buyer_name) || buyer.name || "",
      brand,
      subject: s(h.subject),
      style_no: s(h.style_no),
      line_count: lineCountMap[id] || 0,
    };
  });

  return NextResponse.json({ ok: true, rows: out });
}