import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/app/api/_supabase";

export const dynamic = "force-dynamic";

const BUCKET = "red-quotation-images";
const MAX_IMAGES = 3;
const SIGNED_SECONDS = 60 * 60; // 1 hour

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

function extFromMime(mime: string) {
  const m = (mime || "").toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("webp")) return "webp";
  if (m.includes("gif")) return "gif";
  return "bin";
}

/**
 * GET /api/red/quotations/[id]/images
 * Returns: [{id, quotation_id, path, filename, mime_type, size_bytes, created_at, signed_url}]
 */
export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createSupabaseServerClient();
    const quotationId = params.id;

    const { data: rows, error } = await supabase
      .from("red_quotation_images")
      .select("id, quotation_id, path, filename, mime_type, size_bytes, created_at")
      .eq("quotation_id", quotationId)
      .order("created_at", { ascending: true });

    if (error) throw error;

    const out = [];
    for (const r of rows || []) {
      let signed_url: string | null = null;
      if (r.path) {
        const { data: s, error: se } = await supabase.storage.from(BUCKET).createSignedUrl(r.path, SIGNED_SECONDS);
        if (!se) signed_url = s?.signedUrl ?? null;
      }
      out.push({ ...r, signed_url });
    }

    return NextResponse.json({ data: out });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "GET images failed" }, { status: 500 });
  }
}

/**
 * POST /api/red/quotations/[id]/images
 * multipart/form-data: files[]
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createSupabaseServerClient();
    const quotationId = params.id;

    // Check count
    const { count, error: cErr } = await supabase
      .from("red_quotation_images")
      .select("id", { count: "exact", head: true })
      .eq("quotation_id", quotationId);

    if (cErr) throw cErr;
    if ((count || 0) >= MAX_IMAGES) return bad(`Max ${MAX_IMAGES} images allowed`, 409);

    const form = await req.formData();
    const files = form.getAll("files").filter(Boolean) as File[];
    if (!files || files.length === 0) return bad("No files");
    const remain = Math.max(0, MAX_IMAGES - (count || 0));
    const list = files.slice(0, remain);

    const inserted = [];

    for (const f of list) {
      const mime = (f as any).type || "application/octet-stream";
      if (!mime.startsWith("image/")) return bad("Only image files allowed", 415);

      const bytes = await f.arrayBuffer();
      const id = crypto.randomUUID();
      const filename = (f as any).name || `${id}.${extFromMime(mime)}`;
      const ext = filename.includes(".") ? filename.split(".").pop() : extFromMime(mime);
      const path = `quotations/${quotationId}/${id}.${ext}`;

      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, bytes, {
        contentType: mime,
        upsert: false,
      });
      if (upErr) throw upErr;

      const { data: row, error: iErr } = await supabase
        .from("red_quotation_images")
        .insert({
          id,
          quotation_id: quotationId,
          path,
          filename,
          mime_type: mime,
          size_bytes: (bytes as any).byteLength ?? null,
        })
        .select("id, quotation_id, path, filename, mime_type, size_bytes, created_at")
        .single();

      if (iErr) throw iErr;
      inserted.push(row);
    }

    return NextResponse.json({ data: inserted });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "POST images failed" }, { status: 500 });
  }
}
