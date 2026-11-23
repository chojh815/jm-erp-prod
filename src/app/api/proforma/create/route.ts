
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function safe(v: any) {
  return (v ?? "").toString().trim();
}

function pickFirst(obj: any, keys: string[]) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== null && v !== undefined && safe(v) !== "") return v;
  }
  return null;
}

export async function POST(req: NextRequest) {
  const supabase = supabaseAdmin;

  try {
    const body = await req.json().catch(() => null);
    if (!body) {
      return errorResponse("Invalid JSON payload.", 400);
    }

    const header = body.header as {
      po_no?: string;
      buyer_id?: string;
      buyer_name?: string;
      currency?: string;
      payment_term?: string;
      ship_mode?: string;
      destination?: string;
      incoterm?: string;
      shipping_origin_code?: string;
      origin_code?: string;
    };

    const lines = (body.lines || []) as Array<{
      buyerStyleNo?: string | null;
      jmStyleNo?: string | null;
      description?: string | null;
      color?: string | null;
      size?: string | null;
      hsCode?: string | null;
      qty?: number;
      uom?: string | null;
      unitPrice?: number;
      currency?: string | null;
      amount?: number;
      upcCode?: string | null;
    }>;

    const audit = body.audit as {
      created_by?: string | null;
      created_by_email?: string | null;
    };

    if (!header?.buyer_id) {
      return errorResponse("buyer_id is required.", 400);
    }
    if (!header?.currency) {
      return errorResponse("currency is required.", 400);
    }
    if (!lines.length) {
      return errorResponse("At least one line is required.", 400);
    }

    let poHeader: any = null;
    if (header.po_no) {
      const { data, error } = await supabase
        .from("po_headers")
        .select("*")
        .eq("po_no", header.po_no)
        .eq("is_deleted", false)
        .maybeSingle();

      if (error && error.code !== "PGRST116") {
        console.error("Error loading po header for proforma:", error);
      } else {
        poHeader = data ?? null;
      }
    }

    const shippingOriginCode =
      safe(header.shipping_origin_code) ||
      safe(pickFirst(poHeader, ["shipping_origin_code"])) ||
      safe(header.origin_code) ||
      safe(pickFirst(poHeader, ["origin_code", "origin"])) ||
      null;

    const originCode = shippingOriginCode;

    const headerPayload: Record<string, any> = {
      po_no: header.po_no ?? null,
      buyer_id: header.buyer_id ?? null,
      buyer_name: header.buyer_name ?? null,
      currency: header.currency ?? null,
      payment_term: header.payment_term ?? null,
      ship_mode: header.ship_mode ?? null,
      destination: header.destination ?? null,
      incoterm: header.incoterm ?? null,
      created_by: audit?.created_by ?? null,
      created_by_email: audit?.created_by_email ?? null,
    };

    if (shippingOriginCode) headerPayload.shipping_origin_code = shippingOriginCode;
    if (originCode) headerPayload.origin_code = originCode;

    const linePayload = lines.map((l, idx) => ({
      line_no: idx + 1,
      buyer_style_no: l.buyerStyleNo ?? null,
      jm_style_no: l.jmStyleNo ?? null,
      description: l.description ?? null,
      color: l.color ?? null,
      size: l.size ?? null,
      hs_code: l.hsCode ?? null,
      qty: l.qty ?? 0,
      uom: l.uom ?? null,
      unit_price: l.unitPrice ?? 0,
      currency: l.currency ?? header.currency ?? null,
      amount: l.amount ?? (l.qty ?? 0) * (l.unitPrice ?? 0),
      upc_code: l.upcCode ?? null,
    }));

    const { data: saved, error: saveError } = await supabase.rpc(
      "save_proforma_with_monthly_number",
      { p_header: headerPayload, p_lines: linePayload }
    );

    if (saveError) {
      console.error("Error saving proforma:", saveError);
      return errorResponse(
        saveError.message || "Failed to save proforma invoice.",
        saveError.code === "21000" ? 409 : 500
      );
    }

    return NextResponse.json(
      {
        success: true,
        invoice_no: saved.invoice_no,
        header_id: saved.header_id,
        updated: saved.updated,
        shipping_origin_code: shippingOriginCode,
        origin_code: originCode,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("Unexpected error in /api/proforma/create:", err);
    return errorResponse(
      err?.message || "Unexpected server error while creating proforma invoice.",
      500
    );
  }
}
