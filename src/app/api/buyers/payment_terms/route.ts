// src/app/api/payment_terms/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("payment_terms")
      .select("id, code, name, description, days")
      .order("display_order", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      console.error("GET /api/payment_terms error", error);
      return NextResponse.json(
        { error: error.message ?? "Failed to load payment terms." },
        { status: 500 }
      );
    }

    return NextResponse.json({ items: data ?? [] });
  } catch (err) {
    console.error("GET /api/payment_terms unexpected", err);
    return NextResponse.json(
      { error: "Unexpected server error." },
      { status: 500 }
    );
  }
}
