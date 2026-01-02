// src/app/api/buyer_departments/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const buyerId = searchParams.get("buyerId");

  // buyerId 없으면 그냥 빈 배열
  if (!buyerId) {
    return NextResponse.json({ items: [] });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("buyer_departments")
      .select("id, code, name")
      .eq("buyer_id", buyerId)
      .order("name", { ascending: true });

    if (error) {
      console.error("GET /api/buyer_departments error", error);
      return NextResponse.json(
        { error: error.message ?? "Failed to load buyer departments." },
        { status: 500 }
      );
    }

    return NextResponse.json({ items: data ?? [] });
  } catch (err) {
    console.error("GET /api/buyer_departments unexpected", err);
    return NextResponse.json(
      { error: "Unexpected server error." },
      { status: 500 }
    );
  }
}
