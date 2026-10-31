import { getApiIdentity } from "@/lib/apiIdentity";
import { supabaseAdmin as db } from "@/lib/supabaseAdmin";
import { NextResponse } from "next/server";
import {
  normalizeRedDocument,
  RedError,
  type RedDocument,
} from "@/lib/redQuoteDocument";
export { db, RedError };
export async function redActor(
  action: "view" | "edit" | "create" | "delete" = "view",
) {
  const actor = await getApiIdentity();
  if (
    !actor.permissions.includes("dev.costings.view") ||
    (action !== "view" && !actor.permissions.includes(`dev.costings.${action}`))
  )
    throw new RedError("RED Quotation 권한이 없습니다.", 403);
  return actor;
}
export function redFailure(e: any) {
  const msg = String(e?.message || "처리하지 못했습니다.");
  const setup =
    /schema cache|does not exist|Could not find.*function|column.*archived_at/i.test(
      msg,
    );
  return NextResponse.json(
    {
      error: setup
        ? "RED Quotation DB 업데이트가 필요합니다. 관리자에게 문의해 주세요."
        : msg,
    },
    {
      status: setup ? 503 : e?.status || 500,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
export function redJson(data: any) {
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
export function rpcError(error: any) {
  if (error)
    throw new RedError(
      error.message,
      error.code === "40001"
        ? 409
        : error.code === "55000"
          ? 409
          : error.code === "P0002"
            ? 404
            : 500,
    );
}
export async function loadRedVersion(versionId: string) {
  const v = await db
    .from("red_quotation_versions")
    .select("*")
    .eq("id", versionId)
    .maybeSingle();
  if (v.error) throw v.error;
  if (!v.data) throw new RedError("견적 버전이 없습니다.", 404);
  const q = await db
    .from("red_quotations")
    .select("*")
    .eq("id", v.data.red_quotation_id)
    .maybeSingle();
  if (q.error) throw q.error;
  if (!q.data) throw new RedError("견적이 없습니다.", 404);
  return { version: v.data, quotation: q.data };
}
export async function readRedDocument(versionId: string) {
  const { version, quotation } = await loadRedVersion(versionId);
  const saved = await db
    .from("red_quotation_documents")
    .select("*")
    .eq("version_id", versionId)
    .maybeSingle();
  if (saved.error) throw saved.error;
  if (saved.data)
    return {
      version,
      quotation,
      document: saved.data.document as RedDocument,
      revision: Number(saved.data.revision),
      legacy: false,
    };
  const [m, c, p] = await Promise.all([
    db
      .from("red_quotation_price_matrix_v2")
      .select("*")
      .eq("quotation_id", quotation.id)
      .eq("version_key", `v${version.version_no}`),
    db
      .from("red_quotation_cost_inputs")
      .select("unit_price_per_piece,unit_price_currency")
      .eq("red_quotation_version_id", versionId)
      .maybeSingle(),
    db
      .from("red_quotation_packaging_costs_v2")
      .select("*")
      .eq("red_quotation_version_id", versionId),
  ]);
  for (const r of [m, c, p]) if (r.error) throw r.error;
  let rows = m.data || [];
  if (!rows.length && Number(version.version_no) === 1) {
    const old = await db
      .from("red_quotation_price_matrix")
      .select("*")
      .eq("quotation_id", quotation.id);
    if (old.error) throw old.error;
    rows = old.data || [];
  }
  const packages: any = { A: { cells: [], packaging_costs: [] } };
  for (const r of rows) {
    const code = r.package_code || r.package || "A";
    packages[code] ??= { cells: [], packaging_costs: [] };
    packages[code].cells.push({
      pcs_per_pkg: r.pcs_per_pkg ?? r.pcs,
      moq_packages: r.moq_packages ?? r.moq_pkg,
      price_fob_per_pkg: r.price_fob_per_pkg,
      override_price_fob_per_pkg: r.override_price_fob_per_pkg,
    });
  }
  for (const r of p.data || []) {
    const code = r.package_code || "A";
    packages[code] ??= { cells: [], packaging_costs: [] };
    packages[code].packaging_costs.push({
      moq: r.moq_packages,
      packaging_cost_per_pkg: r.packaging_cost_per_pkg,
    });
  }
  const document = normalizeRedDocument({ inputs: c.data || {}, packages });
  document.header = quotation;
  return { version, quotation, document, revision: 0, legacy: true };
}
export async function createRedRevision(versionId: string, summary = "") {
  const actor = await redActor("create");
  const source = await readRedDocument(versionId);
  if (source.quotation.archived_at)
    throw new RedError("보관된 견적은 먼저 복원해 주세요.", 409);
  const result = await db.rpc("red_create_revision", {
    p_base: versionId,
    p_legacy_document: source.document,
    p_expected_revision: source.revision,
    p_summary: summary.slice(0, 2000),
    p_actor: actor.user.id,
  });
  rpcError(result.error);
  return result.data;
}
