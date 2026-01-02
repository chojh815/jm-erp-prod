import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// PI 번호 규칙 예시:
// JM-{BuyerCode}-PI-YYYYMMDD-HHmmss
// (buyer code 없으면 PI-YYYYMMDD-HHmmss 로만 생성)
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

    // ===== 기본 검증 =====
    if (!header?.buyer_id) {
      return errorResponse("buyer_id is required.", 400);
    }
    if (!header?.currency) {
      return errorResponse("currency is required.", 400);
    }
    if (!lines.length) {
      return errorResponse("At least one line is required.", 400);
    }

    // 1) 바이어 코드 가져오기 (companies.code)
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

    // 2) 같은 PO에 대한 기존 Proforma 가 있는지 체크 (업데이트용)
    let existingHeaderId: string | null = null;
    let existingInvoiceNo: string | null = null;

    if (header.po_no) {
      const { data: exist, error: existErr } = await supabase
        .from("proforma_headers")
        .select("id, invoice_no")
        .eq("po_no", header.po_no)
        .maybeSingle();

      if (existErr && existErr.code !== "PGRST116") {
        // PGRST116 = no rows found, 그 외 에러만 로그
        console.error("Error checking existing proforma header:", existErr);
      }

      if (exist) {
        existingHeaderId = (exist as any).id as string;
        existingInvoiceNo = (exist as any).invoice_no as string;
      }
    }

    // 새 invoiceNo는 "기존 없을 때만" 생성
    const invoiceNo =
      existingInvoiceNo || buildInvoiceNo(buyerCode);

    // 공통 header payload
    const headerPayload = {
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

    let headerId: string;

    if (existingHeaderId) {
      // ===== 이미 같은 PO에 대한 Proforma가 있을 때: UPDATE + 라인 리플레이스 =====
      const { error: updateErr } = await supabase
        .from("proforma_headers")
        .update(headerPayload)
        .eq("id", existingHeaderId);

      if (updateErr) {
        console.error("Error updating proforma header:", updateErr);
        return errorResponse(
          updateErr.message ?? "Failed to update proforma header.",
          500
        );
      }

      headerId = existingHeaderId;

      // 기존 라인 모두 삭제
      const { error: delErr } = await supabase
        .from("proforma_lines")
        .delete()
        .eq("proforma_header_id", headerId);

      if (delErr) {
        console.error("Error deleting old proforma lines:", delErr);
        return errorResponse(
          delErr.message ?? "Failed to replace proforma lines.",
          500
        );
      }
    } else {
      // ===== 처음 만드는 Proforma: INSERT =====
      const { data: headerInsert, error: headerErr } = await supabase
        .from("proforma_headers")
        .insert(headerPayload)
        .select("id, invoice_no")
        .single();

      if (headerErr) {
        console.error("Error inserting proforma header:", headerErr);
        return errorResponse(
          headerErr.message ?? "Failed to insert proforma header.",
          500
        );
      }

      headerId = (headerInsert as any).id as string;
    }

    // 4) Lines INSERT (공통)
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
      return errorResponse(
        linesErr.message ?? "Failed to insert proforma lines.",
        500
      );
    }

    // 5) 성공 JSON 응답
    return NextResponse.json(
      {
        success: true,
        invoice_no: invoiceNo,
        header_id: headerId,
        updated: !!existingHeaderId,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("Unexpected error in /api/proforma/create:", err);
    return errorResponse(
      err?.message ||
        "Unexpected server error while creating proforma invoice.",
      500
    );
  }
}
