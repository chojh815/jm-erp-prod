// src/app/api/invoices/create/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// ✅ A안: 이미 만들어둔 create-from-shipment 로직을 그대로 재사용(프록시)
import { POST as createFromShipmentPOST } from "../create-from-shipment/route";

function bad(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}
function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}

/**
 * GET /api/invoices/create?q=...
 * - "Create Invoice (from Shipment)" 화면에서 Shipment 목록 로딩할 때 쓰는 엔드포인트로 사용
 * - 프론트가 이미 /api/invoices/create 를 호출하고 있으니 여기에 맞춰준다
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") ?? "").trim();

    let query = supabaseAdmin
      .from("shipments")
      .select(
        "id, shipment_no, po_no, buyer_id, buyer_name, currency, status, etd, eta, total_cartons, total_gw, total_nw, created_at, is_deleted"
      )
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .limit(100);

    if (q) {
      const like = `%${q}%`;
      query = query.or(`shipment_no.ilike.${like},po_no.ilike.${like},buyer_name.ilike.${like}`);
    }

    const { data, error } = await query;
    if (error) return bad(error.message, 500);

    return ok({ rows: data ?? [] });
  } catch (err: any) {
    console.error("GET /api/invoices/create error:", err);
    return bad(err?.message || "Internal Server Error", 500);
  }
}

/**
 * POST /api/invoices/create
 * - 프론트가 기존에 이 URL로 Invoice 생성 요청을 보내도
 * - 실제 생성은 A안 /api/invoices/create-from-shipment 로직이 처리하도록 프록시
 */
export async function POST(req: Request) {
  return createFromShipmentPOST(req);
}
