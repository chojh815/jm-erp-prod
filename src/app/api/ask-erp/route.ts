import { NextResponse } from "next/server";
import { ApiIdentityError, getApiIdentity } from "@/lib/apiIdentity";
import { availableModes, interpretPO, poCandidates, validPO } from "./provider";
import { tracePO } from "./trace";

export const dynamic = "force-dynamic";

const json = (data: object, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });

async function identity() {
  const actor = await getApiIdentity();
  const can = (permission: string) => actor.role === "admin" || actor.permissions.includes(permission);
  if (!can("po.view")) throw new ApiIdentityError("Forbidden", 403);
  return {
    shipment: can("shipment.view"),
    invoice: can("invoice.view"),
    packing: can("packing_list.view"),
  };
}

function failure(error: unknown) {
  if (error instanceof ApiIdentityError) return json({ error: "access" }, error.status);
  console.error("Ask ERP lookup failed", error);
  return json({ error: "lookupFailed" }, 500);
}

export async function GET(req: Request) {
  try {
    await identity();
    return json({ modes: availableModes(req) });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(req: Request) {
  try {
    const access = await identity();
    const body = await req.json().catch(() => null);
    const question = typeof body?.question === "string" ? body.question.normalize("NFKC").trim() : "";
    if (!question || question.length > 200) return json({ error: "invalidQuestion" }, 400);
    const modes = availableModes(req);
    const requested = body?.mode;
    const mode = modes.find(value => value === requested) ?? "direct";

    const exact = validPO(question);
    const candidates = exact ? [question] : poCandidates(question);
    if (!candidates.length || candidates.length > 8) return json({ error: "enterPO" }, 400);

    const choice = !exact && mode !== "direct" ? await interpretPO(mode, question, candidates) : null;
    if (choice === "" || (!choice && candidates.length !== 1)) return json({ error: "enterPO" }, 400);

    const trace = await tracePO(choice || candidates[0], access);
    if (!trace.po) {
      return json({ error: trace.ambiguous ? "ambiguousPO" : "notFound" }, trace.ambiguous ? 409 : 404);
    }
    return json({ trace, mode: choice ? mode : "direct" });
  } catch (error) {
    return failure(error);
  }
}
