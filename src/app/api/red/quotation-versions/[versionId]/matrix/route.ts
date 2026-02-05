import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../../_supabase";

export const dynamic = "force-dynamic";

type CellRow = {
  pcs_per_pkg: number;
  moq_packages: number;
  price_fob_per_pkg: number | null;
  override_price_fob_per_pkg?: number | null;
};

function getPackageCodeFromUrl(url: URL) {
  const p = (url.searchParams.get("package") || url.searchParams.get("package_code") || "A").trim();
  return (p === "" ? "A" : p).toUpperCase();
}

/**
 * IMPORTANT (A안 핵심)
 * - DB 테이블 red_quotation_price_matrix_v2 에 NOT NULL 컬럼이 있음:
 *   quotation_id, version_key, status, pcs, moq_pkg, currency (plus created_at/updated_at)
 * - 따라서 PUT 저장 시 위 컬럼들을 반드시 채워서 insert 해야 함.
 * - "quotation_version_id" / "package_code" / "pcs_per_pkg" / "moq_packages" 컬럼은 nullable(있으면 채움)
 */
export async function GET(req: Request, { params }: { params: { versionId: string } }) {
  try {
    const supabase = createSupabaseServerClient();
    const versionId = params?.versionId;
    if (!versionId) return NextResponse.json({ error: "Missing version id" }, { status: 400 });

    const url = new URL(req.url);
    const packageCode = getPackageCodeFromUrl(url);

    // version meta (to resolve red_quotation_id + version_no)
    const { data: v, error: vErr } = await supabase
      .from("red_quotation_versions")
      .select("id, red_quotation_id, version_no, status")
      .eq("id", versionId)
      .maybeSingle();

    if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 });
    if (!v?.red_quotation_id)
      return NextResponse.json({ error: "Version not found or missing red_quotation_id" }, { status: 404 });

    const quotationId = v.red_quotation_id as string;
    const versionKey = `v${Number(v.version_no || 1)}`;

    const { data, error } = await supabase
      .from("red_quotation_price_matrix_v2")
      .select(
        [
          "quotation_id",
          "version_key",
          "status",
          "currency",
          "pcs",
          "moq_pkg",
          "price_fob_per_pkg",
          "override_price_fob_per_pkg",
          "quotation_version_id",
          "package_code",
          "pcs_per_pkg",
          "moq_packages",
        ].join(",")
      )
      // A안: 기본 키는 기존 NOT NULL 컬럼 기준으로 조회 (stable)
      .eq("quotation_id", quotationId)
      .eq("version_key", versionKey)
      .eq("package_code", packageCode)
      .order("pcs", { ascending: true })
      .order("moq_pkg", { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Normalize to UI shape (pcs_per_pkg/moq_packages)
    const rows = (data || []).map((r: any) => ({
      pcs_per_pkg: Number(r.pcs_per_pkg ?? r.pcs),
      moq_packages: Number(r.moq_packages ?? r.moq_pkg),
      price_fob_per_pkg: r.price_fob_per_pkg === null || r.price_fob_per_pkg === undefined ? null : Number(r.price_fob_per_pkg),
      override_price_fob_per_pkg:
        r.override_price_fob_per_pkg === null || r.override_price_fob_per_pkg === undefined ? null : Number(r.override_price_fob_per_pkg),
    }));

    return NextResponse.json({
      meta: { quotation_id: quotationId, version_key: versionKey, package_code: packageCode },
      data: rows,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "GET matrix failed" }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: { params: { versionId: string } }) {
  try {
    const supabase = createSupabaseServerClient();
    const versionId = params?.versionId;
    if (!versionId) return NextResponse.json({ error: "Missing version id" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const packageCode = String(body?.package_code || body?.packageCode || "A").toUpperCase();
    const cells = Array.isArray(body?.cells) ? (body.cells as CellRow[]) : null;
    if (!cells) return NextResponse.json({ error: "Invalid payload: cells[]" }, { status: 400 });

    // Resolve NOT NULL required columns from version/header
    const { data: v, error: vErr } = await supabase
      .from("red_quotation_versions")
      .select("id, red_quotation_id, version_no, status")
      .eq("id", versionId)
      .maybeSingle();

    if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 });
    if (!v?.red_quotation_id)
      return NextResponse.json({ error: "Version not found or missing red_quotation_id" }, { status: 404 });

    const quotationId = v.red_quotation_id as string;
    const versionKey = String(body?.version_key || body?.versionKey || `v${Number(v.version_no || 1)}`);
    const status = String(body?.status || v.status || "DRAFT");
    const currency = String(body?.currency || "USD"); // offer currency (UI dropdown)

    // Normalize + validate
    const rows = cells
      .map((c) => {
        const pcs = Number(c.pcs_per_pkg);
        const moq = Number(c.moq_packages);
        const price = c.price_fob_per_pkg === null ? null : Number(c.price_fob_per_pkg);
        const ovr =
          c.override_price_fob_per_pkg === null || c.override_price_fob_per_pkg === undefined
            ? null
            : Number(c.override_price_fob_per_pkg);

        if (!Number.isFinite(pcs) || !Number.isFinite(moq)) return null;
        if (price !== null && !Number.isFinite(price)) return null;
        if (ovr !== null && !Number.isFinite(ovr)) return null;

        return {
          // NOT NULL 필수
          quotation_id: quotationId,
          version_key: versionKey,
          status,
          currency,

          // 기존 컬럼 (NOT NULL)
          pcs,
          moq_pkg: moq,

          // V2 확장 컬럼 (nullable)
          quotation_version_id: versionId,
          package_code: packageCode,
          pcs_per_pkg: pcs,
          moq_packages: moq,
          price_fob_per_pkg: price,
          override_price_fob_per_pkg: ovr,
        };
      })
      .filter(Boolean) as any[];

    // Replace all rows for quotation_id + version_key + package_code
    const { error: delErr } = await supabase
      .from("red_quotation_price_matrix_v2")
      .delete()
      .eq("quotation_id", quotationId)
      .eq("version_key", versionKey)
      .eq("package_code", packageCode);

    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

    if (rows.length > 0) {
      const { error: insErr } = await supabase.from("red_quotation_price_matrix_v2").insert(rows);
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, count: rows.length });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "PUT matrix failed" }, { status: 500 });
  }
}
