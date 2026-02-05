import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../../_supabase";

export const dynamic = "force-dynamic";

// Excel export as CSV (opens in Excel). If you want true XLSX later, we'll switch to exceljs.
export async function GET(req: Request, { params }: { params: { versionId: string } }) {
  try {
    const supabase = createSupabaseServerClient();
    const versionId = params.versionId;

    const url = new URL(req.url);
    const pkg = (url.searchParams.get("package") || "A").toUpperCase();

    const { data: rows, error } = await supabase
      .from("red_quotation_price_matrix_v2")
      .select("pcs_per_pkg, moq_packages, price_fob_per_pkg, override_price_fob_per_pkg")
      .eq("quotation_version_id", versionId)
      .eq("package_code", pkg)
      .order("pcs_per_pkg", { ascending: true })
      .order("moq_packages", { ascending: true });

    if (error) throw error;

    const header = ["package_code","pcs_per_pkg","moq_packages","price_fob_per_pkg","override_price_fob_per_pkg"];
    const lines = [header.join(",")];
    for (const r of (rows || []) as any[]) {
      const line = [
        pkg,
        r.pcs_per_pkg ?? "",
        r.moq_packages ?? "",
        r.price_fob_per_pkg ?? "",
        r.override_price_fob_per_pkg ?? "",
      ].join(",");
      lines.push(line);
    }

    const csv = lines.join("\n");
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="RED_Matrix_${versionId}_${pkg}.csv"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Excel export failed" }, { status: 500 });
  }
}
