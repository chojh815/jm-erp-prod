// src/app/api/dev/products/upload-image/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}
function bad(message: string, status = 400, extra: any = {}) {
  return NextResponse.json({ success: false, error: message, ...extra }, { status });
}

const BUCKET = "style-images";

// POST: upload 1 image and append to product_development_headers.image_urls (max 3)
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const styleNo = String(form.get("styleNo") || "").trim();
    const file = form.get("file") as File | null;
    const slot = String(form.get("slot") || "1").trim(); // optional

    if (!styleNo) return bad("styleNo is required", 400);
    if (!file) return bad("file is required", 400);

    const safeStyle = styleNo.replace(/[^\w\-]/g, "");
    const name = (file as any)?.name ? String((file as any).name) : "image.webp";
    const dot = name.lastIndexOf(".");
    const ext = (dot >= 0 ? name.slice(dot + 1).toLowerCase() : "webp") || "webp";

    const filename = `${Date.now()}-slot${slot}.${ext}`;
    const path = `${safeStyle}/${filename}`;

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { error: upErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType: file.type || "image/webp", upsert: true });

    if (upErr) return bad("Failed to upload image.", 500, { detail: upErr.message });

    const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
    const publicUrl = pub?.publicUrl || null;
    if (!publicUrl) return bad("Failed to get public URL.", 500);

    // load header
    const { data: header, error: hErr } = await supabaseAdmin
      .from("product_development_headers")
      .select("id, image_urls")
      .eq("style_no", styleNo)
      .eq("is_deleted", false)
      .maybeSingle();

    if (hErr) return bad("Failed to load header.", 500, { detail: hErr.message });

    // If header missing, still return url (upload succeeded)
    if (!header?.id) return ok({ url: publicUrl, imageUrl: publicUrl, path });

    const prev: string[] = Array.isArray(header.image_urls) ? (header.image_urls as any) : [];
    // prepend new, de-dupe, keep max 3
    const merged = [publicUrl, ...prev.filter((u) => u !== publicUrl)].slice(0, 3);

    const { error: uErr } = await supabaseAdmin
      .from("product_development_headers")
      .update({ image_urls: merged })
      .eq("id", header.id);

    if (uErr) return bad("Failed to update header image_urls.", 500, { detail: uErr.message });

    return ok({ url: publicUrl, imageUrl: publicUrl, urls: merged, path });
  } catch (e: any) {
    return bad("Upload failed.", 500, { detail: e?.message || String(e) });
  }
}

// DELETE: remove images from Storage + remove urls from DB image_urls
// Usage: DELETE /api/dev/products/upload-image?styleNo=JS250001
// Optional: &url=<publicUrl> to delete only one image
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const styleNo = String(searchParams.get("styleNo") || "").trim();
    const targetUrl = searchParams.get("url"); // optional

    if (!styleNo) return bad("styleNo is required", 400);

    // load header
    const { data: header, error: hErr } = await supabaseAdmin
      .from("product_development_headers")
      .select("id, image_urls")
      .eq("style_no", styleNo)
      .eq("is_deleted", false)
      .maybeSingle();

    if (hErr) return bad("Failed to load header.", 500, { detail: hErr.message });

    const prev: string[] = Array.isArray(header?.image_urls) ? (header!.image_urls as any) : [];

    // Decide which urls to remove from DB
    const urlsToRemove = targetUrl ? [targetUrl] : prev.slice();

    // Convert public urls to storage paths and delete those objects.
    // If we can't parse url, we fallback to deleting the whole folder by listing.
    const safeStyle = styleNo.replace(/[^\w\-]/g, "");
    const paths: string[] = [];

    const parsePathFromPublicUrl = (u: string) => {
      // public URL pattern: .../storage/v1/object/public/<bucket>/<path>
      const marker = `/storage/v1/object/public/${BUCKET}/`;
      const idx = u.indexOf(marker);
      if (idx === -1) return null;
      return u.slice(idx + marker.length);
    };

    let canParseAll = true;
    for (const u of urlsToRemove) {
      const p = parsePathFromPublicUrl(String(u || ""));
      if (!p) { canParseAll = false; break; }
      paths.push(p);
    }

    if (!canParseAll) {
      // fallback: delete everything under style folder
      const { data: listed, error: lErr } = await supabaseAdmin.storage
        .from(BUCKET)
        .list(safeStyle, { limit: 200, sortBy: { column: "name", order: "asc" } });

      if (lErr) return bad("Failed to list storage files.", 500, { detail: lErr.message });

      const fullPaths = (listed || [])
        .filter((x: any) => x?.name)
        .map((x: any) => `${safeStyle}/${x.name}`);

      if (fullPaths.length) {
        const { error: rErr } = await supabaseAdmin.storage.from(BUCKET).remove(fullPaths);
        if (rErr) return bad("Failed to remove storage files.", 500, { detail: rErr.message });
      }
    } else {
      if (paths.length) {
        const { error: rErr } = await supabaseAdmin.storage.from(BUCKET).remove(paths);
        if (rErr) return bad("Failed to remove storage files.", 500, { detail: rErr.message });
      }
    }

    // Update DB image_urls
    if (header?.id) {
      const nextUrls = targetUrl ? prev.filter((u) => u !== targetUrl) : [];
      const { error: uErr } = await supabaseAdmin
        .from("product_development_headers")
        .update({ image_urls: nextUrls })
        .eq("id", header.id);

      if (uErr) return bad("Failed to update header image_urls.", 500, { detail: uErr.message });

      return ok({ removed: urlsToRemove.length, urls: nextUrls });
    }

    // header missing: still report success (storage deletion attempted)
    return ok({ removed: urlsToRemove.length, urls: [] });
  } catch (e: any) {
    return bad("Delete failed.", 500, { detail: e?.message || String(e) });
  }
}
