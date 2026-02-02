// src/app/api/costings/create-from-dev/route.ts
import { NextResponse } from "next/server";
import { guessFxRateToUsd, requireUser } from "../_utils";

export const dynamic = "force-dynamic";

/**
 * Create SAMPLE costing from Product Development.
 *
 * Fixes & Features:
 * 1) Avoid UUID/int8 mismatch: DO NOT write dev.id (bigint like 8) into any UUID column.
 * 2) Add dev_product_id (bigint) linkage when the column exists in costing_headers.
 * 3) Duplicate UX support:
 *    - If existing SAMPLE v1 exists, return 409 with existing_id + latest_version
 *    - If body.create_new_version=true, automatically create next version (v2, v3...)
 * 4) Better error payload for UI.
 */
function errPayload(e: any) {
  return {
    message: e?.message ?? "Unknown error",
    code: e?.code,
    detail: e?.detail,
    hint: e?.hint,
  };
}

export async function POST(req: Request) {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));

  const rawStyle = String(body?.style_no ?? body?.styleNo ?? body?.style ?? "").trim();
  const rawProductDevId = body?.product_dev_id ?? body?.productDevId ?? body?.product_dev_header_id;

  const createNewVersion = Boolean(body?.create_new_version ?? body?.createNewVersion ?? false);
  const stage = String(body?.stage ?? "SAMPLE").toUpperCase();

  const buyerIdRaw = body?.buyer_id ?? body?.buyerId ?? body?.buyer ?? null;

  async function resolveBuyer(buyerId: any) {
    if (!buyerId || String(buyerId).trim() === "") return null;
    const bid = String(buyerId).trim();

    const { data, error } = await supabase
      .from("companies")
      .select("*")
      .eq("id", bid)
      .maybeSingle();

    if (error || !data) return null;

    const code =
      (data as any).buyer_code ??
      (data as any).code ??
      (data as any).company_code ??
      (data as any).abbr ??
      null;

    const name =
      (data as any).buyer_name ??
      (data as any).name ??
      (data as any).company_name ??
      null;

    const defaultMargin =
      (data as any).default_margin_pct ??
      (data as any).buyer_default_margin_pct ??
      (data as any).margin_default_pct ??
      (data as any).margin_pct ??
      null;

    return {
      buyer_id: bid,
      buyer_code: code ? String(code) : null,
      buyer_name: name ? String(name) : null,
      buyer_default_margin_pct:
        defaultMargin !== null && defaultMargin !== undefined && String(defaultMargin) !== ""
          ? Number(defaultMargin)
          : null,
    };
  }

  const buyerInfo = await resolveBuyer(buyerIdRaw);

  // Resolve product development header
  let dev: any = null;

  try {
    if (rawStyle) {
      const styleNo = rawStyle.toUpperCase();
      const { data, error } = await supabase
        .from("product_development_headers")
        .select("*")
        .eq("is_deleted", false)
        .ilike("style_no", styleNo)
        .maybeSingle();

      if (error) return NextResponse.json({ success: false, error: error.message, ...errPayload(error) }, { status: 500 });
      dev = data;
    } else if (rawProductDevId !== null && rawProductDevId !== undefined && String(rawProductDevId).trim() !== "") {
      const pdid = Number(rawProductDevId);
      if (!Number.isFinite(pdid)) {
        return NextResponse.json({ success: false, error: "product_dev_id must be a number (bigint id)" }, { status: 400 });
      }

      const { data, error } = await supabase
        .from("product_development_headers")
        .select("*")
        .eq("id", pdid)
        .eq("is_deleted", false)
        .maybeSingle();

      if (error) return NextResponse.json({ success: false, error: error.message, ...errPayload(error) }, { status: 500 });
      dev = data;
    } else {
      return NextResponse.json({ success: false, error: "style_no or product_dev_id is required" }, { status: 400 });
    }

    if (!dev) return NextResponse.json({ success: false, error: "Product development style not found" }, { status: 404 });

    const styleNo = String(dev.style_no ?? "").trim();
    if (!styleNo) return NextResponse.json({ success: false, error: "product_development_headers.style_no is empty" }, { status: 400 });

    const defaultCurrency = String(dev.currency ?? "CNY");
    const fxToUsd = Number(guessFxRateToUsd(defaultCurrency)) || 1;

    // Find latest version for (style_no, stage)
    const { data: latestRow, error: latestErr } = await supabase
      .from("costing_headers")
      .select("id, version")
      .eq("style_no", styleNo)
      .eq("stage", stage)
      .eq("is_deleted", false)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestErr) return NextResponse.json({ success: false, error: latestErr.message, ...errPayload(latestErr) }, { status: 500 });

    const latestVersion = Number(latestRow?.version ?? 0) || 0;
    const existingId = latestRow?.id ?? null;

    // Default create version is v1 if none exists
    const version = latestVersion > 0 ? (createNewVersion ? latestVersion + 1 : latestVersion) : 1;

    // If exists and user did not ask for new version => return 409 so UI can "Open" or "Create v2"
    if (latestVersion > 0 && !createNewVersion) {
      return NextResponse.json(
        { success: false, error: "Costing already exists", existing_id: existingId, latest_version: latestVersion, stage, style_no: styleNo , buyer: buyerInfo },
        { status: 409 }
      );
    }

    const now = new Date().toISOString();

    // Header insert (SAFE: no UUID linkage)
    const headerInsert: any = {
      style_no: styleNo,
      stage,
      version,
      status: "DRAFT",
      base_qty: dev.base_qty ?? 1,
      default_currency: defaultCurrency,
      remarks: dev.remarks ?? null,
      created_at: now,
      created_by: user.id,
      created_by_email: user.email ?? null,
      updated_at: now,
      updated_by: user.id,
      updated_by_email: user.email ?? null,
      buyer_id: buyerInfo?.buyer_id ?? null,
      buyer_code: buyerInfo?.buyer_code ?? null,
      buyer_name: buyerInfo?.buyer_name ?? null,
      buyer_default_margin_pct: buyerInfo?.buyer_default_margin_pct ?? null,
      is_deleted: false,
    };

    // Try setting bigint linkage if the column exists (best practice: add it via SQL below).
    // If your schema name is different, change 'dev_product_id' accordingly.
    headerInsert.dev_product_id = dev.id;

    const { data: created, error: cErr } = await supabase
      .from("costing_headers")
      .insert(headerInsert)
      .select("id, style_no, stage, version")
      .single();

    if (cErr) {
      // If dev_product_id column does NOT exist, Supabase will throw "column does not exist".
      // Retry once without dev_product_id for backward compatibility.
      const msg = String(cErr.message ?? "");
      if (msg.includes("dev_product_id") && msg.includes("does not exist")) {
        delete headerInsert.dev_product_id;

        const { data: created2, error: cErr2 } = await supabase
          .from("costing_headers")
          .insert(headerInsert)
          .select("id, style_no, stage, version")
          .single();

        if (cErr2) return NextResponse.json({ success: false, error: cErr2.message, ...errPayload(cErr2) }, { status: 500 });
        // continue with created2
        const costingId2 = created2.id as string;
        // lines
        return await copyLinesAndFinalize({ supabase, user, dev, defaultCurrency, fxToUsd, now, costingId: costingId2, styleNo, stage, version });
      }

      return NextResponse.json({ success: false, error: cErr.message, ...errPayload(cErr) }, { status: 500 });
    }

    const costingId = created.id as string;
    return await copyLinesAndFinalize({ supabase, user, dev, defaultCurrency, fxToUsd, now, costingId, styleNo, stage, version });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message ?? "Internal error", ...errPayload(e) }, { status: 500 });
  }
}

async function copyLinesAndFinalize(args: {
  supabase: any;
  user: any;
  dev: any;
  defaultCurrency: string;
  fxToUsd: number;
  now: string;
  costingId: string;
  styleNo: string;
  stage: string;
  version: number;
}) {
  const { supabase, user, dev, defaultCurrency, fxToUsd, now, costingId, styleNo, stage, version } = args;

  // Materials
  const { data: devMats, error: mErr } = await supabase
    .from("product_development_materials")
    .select("*")
    .eq("product_id", dev.id) // dev header id (bigint)
    .eq("is_deleted", false)
    .order("row_index", { ascending: true });

  if (mErr) return NextResponse.json({ success: false, error: mErr.message, message: mErr.message, code: mErr.code, detail: mErr.detail, hint: mErr.hint }, { status: 500 });

  const matRows = (devMats ?? []).map((m: any, idx: number) => {
    const qty = Number(m.qty ?? 0) || 0;
    const unitCost = Number(m.unit_cost ?? 0) || 0;
    return {
      costing_id: costingId,
      line_no: (Number(m.row_index ?? idx) || idx) + 1,
      material_name: m.material_name ?? "",
      spec: m.remark ?? "",
      qty,
      unit: m.uom ?? "",
      unit_cost: unitCost,
      currency: defaultCurrency,
      fx_rate_to_usd: fxToUsd,
      amount_usd: qty * unitCost * fxToUsd,
      supplier_id: null,
      supplier_name: null,
      created_at: now,
      created_by: user.id,
      created_by_email: user.email ?? null,
      updated_at: now,
      updated_by: user.id,
      updated_by_email: user.email ?? null,
      is_deleted: false,
    };
  });

  if (matRows.length) {
    const { error: i1 } = await supabase.from("costing_material_lines").insert(matRows);
    if (i1) return NextResponse.json({ success: false, error: i1.message, message: i1.message, code: i1.code, detail: i1.detail, hint: i1.hint }, { status: 500 });
  }

  // Operations
  const { data: devOps, error: oErr } = await supabase
    .from("product_development_operations")
    .select("*")
    .eq("product_id", dev.id)
    .eq("is_deleted", false)
    .order("row_index", { ascending: true });

  if (oErr) return NextResponse.json({ success: false, error: oErr.message, message: oErr.message, code: oErr.code, detail: oErr.detail, hint: oErr.hint }, { status: 500 });

  const opRows = (devOps ?? []).map((o: any, idx: number) => {
    const qty = Number(o.qty ?? 0) || 0;
    const unitCost = Number(o.unit_cost ?? 0) || 0;
    return {
      costing_id: costingId,
      line_no: (Number(o.row_index ?? idx) || idx) + 1,
      operation_name: o.operation_name ?? "",
      qty,
      unit: o.unit ?? "",
      unit_cost: unitCost,
      currency: defaultCurrency,
      fx_rate_to_usd: fxToUsd,
      amount_usd: qty * unitCost * fxToUsd,
      supplier_id: null,
      supplier_name: null,
      created_at: now,
      created_by: user.id,
      created_by_email: user.email ?? null,
      updated_at: now,
      updated_by: user.id,
      updated_by_email: user.email ?? null,
      is_deleted: false,
    };
  });

  if (opRows.length) {
    const { error: i2 } = await supabase.from("costing_operation_lines").insert(opRows);
    if (i2) return NextResponse.json({ success: false, error: i2.message, message: i2.message, code: i2.code, detail: i2.detail, hint: i2.hint }, { status: 500 });
  }

  const matTotal = matRows.reduce((s, r) => s + (Number(r.amount_usd ?? 0) || 0), 0);
  const opTotal = opRows.reduce((s, r) => s + (Number(r.amount_usd ?? 0) || 0), 0);
  const total = matTotal + opTotal;

  // Update totals (ignore if some columns don't exist)
  await supabase
    .from("costing_headers")
    .update({
      materials_total_usd: matTotal,
      operations_total_usd: opTotal,
      total_cost_usd: total,
      updated_at: now,
      updated_by: user.id,
      updated_by_email: user.email ?? null,
    })
    .eq("id", costingId);

  return NextResponse.json({ success: true, costing_id: costingId, style_no: styleNo, stage, version });
}
