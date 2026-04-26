import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const BUCKET = "production-order-images";

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data }, { headers: { "Cache-Control": "no-store" } });
}

function bad(message: string, status = 400) {
  return NextResponse.json(
    { success: false, error: message },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

function sanitizeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

async function ensureBucket() {
  const { data, error } = await supabaseAdmin.storage.getBucket(BUCKET);
  if (!error && data) return;

  const created = await supabaseAdmin.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: "10MB",
  });
  if (
    created.error &&
    !String(created.error.message || "").toLowerCase().includes("already exists")
  ) {
    throw created.error;
  }
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");

    if (!(file instanceof File)) return bad("Image file is required", 400);
    if (!file.size) return bad("Empty file", 400);
    if (!(file.type || "").startsWith("image/")) return bad("Only image files are allowed", 400);

    await ensureBucket();

    const now = new Date();
    const y = String(now.getUTCFullYear());
    const m = String(now.getUTCMonth() + 1).padStart(2, "0");
    const d = String(now.getUTCDate()).padStart(2, "0");
    const stamp = `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
    const safeName = sanitizeName(file.name || "image");
    const path = `reference-images/${y}/${m}/${d}/${stamp}-${safeName}`;

    const bytes = Buffer.from(await file.arrayBuffer());
    const uploaded = await supabaseAdmin.storage.from(BUCKET).upload(path, bytes, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
    if (uploaded.error) return bad(uploaded.error.message || "Upload failed", 500);

    const pub = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);

    return ok({
      file: {
        name: file.name,
        path,
        url: pub.data.publicUrl,
        size: file.size,
        type: file.type || null,
      },
    });
  } catch (e: any) {
    return bad(e?.message || "Upload failed", 500);
  }
}
