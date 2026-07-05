import { supabaseAdmin } from "@/lib/supabaseAdmin";

const DEFAULT_CNY_PER_USD = 6.8;
const n = (v: unknown) => {
  const value = Number(v ?? 0);
  return Number.isFinite(value) ? value : 0;
};
const text = (v: unknown) => String(v ?? "").trim();
const key = (v: unknown) => text(v).toUpperCase();
const missingTable = (e: any) =>
  e?.code === "42P01" || /does not exist|schema cache/i.test(String(e?.message ?? ""));

function monthStart(value: unknown) {
  const date = new Date(text(value) || Date.now());
  const valid = Number.isFinite(date.getTime()) ? date : new Date();
  return `${valid.getUTCFullYear()}-${String(valid.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export async function createExpectedMarginSnapshot(args: {
  poHeaderId: string;
  userId?: string | null;
  userEmail?: string | null;
}) {
  const { poHeaderId, userId = null, userEmail = null } = args;
  const { data: header, error: headerError } = await supabaseAdmin
    .from("po_headers")
    .select("id,po_no,status,confirmed_at,order_date")
    .eq("id", poHeaderId)
    .maybeSingle();
  if (headerError) throw headerError;
  if (!header || key(header.status) !== "CONFIRMED") return { created: 0, skipped: "not_confirmed" };

  const { data: lines, error: linesError } = await supabaseAdmin
    .from("po_lines")
    .select("id,line_no,jm_style_no,buyer_style_no,qty,unit_price,amount")
    .eq("po_header_id", poHeaderId)
    .eq("is_deleted", false)
    .order("line_no", { ascending: true });
  if (linesError) throw linesError;
  if (!lines?.length) return { created: 0, skipped: "no_lines" };

  const lineIds = lines.map((x: any) => x.id).filter(Boolean);
  const styles = Array.from(new Set(lines.map((x: any) => key(x.jm_style_no)).filter(Boolean)));
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("expected_margin_snapshots")
    .select("po_line_id")
    .in("po_line_id", lineIds);
  if (existingError) {
    if (missingTable(existingError)) return { created: 0, skipped: "migration_required" };
    throw existingError;
  }
  const existingIds = new Set((existing ?? []).map((x: any) => String(x.po_line_id)));
  const pending = lines.filter((x: any) => !existingIds.has(String(x.id)));
  if (!pending.length) return { created: 0, skipped: "already_snapshotted" };

  const effectiveMonth = monthStart(header.order_date ?? header.confirmed_at);
  const { data: fxRow, error: fxError } = await supabaseAdmin
    .from("expected_margin_fx_rates")
    .select("cny_per_usd")
    .lte("effective_month", effectiveMonth)
    .order("effective_month", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (fxError && !missingTable(fxError)) throw fxError;
  const cnyPerUsd = n(fxRow?.cny_per_usd) > 0 ? n(fxRow?.cny_per_usd) : DEFAULT_CNY_PER_USD;

  const { data: products, error: productError } = styles.length
    ? await supabaseAdmin
        .from("product_development_headers")
        .select("id,style_no,currency")
        .eq("is_deleted", false)
        .in("style_no", styles)
    : ({ data: [], error: null } as any);
  if (productError) throw productError;

  const productIds = (products ?? []).map((x: any) => x.id).filter(Boolean);
  const empty = Promise.resolve({ data: [], error: null } as any);
  const [materials, operations, extras, worksheets] = await Promise.all([
    productIds.length
      ? supabaseAdmin.from("product_development_materials").select("product_id,qty,unit_cost").in("product_id", productIds).eq("is_deleted", false)
      : empty,
    productIds.length
      ? supabaseAdmin.from("product_development_operations").select("product_id,qty,unit_cost").in("product_id", productIds).eq("is_deleted", false)
      : empty,
    supabaseAdmin.from("po_line_extra_costs").select("po_line_id,unit_cost,enabled").in("po_line_id", lineIds),
    supabaseAdmin.from("work_sheet_lines").select("po_line_id,vendor_unit_cost_usd").in("po_line_id", lineIds).eq("is_deleted", false),
  ]);
  const dataError = materials.error ?? operations.error ?? extras.error ?? worksheets.error;
  if (dataError) throw dataError;

  const localByProduct = new Map<string, number>();
  for (const line of [...(materials.data ?? []), ...(operations.data ?? [])]) {
    const id = String((line as any).product_id ?? "");
    localByProduct.set(id, (localByProduct.get(id) ?? 0) + n((line as any).qty) * n((line as any).unit_cost));
  }

  const costByStyle = new Map<string, { local: number; currency: string; usd: number }>();
  for (const product of products ?? []) {
    const currency = key((product as any).currency) || "CNY";
    const local = localByProduct.get(String((product as any).id));
    if (local === undefined) continue;
    const usd = currency === "CNY" ? local / cnyPerUsd : currency === "USD" ? local : 0;
    if (usd > 0) costByStyle.set(key((product as any).style_no), { local, currency, usd });
  }

  const extraByLine = new Map<string, number>();
  for (const extra of extras.data ?? []) {
    if (!(extra as any).enabled) continue;
    const id = String((extra as any).po_line_id ?? "");
    extraByLine.set(id, (extraByLine.get(id) ?? 0) + n((extra as any).unit_cost));
  }

  const worksheetByLine = new Map<string, number>();
  for (const ws of worksheets.data ?? []) {
    const id = String((ws as any).po_line_id ?? "");
    const cost = n((ws as any).vendor_unit_cost_usd);
    if (id && cost > 0 && !worksheetByLine.has(id)) worksheetByLine.set(id, cost);
  }

  const now = new Date().toISOString();
  const rows = pending.map((line: any) => {
    const product = costByStyle.get(key(line.jm_style_no));
    const fallback = worksheetByLine.get(String(line.id)) ?? 0;
    const expectedUnit = product?.usd ?? fallback;
    const optionalUnit = extraByLine.get(String(line.id)) ?? 0;
    const totalUnit = expectedUnit + optionalUnit;
    const qty = n(line.qty);
    const unitPrice = n(line.unit_price);
    const revenue = n(line.amount) || qty * unitPrice;
    const cogs = qty * totalUnit;
    const margin = revenue - cogs;
    return {
      po_header_id: poHeaderId,
      po_line_id: line.id,
      po_no: header.po_no,
      line_no: line.line_no,
      jm_style_no: line.jm_style_no,
      buyer_style_no: line.buyer_style_no,
      qty,
      unit_price_usd: unitPrice,
      revenue_usd: revenue,
      source_cost_currency: product?.currency ?? "USD",
      source_unit_cost_local: product?.local ?? fallback,
      cny_per_usd: product?.currency === "CNY" ? cnyPerUsd : null,
      expected_unit_cost_usd: expectedUnit,
      optional_unit_cost_usd: optionalUnit,
      total_unit_cost_usd: totalUnit,
      expected_cogs_usd: cogs,
      expected_margin_usd: margin,
      expected_margin_pct: revenue > 0 ? margin / revenue : null,
      cost_source: product ? "PRODUCT_DEVELOPMENT" : fallback > 0 ? "WORKSHEET_PLANNED" : "NO_COST",
      snapshot_at: now,
      confirmed_at: header.confirmed_at ?? now,
      created_by: userId,
      created_by_email: userEmail,
    };
  });

  const { error: insertError } = await supabaseAdmin
    .from("expected_margin_snapshots")
    .upsert(rows, { onConflict: "po_line_id", ignoreDuplicates: true });
  if (insertError) throw insertError;
  return { created: rows.length, cnyPerUsd, effectiveMonth };
}
