import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: NextRequest) {
  const styleNo = new URL(req.url).searchParams
    .get("styleNo")
    ?.toUpperCase();

  if (!styleNo)
    return NextResponse.json({ valid: false });

  const regex = /^J[A-Z][0-9]{6}[A-Z]?$/;
  const valid = regex.test(styleNo);

  if (!valid)
    return NextResponse.json({ valid, exists: false });

  const { data } = await supabaseAdmin
    .from("dev_products")
    .select("style_no")
    .eq("style_no", styleNo)
    .is("deleted_at", null)
    .maybeSingle();

  return NextResponse.json({
    valid,
    exists: !!data,
  });
}
