import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../../_supabase";

export const dynamic = "force-dynamic";

/**
 * POST /api/red/quotation-versions/[versionId]/revision
 * Creates a new revision from the given base version:
 * - new version_no = base.version_no + 1 (within same red_quotation_id)
 * - copies price matrix rows
 */
export async function POST(_: Request, { params }: { params: { versionId: string } }) {
  const supabase = createSupabaseServerClient();
  const baseVersionId = params?.versionId;

  const { data: baseV, error: be } = await supabase
    .from("red_quotation_versions")
    .select("id, red_quotation_id, version_no, status")
    .eq("id", baseVersionId)
    .single();

  if (be) return NextResponse.json({ error: be.message }, { status: 500 });

  const redQuotationId = baseV.red_quotation_id;
  const nextNo = (baseV.version_no || 0) + 1;

  // create new version
  const { data: newV, error: ne } = await supabase
    .from("red_quotation_versions")
    .insert({
      red_quotation_id: redQuotationId,
      version_no: nextNo,
      status: "DRAFT",
      revision_of_version_id: baseVersionId,
      change_summary: `Revision created from v${baseV.version_no}`,
    })
    .select("*")
    .single();

  if (ne) {
    // unique conflict (already exists)
    return NextResponse.json({ error: ne.message }, { status: 409 });
  }

  
  // copy FOB per pkg (MOQ-only)
  const { data: fRows, error: fre } = await supabase
    .from("red_quotation_fob_prices")
    .select("package_code, moq_packages, fob_per_pkg, currency")
    .eq("red_quotation_version_id", baseVersionId);

  if (fre) return NextResponse.json({ error: fre.message }, { status: 500 });

  const fInserts = (fRows || []).map((r: any) => ({
    red_quotation_version_id: newV.id,
    package_code: r.package_code,
    moq_packages: r.moq_packages,
    fob_per_pkg: r.fob_per_pkg,
    currency: (r.currency || "USD").toString().toUpperCase(),
  }));

  if (fInserts.length > 0) {
    const { error: fie } = await supabase.from("red_quotation_fob_prices").insert(fInserts);
    if (fie) return NextResponse.json({ error: fie.message }, { status: 500 });
  }

// copy matrix
  const { data: rows, error: re } = await supabase
    .from("red_quotation_price_matrix")
    .select("package_code, pcs_per_pkg, moq_packages, price_fob_per_pkg")
    .eq("red_quotation_version_id", baseVersionId);

  if (re) return NextResponse.json({ error: re.message }, { status: 500 });

  const inserts = (rows || []).map((r: any) => ({
    red_quotation_version_id: newV.id,
    package_code: r.package_code,
    pcs_per_pkg: r.pcs_per_pkg,
    moq_packages: r.moq_packages,
    price_fob_per_pkg: r.price_fob_per_pkg,
  }));

  if (inserts.length > 0) {
    const { error: ie } = await supabase.from("red_quotation_price_matrix").insert(inserts);
    if (ie) return NextResponse.json({ error: ie.message }, { status: 500 });
  }

  return NextResponse.json({ data: { new_version_id: newV.id, version_no: newV.version_no } });
}
