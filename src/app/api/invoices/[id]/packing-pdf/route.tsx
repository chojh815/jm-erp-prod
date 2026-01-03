import { NextRequest, NextResponse } from "next/server";
import { renderToStream } from "@react-pdf/renderer";
import { SupabaseAdminClient } from "@/lib/supabaseAdmin";
import PackingListPDF, {
  PackingPdfHeader,
  PackingPdfLine,
} from "@/pdf/PackingListPDF";

const safeNumber = (v: any, fallback = 0): number => {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  if (Number.isNaN(n)) return fallback;
  return n;
};

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = SupabaseAdminClient;
  const invoiceId = params.id;

  try {
    const { data: header, error: hErr } = await supabase
      .from("invoice_headers")
      .select(
        `
        id,
        invoice_no,
        buyer_name,
        destination,
        total_cartons,
        total_gw,
        total_nw,
        created_at
      `
      )
      .eq("id", invoiceId)
      .single();

    if (hErr || !header) {
      throw new Error(hErr?.message || "Invoice header not found");
    }

    const { data: linesRaw, error: lErr } = await supabase
      .from("invoice_lines")
      .select(
        `
        line_no,
        po_no,
        style_no,
        description,
        color,
        size,
        cartons,
        gw,
        nw
      `
      )
      .eq("invoice_header_id", invoiceId)
      .order("line_no", { ascending: true });

    if (lErr) throw lErr;

    const headerPdf: PackingPdfHeader = {
      invoiceNo: header.invoice_no,
      invoiceDate: header.created_at
        ? new Date(header.created_at).toISOString().slice(0, 10)
        : "",
      buyerName: header.buyer_name ?? "",
      destination: header.destination ?? "",
      totalCartons: safeNumber(header.total_cartons),
      totalGw: safeNumber(header.total_gw),
      totalNw: safeNumber(header.total_nw),
    };

    const lines: PackingPdfLine[] = (linesRaw || []).map((l: any, idx: number) => ({
      lineNo: l.line_no ?? idx + 1,
      poNo: l.po_no ?? "",
      styleNo: l.style_no ?? "",
      description: l.description ?? "",
      color: l.color ?? "",
      size: l.size ?? "",
      cartons: safeNumber(l.cartons),
      gw: safeNumber(l.gw),
      nw: safeNumber(l.nw),
    }));

    const stream = await renderToStream(
      <PackingListPDF header={headerPdf} lines={lines} />
    );

    return new NextResponse(stream as any, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${header.invoice_no}-packing.pdf"`,
      },
    });
  } catch (err: any) {
    console.error("[Packing PDF] error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to generate packing list PDF" },
      { status: 500 }
    );
  }
}
