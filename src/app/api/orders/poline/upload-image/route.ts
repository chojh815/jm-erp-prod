import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}
function bad(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function asStr(v: any): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isUuid(v: string) {
  return UUID_RE.test(v);
}

function safeExtFromName(name: string) {
  const n = (name || "").toLowerCase();
  const m = n.match(/\.(jpg|jpeg|png|webp)$/i);
  return m ? m[1].toLowerCase().replace("jpeg", "jpg") : "png";
}

function cleanUrl(u?: string | null) {
  const s = String(u || "").trim();
  return s.length ? s : null;
}

type ProductImages = {
  table: "product_development_products";
  id: string;
  hasMain: boolean;
  hasUrls: boolean;
  hasUrlSingle: boolean;
  mainUrl: string | null;
  urls: string[];
};

async function loadProductImages(jmStyleNo: string): Promise<ProductImages | null> {
  // We defensively probe columns because schemas can differ between v1/v2.
  const table = "product_development_products" as const;

  // Try: main_image_url + image_urls
  {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select("id,jm_style_no,main_image_url,image_urls")
      .eq("jm_style_no", jmStyleNo)
      .maybeSingle();
    if (!error && data) {
      const urls = Array.isArray((data as any).image_urls)
        ? ((data as any).image_urls as any[]).map((x) => String(x)).filter(Boolean)
        : [];
      return {
        table,
        id: String((data as any).id),
        hasMain: true,
        hasUrls: true,
        hasUrlSingle: false,
        mainUrl: cleanUrl((data as any).main_image_url),
        urls,
      };
    }
  }

  // Try: image_url (single) + main_image_url
  {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select("id,jm_style_no,main_image_url,image_url")
      .eq("jm_style_no", jmStyleNo)
      .maybeSingle();
    if (!error && data) {
      const main = cleanUrl((data as any).main_image_url) || cleanUrl((data as any).image_url);
      const urls = cleanUrl((data as any).image_url) ? [String((data as any).image_url)] : [];
      return {
        table,
        id: String((data as any).id),
        hasMain: Boolean((data as any).main_image_url !== undefined),
        hasUrls: false,
        hasUrlSingle: Boolean((data as any).image_url !== undefined),
        mainUrl: main,
        urls,
      };
    }
  }

  // Try: only id exists
  {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select("id,jm_style_no")
      .eq("jm_style_no", jmStyleNo)
      .maybeSingle();
    if (!error && data) {
      return {
        table,
        id: String((data as any).id),
        hasMain: false,
        hasUrls: false,
        hasUrlSingle: false,
        mainUrl: null,
        urls: [],
      };
    }
  }

  return null;
}

async function updateProductImages(prod: ProductImages, nextMain: string | null, nextUrls: string[]) {
  const patch: any = {};
  if (prod.hasMain) patch.main_image_url = nextMain;
  if (prod.hasUrls) patch.image_urls = nextUrls;
  if (!prod.hasUrls && prod.hasUrlSingle) patch.image_url = nextMain;

  const { error } = await supabaseAdmin.from(prod.table).update(patch).eq("id", prod.id);
  if (error) throw new Error(error.message);
}

async function loadPoLineImages(poLineId: string) {
  const { data, error } = await supabaseAdmin
    .from("po_lines")
    .select("id,main_image_url,image_urls")
    .eq("id", poLineId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const urls = Array.isArray((data as any).image_urls)
    ? ((data as any).image_urls as any[]).map((x) => String(x)).filter(Boolean)
    : [];
  return { id: String((data as any).id), main: cleanUrl((data as any).main_image_url), urls };
}

async function updatePoLineImages(poLineId: string, nextMain: string | null, nextUrls: string[]) {
  const { error } = await supabaseAdmin
    .from("po_lines")
    .update({ main_image_url: nextMain, image_urls: nextUrls })
    .eq("id", poLineId);
  if (error) throw new Error(error.message);
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    const poLineIdRaw = asStr(form.get("poLineId"));
    const jmStyleNo = asStr(form.get("jmStyleNo"));
    const isMain = asStr(form.get("isMain")).toLowerCase() === "true";

    if (!file) return bad("file is required");
    if (!jmStyleNo) return bad("jmStyleNo is required");

    const poLineId = poLineIdRaw && isUuid(poLineIdRaw) ? poLineIdRaw : "";

    // 1) Load product images first (this is the core requirement: PO upload also persists to style/product)
    const prod = await loadProductImages(jmStyleNo);
    if (!prod) {
      // If product row doesn't exist, we still allow the upload for PO-only use.
      // But we return a clear message so you can decide to create the product later.
      // (We still proceed with storage upload and PO-line save if poLineId exists.)
    }

    // 2) Enforce limits
    if (prod && prod.hasUrls) {
      const current = [...prod.urls];
      const count = current.length + (isMain ? 0 : 1);
      // Style-side max is 3
      if (!isMain && current.length >= 3) return bad("Style images max 3.");
      if (isMain && current.length > 3) return bad("Style images max 3.");
      void count;
    }

    let poLine = null as null | { id: string; main: string | null; urls: string[] };
    if (poLineId) {
      poLine = await loadPoLineImages(poLineId);
      if (!poLine) return bad("poLineId not found");
      // PO-line side max is 3
      if (!isMain && poLine.urls.length >= 3) return bad("PO line images max 3.");
    }

    // 3) Upload to storage (style-images bucket)
    const ext = safeExtFromName(file.name);
    const buf = Buffer.from(await file.arrayBuffer());

    const safeStyle = jmStyleNo.replace(/[^a-zA-Z0-9_-]/g, "");
    const prefix = `po-uploads/${safeStyle}`;
    const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const path = `${prefix}/${filename}`;

    const { error: upErr } = await supabaseAdmin
      .storage
      .from("style-images")
      .upload(path, buf, { contentType: file.type || `image/${ext}`, upsert: false });
    if (upErr) return bad(upErr.message, 500);

    const { data: pub } = supabaseAdmin.storage.from("style-images").getPublicUrl(path);
    const publicUrl = pub?.publicUrl || "";
    if (!publicUrl) return bad("failed to create public url", 500);

    // 4) Persist to product
    if (prod) {
      const nextMain = isMain ? publicUrl : (prod.mainUrl || publicUrl);
      const nextUrls = prod.hasUrls ? (isMain ? prod.urls : [...prod.urls, publicUrl]) : prod.urls;

      // If style table is array-based, enforce 3.
      if (prod.hasUrls && nextUrls.length > 3) return bad("Style images max 3.");

      await updateProductImages(prod, nextMain, nextUrls);
    }

    // 5) Persist to PO line if available
    if (poLine) {
      const nextMain = isMain ? publicUrl : (poLine.main || publicUrl);
      const nextUrls = isMain ? poLine.urls : [...poLine.urls, publicUrl];
      if (!isMain && nextUrls.length > 3) return bad("PO line images max 3.");
      await updatePoLineImages(poLine.id, nextMain, nextUrls);

      return ok({
        url: publicUrl,
        path,
        poLineId: poLine.id,
        saved_to_po_line: true,
        saved_to_product: Boolean(prod),
      });
    }

    // If poLineId not yet available, we still succeed (saved to product only).
    return ok({
      url: publicUrl,
      path,
      poLineId: null,
      saved_to_po_line: false,
      saved_to_product: Boolean(prod),
      note: "PO line is not saved yet. Image was saved to the product/style side only.",
    });
  } catch (e: any) {
    return bad(e?.message || "server error", 500);
  }
}
