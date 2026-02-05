import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../_supabase";

export const dynamic = "force-dynamic";

/**
 * FIX: Seed RED price matrix rows using DB columns.
 * Your public.red_quotation_price_matrix requires:
 *   - quotation_id (uuid)
 *   - package (text) NOT NULL
 *   - row_no (int) NOT NULL
 *
 * The previous seeding used red_quotation_version_id/package_code only, which caused:
 *   null value in column "package" of relation "red_quotation_price_matrix"
 * and resulted in an empty table.
 */

export async function GET() {
  const supabase = createSupabaseServerClient();

  const { data, error } = await supabase
    .from("red_quotations")
    .select("id, red_quotation_no, title, buyer_name, style_no, currency, incoterm, ship_from_code, status, updated_at")
    .order("updated_at", { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

function yymm() {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yy}${mm}`;
}

async function nextRedNo(supabase: any) {
  const prefix = `REDQ-${yymm()}-`;
  const { data, error } = await supabase
    .from("red_quotations")
    .select("red_quotation_no")
    .ilike("red_quotation_no", `${prefix}%`)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw new Error(error.message);

  const last = data?.[0]?.red_quotation_no as string | undefined;
  const lastSeq = last ? parseInt(last.split("-").pop() || "0", 10) : 0;
  const nextSeq = (Number.isFinite(lastSeq) ? lastSeq : 0) + 1;
  return `${prefix}${String(nextSeq).padStart(4, "0")}`;
}

export async function POST(req: Request) {
  const supabase = createSupabaseServerClient();
  const body = await req.json().catch(() => ({}));

  const buyer_name = (body?.buyer_name ?? "").toString().trim() || null;
  const style_no = (body?.style_no ?? "").toString().trim() || null;
  const title = (body?.title ?? "").toString().trim() || null;
  const ship_from_code = (body?.ship_from_code ?? "").toString().trim() || "CN_QINGDAO";

  try {
    const redNo = await nextRedNo(supabase);

    const { data: master, error: me } = await supabase
      .from("red_quotations")
      .insert({
        red_quotation_no: redNo,
        title,
        buyer_name,
        style_no,
        ship_from_code,
        currency: "USD",
        incoterm: "FOB",
        status: "DRAFT",
      })
      .select("*")
      .single();

    if (me) return NextResponse.json({ error: me.message }, { status: 500 });

    // create v1
    const { data: v1, error: ve } = await supabase
      .from("red_quotation_versions")
      .insert({
        red_quotation_id: master.id,
        version_no: 1,
        status: "DRAFT",
        change_summary: "Initial v1 created",
      })
      .select("*")
      .single();

    if (ve) return NextResponse.json({ error: ve.message }, { status: 500 });

    // seed preset pcs rows for package A with MOQ 1000/3000/5000
    const presetPcs = [3, 4, 6, 10, 12, 14];
    const moqs = [1000, 3000, 5000];

    // We store seed rows into red_quotation_price_matrix using quotation_id+package+row_no.
    // Additionally we fill optional columns: package_code, moq_packages, pcs_per_pkg.
    const matrixRows: any[] = [];
    let rowNo = 0;
    for (const pcs of presetPcs) {
      for (const moq of moqs) {
        rowNo += 1;
        matrixRows.push({
          quotation_id: master.id,
          package: "A",
          row_no: rowNo,
          package_code: "A",
          pcs_per_pkg: pcs,
          moq_packages: moq,
          price_fob_per_pkg: null,
        });
      }
    }

    const { error: se } = await supabase.from("red_quotation_price_matrix").insert(matrixRows);
    if (se) return NextResponse.json({ error: se.message }, { status: 500 });

    // seed MOQ-only packaging costs (A) - v2 table is version-scoped
    const packRows = moqs.map((moq) => ({
      red_quotation_version_id: v1.id,
      package_code: "A",
      moq_packages: moq,
      packaging_cost_per_pkg: null,
    }));
    const { error: pe } = await supabase.from("red_quotation_packaging_costs_v2").insert(packRows);
    if (pe) return NextResponse.json({ error: pe.message }, { status: 500 });

    const { error: cie } = await supabase.from("red_quotation_cost_inputs").upsert(
      { red_quotation_version_id: v1.id, unit_price_per_piece: null, unit_price_currency: "USD" },
      { onConflict: "red_quotation_version_id" }
    );
    if (cie) return NextResponse.json({ error: cie.message }, { status: 500 });

    return NextResponse.json({ data: { id: master.id, red_quotation_no: redNo, version_id: v1.id } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}
