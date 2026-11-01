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
export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    await quoteActor();
    const p = new URL(req.url).searchParams,
      s = await readQuote(params.id, p.get("version_id") || undefined);
    const lines = s.document.lines;
    return quoteJson({ rows: [], version_id: s.version.id });
  } catch (e) {
    return quoteFailure(e);
  }
}
