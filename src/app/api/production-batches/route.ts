import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getApiIdentity } from "@/lib/apiIdentity";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { makeRedBatchCode, RED_BATCH_UUID } from "@/lib/redBatchCode";

import {
  resolveRedBatchPoLine,
  loadRedBatchPo,
  listRedBatchPoLines,
} from "@/lib/redBatchOrders";

export const dynamic = "force-dynamic";
class BatchError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
function jsonError(error: any) {
  const setup = ["42P01", "PGRST202", "PGRST205"].includes(error?.code);
  const message = setup
    ? "BATCH 4.0 DB 설정을 먼저 적용해 주세요."
    : error?.code === "23505"
      ? "동일 SKU·생산 시작일·차수·라벨 버전이 이미 등록되어 있습니다. 기존 배치를 확인해 주세요."
      : error?.message || "처리하지 못했습니다.";
  const status = setup
    ? 503
    : error?.status ||
      (["23505", "40001", "55000", "23503"].includes(error?.code)
        ? 409
        : error?.code === "P0002"
          ? 404
          : ["22023", "23514"].includes(error?.code)
            ? 400
            : 500);
  return NextResponse.json(
    { success: false, message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
function json(data: any) {
  return NextResponse.json(
    { success: true, ...data },
    { headers: { "Cache-Control": "no-store" } },
  );
}
async function actor() {
  const identity = await getApiIdentity();
  if (!identity.permissions.includes("production_batches.view"))
    throw new BatchError("Batches (RED) 접근 권한이 없습니다.", 403);
  return identity;
}
function legacyClient() {
  const store = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: { getAll: () => store.getAll(), setAll: () => {} },
    },
  );
}
function text(value: unknown, label: string, max: number, required = false) {
  if (value === undefined || value === null) {
    if (required) throw new BatchError(label + "을 입력해 주세요.");
    return "";
  }
  if (
    typeof value !== "string" ||
    value.trim().length > max ||
    (required && !value.trim())
  )
    throw new BatchError(label + "을 확인해 주세요.");
  return value.trim();
}
function check(result: any) {
  if (result.error) throw result.error;
  return result.data;
}
function isV4(body: any) {
  if (body.guideline_version && body.guideline_version !== "4.0")
    throw new BatchError("유효하지 않은 규칙입니다.");
  return body.guideline_version === "4.0";
}
export async function GET(req: Request) {
  try {
    await actor();
    const params = new URL(req.url).searchParams;
    const sku = text(params.get("sku_code"), "SKU", 120).toUpperCase();
    function filtered(client: any, table: string) {
      let query = client.from(table).select("*").eq("buyer_code", "RED");
      for (const key of ["po_no", "mfg_date"])
        if (params.get(key)) query = query.eq(key, params.get(key));
      if (params.get("date_from"))
        query = query.gte("mfg_date", params.get("date_from"));
      if (params.get("date_to"))
        query = query.lte("mfg_date", params.get("date_to"));
      if (table === "production_batches_v4" && sku)
        query = query.eq("sku_code", sku);
      return query
        .order("mfg_date", { ascending: false })
        .order("version", { ascending: false })
        .limit(200);
    }
    const [current, legacy] = await Promise.all([
      filtered(supabaseAdmin, "production_batches_v4"),
      sku
        ? Promise.resolve({ data: [], error: null })
        : filtered(legacyClient(), "production_batches"),
    ]);
    const setupRequired =
      current.error && ["42P01", "PGRST205"].includes(current.error.code);
    if (current.error && !setupRequired) throw current.error;
    const old = check(legacy) || [];
    const rows = [
      ...(current.data || []),
      ...old.map((row: any) => ({ ...row, guideline_version: "legacy" })),
    ].sort(
      (a, b) =>
        b.mfg_date.localeCompare(a.mfg_date) ||
        b.created_at.localeCompare(a.created_at),
    );
    return json({ rows, setupRequired: !!setupRequired });
  } catch (e) {
    return jsonError(e);
  }
}
export async function POST(req: Request) {
  try {
    const identity = await actor();
    const body = await req.json().catch(() => {
      throw new BatchError("JSON 요청을 확인해 주세요.");
    });
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new BatchError("배치 정보를 확인해 주세요.");
    const sku = text(
      body.sku_code,
      "SKU / 바이어 스타일 번호",
      120,
      true,
    ).toUpperCase();
    const date = text(body.mfg_date, "생산 시작일", 10, true);
    const vendor = text(
      body.vendor_initial ?? "J",
      "업체코드",
      1,
      true,
    ).toUpperCase();
    const type = text(body.label_type, "V/M 유형", 1, true).toUpperCase();
    const run = body.run_no ?? 1,
      version = body.version ?? 0;
    const source = body.source_id ?? null;
    if (
      source !== null &&
      (typeof source !== "string" || !RED_BATCH_UUID.test(source))
    )
      throw new BatchError("원본 배치를 확인해 주세요.");
    if (!source && version !== 0)
      throw new BatchError("새 생산 배치는 라벨 버전 0으로 등록해 주세요.");
    try {
      makeRedBatchCode({
        mfgDate: date,
        vendorInitial: vendor,
        labelType: type,
        runNo: run,
        version,
      });
    } catch (e: any) {
      throw new BatchError(e.message);
    }
    let po = text(body.po_no, "PO 번호", 200);
    const selectedPo = body.po_id ?? null,
      selectedLine = body.po_line_id ?? null;
    if (selectedPo !== null || selectedLine !== null) {
      if (
        typeof selectedPo !== "string" ||
        !RED_BATCH_UUID.test(selectedPo) ||
        typeof selectedLine !== "string" ||
        !RED_BATCH_UUID.test(selectedLine)
      )
        throw new BatchError("PO와 해당 품목을 다시 선택해 주세요.");
      const selection = await resolveRedBatchPoLine(selectedPo, selectedLine);
      if (sku !== selection.line.sku_code || po !== selection.po.po_no)
        throw new BatchError(
          "PO 또는 품목 정보가 변경되었습니다. 다시 선택해 주세요.",
          409,
        );
      po = selection.po.po_no;
    }
    const result = check(
      await supabaseAdmin.rpc("create_kiss_batch_v4", {
        p_sku: sku,
        p_date: date,
        p_vendor: vendor,
        p_run: run,
        p_type: type,
        p_version: version,
        p_po: po || null,
        p_source: source,
        p_actor: identity.user.id,
      }),
    );
    const row = Array.isArray(result) ? result[0] : result;
    return json({ row });
  } catch (e) {
    return jsonError(e);
  }
}
export async function PUT(req: Request) {
  try {
    await actor();
    const body = await req.json().catch(() => {
      throw new BatchError("JSON 요청을 확인해 주세요.");
    });
    if (!body || typeof body.id !== "string" || !RED_BATCH_UUID.test(body.id))
      throw new BatchError("배치 ID를 확인해 주세요.");
    let po = text(body.po_no, "PO 번호", 200);
    const current = isV4(body);
    if (body.po_id) {
      if (typeof body.po_id !== "string" || !RED_BATCH_UUID.test(body.po_id))
        throw new BatchError("PO를 다시 선택해 주세요.");
      const selected = await loadRedBatchPo(body.po_id);
      if (po !== selected.po_no)
        throw new BatchError(
          "PO 정보가 변경되었습니다. 다시 선택해 주세요.",
          409,
        );
      if (current) {
        const saved = check(
          await supabaseAdmin
            .from("production_batches_v4")
            .select("sku_code")
            .eq("id", body.id)
            .maybeSingle(),
        );
        if (!saved) throw new BatchError("배치가 없습니다.", 404);
        const lines = await listRedBatchPoLines(selected.id);
        if (!lines.some((line) => line.sku_code === saved.sku_code))
          throw new BatchError("선택한 PO에 이 배치의 SKU가 없습니다.");
      }
      po = selected.po_no;
    }
    const client = current ? supabaseAdmin : legacyClient();
    const row = check(
      await client
        .from(current ? "production_batches_v4" : "production_batches")
        .update({ po_no: po || null })
        .eq("id", body.id)
        .eq("buyer_code", "RED")
        .select("*")
        .maybeSingle(),
    );
    if (!row) throw new BatchError("배치가 없거나 수정 권한이 없습니다.", 404);
    return json({ row });
  } catch (e) {
    return jsonError(e);
  }
}
export async function DELETE(req: Request) {
  try {
    await actor();
    const params = new URL(req.url).searchParams;
    const id = params.get("id") || "";
    if (!RED_BATCH_UUID.test(id))
      throw new BatchError("배치 ID를 확인해 주세요.");
    const current = isV4({
      guideline_version: params.get("guideline_version"),
    });
    const client = current ? supabaseAdmin : legacyClient();
    const rows = check(
      await client
        .from(current ? "production_batches_v4" : "production_batches")
        .delete()
        .eq("id", id)
        .eq("buyer_code", "RED")
        .select("id"),
    );
    if (!rows?.length)
      throw new BatchError("배치가 없거나 삭제 권한이 없습니다.", 404);
    return json({ deleted_ids: rows.map((row: any) => row.id) });
  } catch (e) {
    return jsonError(e);
  }
}
