import {
  quoteActor,
  quoteJson,
  quoteFailure,
  db,
  checkDb,
} from "@/lib/generalQuoteServer";
export async function GET(req: Request) {
  try {
    await quoteActor();
    const p = new URL(req.url).searchParams;
    let q = db
      .from("quotation_headers")
      .select("buyer_brand_name,buyer_brand,brand")
      .is("archived_at", null)
      .limit(5000);
    if (p.get("buyer_id")) q = q.eq("buyer_id", p.get("buyer_id"));
    const rows = checkDb(await q) || [],
      term = (p.get("q") || "").toLowerCase();
    const brands = [
      ...new Set<string>(
        rows
          .flatMap((r: any) => [r.buyer_brand_name, r.buyer_brand, r.brand])
          .filter(Boolean)
          .map((x: any) => String(x).trim()),
      ),
    ]
      .filter((x) => x.toLowerCase().includes(term))
      .sort();
    return quoteJson({ brands });
  } catch (e) {
    return quoteFailure(e);
  }
}
