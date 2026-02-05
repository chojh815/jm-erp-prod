import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../../_supabase";

export const dynamic = "force-dynamic";

// GET: current ship_from_code + options
export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createSupabaseServerClient();
    const quotationId = params.id;

    const { data: q, error: qErr } = await supabase
      .from("red_quotations")
      .select("id, ship_from_code")
      .eq("id", quotationId)
      .maybeSingle();
    if (qErr) throw qErr;

    // Options: company_sites (your shipping sites)
    // IMPORTANT: schema-safe select(*) to avoid "column does not exist" build/runtime errors.
    const { data: sites, error: sErr } = await supabase
      .from("company_sites")
      .select("*")
      .eq("is_deleted", false);
    if (sErr) throw sErr;

    const options = (sites || [])
      .map((s: any) => {
        const code =
          (s.code ??
            s.site_code ??
            s.shipping_site_code ??
            s.shipping_origin_code ??
            s.origin_code ??
            s.site ??
            s.siteName ??
            "") + "";
        const city = (s.city ?? "").trim();
return {
  code: code.trim(),
  name: s.country ?? "",
};
      })
      .filter((o: any) => !!o.code);

    return NextResponse.json({
      data: { ship_from_code: q?.ship_from_code || "", options },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "GET ship-from failed" },
      { status: 500 }
    );
  }
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createSupabaseServerClient();
    const quotationId = params.id;
    const body = await req.json().catch(() => ({}));
    const ship_from_code = String(body?.ship_from_code || "").trim() || null;

    const { error } = await supabase
      .from("red_quotations")
      .update({ ship_from_code })
      .eq("id", quotationId);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "PUT ship-from failed" },
      { status: 500 }
    );
  }
}
