// src/app/api/buyers/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function okResponse(data: any = {}, status = 200) {
  return NextResponse.json({ success: true, ...data }, { status });
}

/**
 * GET /api/buyers
 *  - 리스트 : ?mode=list
 *  - 단일   : ?id=...
 *
 * POST /api/buyers
 *  body: { buyer, departments, brands }
 *
 * DELETE /api/buyers?id=...
 */

// ===================
// GET
// ===================
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const mode = searchParams.get("mode") || "list";

    // 단일 바이어 + dept/brand
    if (id) {
      const { data: buyer, error: buyerErr } = await supabaseAdmin
        .from("buyers")
        .select(
          `
          id,
          code,
          name,
          payment_term_id,
          destination,
          payment_terms (
            id,
            name
          ),
          buyer_departments (
            id,
            name
          ),
          buyer_brands (
            id,
            name
          )
        `
        )
        .eq("id", id)
        .maybeSingle();

      if (buyerErr) {
        console.error("GET /api/buyers single error:", buyerErr);
        return errorResponse(
          buyerErr.message ?? "Failed to load buyer.",
          500
        );
      }

      if (!buyer) return errorResponse("Buyer not found.", 404);

      return okResponse({ buyer });
    }

    // 리스트
    if (mode === "list") {
      const { data, error } = await supabaseAdmin
        .from("buyers")
        .select(
          `
          id,
          code,
          name,
          payment_term_id,
          destination,
          payment_terms (
            id,
            name
          ),
          buyer_departments (
            id,
            name
          ),
          buyer_brands (
            id,
            name
          )
        `
        )
        .order("name", { ascending: true });

      if (error) {
        console.error("GET /api/buyers list error:", error);
        return errorResponse(
          error.message ?? "Failed to load buyers.",
          500
        );
      }

      return okResponse({ items: data ?? [] });
    }

    return errorResponse("Invalid request.", 400);
  } catch (e: any) {
    console.error("GET /api/buyers unexpected error:", e);
    return errorResponse("Unexpected server error.", 500);
  }
}

// ===================
// POST (create / update)
// ===================
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const buyer = body?.buyer;
    const departments = (body?.departments ?? []) as { id?: string; name: string }[];
    const brands = (body?.brands ?? []) as { id?: string; name: string }[];

    if (!buyer) return errorResponse("Missing buyer payload.", 400);
    if (!buyer.code || !buyer.name) {
      return errorResponse("Buyer code and name are required.", 400);
    }

    const nowIso = new Date().toISOString();

    // 1) buyer upsert (code 기준 or id 기준)
    const buyerPayload: any = {
      code: buyer.code,
      name: buyer.name,
      payment_term_id: buyer.payment_term_id ?? null,
      destination: buyer.destination ?? null,
      updated_at: nowIso,
    };

    if (!buyer.id) {
      buyerPayload.created_at = nowIso;
    }

    const { data: upsertedBuyers, error: buyerErr } = await supabaseAdmin
      .from("buyers")
      .upsert(buyerPayload, {
        onConflict: "code",
        ignoreDuplicates: false,
      })
      .select("*");

    if (buyerErr) {
      console.error("POST /api/buyers buyer upsert error:", buyerErr);
      return errorResponse(
        buyerErr.message ?? "Failed to save buyer.",
        500
      );
    }

    const savedBuyer = upsertedBuyers?.[0];
    if (!savedBuyer) {
      return errorResponse("Failed to save buyer.", 500);
    }

    const buyerId = savedBuyer.id as string;

    // 2) dept/brand는 간단하게 "다 지우고 다시 입력" 방식
    const { error: delDeptErr } = await supabaseAdmin
      .from("buyer_departments")
      .delete()
      .eq("buyer_id", buyerId);

    if (delDeptErr) {
      console.error("POST /api/buyers delete depts error:", delDeptErr);
      return errorResponse(
        delDeptErr.message ?? "Failed to reset buyer departments.",
        500
      );
    }

    const cleanDepts = departments
      .filter((d) => d.name && d.name.trim() !== "")
      .map((d) => ({
        buyer_id: buyerId,
        name: d.name.trim(),
        created_at: nowIso,
        updated_at: nowIso,
      }));

    if (cleanDepts.length > 0) {
      const { error: insDeptErr } = await supabaseAdmin
        .from("buyer_departments")
        .insert(cleanDepts);

      if (insDeptErr) {
        console.error(
          "POST /api/buyers insert depts error:",
          insDeptErr
        );
        return errorResponse(
          insDeptErr.message ?? "Failed to save departments.",
          500
        );
      }
    }

    const { error: delBrandErr } = await supabaseAdmin
      .from("buyer_brands")
      .delete()
      .eq("buyer_id", buyerId);

    if (delBrandErr) {
      console.error(
        "POST /api/buyers delete brands error:",
        delBrandErr
      );
      return errorResponse(
        delBrandErr.message ?? "Failed to reset buyer brands.",
        500
      );
    }

    const cleanBrands = brands
      .filter((b) => b.name && b.name.trim() !== "")
      .map((b) => ({
        buyer_id: buyerId,
        name: b.name.trim(),
        created_at: nowIso,
        updated_at: nowIso,
      }));

    if (cleanBrands.length > 0) {
      const { error: insBrandErr } = await supabaseAdmin
        .from("buyer_brands")
        .insert(cleanBrands);

      if (insBrandErr) {
        console.error(
          "POST /api/buyers insert brands error:",
          insBrandErr
        );
        return errorResponse(
          insBrandErr.message ?? "Failed to save brands.",
          500
        );
      }
    }

    return okResponse({ buyer: savedBuyer });
  } catch (e: any) {
    console.error("POST /api/buyers unexpected error:", e);
    return errorResponse("Unexpected server error.", 500);
  }
}

// ===================
// DELETE
// ===================
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return errorResponse("id is required.", 400);

    const { error } = await supabaseAdmin
      .from("buyers")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("DELETE /api/buyers error:", error);
      return errorResponse(
        error.message ?? "Failed to delete buyer.",
        500
      );
    }

    return okResponse({ deleted: true });
  } catch (e: any) {
    console.error("DELETE /api/buyers unexpected error:", e);
    return errorResponse("Unexpected server error.", 500);
  }
}
