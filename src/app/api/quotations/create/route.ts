import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function normBrand(s?: string | null) {
  if (!s) return null;
  const v = s.trim();
  return v ? v : null;
}

function brandCodeFromName(brand: string) {
  const c = brand.toUpperCase().replace(/[^A-Z0-9]+/g, "");
  if (!c) return "BRAND";
  return c.length > 8 ? c.slice(0, 8) : c;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const buyer_id = String(body?.buyer_id || "").trim();
    const brand_name = normBrand(body?.brand_name ?? null);
    const received_at = String(body?.received_at || "").slice(0, 10) || null;
    const notes = body?.notes ?? null;
    const lines = Array.isArray(body?.lines) ? body.lines : [];

    if (!buyer_id) return NextResponse.json({ success: false, error: "buyer_id is required" }, { status: 400 });
    if (!received_at) return NextResponse.json({ success: false, error: "received_at is required" }, { status: 400 });
    if (!lines.length) return NextResponse.json({ success: false, error: "lines is required" }, { status: 400 });

    const sb = supabaseAdmin;

    // Use select("*") to avoid column-missing errors.
    const { data: buyerRow, error: buyerErr } = await sb
      .from("companies")
      .select("*")
      .eq("id", buyer_id)
      .maybeSingle();

    if (buyerErr) throw new Error(buyerErr.message);
    if (!buyerRow) return NextResponse.json({ success: false, error: "Buyer not found" }, { status: 404 });

    const buyerCode = String((buyerRow as any).code || "").trim();
    const buyerName = String(
      (buyerRow as any).company_name ||
      (buyerRow as any).name ||
      (buyerRow as any).company_name_en ||
      (buyerRow as any).company_name_kr ||
      ""
    ).trim();

    if (!buyerCode) return NextResponse.json({ success: false, error: "Buyer code is missing (companies.code)" }, { status: 400 });
    if (!buyerName) return NextResponse.json({ success: false, error: "Buyer name is missing (companies.company_name/name)" }, { status: 400 });

    const account_code = brand_name ? `${buyerCode}-${brandCodeFromName(brand_name)}` : buyerCode;
    const display_name = brand_name ? `${buyerName} / ${brand_name}` : buyerName;

    // find existing account
    const { data: existAcc, error: existErr } = await sb
      .from("quote_accounts")
      .select("id, account_code")
      .eq("buyer_id", buyer_id)
      .eq("brand_name_norm", brand_name ? brand_name.trim().toUpperCase() : null)
      .maybeSingle();

    if (existErr) throw new Error(existErr.message);

    let quote_account_id = existAcc?.id as string | undefined;

    if (!quote_account_id) {
      const { data: accIns, error: accErr } = await sb
        .from("quote_accounts")
        .insert({
          buyer_id,
          brand_name,
          account_code,
          display_name,
        })
        .select("id")
        .single();

      if (accErr) throw new Error(accErr.message);
      quote_account_id = accIns.id as string;
    }

    // quotation no
    const { data: noData, error: noErr } = await sb.rpc("next_quotation_no", {
      p_account_code: account_code,
      p_date: received_at,
    });

    if (noErr) throw new Error(noErr.message);

    const quotation_no = typeof noData === "string" ? noData : String(noData);

    // header
    const { data: hdr, error: hdrErr } = await sb
      .from("quotation_headers")
      .insert({
        quotation_no,
        quote_account_id,
        received_at,
        notes,
        status: "DRAFT",
      })
      .select("id, quotation_no")
      .single();

    if (hdrErr) throw new Error(hdrErr.message);

    // lines
    const lineRows = lines
      .map((l: any, i: number) => ({
        quotation_id: hdr.id,
        line_no: i + 1,
        style_no: String(l?.style_no || "").trim(),
        qty: l?.qty ?? null,
        target_price: l?.target_price ?? null,
        remarks: l?.remarks ?? null,
        status: "DRAFT",
      }))
      .filter((r: any) => r.style_no);

    if (!lineRows.length) return NextResponse.json({ success: false, error: "No valid style_no" }, { status: 400 });

    const { error: lnErr } = await sb.from("quotation_lines").insert(lineRows);
    if (lnErr) throw new Error(lnErr.message);

    return NextResponse.json({ success: true, id: hdr.id, quotation_no: hdr.quotation_no });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || String(e) }, { status: 500 });
  }
}
