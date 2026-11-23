import { NextResponse } from "next/server";
import { ApiIdentityError, getApiIdentity } from "@/lib/apiIdentity";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const actor = await getApiIdentity();
    if (actor.role !== "admin" && !actor.permissions.includes("proforma.delete")) {
      return NextResponse.json({ error: "You do not have permission to delete or void PIs." }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const action = body?.action;
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    if (action !== "delete" && action !== "void") {
      return NextResponse.json({ error: "Select whether to delete or void the PI." }, { status: 400 });
    }
    if (action === "void" && (!reason || reason.length > 500)) {
      return NextResponse.json({ error: "Enter a reason for voiding the PI (1–500 characters)." }, { status: 400 });
    }
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(params.id)) {
      return NextResponse.json({ error: "PI not found." }, { status: 404 });
    }

    const { error } = await supabaseAdmin.rpc("retire_proforma", {
      p_id: params.id,
      p_action: action,
      p_reason: action === "void" ? reason : null,
      p_actor: actor.user.id,
    });

    if (error?.code === "P0002") {
      return NextResponse.json({ error: "PI not found." }, { status: 404 });
    }
    if (error?.code === "55000") {
      return NextResponse.json({ error: "This PI has already been deleted or voided." }, { status: 409 });
    }
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ApiIdentityError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Failed to retire PI", error);
    return NextResponse.json({ error: "Could not update the PI. Try again." }, { status: 500 });
  }
}
