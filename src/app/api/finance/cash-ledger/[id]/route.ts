import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function ok(data: any = {}) {
  return NextResponse.json({ ok: true, ...data });
}

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

async function hasActiveLinkedSource(refType: string, refId: string) {
  if (!refType || !refId) return false;

  if (refType === "subcontract_payable") {
    const { data, error } = await supabaseAdmin
      .from("subcontract_payables")
      .select("id, is_deleted")
      .eq("id", refId)
      .maybeSingle();
    if (error) throw error;
    return !!data && data.is_deleted !== true;
  }

  if (refType === "subcontract_advance") {
    const { data, error } = await supabaseAdmin
      .from("subcontract_advances")
      .select("id, is_deleted")
      .eq("id", refId)
      .maybeSingle();
    if (error) throw error;
    return !!data && data.is_deleted !== true;
  }

  return false;
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const id = String(params?.id || "").trim();
    if (!id) return bad("Cash transaction id is required", 400);

    const { data: tx, error: txLoadError } = await supabaseAdmin
      .from("cash_transactions")
      .select("id, ref_type, ref_id, is_deleted")
      .eq("id", id)
      .maybeSingle();

    if (txLoadError) throw txLoadError;
    if (!tx || tx.is_deleted === true) return ok();

    const refType = String(tx.ref_type || "").trim();
    const refId = String(tx.ref_id || "").trim();
    const linkedSourceActive = await hasActiveLinkedSource(refType, refId);
    if (linkedSourceActive) {
      return bad(
        `Cannot delete cashbook line directly while linked ${refType} is still active. Delete it from the source screen first.`,
        409
      );
    }

    const { error } = await supabaseAdmin
      .from("cash_transactions")
      .update({ is_deleted: true })
      .eq("id", id)
      .eq("is_deleted", false);

    if (error) throw error;
    return ok();
  } catch (e: any) {
    return bad(e?.message || "Failed to delete cash transaction", 500);
  }
}
