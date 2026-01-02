import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}
function bad(message: string, status = 400, extra: any = {}) {
  return NextResponse.json({ success: false, error: message, ...extra }, { status });
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isUuid(v: any) {
  return typeof v === "string" && UUID_RE.test(v);
}

function uniq(arr: string[]) {
  return Array.from(new Set(arr.filter(Boolean)));
}

// Expect public url like: https://<project>.supabase.co/storage/v1/object/public/<bucket>/<path>
function parsePublicUrl(url: string) {
  const m = url.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
  if (!m) return null;
  return { bucket: decodeURIComponent(m[1]), path: decodeURIComponent(m[2]) };
}

async function getPoLine(poLineId: string) {
  const { data, error } = await supabaseAdmin
    .from("po_lines")
    .select("id, main_image_url, image_urls, image_url")
    .eq("id", poLineId)
    .single();
  if (error) throw error;

  const main = (data as any).main_image_url || (data as any).image_url || null;
  const thumbsRaw = (data as any).image_urls;
  const thumbs = Array.isArray(thumbsRaw)
    ? thumbsRaw
    : typeof thumbsRaw === "string"
      ? (() => { try { return JSON.parse(thumbsRaw); } catch { return []; } })()
      : [];

  return { main: main as string | null, thumbs: thumbs as string[] };
}

async function updatePoLine(poLineId: string, main: string | null, thumbs: string[]) {
  const payload: any = { main_image_url: main, image_urls: thumbs, image_url: null };
  let { error } = await supabaseAdmin.from("po_lines").update(payload).eq("id", poLineId);

  if (error && String((error as any).message || error).includes("main_image_url")) {
    const legacyPayload: any = { image_url: main, image_urls: thumbs };
    const r = await supabaseAdmin.from("po_lines").update(legacyPayload).eq("id", poLineId);
    error = r.error as any;
  }
  if (error) throw error;
}

async function getStyle(jmStyleNo: string) {
  let res = await supabaseAdmin
    .from("dev_products")
    .select("jm_style_no, main_image_url, image_urls")
    .eq("jm_style_no", jmStyleNo)
    .maybeSingle();

  if (res.error && String((res.error as any).message || res.error).includes("main_image_url")) {
    res = await supabaseAdmin
      .from("dev_products")
      .select("jm_style_no, image_url, image_urls")
      .eq("jm_style_no", jmStyleNo)
      .maybeSingle();
  }
  if (res.error) throw res.error;

  const row: any = res.data || null;
  const main = row?.main_image_url || row?.image_url || null;
  const thumbsRaw = row?.image_urls;
  const thumbs = Array.isArray(thumbsRaw)
    ? thumbsRaw
    : typeof thumbsRaw === "string"
      ? (() => { try { return JSON.parse(thumbsRaw); } catch { return []; } })()
      : [];
  return { main: main as string | null, thumbs: thumbs as string[], hasMainCol: !!row?.main_image_url };
}

async function updateStyle(jmStyleNo: string, main: string | null, thumbs: string[]) {
  // try modern then legacy
  let r = await supabaseAdmin
    .from("dev_products")
    .update({ main_image_url: main, image_urls: thumbs })
    .eq("jm_style_no", jmStyleNo);

  if (r.error && String((r.error as any).message || r.error).includes("main_image_url")) {
    r = await supabaseAdmin
      .from("dev_products")
      .update({ image_url: main, image_urls: thumbs })
      .eq("jm_style_no", jmStyleNo);
  }
  if (r.error) throw r.error;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const imageUrl = String(body.imageUrl || "");
    const jmStyleNo = String(body.jmStyleNo || "");
    const poLineId = body.poLineId ? String(body.poLineId) : "";

    if (!imageUrl) return bad("imageUrl is required");
    if (!jmStyleNo) return bad("jmStyleNo is required");

    // 1) Remove from Storage if possible (best-effort)
    const parsed = parsePublicUrl(imageUrl);
    let storageDeleted = false;
    if (parsed) {
      const del = await supabaseAdmin.storage.from(parsed.bucket).remove([parsed.path]);
      if (!del.error) storageDeleted = true;
    }

    // 2) Remove from PO line (if provided)
    let poLineUpdated = false;
    if (poLineId && isUuid(poLineId)) {
      const cur = await getPoLine(poLineId);
      let main = cur.main;
      let thumbs = [...cur.thumbs];

      if (main === imageUrl) main = null;
      thumbs = thumbs.filter((u) => u !== imageUrl);

      // If main removed but thumbs exist, promote first thumb to main
      if (!main && thumbs.length > 0) {
        main = thumbs[0];
        thumbs = thumbs.slice(1);
      }

      thumbs = uniq(thumbs).slice(0, 2);
      await updatePoLine(poLineId, main, thumbs);
      poLineUpdated = true;
    }

    // 3) Remove from STYLE (best-effort). If style table is missing/blocked, do not fail the delete.
    let styleUpdated = false;
    try {
      const st = await getStyle(jmStyleNo);
      let main = st.main;
      let thumbs = [...st.thumbs];

      if (main === imageUrl) main = null;
      thumbs = thumbs.filter((u) => u !== imageUrl);

      if (!main && thumbs.length > 0) {
        main = thumbs[0];
        thumbs = thumbs.slice(1);
      }

      thumbs = uniq(thumbs).slice(0, 2);
      await updateStyle(jmStyleNo, main, thumbs);
      styleUpdated = true;
    } catch {
      styleUpdated = false;
    }

    return ok({ storageDeleted, poLineUpdated, styleUpdated });
  } catch (e: any) {
    return bad(e?.message || "Unexpected error", 500);
  }
}