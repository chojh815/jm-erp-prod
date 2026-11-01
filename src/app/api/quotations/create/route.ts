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

import { randomUUID } from "node:crypto";
export async function POST(req: Request) {
  try {
    const actor = await quoteActor("create"),
      b = await req.json();
    const raw = b.document || {
      header: {
        buyer_id: b.buyer_id,
        brand: b.brand_name,
        received_at: b.received_at,
        quotation_date: b.received_at || today(),
        subject: b.subject || "",
        remarks: b.notes || "",
        currency: "USD",
        incoterm: "FOB",
      },
      lines: (b.lines || []).map((l: any) => ({
        ...l,
        id: randomUUID(),
        qty: l.qty || 1,
        unit: "pc",
        offer_price: null,
        tiers: [],
      })),
    };
    const d = await prepareQuote(raw);
    await resolveBuyer(d);
    const r = await writeQuote("create", actor, null, null, null, d);
    return quoteJson({ ...r, id: r.quotation_id });
  } catch (e) {
    return quoteFailure(e);
  }
}
