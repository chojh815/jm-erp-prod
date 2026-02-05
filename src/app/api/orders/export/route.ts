import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function n(v:any){const x=Number(v);return Number.isFinite(x)?x:0;}

export async function GET(req: Request){
  const { searchParams } = new URL(req.url);

  // SAME FILTERS AS LIST
  const q = searchParams.get("q")?.trim() || "";
  const status = searchParams.get("status") || "";
  const buyer = searchParams.get("buyer") || "";
  const brand = searchParams.get("brand") || "";

  let qy = supabaseAdmin
    .from("po_headers")
    .select(`id, po_no, order_date, req_ship_date, ship_mode, currency, subtotal, status, buyer_brand_name, buyer_style_no`)
    .eq("is_deleted", false);

  if (status) qy = qy.eq("status", status);
  if (buyer) qy = qy.eq("buyer_id", buyer);
  if (brand) qy = qy.ilike("buyer_brand_name", `%${brand}%`);
  if (q) qy = qy.or(`po_no.ilike.%${q}%,buyer_style_no.ilike.%${q}%,buyer_brand_name.ilike.%${q}%`);

  const { data, error } = await qy.order("order_date", { ascending: false });
  if (error) return NextResponse.json({ success:false, error: error.message }, { status: 500 });

  const items = (data||[]).map((r:any)=>({
    id: r.id,
    poNo: r.po_no,
    orderDate: r.order_date,
    reqShipDate: r.req_ship_date,
    shipMode: r.ship_mode,
    currency: r.currency,
    subtotal: n(r.subtotal),
    status: r.status,
    mainBuyerBrand: r.buyer_brand_name,
    mainBuyerStyleNo: r.buyer_style_no,
  }));

  const totalsByCurrency: Record<string, number> = {};
  for (const it of items){
    const cur = it.currency || "UNKNOWN";
    totalsByCurrency[cur] = (totalsByCurrency[cur]||0) + n(it.subtotal);
  }

  return NextResponse.json({
    success: true,
    items,
    totalCount: items.length,
    grandTotalsByCurrency: totalsByCurrency
  });
}