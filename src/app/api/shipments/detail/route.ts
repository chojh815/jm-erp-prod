// src/app/api/shipments/detail/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Shipment id is required." },
        { status: 400 }
      );
    }

    // 1) shipments 헤더: 컬럼 이름 나열하지 말고 전체(*)
    const { data: header, error: headerErr } = await supabaseAdmin
      .from("shipments")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (headerErr) {
      console.error("[ShipmentDetail] header error:", headerErr);
      return NextResponse.json(
        { success: false, error: headerErr.message },
        { status: 500 }
      );
    }

    if (!header) {
      return NextResponse.json(
        { success: false, error: "Shipment not found." },
        { status: 404 }
      );
    }

    // 2) shipment_lines 라인들도 전체(*)
    const { data: lines, error: linesErr } = await supabaseAdmin
      .from("shipment_lines")
      .select("*")
      .eq("shipment_id", id)
      .order("line_no", { ascending: true });

    if (linesErr) {
      console.error("[ShipmentDetail] lines error:", linesErr);
      return NextResponse.json(
        { success: false, error: linesErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        header,
        lines: lines ?? [],
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[ShipmentDetail] fatal error:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Unknown error." },
      { status: 500 }
    );
  }
}
