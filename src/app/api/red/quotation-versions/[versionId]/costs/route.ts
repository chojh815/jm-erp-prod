import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../../_supabase";

export const dynamic = "force-dynamic";

const ALLOWED_MOQ = new Set([1000, 3000, 5000]);

function normPkg(p: string | null) {
  const v = (p || "A").toString().trim().toUpperCase();
  return v === "" ? "A" : v;
}

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

/**
 * RED Quotation Version Costs API
 * Route: /api/red/quotation-versions/[versionId]/costs?package=A
 *
 * Returns (UI expects top-level keys):
 *  {
 *    cost_inputs: { unit_price_per_piece, unit_price_currency } | null,
 *    packaging_costs: Array<{ moq, packaging_cost_per_pkg }>
 *  }
 *
 * Notes:
 * - red_quotation_cost_inputs table DOES NOT have package_code (single row per version).
 * - packaging costs are stored in red_quotation_packaging_costs_v2 with package_code + moq_packages.
 */
export async function GET(req: Request, { params }: { params: { versionId: string } }) {
  try {
    const supabase = createSupabaseServerClient();
    const versionId = params?.versionId;

    if (!versionId) return bad("Missing versionId");

    const url = new URL(req.url);
    const packageCode = normPkg(url.searchParams.get("package") || url.searchParams.get("package_code"));

    // 1) Cost inputs (per version, no package_code)
    const { data: ci, error: ciErr } = await supabase
      .from("red_quotation_cost_inputs")
      .select("unit_price_per_piece, unit_price_currency")
      .eq("red_quotation_version_id", versionId)
      .maybeSingle();

    if (ciErr) return bad(ciErr.message, 500);

    // 2) Packaging costs (per version + package_code + moq)
    const { data: pcRows, error: pcErr } = await supabase
      .from("red_quotation_packaging_costs_v2")
      .select("moq_packages, packaging_cost_per_pkg")
      .eq("red_quotation_version_id", versionId)
      .eq("package_code", packageCode)
      .order("moq_packages", { ascending: true });

    if (pcErr) return bad(pcErr.message, 500);

    return NextResponse.json({
      cost_inputs: ci || null,
      packaging_costs: (pcRows || []).map((r: any) => ({
        moq: Number(r.moq_packages),
        packaging_cost_per_pkg: r.packaging_cost_per_pkg,
      })),
    });
  } catch (e: any) {
    return bad(e?.message || "Server error", 500);
  }
}

export async function PUT(req: Request, { params }: { params: { versionId: string } }) {
  try {
    const supabase = createSupabaseServerClient();
    const versionId = params?.versionId;

    if (!versionId) return bad("Missing versionId");

    const url = new URL(req.url);
    const packageCode = normPkg(url.searchParams.get("package") || url.searchParams.get("package_code"));

    const body = await req.json().catch(() => ({} as any));
    const ci = body?.cost_inputs || {};
    const unit_price_per_piece =
      ci?.unit_price_per_piece === null || ci?.unit_price_per_piece === undefined || ci?.unit_price_per_piece === ""
        ? null
        : Number(ci.unit_price_per_piece);

    if (unit_price_per_piece !== null && !Number.isFinite(unit_price_per_piece)) {
      return bad("unit_price_per_piece must be number or null", 400);
    }

    const unit_price_currency = (ci?.unit_price_currency || "CNY").toString().trim().toUpperCase();

    // ---- Cost inputs upsert WITHOUT relying on unique constraints ----
    const { data: existing, error: exErr } = await supabase
      .from("red_quotation_cost_inputs")
      .select("red_quotation_version_id")
      .eq("red_quotation_version_id", versionId)
      .maybeSingle();

    if (exErr) return bad(exErr.message, 500);

    if (existing) {
      const { error: upErr } = await supabase
        .from("red_quotation_cost_inputs")
        .update({
          unit_price_per_piece,
          unit_price_currency,
          updated_at: new Date().toISOString(),
        })
        .eq("red_quotation_version_id", versionId);

      if (upErr) return bad(upErr.message, 500);
    } else {
      const { error: insErr } = await supabase.from("red_quotation_cost_inputs").insert({
        red_quotation_version_id: versionId,
        unit_price_per_piece,
        unit_price_currency,
      });

      if (insErr) return bad(insErr.message, 500);
    }

    // ---- Packaging costs: replace-all (safe, no unique constraint dependency) ----
    const incoming = Array.isArray(body?.packaging_costs) ? body.packaging_costs : [];

    // Normalize incoming to {moq_packages, packaging_cost_per_pkg}
    const normalized: { moq_packages: number; packaging_cost_per_pkg: number | null }[] = [];
    for (const row of incoming) {
      const moq = Number(row?.moq_packages ?? row?.moq);
      if (!Number.isFinite(moq) || !ALLOWED_MOQ.has(moq)) continue;

      const raw = row?.packaging_cost_per_pkg;
      const v = raw === null || raw === undefined || raw === "" ? null : Number(raw);
      if (v !== null && !Number.isFinite(v)) continue;

      normalized.push({ moq_packages: moq, packaging_cost_per_pkg: v });
    }

    // delete existing for that version/package first
    const { error: delErr } = await supabase
      .from("red_quotation_packaging_costs_v2")
      .delete()
      .eq("red_quotation_version_id", versionId)
      .eq("package_code", packageCode);

    if (delErr) return bad(delErr.message, 500);

    if (normalized.length > 0) {
      const insertRows = normalized.map((r) => ({
        red_quotation_version_id: versionId,
        package_code: packageCode,
        moq_packages: r.moq_packages,
        packaging_cost_per_pkg: r.packaging_cost_per_pkg,
      }));

      const { error: pcInsErr } = await supabase.from("red_quotation_packaging_costs_v2").insert(insertRows);
      if (pcInsErr) return bad(pcInsErr.message, 500);
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return bad(e?.message || "Server error", 500);
  }
}
