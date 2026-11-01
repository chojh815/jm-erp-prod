import { redActor, redJson, redFailure, RedError } from "@/lib/redQuoteServer";
import { UUID } from "@/lib/generalQuoteRules";
import { cleanPurgedQuoteFiles } from "@/lib/redQuotationPurge";
export const dynamic = "force-dynamic";
export async function POST(_: Request, { params }: { params: { id: string } }) {
  try {
    const actor = await redActor("delete");
    if (!UUID.test(params.id)) throw new RedError("견적 ID를 확인해 주세요.");
    return redJson({
      cleanup: await cleanPurgedQuoteFiles(params.id, actor.user.id),
    });
  } catch (e) {
    return redFailure(e);
  }
}
