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
    const actor = await quoteActor("create"),
      b = await req.json();
    let ids: any[] = b.costing_ids ||
      b.costingIds || [b.costing_id || b.costingId];
    if (!Array.isArray(ids)) ids = [ids];
    ids = ids.filter(Boolean);
    if (!ids.length) {
      const style = String(b.style_no || b.styleNo || "").trim();
      if (!style) throw new QuoteError("Costing을 선택해 주세요.");
      const rows = checkDb(
        await db
          .from("costing_headers")
          .select("id")
          .eq("style_no", style)
          .eq("is_deleted", false)
          .limit(50),
      );
      if (rows.length !== 1)
        throw new QuoteError(
          "일치하는 Costing이 없거나 여러 개입니다. 새 견적 화면에서 Costing 버전을 선택해 주세요.",
          409,
        );
      ids = rows.map((x: any) => x.id);
    }
    if (ids.length > 100 || new Set(ids).size !== ids.length)
      throw new QuoteError("Costing 선택이 중복되었거나 너무 많습니다.");
    const lines = await Promise.all(ids.map(copyCosting));
    const first = lines[0].internal.costing_snapshot;
    const d = await prepareQuote({
      header: {
        buyer_id: first.buyer_id,
        subject: "",
        quotation_date: today(),
        received_at: today(),
        currency: "USD",
        incoterm: "FOB",
        brand: first.buyer_brand_name || "",
      },
      lines,
    });
    for (let i = 0; i < lines.length; i++)
      d.lines[i].internal = lines[i].internal;
    await resolveBuyer(d);
    const r = await writeQuote("create", actor, null, null, null, d);
    return quoteJson({
      ...r,
      id: r.quotation_id,
      redirect_url: "/quotations/" + r.quotation_id,
    });
  } catch (e) {
    return quoteFailure(e);
  }
}
