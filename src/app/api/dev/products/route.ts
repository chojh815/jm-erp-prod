// src/app/api/dev/products/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}
function bad(message: string, status = 400, extra: any = {}) {
  return NextResponse.json({ success: false, error: message, ...extra }, { status });
}

function safeNumber(v: any, fallback = 0): number {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isNaN(n) ? fallback : n;
}
function upper(v: any) {
  const s = (v ?? "").toString().trim();
  return s ? s.toUpperCase() : "";
}

const T_HEADERS = "product_development_headers";
const T_MATS = "product_development_materials";
const T_OPS = "product_development_operations";
const T_VERS = "product_development_versions";

const V_MATS = "dev_product_materials";
const V_OPS = "dev_product_operations";

function mapMaterialRowForUI(r: any) {
  const out: any = {
    id: r.id ?? null,
    row_index: r.row_index ?? r.rowIndex ?? null,
    name: r.material_name ?? r.materialName ?? r.name ?? "",
    spec: r.spec_description ?? r.specDescription ?? r.spec ?? "",
    qty: r.qty ?? 0,
    unit_cost: r.unit_cost ?? r.unitCost ?? r.unitPrice ?? 0,
    supplier_company_id: r.supplier_company_id ?? null,
    supplier_name_text: r.supplier_name_text ?? r.supplierNameText ?? "",
    vendor_name: r.supplier_name_text ?? r.vendor_name ?? r.vendorName ?? "",
    vendor: r.supplier_name_text ?? r.vendor ?? "",
    supplier: r.supplier_name_text ?? r.supplier ?? "",
    uom: r.uom ?? null,
    remark: r.remark ?? null,
    is_deleted: r.is_deleted ?? false,
    material_name: r.material_name ?? null,
    spec_description: r.spec_description ?? null,
  };
  return out;
}

function mapOperationRowForUI(r: any) {
  const out: any = {
    id: r.id ?? null,
    row_index: r.row_index ?? r.rowIndex ?? null,
    name: r.operation_name ?? r.operationName ?? r.name ?? "",
    qty: r.qty ?? 0,
    unit_cost: r.unit_cost ?? r.unitCost ?? r.unitPrice ?? 0,
    supplier_company_id: r.supplier_company_id ?? null,
    supplier_name_text: r.supplier_name_text ?? r.supplierNameText ?? "",
    vendor_name: r.supplier_name_text ?? r.vendor_name ?? r.vendorName ?? "",
    vendor: r.supplier_name_text ?? r.vendor ?? "",
    supplier: r.supplier_name_text ?? r.supplier ?? "",
    remark: r.remark ?? null,
    is_deleted: r.is_deleted ?? false,
    operation_name: r.operation_name ?? null,
  };
  return out;
}

async function getHeaderByStyleNo(styleNo: string) {
  const { data, error } = await supabaseAdmin
    .from(T_HEADERS)
    .select("*")
    .eq("style_no", styleNo)
    .eq("is_deleted", false as any)
    .maybeSingle();

  if (!error) return { data, error: null };

  const msg = (error as any)?.message ?? "";
  if (msg.toLowerCase().includes("column") && msg.toLowerCase().includes("is_deleted")) {
    const q2 = await supabaseAdmin.from(T_HEADERS).select("*").eq("style_no", styleNo).maybeSingle();
    return { data: q2.data ?? null, error: q2.error ?? null };
  }

  return { data: null, error };
}

async function selectChildRows(tableOrView: string, productId: any, orderCol = "row_index") {
  const q1 = await supabaseAdmin
    .from(tableOrView)
    .select("*")
    .eq("product_id", productId)
    .eq("is_deleted", false as any)
    .order(orderCol, { ascending: true });

  if (!q1.error) return { data: q1.data ?? [], error: null };

  const msg = (q1.error as any)?.message ?? "";
  if (msg.toLowerCase().includes("column") && msg.toLowerCase().includes("is_deleted")) {
    const q2 = await supabaseAdmin
      .from(tableOrView)
      .select("*")
      .eq("product_id", productId)
      .order(orderCol, { ascending: true });

    return { data: q2.data ?? [], error: q2.error ?? null };
  }

  return { data: [], error: q1.error };
}

async function loadMats(productId: any) {
  const v = await selectChildRows(V_MATS, productId);
  if (!v.error) return { data: (v.data ?? []).map(mapMaterialRowForUI), error: null };

  const t = await selectChildRows(T_MATS, productId);
  if (!t.error) return { data: (t.data ?? []).map(mapMaterialRowForUI), error: null };

  return { data: [], error: t.error ?? v.error ?? null };
}

async function loadOps(productId: any) {
  const v = await selectChildRows(V_OPS, productId);
  if (!v.error) return { data: (v.data ?? []).map(mapOperationRowForUI), error: null };

  const t = await selectChildRows(T_OPS, productId);
  if (!t.error) return { data: (t.data ?? []).map(mapOperationRowForUI), error: null };

  return { data: [], error: t.error ?? v.error ?? null };
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const styleNo = upper(url.searchParams.get("styleNo") || url.searchParams.get("style_no"));
    const keywordRaw = (url.searchParams.get("keyword") || "").toString().trim();

    if (styleNo) {
      const found = await getHeaderByStyleNo(styleNo);
      if (found.error) {
        console.error("GET header error:", found.error);
        return bad("Failed to load product header.", 500, { detail: found.error?.message });
      }
      if (!found.data) {
        return ok({ header: null, materials: [], operations: [] });
      }

      const productId = found.data.id;

      const mats = await loadMats(productId);
      if (mats.error) {
        console.error("GET materials error:", mats.error);
        return bad("Failed to load materials.", 500, { detail: mats.error?.message });
      }

      const ops = await loadOps(productId);
      if (ops.error) {
        console.error("GET operations error:", ops.error);
        return bad("Failed to load operations.", 500, { detail: ops.error?.message });
      }

      return ok({
        header: found.data,
        materials: mats.data ?? [],
        operations: ops.data ?? [],
      });
    }

    if (keywordRaw) {
      const keyword = keywordRaw.toUpperCase();

      const q1 = await supabaseAdmin
        .from(T_HEADERS)
        .select("*")
        .ilike("style_no", `%${keyword}%`)
        .eq("is_deleted", false as any)
        .order("updated_at", { ascending: false })
        .limit(50);

      if (q1.error) {
        console.error("GET search error:", q1.error);
        return bad("Failed to search products.", 500, { detail: q1.error?.message });
      }

      const items = (q1.data ?? []).map((r: any) => ({
        id: r.id,
        style_no: r.style_no,
        styleNo: r.style_no,
        product_category: r.product_category ?? null,
        product_type: r.product_type ?? null,
        dev_date: r.dev_date ?? null,
        developer: r.developer ?? null,
        remarks: r.remarks ?? null,
        currency: r.currency ?? null,
        base_style_no: r.base_style_no ?? null,
        color_suffix: r.color_suffix ?? null,
        plating_color: r.plating_color ?? null,
      }));

      return ok({ items });
    }

    return bad("styleNo or keyword is required.", 400);
  } catch (e: any) {
    console.error("GET /api/dev/products fatal:", e);
    return bad("Unexpected error.", 500, { detail: e?.message });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const styleNo = upper(body.styleNo || body.style_no);
    if (!styleNo) return bad("Style No. is required.", 400);
    const createOnly = body.createOnly === true;

    if (createOnly) {
      const existing = await getHeaderByStyleNo(styleNo);
      if (existing.error) {
        return bad("Failed to check the new style number.", 500, {
          detail: existing.error?.message,
        });
      }
      if (existing.data?.id) {
        return bad("This style number already exists. Enter a new style number.", 409);
      }
    }

    const productCategory = body.productCategory ?? body.product_category ?? null;
    const productType = body.productType ?? body.product_type ?? null;

    const weightG = safeNumber(body.weight_g ?? body.weightG ?? body.weight ?? 0, 0);
    const sizeText = body.size_text ?? body.sizeText ?? body.size ?? null;
    const devDate = body.dev_date ?? body.devDate ?? body.dev_date_text ?? null;

    const developer = body.developer ?? null;
    const remarks = body.remarks ?? body.remark ?? null;
    const currency = body.currency ?? null;
    const platingColor = body.platingColor ?? body.plating_color ?? null;

    const baseStyleNo = upper(body.baseStyleNo || body.base_style_no) || null;
    const colorSuffix = upper(body.colorSuffix || body.color_suffix) || null;

    const materials: any[] = Array.isArray(body.materials) ? body.materials : [];
    const operations: any[] = Array.isArray(body.operations) ? body.operations : [];

    const headerPayload: any = {
      style_no: styleNo,
      product_category: productCategory,
      product_type: productType,
      weight_g: weightG,
      size_text: sizeText,
      dev_date: devDate,
      developer,
      remarks,
      currency,
      plating_color: platingColor,
      base_style_no: baseStyleNo,
      color_suffix: colorSuffix,
      is_deleted: false,
    };

    const up = createOnly
      ? await supabaseAdmin
          .from(T_HEADERS)
          .insert(headerPayload)
          .select("*")
          .maybeSingle()
      : await supabaseAdmin
          .from(T_HEADERS)
          .upsert(headerPayload, { onConflict: "style_no" })
          .select("*")
          .eq("style_no", styleNo)
          .maybeSingle();

    if (up.error) {
      console.error("header upsert error:", up.error);
      return bad("Failed to save product header.", 500, { detail: up.error?.message });
    }
    if (!up.data?.id) {
      return bad("Saved header but missing product id.", 500, { detail: "header id not returned" });
    }

    const productId = up.data.id;

    try {
      await supabaseAdmin.from(T_VERS).insert({
        product_id: productId,
        jm_style_no: styleNo,
        snapshot: {
          header: up.data,
          materials,
          operations,
          savedAt: new Date().toISOString(),
        },
      } as any);
    } catch (e) {
      console.warn("version insert skipped(best-effort):", e);
    }

    const delM = await supabaseAdmin.from(T_MATS).delete().eq("product_id", productId);
    if (delM.error) {
      console.error("materials delete error:", delM.error);
      return bad("Failed to delete existing materials.", 500, { detail: delM.error?.message });
    }

    const delO = await supabaseAdmin.from(T_OPS).delete().eq("product_id", productId);
    if (delO.error) {
      console.error("operations delete error:", delO.error);
      return bad("Failed to delete existing operations.", 500, { detail: delO.error?.message });
    }

    if (materials.length > 0) {
      const rows = materials.map((m: any, idx: number) => ({
        product_id: productId,
        row_index: m.rowIndex ?? m.row_index ?? idx + 1,
        qty: safeNumber(m.qty, 0),
        unit_cost: safeNumber(m.unitCost ?? m.unit_cost ?? m.unitPrice ?? m.unit_price, 0),
        material_name: m.materialName ?? m.material_name ?? m.name ?? null,
        spec_description: m.specDescription ?? m.spec_description ?? m.spec ?? null,
        uom: m.uom ?? null,
        remark: m.remark ?? m.remarks ?? null,
        supplier_company_id: m.supplierCompanyId ?? m.supplier_company_id ?? m.vendorId ?? null,
        supplier_name_text:
          m.supplierNameText ??
          m.supplier_name_text ??
          m.vendor_name ??
          m.vendorName ??
          m.vendor ??
          m.supplier ??
          null,
        is_deleted: false,
      }));

      const ins = await supabaseAdmin.from(T_MATS).insert(rows);
      if (ins.error) {
        console.error("materials insert error:", ins.error);
        return bad("Failed to save materials.", 500, {
          detail: ins.error?.message,
          hint: "Check product_development_materials columns.",
        });
      }
    }

    if (operations.length > 0) {
      const rows = operations.map((op: any, idx: number) => ({
        product_id: productId,
        row_index: op.rowIndex ?? op.row_index ?? idx + 1,
        qty: safeNumber(op.qty, 0),
        unit_cost: safeNumber(op.unitCost ?? op.unit_cost ?? op.unitPrice ?? op.unit_price, 0),
        operation_name: op.operationName ?? op.operation_name ?? op.name ?? null,
        remark: op.remark ?? op.remarks ?? null,
        supplier_company_id: op.supplierCompanyId ?? op.supplier_company_id ?? op.vendorId ?? null,
        supplier_name_text:
          op.supplierNameText ??
          op.supplier_name_text ??
          op.vendor_name ??
          op.vendorName ??
          op.vendor ??
          op.supplier ??
          null,
        is_deleted: false,
      }));

      const ins = await supabaseAdmin.from(T_OPS).insert(rows);
      if (ins.error) {
        console.error("operations insert error:", ins.error);
        return bad("Failed to save operations.", 500, {
          detail: ins.error?.message,
          hint: "Check product_development_operations columns.",
        });
      }
    }

    const mats2 = await loadMats(productId);
    const ops2 = await loadOps(productId);

    return ok({
      header: up.data,
      materials: mats2.data ?? [],
      operations: ops2.data ?? [],
    });
  } catch (e: any) {
    console.error("POST /api/dev/products fatal:", e);
    return bad("Unexpected error.", 500, { detail: e?.message });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const styleNo = upper(url.searchParams.get("styleNo") || url.searchParams.get("style_no"));
    if (!styleNo) return bad("styleNo required", 400);

    const found = await getHeaderByStyleNo(styleNo);
    if (found.error) return bad("Failed to load product.", 500, { detail: found.error?.message });
    if (!found.data?.id) return ok({ message: "Already deleted (not found)." });

    const productId = found.data.id;

    const d1 = await supabaseAdmin.from(T_MATS).delete().eq("product_id", productId);
    if (d1.error) return bad("Failed to delete materials.", 500, { detail: d1.error?.message });

    const d2 = await supabaseAdmin.from(T_OPS).delete().eq("product_id", productId);
    if (d2.error) return bad("Failed to delete operations.", 500, { detail: d2.error?.message });

    try {
      await supabaseAdmin.from(T_VERS).delete().eq("product_id", productId);
    } catch {}

    const d3 = await supabaseAdmin.from(T_HEADERS).delete().eq("id", productId);
    if (d3.error) return bad("Failed to delete product.", 500, { detail: d3.error?.message });

    return ok({ message: "Product deleted.", styleNo });
  } catch (e: any) {
    console.error("DELETE /api/dev/products fatal:", e);
    return bad("Unexpected error.", 500, { detail: e?.message });
  }
}
