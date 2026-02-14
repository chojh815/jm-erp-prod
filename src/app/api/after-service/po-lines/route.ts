import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/**
 * After Service helper API: fetch PO context + lines by po_no
 *
 * Returns:
 *  - context: buyer/vendor/origin (best-effort)
 *  - rows: minimal PO line fields for dropdown/autocomplete + optional images
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = createClient();
    const url = new URL(req.url);
    const poNo = (url.searchParams.get("po_no") || "").trim();

    if (!poNo) {
      return NextResponse.json({ ok: false, error: "po_no is required" }, { status: 400 });
    }

    const { data: headers, error: hErr } = await supabase
      .from("po_headers")
      .select("id, po_no, buyer_id, vendor_id, shipping_origin_code")
      .eq("po_no", poNo)
      .eq("is_deleted", false);

    if (hErr) return NextResponse.json({ ok: false, error: hErr.message }, { status: 500 });
    if (!headers || headers.length === 0) {
      return NextResponse.json({ ok: true, context: null, rows: [] });
    }

    const headerIds = headers.map((h: any) => h.id);
    const buyerIds = Array.from(new Set(headers.map((h: any) => h.buyer_id).filter(Boolean)));
    const vendorIds = Array.from(new Set(headers.map((h: any) => h.vendor_id).filter(Boolean)));

    // Best-effort resolve buyer/vendor names from companies
    let buyerMap: Record<string, string> = {};
    let vendorMap: Record<string, string> = {};
    const allCompanyIds = Array.from(new Set([...buyerIds, ...vendorIds]));
    if (allCompanyIds.length) {
      const { data: comps } = await supabase.from("companies").select("id, company_name, name").in("id", allCompanyIds);
      (comps || []).forEach((c: any) => {
        const nm = c.company_name || c.name || null;
        if (!nm) return;
        if (buyerIds.includes(c.id)) buyerMap[c.id] = nm;
        if (vendorIds.includes(c.id)) vendorMap[c.id] = nm;
      });
    }

    // Choose the first header as primary context
    const h0: any = headers[0];
    const context = {
      po_no: poNo,
      buyer_id: h0.buyer_id || null,
      buyer_name: h0.buyer_id ? buyerMap[h0.buyer_id] || null : null,
      vendor_id: h0.vendor_id || null,
      vendor_name: h0.vendor_id ? vendorMap[h0.vendor_id] || null : null,
      shipping_origin_code: h0.shipping_origin_code || null,
    };

    const { data: lines, error: lErr } = await supabase
      .from("po_lines")
      .select("id, po_header_id, style_no, buyer_style_no, color, size, qty, unit")
      .in("po_header_id", headerIds)
      .eq("is_deleted", false)
      .order("buyer_style_no", { ascending: true })
      .order("style_no", { ascending: true });

    if (lErr) return NextResponse.json({ ok: false, error: lErr.message }, { status: 500 });

    // Best-effort images: po_line_images (unknown schema -> select("*"))
    const lineIds = (lines || []).map((ln: any) => ln.id);
    const imagesByLine: Record<string, string[]> = {};
    if (lineIds.length) {
      const { data: imgs, error: imgErr } = await supabase
        .from("po_line_images")
        .select("*")
        .in("po_line_id", lineIds);

      if (!imgErr) {
        (imgs || []).forEach((r: any) => {
          const lineId = r.po_line_id;
          if (!lineId) return;
          const url =
            r.image_url ||
            r.public_url ||
            r.url ||
            r.path ||
            r.file_url ||
            r.storage_path ||
            null;
          if (!url) return;
          imagesByLine[lineId] = imagesByLine[lineId] || [];
          imagesByLine[lineId].push(url);
        });
      }
    }

    const rows = (lines || []).map((ln: any) => ({
      po_line_id: ln.id,
      po_no: poNo,
      po_header_id: ln.po_header_id,
      buyer_style_no: ln.buyer_style_no || null,
      style_no: ln.style_no || null,
      style_name: ln.style_name || null, // if exists in your schema
      color: ln.color || null,
      size: ln.size || null,
      qty: ln.qty ?? null,
      unit: ln.unit || null,
      images: imagesByLine[ln.id] || [],
    }));

    return NextResponse.json({ ok: true, context, rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Unknown error" }, { status: 500 });
  }
}
