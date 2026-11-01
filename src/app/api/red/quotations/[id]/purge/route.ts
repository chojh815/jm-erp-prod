import { redActor, redJson, redFailure } from "@/lib/redQuoteServer";
import { purgePreview, purgeTestQuote } from "@/lib/redQuotationPurge";
export const dynamic = "force-dynamic";
export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    await redActor("delete");
    return redJson(await purgePreview(params.id));
  } catch (e) {
    return redFailure(e);
  }
}
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    await redActor("delete");
    return redJson(await purgeTestQuote(params.id, await req.json()));
  } catch (e) {
    return redFailure(e);
  }
}
