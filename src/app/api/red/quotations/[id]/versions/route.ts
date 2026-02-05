import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../../_supabase";

export const dynamic = "force-dynamic";

/**
 * GET /api/red/quotations/[id]/versions
 * Returns: { data: { quotation, versions } }
 *
 * NOTE (A안 원칙):
 * - red_quotation_versions 테이블은 (quotation_id / version_key) 컬럼이 아니라
 *   (red_quotation_id / version_no) 구조를 사용합니다.
 * - UI는 version_key가 필요하면 version_no로부터 'v{version_no}'로 만들어 쓰면 됩니다.
 */
export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createSupabaseServerClient();
    const quotationId = params.id;

    // 1) quotation header (가볍게 필요한 필드만)
    const { data: q, error: qErr } = await supabase
      .from("red_quotations")
      .select(
        "id, red_quotation_no, title, buyer_name, style_no, ship_from_code, currency, incoterm, status, thumbnail_url, thumbnail_path"
      )
      .eq("id", quotationId)
      .maybeSingle();

    if (qErr) throw qErr;
    if (!q) {
      return NextResponse.json({ error: "Quotation not found" }, { status: 404 });
    }

    // 2) versions (IMPORTANT: red_quotation_id 사용)
    const { data: versions, error: vErr } = await supabase
      .from("red_quotation_versions")
      .select("id, version_no, status, revision_of_version_id, change_summary, updated_at")
      .eq("red_quotation_id", quotationId)
      .order("version_no", { ascending: false });

    if (vErr) throw vErr;

    // UI가 필요하면 version_key를 파생해서 쓰도록 같이 내려줌(컬럼으로 저장 X)
    const normalized = (versions ?? []).map((v: any) => ({
      ...v,
      version_key: `v${v.version_no}`, // convenience
    }));

    return NextResponse.json({
      data: {
        quotation: q,
        versions: normalized,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to load versions" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/red/quotations/[id]/versions
 * Body (optional): { from_version_id?: string }
 *
 * Creates a NEW DRAFT version row. (필요 시 matrix/cost copy는 별도 엔드포인트에서 처리)
 * - 이 라우트는 '버전 레코드 생성'에만 책임을 둡니다. (A안: 보수적)
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createSupabaseServerClient();
    const quotationId = params.id;

    let body: any = null;
    try { body = await req.json(); } catch { body = null; }

    // next version_no = max + 1
    const { data: maxRow, error: maxErr } = await supabase
      .from("red_quotation_versions")
      .select("version_no")
      .eq("red_quotation_id", quotationId)
      .order("version_no", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (maxErr) throw maxErr;

    const nextNo = (maxRow?.version_no ?? 0) + 1;

    const insertPayload: any = {
      red_quotation_id: quotationId,
      version_no: nextNo,
      status: "DRAFT",
      revision_of_version_id: body?.from_version_id ?? null,
      change_summary: body?.change_summary ?? null,
    };

    const { data: created, error: insErr } = await supabase
      .from("red_quotation_versions")
      .insert(insertPayload)
      .select("id, version_no, status, revision_of_version_id, change_summary, updated_at")
      .single();

    if (insErr) throw insErr;

    return NextResponse.json({
      data: {
        version: { ...created, version_key: `v${created.version_no}` },
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to create version" },
      { status: 500 }
    );
  }
}
