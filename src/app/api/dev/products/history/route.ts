import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const styleNo = searchParams.get("styleNo")?.toUpperCase();

  if (!styleNo)
    return NextResponse.json({ error: "styleNo required" }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from("dev_product_versions")
    .select("*")
    .eq("style_no", styleNo)
    .order("version_no", { ascending: false });

  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ items: data ?? [] });
}
