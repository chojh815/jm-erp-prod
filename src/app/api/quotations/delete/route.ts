import {
  quoteActor,
  quoteJson,
  quoteFailure,
  readQuote,
  prepareQuote,
  resolveBuyer,
  writeQuote,
  db,
  checkDb,
  QuoteError,
  today,
  copyCosting,
} from "@/lib/generalQuoteServer";
export async function POST(req: Request) {
  try {
    const a = await quoteActor("delete"),
      b = await req.json();
    if (!b.id) throw new QuoteError("견적 ID가 필요합니다.");
    return quoteJson(await writeQuote("archive", a, b.id, null, null, null));
  } catch (e) {
    return quoteFailure(e);
  }
}
