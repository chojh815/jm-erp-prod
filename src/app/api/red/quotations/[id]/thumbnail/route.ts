import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../../_supabase";

export const dynamic = "force-dynamic";

const BUCKET = process.env.NEXT_PUBLIC_SUPABASE_RED_THUMB_BUCKET || "red-quotation-thumbnails";
const MAX_BYTES = 600 * 1024; // resized output cap

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const id = params?.id;

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `file too large (>${MAX_BYTES} bytes)` }, { status: 400 });
  }

  const ct = (file.type || "").toLowerCase();
  if (!["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(ct)) {
    return NextResponse.json({ error: "only jpg/png/webp allowed" }, { status: 400 });
  }

  const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg";
  const path = `red-quotations/${id}/thumbnail.${ext}`;

  const buf = new Uint8Array(await file.arrayBuffer());

  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, buf, {
    contentType: ct,
    upsert: true,
    cacheControl: "3600",
  });

  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const pub = supabase.storage.from(BUCKET).getPublicUrl(path);
  const publicUrl = pub?.data?.publicUrl || null;

  const { error: he } = await supabase
    .from("red_quotations")
    .update({ thumbnail_path: path, thumbnail_url: publicUrl })
    .eq("id", id);

  if (he) return NextResponse.json({ error: he.message }, { status: 500 });

  return NextResponse.json({ data: { path, publicUrl } });
}
