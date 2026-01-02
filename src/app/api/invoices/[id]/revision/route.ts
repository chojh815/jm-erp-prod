// src/app/api/invoices/[id]/revision/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function bad(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}
function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function pad4(n: number) {
  return String(n).padStart(4, "0");
}

async function getBuyerCode(buyerId: string) {
  const { data, error } = await supabaseAdmin
    .from("companies")
    .select("code")
    .eq("id", buyerId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  const code = (data as any)?.code ?? null;
  if (!code) throw new Error("Buyer code(companies.code) not found.");
  return String(code).trim();
}

// InvoiceNo: JMI-{buyerCode}-{yy}-{seq4}
async function generateInvoiceNo(buyerCode: string) {
  const now = new Date();
  const yy = pad2(now.getFullYear() % 100);
  const prefix = `JMI-${buyerCode}-${yy}-`;

  const { data, error } = await supabaseAdmin
    .from("invoice_headers")
    .select("invoice_no")
    .like("invoice_no", `${prefix}%`)
    .order("invoice_no", { ascending: false })
    .limit(1);

  if (error) throw new Error(error.message);

  let nextSeq = 1;
  const last = data?.[0]?.invoice_no ? String(data[0].invoice_no) : null;

  if (last && last.startsWith(prefix)) {
    const tail = last.substring(prefix.length);
    const num = parseInt(tail, 10);
    if (!Number.isNaN(num)) nextSeq = num + 1;
  }

  return `${prefix}${pad4(nextSeq)}`;
}

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const invoiceId = params?.id;
    if (!invoiceId) return bad("Invoice id is required.", 400);

    // 1) 원본(또는 특정 revision) 헤더 로드
    const { data: header, error: hErr } = await supabaseAdmin
      .from("invoice_headers")
      .select("*")
      .eq("id", invoiceId)
      .eq("is_deleted", false)
      .maybeSingle();

    if (hErr) return bad(hErr.message, 500);
    if (!header) return bad("Invoice not found.", 404);

    // 2) root id 계산
    const rootId = (header as any).revision_of_invoice_id
      ? String((header as any).revision_of_invoice_id)
      : String((header as any).id);

    // 3) next revision_no 계산 (root+revisions 중 max + 1)
    const { data: maxRows, error: maxErr } = await supabaseAdmin
      .from("invoice_headers")
      .select("revision_no")
      .eq("is_deleted", false)
      .or(`id.eq.${rootId},revision_of_invoice_id.eq.${rootId}`)
      .order("revision_no", { ascending: false })
      .limit(1);

    if (maxErr) return bad(maxErr.message, 500);

    const maxRev = maxRows?.[0]?.revision_no ?? 0;
    const nextRevNo = Number(maxRev) + 1;

    // 4) invoice_no 발급
    const buyerId = String((header as any).buyer_id ?? "");
    if (!buyerId) return bad("buyer_id is missing in invoice header.", 400);

    const buyerCode = await getBuyerCode(buyerId);
    const newInvoiceNo = await generateInvoiceNo(buyerCode);

    // 5) 기존 최신 is_latest=false 처리 (있으면)
    try {
      await supabaseAdmin
        .from("invoice_headers")
        .update({ is_latest: false, updated_at: new Date().toISOString() } as any)
        .eq("is_deleted", false)
        .or(`id.eq.${rootId},revision_of_invoice_id.eq.${rootId}`)
        .eq("is_latest", true);
    } catch {
      // ignore
    }

    // ✅ memo → remarks 전환기 안전: remarks 우선, 없으면 memo 읽어서라도 유지
    const prevRemarks =
      (header as any).remarks ?? (header as any).memo ?? null;

    // 6) 새 헤더 insert (원본 복사 + revision 메타 + DRAFT)
    const insertBase: any = {
      invoice_no: newInvoiceNo,

      buyer_id: (header as any).buyer_id ?? null,
      buyer_name: (header as any).buyer_name ?? null,

      currency: (header as any).currency ?? null,
      incoterm: (header as any).incoterm ?? null,
      payment_term: (header as any).payment_term ?? null,
      destination: (header as any).destination ?? null,
      shipping_origin_code: (header as any).shipping_origin_code ?? null,

      etd: (header as any).etd ?? null,
      eta: (header as any).eta ?? null,

      // ✅ Consignee / Notify 유지
      consignee_text: (header as any).consignee_text ?? null,
      notify_party_text: (header as any).notify_party_text ?? null,

      // ✅ Remarks 유지
      remarks: prevRemarks,

      total_amount: (header as any).total_amount ?? null,

      status: "DRAFT",
      is_deleted: false,
      updated_at: new Date().toISOString(),

      revision_of_invoice_id: rootId,
      revision_no: nextRevNo,

      is_latest: true,

      confirmed_at: null,
      confirmed_by: null,
      confirmed_by_email: null,
    };

    // 컬럼 불일치 대비: 단계적 fallback
    async function insertHeaderWithFallback(payload: any) {
      let current = { ...payload };

      // ✅ 여기서 revision_of_invoice_id / revision_no 는 절대 삭제하지 않는다
      const dropKeys = [
        "payment_term",
        "destination",
        "shipping_origin_code",

        "consignee_text",
        "notify_party_text",

        "remarks",
        "memo", // 혹시 남아있을 경우 대비

        "total_amount",
        "is_latest",
        "confirmed_at",
        "confirmed_by",
        "confirmed_by_email",

        "is_deleted",
        "updated_at",
      ];

      for (let i = 0; i <= dropKeys.length; i++) {
        const { data, error } = await supabaseAdmin
          .from("invoice_headers")
          .insert(current)
          .select()
          .single();

        if (!error && data) return data;

        const msg = error?.message ?? "";
        if (i === dropKeys.length) {
          throw new Error(msg || "Failed to create revision header.");
        }
        delete current[dropKeys[i]];
      }

      throw new Error("Failed to create revision header.");
    }

    const newHeader = await insertHeaderWithFallback(insertBase);
    const newId = String((newHeader as any).id);

    // 7) 라인 복사
    const { data: lines, error: lErr } = await supabaseAdmin
      .from("invoice_lines")
      .select("*")
      .eq("invoice_id", invoiceId)
      .order("line_no", { ascending: true });

    if (lErr) return bad(lErr.message, 500);

    if (lines && lines.length > 0) {
      const rows = (lines as any[]).map((ln) => ({
        invoice_id: newId,
        shipment_id: ln.shipment_id ?? null,
        po_header_id: ln.po_header_id ?? null,
        po_line_id: ln.po_line_id ?? null,
        po_no: ln.po_no ?? null,
        line_no: ln.line_no ?? null,
        style_no: ln.style_no ?? null,
        description: ln.description ?? null,
        qty: ln.qty ?? null,
        unit_price: ln.unit_price ?? null,
        amount: ln.amount ?? null,
        is_deleted: false,
        updated_at: new Date().toISOString(),
      }));

      const first = await supabaseAdmin.from("invoice_lines").insert(rows);
      if (first.error) {
        const stripped = rows.map((r) => {
          const x = { ...r };
          delete x.shipment_id;
          delete x.is_deleted;
          delete x.updated_at;
          return x;
        });
        const second = await supabaseAdmin.from("invoice_lines").insert(stripped);
        if (second.error) throw new Error(second.error.message);
      }
    }

    // 8) invoice_shipments 링크 복사 (있으면)
    try {
      const { data: links } = await supabaseAdmin
        .from("invoice_shipments")
        .select("shipment_id")
        .eq("invoice_id", invoiceId);

      const rows =
        links
          ?.map((r: any) => r.shipment_id)
          .filter(Boolean)
          .map((sid: string) => ({ invoice_id: newId, shipment_id: sid })) ?? [];

      if (rows.length) {
        await supabaseAdmin
          .from("invoice_shipments")
          .upsert(rows, { onConflict: "invoice_id,shipment_id" } as any);
      }
    } catch {
      // ignore
    }

    return ok({
      created: true,
      root_invoice_id: rootId,
      revision_no: nextRevNo,
      invoice_id: newId,
      invoice_no: newInvoiceNo,
    });
  } catch (e: any) {
    console.error("[api/invoices/:id/revision] error:", e);
    return bad(e?.message || "Unexpected server error", 500);
  }
}
