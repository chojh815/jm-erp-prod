import {
  redActor,
  redFailure,
  redJson,
  db,
  rpcError,
  RedError,
} from "@/lib/redQuoteServer";
import { normalizeRedDocument } from "@/lib/redQuoteDocument";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const actor = await redActor();
    const archived = new URL(req.url).searchParams.get("archived") === "1";
    let query = db
      .from("red_quotations")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(200);
    query = archived
      ? query.not("archived_at", "is", null)
      : query.is("archived_at", null);
    const result = await query;
    if (result.error) throw result.error;
    return redJson({
      data: result.data || [],
      canCreate: actor.permissions.includes("dev.costings.create"),
      canArchive: actor.permissions.includes("dev.costings.delete"),
    });
  } catch (e) {
    return redFailure(e);
  }
}
export async function POST(req: Request) {
  try {
    const actor = await redActor("create"),
      body = await req.json();
    const header: any = {};
    for (const k of ["title", "buyer_name", "style_no", "ship_from_code"]) {
      header[k] = String(body[k] || "").trim() || null;
      if (header[k]?.length > 300)
        throw new RedError("입력은 300자 이내로 작성해 주세요.");
    }
    header.ship_from_code ||= "CN_QINGDAO";
    const document = normalizeRedDocument({
      inputs: { unit_price_currency: "CNY" },
      packages: { A: { cells: [], packaging_costs: [] } },
    });
    const result = await db.rpc("red_create_quotation", {
      p_header: header,
      p_document: document,
      p_actor: actor.user.id,
    });
    rpcError(result.error);
    return redJson({ data: result.data });
  } catch (e) {
    return redFailure(e);
  }
}
