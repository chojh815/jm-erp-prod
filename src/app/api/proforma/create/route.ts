
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function buildInvoiceNo(buyerCode?: string | null): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");

  const yyyy = now.getFullYear().toString();
  const mm = pad(now.getMonth() + 1);
  const dd = pad(now.getDate());
  const hh = pad(now.getHours());
  const mi = pad(now.getMinutes());
  const ss = pad(now.getSeconds());

  const datePart = `${yyyy}${mm}${dd}`;
  const timePart = `${hh}${mi}${ss}`;

  const prefix = buyerCode ? `JM-${buyerCode}-PI` : "PI";
  return `${prefix}-${datePart}-${timePart}`;
}

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
      created_at?: string | null;
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

    let buyerCode: string | null = null;
    if (header.buyer_id) {
      const { data: buyerRow, error: buyerErr } = await supabase
        .from("companies")
        .select("code")
        .eq("id", header.buyer_id)
        .maybeSingle();

      if (buyerErr) {
        console.error("Error loading buyer for proforma:", buyerErr);
      } else {
        buyerCode = (buyerRow as any)?.code ?? null;
      }
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

    let existingHeaderId: string | null = null;
    let existingInvoiceNo: string | null = null;

    if (header.po_no) {
      const { data: exist, error: existErr } = await supabase
        .from("proforma_headers")
        .select("id, invoice_no")
        .eq("po_no", header.po_no)
        .maybeSingle();

      if (existErr && existErr.code !== "PGRST116") {
        console.error("Error checking existing proforma header:", existErr);
      }

      if (exist) {
        existingHeaderId = (exist as any).id as string;
        existingInvoiceNo = (exist as any).invoice_no as string;
      }
    }

    const invoiceNo = existingInvoiceNo || buildInvoiceNo(buyerCode);

    const headerPayload: Record<string, any> = {
      invoice_no: invoiceNo,
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
      created_at: audit?.created_at ?? new Date().toISOString(),
    };

    if (shippingOriginCode) headerPayload.shipping_origin_code = shippingOriginCode;
    if (originCode) headerPayload.origin_code = originCode;

    let headerId: string;

    if (existingHeaderId) {
      const { error: updateErr } = await supabase
        .from("proforma_headers")
        .update(headerPayload)
        .eq("id", existingHeaderId);

      if (updateErr) {
        console.error("Error updating proforma header:", updateErr);
        return errorResponse(updateErr.message ?? "Failed to update proforma header.", 500);
      }

      headerId = existingHeaderId;

      const { error: delErr } = await supabase
        .from("proforma_lines")
        .delete()
        .eq("proforma_header_id", headerId);

      if (delErr) {
        console.error("Error deleting old proforma lines:", delErr);
        return errorResponse(delErr.message ?? "Failed to replace proforma lines.", 500);
      }
    } else {
      const { data: headerInsert, error: headerErr } = await supabase
        .from("proforma_headers")
        .insert(headerPayload)
        .select("id, invoice_no")
        .single();

      if (headerErr) {
        console.error("Error inserting proforma header:", headerErr);
        return errorResponse(headerErr.message ?? "Failed to insert proforma header.", 500);
      }

      headerId = (headerInsert as any).id as string;
    }

    const linePayload = lines.map((l, idx) => ({
      proforma_header_id: headerId,
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

    const { error: linesErr } = await supabase
      .from("proforma_lines")
      .insert(linePayload);

    if (linesErr) {
      console.error("Error inserting proforma lines:", linesErr);
      return errorResponse(linesErr.message ?? "Failed to insert proforma lines.", 500);
    }

    return NextResponse.json(
      {
        success: true,
        invoice_no: invoiceNo,
        header_id: headerId,
        updated: !!existingHeaderId,
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
