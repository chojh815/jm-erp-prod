import { quoteActor, quoteJson, quoteFailure } from "@/lib/generalQuoteServer";
import { purgePreview, purgeTestQuote } from "@/lib/quotationPurge";
export const dynamic = "force-dynamic";
export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    await quoteActor("delete");
    return quoteJson(await purgePreview(params.id));
  } catch (e) {
    return quoteFailure(e);
  }
}
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    await quoteActor("delete");
    return quoteJson(await purgeTestQuote(params.id, await req.json()));
  } catch (e) {
    return quoteFailure(e);
  }
}
