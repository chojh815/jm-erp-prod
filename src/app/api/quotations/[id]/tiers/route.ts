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
export async function PUT() {
  try {
    await quoteActor("edit");
    throw new QuoteError(
      "새로고침 후 견적 전체와 MOQ를 함께 저장해 주세요. 기존 자료는 변경하지 않았습니다.",
      409,
    );
  } catch (e) {
    return quoteFailure(e);
  }
}
