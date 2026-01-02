// src/app/api/dev/products/delete-image/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}
function bad(message: string, status = 400, extra: any = {}) {
  return NextResponse.json({ success: false, error: message, ...extra }, { status });
}

// dev_products.image_url 이 public URL일 수도 있고, 이미 path만 저장했을 수도 있어서 둘 다 처리
function extractStoragePath(imageUrlOrPath: string): { bucket: string; path: string } | null {
  const v = String(imageUrlOrPath || "").trim();
  if (!v) return null;

  // 1) 이미 "bucket/path" 형태로 저장된 경우
  if (!v.startsWith("http") && v.includes("/")) {
    // 예: "dev-products/JS250001.jpg" 또는 "style-images/xxx.webp"
    const parts = v.split("/").filter(Boolean);
    if (parts.length >= 2) {
      const bucket = parts[0];
      const path = parts.slice(1).join("/");
      return { bucket, path };
    }
  }

  // 2) Public URL 형태: .../storage/v1/object/public/<bucket>/<path>
  try {
    const u = new URL(v);
    const p = u.pathname; // /storage/v1/object/public/bucket/path...
    const m = p.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
    if (m && m[1] && m[2]) return { bucket: m[1], path: decodeURIComponent(m[2]) };
  } catch {
    // ignore
  }

  return null;
}

async function findProductByStyleNo(styleNo: string) {
  const { data, error } = await supabaseAdmin
    .from("dev_products")
    .select("*")
    .eq("style_no", styleNo)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const styleNo = (url.searchParams.get("styleNo") || url.searchParams.get("style_no") || "").trim();

    if (!styleNo) {
      return bad("Missing styleNo", 400);
    }

    const product = await findProductByStyleNo(styleNo);

    if (!product) {
      // 없으면 “삭제할 것도 없음”으로 처리(프론트가 막히지 않게)
      return ok({ message: "No product found. Nothing to delete." });
    }

    const imageUrl = (product.image_url ?? "") as string;

    // 1) 스토리지 파일 삭제(가능한 경우만)
    const info = extractStoragePath(imageUrl);
    if (info) {
      const { bucket, path } = info;
      const { error: removeErr } = await supabaseAdmin.storage.from(bucket).remove([path]);

      // 스토리지 삭제가 실패하더라도 DB NULL 업데이트는 진행(운영 편의)
      if (removeErr) {
        console.warn("storage remove error:", removeErr);
      }
    }

    // 2) DB에서 image_url을 null로
    const { error: updErr } = await supabaseAdmin
      .from("dev_products")
      .update({ image_url: null })
      .eq("style_no", styleNo);

    if (updErr) {
      console.error("DB update error:", updErr);
      return bad("DB update failed.", 500, { detail: updErr.message });
    }

    return ok({ message: "Image removed.", style_no: styleNo });
  } catch (e: any) {
    console.error("delete-image route error:", e);
    return bad("Internal server error", 500, { detail: e?.message || String(e) });
  }
}
