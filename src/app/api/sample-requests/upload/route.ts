import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type UploadKind = "attachments" | "reference_images" | "shipment_proof_files";
const BUCKET = "sample-requests";

function bad(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...(extra ?? {}) }, { status, headers: { "Cache-Control": "no-store" } });
}

function sanitizeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

async function ensureBucket() {
  const { data, error } = await supabaseAdmin.storage.getBucket(BUCKET);
  if (!error && data) return;
  const create = await supabaseAdmin.storage.createBucket(BUCKET, { public: true, fileSizeLimit: "25MB" });
  if (create.error && !String(create.error.message || "").toLowerCase().includes("already exists")) throw create.error;
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    const kindRaw = String(form.get("kind") || "attachments").trim();
    const kind: UploadKind = ["attachments", "reference_images", "shipment_proof_files"].includes(kindRaw) ? (kindRaw as UploadKind) : "attachments";
    if (!(file instanceof File)) return bad("File is required", 400);
    if (!file.size) return bad("Empty file", 400);

    await ensureBucket();

    const now = new Date();
    const y = String(now.getUTCFullYear());
    const m = String(now.getUTCMonth() + 1).padStart(2, "0");
    const d = String(now.getUTCDate()).padStart(2, "0");
    const stamp = `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
    const safeName = sanitizeName(file.name || "file");
    const path = `${kind}/${y}/${m}/${d}/${stamp}-${safeName}`;

    const bytes = Buffer.from(await file.arrayBuffer());
    const up = await supabaseAdmin.storage.from(BUCKET).upload(path, bytes, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
    if (up.error) return bad(up.error.message || "Upload failed", 500);

    const pub = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
    return NextResponse.json({ ok: true, file: { name: file.name, path, url: pub.data.publicUrl, size: file.size, type: file.type || null, kind } }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return bad(e?.message || "Upload failed", 500);
  }
}
