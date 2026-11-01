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
export async function GET(req: Request) {
  try {
    await quoteActor();
    const p = new URL(req.url).searchParams;
    if (p.get("id"))
      return quoteJson({ line: await copyCosting(p.get("id")!) });
    const q = (p.get("q") || "")
      .replace(/[%_(),.\\]/g, " ")
      .trim()
      .slice(0, 100);
    let request = db
      .from("costing_headers")
      .select("id,style_no,version,status,offer_usd,offer_price_usd,buyer_id")
      .eq("is_deleted", false)
      .order("updated_at", { ascending: false })
      .limit(50);
    if (q) request = request.ilike("style_no", "%" + q + "%");
    return quoteJson({ rows: checkDb(await request) || [] });
  } catch (e) {
    return quoteFailure(e);
  }
}
