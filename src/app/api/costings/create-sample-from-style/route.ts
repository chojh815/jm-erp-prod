import { NextResponse } from "next/server";
import { requireUser } from "../_utils";

export const dynamic = "force-dynamic";

function normStyle(s: string) {
  return (s || "").toString().trim();
}

function pickBuyerDefaultMarginPct(buyerRow: any): number | null {
  const cands = [
    buyerRow?.buyer_default_margin_pct,
    buyerRow?.default_margin_pct,
    buyerRow?.margin_pct,
    buyerRow?.margin_default_pct,
  ];
  for (const v of cands) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export async function POST(req: Request) {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const styleNo = normStyle(body?.style_no);
  const buyerId = (body?.buyer_id ?? "").toString().trim() || null;

  if (!styleNo) return NextResponse.json({ success: false, error: "style_no is required" }, { status: 400 });

  const { data: pd, error: pErr } = await supabase
    .from("product_development_products")
    .select("id, style_no")
    .ilike("style_no", styleNo)
    .maybeSingle();

  if (pErr) return NextResponse.json({ success: false, error: pErr.message }, { status: 500 });
  if (!pd) return NextResponse.json({ success: false, error: "Style not found" }, { status: 404 });

  let buyerCode: string | null = null;
  let buyerName: string | null = null;
  let defaultMargin: number | null = null;

  if (buyerId) {
    const { data: buyer, error: bErr } = await supabase.from("companies").select("*").eq("id", buyerId).maybeSingle();
    if (bErr) return NextResponse.json({ success: false, error: bErr.message }, { status: 500 });
    if (buyer) {
      buyerCode =
        (buyer?.buyer_code ?? buyer?.code ?? buyer?.company_code ?? buyer?.short_code ?? "").toString().trim() || null;
      buyerName =
        (buyer?.buyer_name ?? buyer?.name ?? buyer?.company_name ?? buyer?.full_name ?? "").toString().trim() || null;
      defaultMargin = pickBuyerDefaultMarginPct(buyer);
    }
  }

  let exQ = supabase
    .from("costing_headers")
    .select("*")
    .eq("is_deleted", false)
    .eq("stage", "SAMPLE")
    .eq("style_no", pd.style_no)
    .order("version", { ascending: false })
    .limit(1);
  if (buyerId) exQ = exQ.eq("buyer_id", buyerId);

  const { data: ex, error: exErr } = await exQ;
  if (exErr) return NextResponse.json({ success: false, error: exErr.message }, { status: 500 });

  if (ex?.[0]) return NextResponse.json({ success: true, existed: true, costing_id: ex[0].id });

  const { data: created, error: cErr } = await supabase
    .from("costing_headers")
    .insert({
      style_no: pd.style_no,
      stage: "SAMPLE",
      version: 1,
      status: "DRAFT",
      buyer_id: buyerId,
      buyer_code: buyerCode,
      buyer_name: buyerName,
      buyer_default_margin_pct: defaultMargin,
      margin_pct: defaultMargin,
      created_by: user.id,
      created_by_email: user.email ?? null,
      updated_by: user.id,
      updated_by_email: user.email ?? null,
    })
    .select("id")
    .single();

  if (cErr) NextResponse.json({ success: false, error: cErr.message }, { status: 500 });

  return NextResponse.json({ success: true, existed: false, costing_id: created.id });
}
