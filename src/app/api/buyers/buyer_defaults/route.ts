// src/app/api/buyer_defaults/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const buyerId = searchParams.get("buyerId");

  // buyerId가 없으면 그냥 빈 값 리턴 (초기 렌더링용)
  if (!buyerId) {
    return NextResponse.json({ buyer: null });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("buyers")
      .select(
        `
        id,
        code,
        name,
        default_destination,
        default_final_destination,
        payment_term_id,
        default_brand_id,
        default_department_id
      `
      )
      .eq("id", buyerId)
      .maybeSingle();

    if (error) {
      console.error("GET /api/buyer_defaults error", error);
      return NextResponse.json(
        { error: error.message ?? "Failed to load buyer defaults." },
        { status: 500 }
      );
    }

    return NextResponse.json({ buyer: data ?? null });
  } catch (err) {
    console.error("GET /api/buyer_defaults unexpected", err);
    return NextResponse.json(
      { error: "Unexpected server error." },
      { status: 500 }
    );
  }
}
