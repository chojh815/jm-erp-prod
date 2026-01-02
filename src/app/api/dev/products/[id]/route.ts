// src/app/api/dev/products/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}
function bad(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}
function safeNumber(v: any, fallback: number | null = null): number | null {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  if (Number.isNaN(n)) return fallback;
  return n;
}

const T_HEADERS = "product_development_headers";
const T_MATS = "product_development_materials";
const T_OPS = "product_development_operations";
const T_VERS = "product_development_versions";

function parseId(idRaw: any): number | null {
  const s = String(idRaw ?? "").trim();
  if (!/^\d+$/.test(s)) return null;
  return Number(s);
}

// ==================================================
// GET /api/dev/products/:id
// ==================================================
export async function GET(
  _req: NextRequest,
  ctx: { params: { id: string } }
) {
  try {
    const id = parseId(ctx.params.id);
    if (!id) return bad("Invalid id", 400);

    const { data: header, error: hErr } = await supabaseAdmin
      .from(T_HEADERS)
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (hErr) {
      console.error(`${T_HEADERS} select error:`, hErr);
      return bad("Failed to load header.", 500);
    }
    if (!header) return ok({ header: null, materials: [], operations: [] });

    const { data: materials, error: mErr } = await supabaseAdmin
      .from(T_MATS)
      .select("*")
      .eq("product_id", id)
      .order("row_index", { ascending: true });

    if (mErr) {
      console.error(`${T_MATS} select error:`, mErr);
      return bad("Failed to load materials.", 500);
    }

    const { data: operations, error: oErr } = await supabaseAdmin
      .from(T_OPS)
      .select("*")
      .eq("product_id", id)
      .order("row_index", { ascending: true });

    if (oErr) {
      console.error(`${T_OPS} select error:`, oErr);
      return bad("Failed to load operations.", 500);
    }

    return ok({
      header,
      materials: materials ?? [],
      operations: operations ?? [],
    });
  } catch (e) {
    console.error("GET /api/dev/products/[id] error:", e);
    return bad("Unexpected error.", 500);
  }
}

// ==================================================
// PUT /api/dev/products/:id
// body: (POST와 동일 형태 가능)
// ==================================================
export async function PUT(req: NextRequest, ctx: { params: { id: string } }) {
  try {
    const id = parseId(ctx.params.id);
    if (!id) return bad("Invalid id", 400);

    const body = await req.json();

    // 기존 header 조회해서 style_no 확보(스토리지 폴더/일관성)
    const { data: existing, error: exErr } = await supabaseAdmin
      .from(T_HEADERS)
      .select("id, style_no")
      .eq("id", id)
      .maybeSingle();

    if (exErr) {
      console.error(`${T_HEADERS} existing select error:`, exErr);
      return bad("Failed to load product.", 500);
    }
    if (!existing) return bad("Product not found.", 404);

    const styleNo = (existing.style_no ?? "").toString().trim().toUpperCase();

    const headerPayload: any = {
      product_category: body.productCategory ?? null,
      product_type: body.productType ?? null,
      weight_g: safeNumber(body.weight, null),
      size_text: body.size ?? null,
      dev_date: body.devDate ?? null,
      developer: body.developer ?? null,
      remarks: body.remarks ?? null,
      currency: body.currency ?? null,
      base_style_no: body.baseStyleNo ?? null,
      color_suffix: body.colorSuffix ?? null,
      material_content: body.materialContent ?? null,
      hs_code: body.hsCode ?? null,
      image_urls: Array.isArray(body.imageUrls)
        ? body.imageUrls
        : body.imageUrl
        ? [body.imageUrl]
        : null,
    };

    const { data: updated, error: upErr } = await supabaseAdmin
      .from(T_HEADERS)
      .update(headerPayload)
      .eq("id", id)
      .select("*")
      .maybeSingle();

    if (upErr) {
      console.error(`${T_HEADERS} update error:`, upErr);
      return bad("Failed to update header.", 500);
    }

    const materials = Array.isArray(body.materials) ? body.materials : [];
    const operations = Array.isArray(body.operations) ? body.operations : [];

    // version best-effort
    try {
      const snapshot = {
        header: { style_no: styleNo, ...headerPayload },
        materials,
        operations,
        saved_at: new Date().toISOString(),
      };

      const { data: lastVers } = await supabaseAdmin
        .from(T_VERS)
        .select("version_no")
        .eq("product_id", id)
        .order("version_no", { ascending: false })
        .limit(1);

      const nextVersion =
        (lastVers && lastVers.length > 0 ? lastVers[0].version_no ?? 0 : 0) + 1;

      await supabaseAdmin.from(T_VERS).insert({
        product_id: id,
        version_no: nextVersion,
        snapshot,
      });
    } catch (e) {
      console.error("Version backup exception (best-effort):", e);
    }

    // lines re-save
    await supabaseAdmin.from(T_MATS).delete().eq("product_id", id);
    await supabaseAdmin.from(T_OPS).delete().eq("product_id", id);

    if (materials.length > 0) {
      const toInsertMats = materials.map((m: any, idx: number) => ({
        product_id: id,
        style_no: styleNo,
        row_index: idx + 1,
        material_name: m.materialName ?? m.material_name ?? m.name ?? null,
        name: m.name ?? m.materialName ?? m.material_name ?? null,
        spec: m.spec ?? null,
        qty: safeNumber(m.qty, 0),
        uom: m.uom ?? null,
        unit_cost: safeNumber(m.unitCost ?? m.unit_cost ?? m.unitPrice, 0),
        supplier_id: m.supplierId ?? m.supplier_id ?? null,
        supplier_name:
          m.supplierName ??
          m.supplier_name ??
          m.supplier ??
          m.manualSupplier ??
          null,
        supplier_company_id: m.supplierCompanyId ?? null,
        supplier_name_text: m.supplierNameText ?? null,
        remark: m.remark ?? m.remarks ?? null,
        is_deleted: false,
      }));

      const { error: mInsErr } = await supabaseAdmin
        .from(T_MATS)
        .insert(toInsertMats);

      if (mInsErr) {
        console.error(`${T_MATS} insert error:`, mInsErr);
        return bad("Failed to save materials.", 500);
      }
    }

    if (operations.length > 0) {
      const toInsertOps = operations.map((op: any, idx: number) => ({
        product_id: id,
        style_no: styleNo,
        row_index: idx + 1,
        operation_name: op.operationName ?? op.operation_name ?? op.name ?? null,
        name: op.name ?? op.operationName ?? op.operation_name ?? null,
        qty: safeNumber(op.qty, 0),
        unit_cost: safeNumber(op.unitCost ?? op.unit_cost ?? op.unitPrice, 0),
        supplier_id: op.supplierId ?? op.supplier_id ?? null,
        supplier_name:
          op.supplierName ??
          op.supplier_name ??
          op.supplier ??
          op.manualSupplier ??
          null,
        supplier_company_id: op.supplierCompanyId ?? null,
        supplier_name_text: op.supplierNameText ?? null,
        remark: op.remark ?? op.remarks ?? null,
        is_deleted: false,
      }));

      const { error: oInsErr } = await supabaseAdmin
        .from(T_OPS)
        .insert(toInsertOps);

      if (oInsErr) {
        console.error(`${T_OPS} insert error:`, oInsErr);
        return bad("Failed to save operations.", 500);
      }
    }

    return ok({ header: updated });
  } catch (e) {
    console.error("PUT /api/dev/products/[id] error:", e);
    return bad("Unexpected error.", 500);
  }
}

// ==================================================
// DELETE /api/dev/products/:id
// ==================================================
export async function DELETE(
  _req: NextRequest,
  ctx: { params: { id: string } }
) {
  try {
    const id = parseId(ctx.params.id);
    if (!id) return bad("Invalid id", 400);

    // style_no for storage path
    const { data: header, error: hErr } = await supabaseAdmin
      .from(T_HEADERS)
      .select("id, style_no")
      .eq("id", id)
      .maybeSingle();

    if (hErr) {
      console.error(`${T_HEADERS} select for delete error:`, hErr);
      return bad("Failed to load product.", 500);
    }
    if (!header) return ok({ message: "Already deleted." });

    const styleNo = (header.style_no ?? "").toString().trim().toUpperCase();

    await supabaseAdmin.from(T_MATS).delete().eq("product_id", id);
    await supabaseAdmin.from(T_OPS).delete().eq("product_id", id);
    await supabaseAdmin.from(T_VERS).delete().eq("product_id", id);

    const { error: delErr } = await supabaseAdmin
      .from(T_HEADERS)
      .delete()
      .eq("id", id);

    if (delErr) {
      console.error(`${T_HEADERS} delete error:`, delErr);
      return bad("Failed to delete header.", 500);
    }

    // storage (best-effort)
    const BUCKET = "style-images";
    const folder = `styles/${styleNo}`;

    try {
      const { data: files } = await supabaseAdmin.storage
        .from(BUCKET)
        .list(folder, { limit: 200 });
      if (files && files.length > 0) {
        const paths = files.map((f) => `${folder}/${f.name}`);
        await supabaseAdmin.storage.from(BUCKET).remove(paths);
      }
    } catch (e) {
      console.error("Storage delete exception (best-effort):", e);
    }

    return ok({ message: "Deleted." });
  } catch (e) {
    console.error("DELETE /api/dev/products/[id] error:", e);
    return bad("Unexpected error.", 500);
  }
}
