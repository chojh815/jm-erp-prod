import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function json(body: any, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const styleNo = String(searchParams.get("styleNo") || "")
      .trim()
      .toUpperCase();

    if (!styleNo) {
      return json({ error: "styleNo required" }, 400);
    }

    // 1차: jm_style_no로 바로 조회
    const directRes = await supabaseAdmin
      .from("product_development_versions")
      .select("*")
      .eq("is_deleted", false)
      .eq("jm_style_no", styleNo)
      .order("version_no", { ascending: false });

    if (directRes.error) {
      return json({ error: directRes.error.message }, 400);
    }

    const directItems = directRes.data ?? [];
    if (directItems.length > 0) {
      return json({ items: directItems });
    }

    // 2차 fallback: header → product_id
    const headerRes = await supabaseAdmin
      .from("product_development_headers")
      .select("id")
      .eq("is_deleted", false)
      .eq("style_no", styleNo)
      .maybeSingle();

    if (headerRes.error) {
      return json({ error: headerRes.error.message }, 400);
    }

    const header = headerRes.data;
    if (!header?.id) {
      return json({ items: [] });
    }

    const byProductRes = await supabaseAdmin
      .from("product_development_versions")
      .select("*")
      .eq("is_deleted", false)
      .eq("product_id", header.id)
      .order("version_no", { ascending: false });

    if (byProductRes.error) {
      return json({ error: byProductRes.error.message }, 400);
    }

    return json({ items: byProductRes.data ?? [] });
  } catch (err: any) {
    return json({ error: err?.message || "Unknown error" }, 500);
  }
}