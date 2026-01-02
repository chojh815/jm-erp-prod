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

const STYLE_TABLE = "product_development_products";

async function loadProductByStyle(jmStyleNo: string) {
  const tries = [
    "id,jm_style_no,main_image_url,image_urls",
    "id,jm_style_no,image_url,image_urls",
    "id,jm_style_no,main_image_url,image_url",
    "id,jm_style_no,image_url",
  ];

  for (const sel of tries) {
    const { data, error } = await supabaseAdmin
      .from(STYLE_TABLE)
      .select(sel)
      .eq("jm_style_no", jmStyleNo)
      .maybeSingle();
    if (!error) {
      return { row: data as any, select: sel };
    }
    const msg = String(error.message || "").toLowerCase();
    if (!msg.includes("does not exist")) {
      throw error;
    }
  }
  return { row: null as any, select: "" };
}

function normalizeUrls(v: any): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(Boolean).map(String);
  if (typeof v === "string") return v ? [v] : [];
  return [];
}

function removeUrl(arr: string[], url: string): string[] {
  return arr.filter((x) => x !== url);
}

function shouldUpdate(colList: string, col: string) {
  const s = `,${colList.replace(/\s+/g, "")},`;
  return s.includes(`,${col},`);
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const url = asStr(body?.url);
    const poLineId = asStr(body?.poLineId);
    const jmStyleNo = asStr(body?.jmStyleNo);

    if (!url) return bad("url is required");

    // 1) Remove from PO line (optional)
    if (poLineId) {
      if (!isUuid(poLineId)) return bad("Invalid poLineId");

      const { data: poLine, error: e1 } = await supabaseAdmin
        .from("po_lines")
        .select("id,main_image_url,image_urls,image_url")
        .eq("id", poLineId)
        .maybeSingle();
      if (e1) throw e1;

      if (poLine) {
        const currentThumbs = normalizeUrls((poLine as any).image_urls ?? (poLine as any).image_url);
        const newThumbs = removeUrl(currentThumbs, url);
        const newMain = (poLine as any).main_image_url === url ? (newThumbs[0] || null) : (poLine as any).main_image_url;

        const updateObj: any = { updated_at: new Date().toISOString() };
        updateObj.main_image_url = newMain;
        updateObj.image_urls = newThumbs;

        // If the schema doesn't have image_urls, fall back to image_url (single)
        // Note: Supabase will error if column doesn't exist; we catch and retry.
        let u1 = await supabaseAdmin.from("po_lines").update(updateObj).eq("id", poLineId);
        if (u1.error) {
          const msg = String(u1.error.message || "").toLowerCase();
          if (msg.includes("image_urls") && msg.includes("does not exist")) {
            const fallback: any = { updated_at: updateObj.updated_at, main_image_url: newMain, image_url: newThumbs[0] || null };
            const u2 = await supabaseAdmin.from("po_lines").update(fallback).eq("id", poLineId);
            if (u2.error) throw u2.error;
          } else {
            throw u1.error;
          }
        }
      }
    }

    // 2) Remove from product/style table (optional but recommended)
    if (jmStyleNo) {
      const prod = await loadProductByStyle(jmStyleNo);
      if (prod.row) {
        const hasMain = shouldUpdate(prod.select, "main_image_url");
        const hasUrls = shouldUpdate(prod.select, "image_urls");
        const hasSingle = shouldUpdate(prod.select, "image_url");

        const currentThumbs = normalizeUrls((prod.row as any).image_urls ?? (prod.row as any).image_url);
        const newThumbs = removeUrl(currentThumbs, url);
        const newMain = (prod.row as any).main_image_url === url ? (newThumbs[0] || null) : (prod.row as any).main_image_url;

        const updateObj: any = { updated_at: new Date().toISOString() };
        if (hasMain) updateObj.main_image_url = newMain;
        if (hasUrls) updateObj.image_urls = newThumbs;
        if (!hasUrls && hasSingle) updateObj.image_url = newThumbs[0] || null;

        const u = await supabaseAdmin.from(STYLE_TABLE).update(updateObj).eq("id", (prod.row as any).id);
        if (u.error) {
          const msg = String(u.error.message || "").toLowerCase();
          if (!(msg.includes("does not exist"))) throw u.error;
          // if schema mismatch, ignore product update
        }
      }
    }

    // 3) Delete from storage (best effort)
    // We delete from the style-images bucket (same as upload route)
    // Derive path if the caller provides it; else try parsing from URL.
    const path = asStr(body?.path);
    const bucket = "style-images";

    const candidates: string[] = [];
    if (path) candidates.push(path);
    if (url.includes(`/storage/v1/object/public/${bucket}/`)) {
      const idx = url.indexOf(`/storage/v1/object/public/${bucket}/`);
      if (idx >= 0) {
        candidates.push(url.substring(idx + `/storage/v1/object/public/${bucket}/`.length));
      }
    }

    // attempt delete (ignore errors)
    if (candidates.length) {
      const unique = Array.from(new Set(candidates)).filter(Boolean);
      await supabaseAdmin.storage.from(bucket).remove(unique);
    }

    return ok({ url, deleted: true });
  } catch (e: any) {
    return bad(e?.message || "server error", 500);
  }
}
