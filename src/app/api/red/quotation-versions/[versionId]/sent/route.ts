import {
  redActor,
  redFailure,
  redJson,
  readRedDocument,
  db,
  rpcError,
  RedError,
} from "@/lib/redQuoteServer";
import { assertOfferReady } from "@/lib/redQuoteDocument";
export const dynamic = "force-dynamic";
export async function POST(
  req: Request,
  { params }: { params: { versionId: string } },
) {
  try {
    const actor = await redActor("edit"),
      body = await req.json();
    if (!Number.isSafeInteger(body.revision))
      throw new RedError("저장한 버전이 필요합니다.", 409);
    const saved = await readRedDocument(params.versionId);
    assertOfferReady(saved.document);
    const result = await db.rpc("red_mark_sent", {
      p_version: params.versionId,
      p_expected_revision: body.revision,
      p_actor: actor.user.id,
    });
    rpcError(result.error);
    return redJson({ ok: true, ...result.data });
  } catch (e) {
    return redFailure(e);
  }
}
