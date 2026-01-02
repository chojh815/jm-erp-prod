import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}
function bad(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function asArray(v: any): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  // jsonb can come as stringified json
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {}
  }
  return [];
}

function uniq(arr: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of arr) {
    const s = String(x || "").trim();
    if (!s) continue;
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

function guessExtFromFile(file: File) {
  const name = (file as any)?.name ? String((file as any).name) : "";
  const m = name.toLowerCase().match(/\.(png|jpe?g|webp|gif)$/);
  if (m) return m[1] === "jpeg" ? "jpg" : m[1];
  const type = String((file as any)?.type || "").toLowerCase();
  if (type.includes("png")) return "png";
  if (type.includes("jpeg")) return "jpg";
  if (type.includes("webp")) return "webp";
  if (type.includes("gif")) return "gif";
  return "png";
}

function pickBucket() {
  // keep compatibility if you later rename bucket
  return process.env.STYLE_IMAGES_BUCKET || "style-images";
}

async function getPublicUrl(bucket: string, path: string) {
  // public bucket assumed. If not, you'd need signed URLs.
  const { data } = supabaseAdmin.storage.from(bucket).getPublicUrl(path);
  return data?.publicUrl || "";
}

async function upsertDevProductImage(jmStyleNo: string, url: string, kind?: string | null) {
  // Save uploaded image into dev_products so style image becomes available everywhere.
  // Columns observed: image_url(text), image_urls(jsonb), main_image_url(text)
  const { data: prod, error } = await supabaseAdmin
    .from("dev_products")
    .select("id, image_url, image_urls, main_image_url")
    .eq("jm_style_no", jmStyleNo)
    .maybeSingle();

  if (error) throw error;

  if (!prod?.id) {
    // If dev_products row doesn't exist yet, we still return success.
    return { updated: false };
  }

  const currentUrls = asArray(prod.image_urls);
  const nextUrls = uniq([...currentUrls, url]);

  // Style-level limit: keep at most 3 (your existing rule)
  const trimmedUrls = nextUrls.slice(0, 3);

  const nextMain =
    kind === "main"
      ? url
      : (prod.main_image_url ? String(prod.main_image_url) : (trimmedUrls[0] || url));

  const nextLegacy = prod.image_url ? String(prod.image_url) : nextMain;

  const { error: uErr } = await supabaseAdmin
    .from("dev_products")
    .update({
      image_urls: trimmedUrls,
      main_image_url: nextMain || null,
      image_url: nextLegacy || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", prod.id);

  if (uErr) throw uErr;

  return { updated: true, image_urls: trimmedUrls, main_image_url: nextMain, image_url: nextLegacy };
}

async function updatePoLineImage(poLineId: string, url: string, kind?: string | null) {
  // Optional: If PO line exists, also save to po_lines image columns.
  const { data: line, error } = await supabaseAdmin
    .from("po_lines")
    .select("id, image_url, image_urls, main_image_url")
    .eq("id", poLineId)
    .maybeSingle();

  if (error) throw error;
  if (!line?.id) return { updated: false };

  const curThumbs = asArray(line.image_urls);
  const curMain = line.main_image_url ? String(line.main_image_url) : "";
  const all = uniq([curMain, ...curThumbs].filter(Boolean));

  // PO upload max 3 (total including main+thumbs)
  if (!all.includes(url) && all.length >= 3) {
    return { updated: false, maxed: true };
  }

  let nextMain = curMain;
  let nextThumbs = curThumbs;

  if (kind === "main") {
    nextMain = url;
  } else {
    nextThumbs = uniq([...curThumbs, url]);
  }

  // ensure total max 3
  const recombined = uniq([nextMain, ...nextThumbs].filter(Boolean)).slice(0, 3);
  // prefer main if set
  if (nextMain && !recombined.includes(nextMain)) {
    recombined.unshift(nextMain);
  }
  const final = recombined.slice(0, 3);
  // choose main as first if current main empty
  if (!nextMain) nextMain = final[0] || "";

  // thumbnails are the remaining (excluding main)
  const finalThumbs = final.filter((u) => u && u !== nextMain);

  const { error: uErr } = await supabaseAdmin
    .from("po_lines")
    .update({
      main_image_url: nextMain || null,
      image_url: nextMain || null,
      image_urls: finalThumbs,
      updated_at: new Date().toISOString(),
    })
    .eq("id", poLineId);

  if (uErr) throw uErr;

  return { updated: true, main_image_url: nextMain, image_urls: finalThumbs, image_url: nextMain };
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();

    const file = form.get("file");
    const jmStyleNo = String(form.get("jmStyleNo") || "").trim();
    const poLineIdRaw = String(form.get("poLineId") || "").trim();
    const kind = String(form.get("kind") || "").trim() || null;

    if (!jmStyleNo) return bad("jmStyleNo is required.", 400);
    if (!(file instanceof File)) return bad("file is required.", 400);
    if (file.size <= 0) return bad("file is empty.", 400);

    const bucket = pickBucket();
    const ext = guessExtFromFile(file);
    const safeStyle = jmStyleNo.replace(/[^A-Za-z0-9_-]/g, "");
    const rand = Math.random().toString(36).slice(2, 10);
    const path = `styles/${safeStyle}/${Date.now()}_${rand}.${ext}`;

    const arrayBuf = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuf);

    const { error: upErr } = await supabaseAdmin.storage
      .from(bucket)
      .upload(path, bytes, {
        contentType: file.type || (ext === "jpg" ? "image/jpeg" : `image/${ext}`),
        upsert: false,
      });

    if (upErr) return bad(upErr.message || "Storage upload failed.", 500);

    const publicUrl = await getPublicUrl(bucket, path);
    if (!publicUrl) return bad("Upload succeeded but public URL could not be generated.", 500);

    // 1) always store to dev_products as the "source of truth" for style images
    const prodRes = await upsertDevProductImage(jmStyleNo, publicUrl, kind);

    // 2) optionally store to po_lines if a real DB line id was provided
    let poRes: any = null;
    if (poLineIdRaw) {
      poRes = await updatePoLineImage(poLineIdRaw, publicUrl, kind);
      if (poRes?.maxed) {
        // Rollback storage + dev_product update is messy; we keep the style image and just reject PO-line attach.
        // This is OK because PO upload is a convenience to backfill product images.
        return ok({
          imageUrl: publicUrl,
          url: publicUrl,
          savedToProduct: true,
          savedToPoLine: false,
          warning: "PO line already has maximum 3 images. Image was saved to Product images only.",
          product: prodRes,
        });
      }
    }

    return ok({
      imageUrl: publicUrl,
      url: publicUrl,
      bucket,
      path,
      savedToProduct: !!prodRes?.updated,
      savedToPoLine: !!poRes?.updated,
      product: prodRes,
      poLine: poRes,
    });
  } catch (e: any) {
    console.error("styles/upload-image POST error:", e);
    return bad(e?.message || "Unexpected server error.", 500);
  }
}
