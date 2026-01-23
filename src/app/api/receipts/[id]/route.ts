import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function num(v: any) {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "0"));
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const receiptId = params.id;
    const body = await req.json().catch(() => ({}));

    const patch: any = {
      updated_at: new Date().toISOString(),
    };

    if (body?.receipt_date != null) patch.receipt_date = body.receipt_date;
    if (body?.payment_method != null)
      patch.payment_method = String(body.payment_method).trim();
    if (body?.reference_no !== undefined)
      patch.reference_no = String(body.reference_no ?? "").trim() || null;
    if (body?.note !== undefined) patch.note = String(body.note ?? "") || null;

    if (body?.received_amount != null) {
      const amt = round2(num(body.received_amount));
      if (amt <= 0) {
        return NextResponse.json(
          { success: false, error: "received_amount must be > 0" },
          { status: 400 }
        );
      }
      patch.received_amount = amt;
    }

    if (body?.fx_rate !== undefined)
      patch.fx_rate = body.fx_rate == null ? null : num(body.fx_rate);
    if (body?.received_amount_local !== undefined)
      patch.received_amount_local =
        body.received_amount_local == null ? null : num(body.received_amount_local);

    const { data, error } = await supabaseAdmin
      .from("receipt_headers")
      .update(patch)
      .eq("id", receiptId)
      .eq("is_deleted", false)
      .select("*")
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, row: data });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const receiptId = params.id;

    const { data, error } = await supabaseAdmin
      .from("receipt_headers")
      .update({ is_deleted: true, updated_at: new Date().toISOString() })
      .eq("id", receiptId)
      .select("id")
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, id: data?.id ?? receiptId });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
