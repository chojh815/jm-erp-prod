import {
  quoteActor,
  quoteJson,
  quoteFailure,
  QuoteError,
} from "@/lib/generalQuoteServer";
import { UUID } from "@/lib/generalQuoteRules";
import { cleanPurgedQuoteFiles } from "@/lib/quotationPurge";
export const dynamic = "force-dynamic";
export async function POST(_: Request, { params }: { params: { id: string } }) {
  try {
    const actor = await quoteActor("delete");
    if (!UUID.test(params.id)) throw new QuoteError("견적 ID를 확인해 주세요.");
    return quoteJson({
      cleanup: await cleanPurgedQuoteFiles(params.id, actor.user.id),
    });
  } catch (e) {
    return quoteFailure(e);
  }
}
