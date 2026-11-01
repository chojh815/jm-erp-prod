import { getApiIdentity } from "@/lib/apiIdentity";
import { supabaseAdmin as db } from "@/lib/supabaseAdmin";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  QuoteError,
  normalizeQuote,
  UUID,
  type QuoteDocument,
  type QuoteLine,
} from "@/lib/generalQuoteRules";
export { db, QuoteError };
export async function quoteActor(
  action: "view" | "edit" | "create" | "delete" = "view",
) {
  const a = await getApiIdentity();
  if (
    !a.permissions.includes("dev.costings.view") ||
    (action !== "view" && !a.permissions.includes("dev.costings." + action))
  )
    throw new QuoteError("Quotation 권한이 없습니다.", 403);
  return a;
}
export function quoteJson(data: any) {
  return NextResponse.json(
    { ok: true, success: true, ...data },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export function quoteFailure(e: any) {
  const m = String(e?.message || "처리하지 못했습니다.");
  const setup = /schema cache|does not exist|Could not find.*function/i.test(m);
  return NextResponse.json(
    {
      ok: false,
      success: false,
      error: setup ? "일반 Quotation DB 업데이트가 필요합니다." : m,
    },
    {
      status: setup ? 503 : e?.status || 500,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
export function checkDb(r: any) {
  if (r.error)
    throw new QuoteError(
      r.error.message,
      ["40001", "55000"].includes(r.error.code)
        ? 409
        : r.error.code === "P0002"
          ? 404
          : 500,
    );
  return r.data;
}
export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const value = (x: any) => (x == null || x === "" ? null : Number(x));
export async function legacyRows(table: string, column: string, id: string) {
  const r = await db.from(table).select("*").eq(column, id);
  if (r.error) {
    if (["42P01", "PGRST205", "42703"].includes(r.error.code)) return [];
    throw r.error;
  }
  return (r.data || []).filter((x) => !x.is_deleted);
}
export function legacyLine(
  r: any,
  base: any = {},
  tiers: any[] = [],
): QuoteLine {
  return {
    id: r.id,
    style_no:
      r.style_no ||
      r.buyer_style_no ||
      r.our_style_no ||
      r.internal_style_no ||
      base.style_no ||
      "(Style 확인 필요)",
    description: r.description || base.description || "",
    qty: Number(r.qty || r.quantity || base.qty || 1),
    unit: r.unit || "pc",
    offer_price: value(
      r.offer_usd ?? r.offer_price_usd ?? r.price_usd ?? r.offer_price,
    ),
    target_price: value(r.target_price),
    remarks: r.remarks || r.notes || "",
    costing_id: r.costing_id || base.costing_id || null,
    internal: { legacy_snapshot: r },
    tiers: tiers.map((t) => ({
      id: t.id,
      qty: Number(t.moq || t.qty || 1),
      offer_price: value(t.price_usd ?? t.unit_price ?? t.offer_price),
      ship_from: t.origin_code || t.ship_from || "",
      remarks: t.notes || "",
    })),
  };
}
export async function readQuote(
  id: string,
  versionId?: string,
  source?: string,
) {
  if (!UUID.test(id) || (versionId && !UUID.test(versionId)))
    throw new QuoteError("유효하지 않은 견적 ID입니다.");
  const q = checkDb(
    await db.from("quotation_headers").select("*").eq("id", id).maybeSingle(),
  );
  if (!q) throw new QuoteError("견적이 없습니다.", 404);
  const versions =
    checkDb(
      await db
        .from("quotation_versions")
        .select("*")
        .eq("quotation_id", id)
        .order("version_no", { ascending: false }),
    ) || [];
  const v = versionId
    ? versions.find((x: any) => x.id === versionId)
    : versions.find((x: any) => x.status === "DRAFT") || versions[0];
  if (!v)
    throw new QuoteError("견적 버전이 없습니다. DB 설정을 확인해 주세요.", 404);
  let document: QuoteDocument = v.document,
    sources: { key: string; label: string; document: QuoteDocument }[] = [];
  if (!document) {
    const [base, items, variants, variantLines] = await Promise.all([
      legacyRows("quotation_lines", "quotation_id", id),
      legacyRows("quotation_items", "quotation_id", id),
      legacyRows("quotation_variants", "quotation_id", id),
      legacyRows(
        "quotation_variant_lines",
        "quotation_variant_id",
        "00000000-0000-0000-0000-000000000000",
      ),
    ]);
    // Variant lines use a variant FK, not quotation_id, in the live schema.
    const groupRows: any[] = [...variantLines];
    if (variants.length) {
      const r = await db
        .from("quotation_variant_lines")
        .select("*")
        .in(
          "quotation_variant_id",
          variants.map((v) => v.id),
        );
      if (r.error) throw r.error;
      groupRows.push(...(r.data || []).filter((x) => !x.is_deleted));
      const alt = await db
        .from("quotation_variant_lines")
        .select("*")
        .in(
          "variant_id",
          variants.map((v) => v.id),
        );
      if (alt.error) throw alt.error;
      for (const x of alt.data || [])
        if (!x.is_deleted && !groupRows.some((r) => r.id === x.id))
          groupRows.push(x);
    }
    const h = v.header_snapshot || q;
    const header = {
      buyer_id: h.buyer_id || null,
      buyer_code: h.buyer_code || "",
      buyer_name: h.buyer_name || "",
      brand: h.buyer_brand_name || h.brand || "",
      subject: h.subject || "",
      quotation_date: String(
        h.quotation_date ||
          h.received_date ||
          h.received_at ||
          h.created_at ||
          today(),
      ).slice(0, 10),
      received_at: String(h.received_at || h.received_date || "").slice(0, 10),
      valid_until: h.valid_until || "",
      currency: h.currency || "USD",
      incoterm: h.incoterm || "FOB",
      remarks: h.remarks || h.notes || "",
    };
    const add = (
      key: string,
      label: string,
      lines: QuoteLine[],
      currency = header.currency,
    ) => {
      if (!lines.length) return;
      sources.push({
        key,
        label,
        document: {
          header: { ...header, currency },
          lines,
          requires_review: false,
          source_note: label,
        },
      });
    };
    add(
      "lines",
      "기존 기본 견적 행",
      base.map((l) =>
        legacyLine(
          l,
          {},
          variants.filter((t) => t.quotation_line_id === l.id && t.moq),
        ),
      ),
      "USD",
    );
    add(
      "items",
      "기존 Items 행",
      items.map((l) => legacyLine(l)),
    );
    for (const group of variants.filter((x) =>
      groupRows.some((r) => (r.quotation_variant_id || r.variant_id) === x.id),
    )) {
      add(
        "variant:" + group.id,
        "기존 옵션: " + (group.label || group.variant_no || group.id),
        groupRows
          .filter((r) => (r.quotation_variant_id || r.variant_id) === group.id)
          .map((r) =>
            legacyLine(
              r,
              base.find((l) => l.id === r.quotation_line_id),
            ),
          ),
        group.currency || header.currency,
      );
    }
    if (!sources.length)
      sources.push({
        key: "empty",
        label: "기존 행 없음 · 원본 확인 후 입력 필요",
        document: {
          header,
          lines: [],
          requires_review: true,
          source_note: "기존 행 없음 · 원본 확인 후 입력 필요",
        },
      });
    const chosen = source ? sources.find((s) => s.key === source) : sources[0];
    if (!chosen) throw new QuoteError("유효하지 않은 기존 가격 출처입니다.");
    document = structuredClone(chosen.document);
    document.requires_review =
      document.lines.length === 0 ||
      sources.length > 1 ||
      document.lines.some(
        (l) =>
          l.offer_price == null ||
          l.style_no === "(Style 확인 필요)" ||
          l.internal.legacy_snapshot?.qty === 0,
      ) ||
      document.header.currency !== header.currency;
  }
  const lineIds = new Set(document.lines.map((l) => l.id));
  const files =
    checkDb(
      await db
        .from("quotation_line_attachments")
        .select("*")
        .eq("quotation_id", id)
        .eq("version_id", v.id)
        .eq("is_deleted", false),
    ) || [];
  return {
    quotation: q,
    versions: versions.map(({ document, header_snapshot, ...row }: any) => row),
    version: { ...v, document: undefined, header_snapshot: undefined },
    document,
    revision: Number(v.revision),
    legacy: !v.document,
    sources,
    files: files.filter((f: any) => lineIds.has(f.quotation_line_id)),
  };
}
export async function writeQuote(
  action: string,
  actor: any,
  id: string | null,
  versionId: string | null,
  revision: number | null,
  document: QuoteDocument | null,
  note = "",
  file: any = null,
) {
  if ((id && !UUID.test(id)) || (versionId && !UUID.test(versionId)))
    throw new QuoteError("견적과 버전 ID를 확인해 주세요.");
  const r = await db.rpc("quotation_write", {
    p_action: action,
    p_quote: id,
    p_version: versionId,
    p_revision: revision,
    p_document: document,
    p_actor: actor.user.id,
    p_note: note.slice(0, 2000),
    p_file: file,
  });
  return checkDb(r);
}
export async function copyCosting(id: string): Promise<QuoteLine> {
  if (!UUID.test(id)) throw new QuoteError("Costing ID를 확인해 주세요.");
  const c = checkDb(
    await db
      .from("costing_headers")
      .select("*")
      .eq("id", id)
      .eq("is_deleted", false)
      .maybeSingle(),
  );
  if (!c) throw new QuoteError("Costing이 없습니다.", 404);
  return {
    id: randomUUID(),
    style_no: c.style_no || "",
    description: "",
    qty: 1,
    unit: "pc",
    offer_price: value(c.offer_usd ?? c.offer_price_usd),
    target_price: null,
    remarks: c.remarks || "",
    costing_id: c.id,
    internal: { costing_snapshot: c, copied_at: new Date().toISOString() },
    tiers: [],
  };
}
export async function prepareQuote(value: any, current?: QuoteDocument) {
  const d = normalizeQuote(value);
  for (const l of d.lines) {
    const prior = current?.lines.find((x) => x.id === l.id);
    if (prior?.costing_id === l.costing_id) {
      l.internal = prior.internal || {};
    } else if (l.costing_id) {
      const copy = await copyCosting(l.costing_id);
      const expected = value.lines.find((x: any) => x.id === l.id)?.internal
        ?.costing_snapshot;
      if (
        expected &&
        (expected.updated_at !== copy.internal.costing_snapshot.updated_at ||
          Number(expected.version) !==
            Number(copy.internal.costing_snapshot.version))
      )
        throw new QuoteError(
          "Costing이 변경되었습니다. 원가 버전을 다시 선택해 주세요.",
          409,
        );
      l.internal = copy.internal;
    } else if (prior) l.internal = prior.internal || {};
  }
  return d;
}
export async function resolveBuyer(d: QuoteDocument) {
  if (!d.header.buyer_id) {
    if (!d.header.buyer_name) throw new QuoteError("바이어를 선택해 주세요.");
    return;
  }
  const b = checkDb(
    await db
      .from("companies")
      .select("*")
      .eq("id", d.header.buyer_id)
      .maybeSingle(),
  );
  if (!b || b.is_deleted) throw new QuoteError("바이어를 확인해 주세요.");
  d.header.buyer_code = b.code || "";
  d.header.buyer_name = b.company_name || b.name || b.company_name_en || "";
  if (!d.header.buyer_name)
    throw new QuoteError("바이어 이름을 확인해 주세요.");
}
