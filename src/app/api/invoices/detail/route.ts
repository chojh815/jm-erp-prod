// src/app/api/invoices/detail/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function bad(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}
function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}

function normalizeHeaderRemarks(header: any) {
  if (!header) return header;
  const h: any = { ...header };

  const hasRemarks = h.remarks !== undefined && h.remarks !== null;
  const hasMemo = h.memo !== undefined && h.memo !== null;

  if (!hasRemarks && hasMemo) h.remarks = String(h.memo);
  delete h.memo;

  return h;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return bad("id is required.", 400);

    const { data: headerRaw, error: hErr } = await supabaseAdmin
      .from("invoice_headers")
      .select("*")
      .eq("id", id)
      .eq("is_deleted", false)
      .maybeSingle();

    if (hErr) return bad(hErr.message, 500);
    if (!headerRaw) return bad("Invoice not found.", 404);

    const header = normalizeHeaderRemarks(headerRaw);

    const { data: lines, error: lErr } = await supabaseAdmin
      .from("invoice_lines")
      .select("*")
      .eq("invoice_id", id)
      .order("line_no", { ascending: true });

    if (lErr) return bad(lErr.message, 500);

    return ok({ header, lines: lines ?? [] });
  } catch (e: any) {
    console.error("[api/invoices/detail] error:", e);
    return bad(e?.message || "Unexpected server error", 500);
  }
}
