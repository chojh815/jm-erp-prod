import {
  redActor,
  readRedDocument,
  redFailure,
  redJson,
  db,
  rpcError,
  RedError,
} from "@/lib/redQuoteServer";
import { normalizeRedDocument } from "@/lib/redQuoteDocument";
export const dynamic = "force-dynamic";
export async function GET(
  _: Request,
  { params }: { params: { versionId: string } },
) {
  try {
    await redActor();
    return redJson(await readRedDocument(params.versionId));
  } catch (e) {
    return redFailure(e);
  }
}
export async function PUT(
  req: Request,
  { params }: { params: { versionId: string } },
) {
  try {
    const actor = await redActor("edit");
    const body = await req.json();
    if (!Number.isSafeInteger(body.revision) || body.revision < 0)
      throw new RedError("새로 불러온 버전 정보가 필요합니다.", 409);
    const document = normalizeRedDocument(body.document);
    const result = await db.rpc("red_save_document", {
      p_version: params.versionId,
      p_document: document,
      p_expected_revision: body.revision,
      p_actor: actor.user.id,
    });
    rpcError(result.error);
    return redJson({ ok: true, ...result.data });
  } catch (e) {
    return redFailure(e);
  }
}
