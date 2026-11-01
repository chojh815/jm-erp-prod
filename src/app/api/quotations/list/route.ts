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

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const a = await quoteActor(),
      p = new URL(req.url).searchParams;
    let query = db
      .from("quotation_headers")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(500);
    query =
      p.get("archived") === "1"
        ? query.not("archived_at", "is", null)
        : query.is("archived_at", null);
    const data = checkDb(await query) || [],
      term = (p.get("q") || "").trim().toLowerCase();
    const rows = data.filter(
      (r: any) =>
        !term ||
        [
          r.quotation_no,
          r.subject,
          r.style_no,
          r.buyer_name,
          r.buyer_code,
        ].some((x) =>
          String(x || "")
            .toLowerCase()
            .includes(term),
        ),
    );
    return quoteJson({
      rows,
      canCreate: a.permissions.includes("dev.costings.create"),
      canArchive: a.permissions.includes("dev.costings.delete"),
    });
  } catch (e) {
    return quoteFailure(e);
  }
}
