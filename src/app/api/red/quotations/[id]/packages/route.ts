import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../../_supabase";

export const dynamic = "force-dynamic";

const TABLE = "red_quotation_price_matrix";

async function tryPackages(supabase: any, fkCol: string, id: string) {
  const { data, error } = await supabase
    .from(TABLE)
    .select("package_code")
    .eq(fkCol, id)
    .order("package_code", { ascending: true });
  if (error) return { ok: false, error };
  const uniq = Array.from(new Set((data || []).map((r: any) => r.package_code).filter(Boolean)));
  return { ok: true, packages: uniq };
}

export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createSupabaseServerClient();
    const id = params?.id;
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const fkCandidates = [
      "red_quotation_version_id",
      "quotation_version_id",
      "version_id",
      "red_quotation_id",
      "quotation_id",
      "id",
    ];

    let lastErr: any = null;
    for (const fk of fkCandidates) {
      const res = await tryPackages(supabase, fk, id);
      if (res.ok) {
        const packages = res.packages ?? [];
return NextResponse.json(
  { packages: packages.length ? packages : ["A"] },
  { status: 200 }
);
      }
      lastErr = res.error;
    }

    return NextResponse.json(
      {
        error: "Failed to load packages",
        detail: lastErr?.message || String(lastErr || "unknown"),
        hint: "Check that red_quotation_price_matrix has a version/quotation FK column.",
      },
      { status: 500 }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
