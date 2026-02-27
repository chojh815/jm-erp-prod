// src/app/api/debug-db/route.ts (없으면 생성)
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const envNextPublic = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const envServer = process.env.SUPABASE_URL ?? "";

  const { count: invoiceCnt } = await supabaseAdmin
    .from("invoice_headers")
    .select("id", { count: "exact", head: true });

  const { count: packingCnt } = await supabaseAdmin
    .from("packing_list_headers")
    .select("id", { count: "exact", head: true });

  const { count: shipmentCnt } = await supabaseAdmin
    .from("shipments")
    .select("id", { count: "exact", head: true });

  return NextResponse.json(
    {
      now: new Date().toISOString(),
      NEXT_PUBLIC_SUPABASE_URL: envNextPublic,
      SUPABASE_URL: envServer,
      counts: {
        invoice_headers: invoiceCnt ?? null,
        packing_list_headers: packingCnt ?? null,
        shipments: shipmentCnt ?? null,
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}