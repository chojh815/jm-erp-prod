import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * GET  /api/quotations/lines/:line_id/attachments
 * POST /api/quotations/lines/:line_id/attachments   (multipart/form-data: file, quotation_id)
 *
 * Storage bucket: quotation-attachments
 */

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_EXT = new Set(["pdf","png","jpg","jpeg","webp","xlsx","xls","csv","doc","docx","txt"]);

function extOf(name: string) {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

function getAuthedClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
      },
    }
  );
}

export async function GET(_: Request, { params }: { params: { line_id: string } }) {
  try {
    const lineId = params.line_id;

    const { data, error } = await supabaseAdmin
      .from("quotation_line_attachments")
      .select("*")
      .eq("quotation_line_id", lineId)
      .eq("is_deleted", false)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const bucket = "quotation-attachments";
    const items = await Promise.all(
      (data || []).map(async (r: any) => {
        const { data: s } = await supabaseAdmin.storage
          .from(bucket)
          .createSignedUrl(r.file_path, 60 * 30); // 30 minutes
        return { ...r, signed_url: s?.signedUrl || null };
      })
    );

    return NextResponse.json({ success: true, items });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || String(e) }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: { line_id: string } }) {
  try {
    const lineId = params.line_id;

    const sb = getAuthedClient();
    const { data: auth } = await sb.auth.getUser();
    const user = auth?.user || null;

    const form = await req.formData();
    const file = form.get("file");
    const quotationId = (form.get("quotation_id") || "").toString();

    if (!quotationId) {
      return NextResponse.json({ success: false, error: "quotation_id is required" }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: "file is required" }, { status: 400 });
    }

    const ext = extOf(file.name);
    if (!ext || !ALLOWED_EXT.has(ext)) {
      return NextResponse.json({ success: false, error: `Not allowed file type: .${ext || "?"}` }, { status: 400 });
    }
    if ((file as any).size > MAX_FILE_BYTES) {
      return NextResponse.json({ success: false, error: "File too large (10MB limit)" }, { status: 413 });
    }

    const bucket = "quotation-attachments";
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");

    const safeName = file.name.replace(/[^\w.\-()\s]/g, "_");
    const path = `quotation/${quotationId}/line/${lineId}/${y}${m}${d}_${crypto.randomUUID()}_${safeName}`;

    const arrayBuf = await file.arrayBuffer();
    const buf = new Uint8Array(arrayBuf);

    const { error: upErr } = await supabaseAdmin.storage
      .from(bucket)
      .upload(path, buf, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
    if (upErr) throw upErr;

    const row = {
      quotation_id: quotationId,
      quotation_line_id: lineId,
      file_name: file.name,
      file_path: path,
      mime_type: file.type || null,
      file_size: (file as any).size ?? null,
      created_by: user?.id ?? null,
      created_by_email: (user?.email as string) ?? null,
    };

    const { data: ins, error: insErr } = await supabaseAdmin
      .from("quotation_line_attachments")
      .insert(row)
      .select("*")
      .single();
    if (insErr) throw insErr;

    const { data: s } = await supabaseAdmin.storage.from(bucket).createSignedUrl(path, 60 * 30);

    return NextResponse.json({ success: true, item: { ...ins, signed_url: s?.signedUrl || null } });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || String(e) }, { status: 500 });
  }
}
