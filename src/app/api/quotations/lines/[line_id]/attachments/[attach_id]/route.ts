import { quoteActor, quoteFailure, QuoteError } from "@/lib/generalQuoteServer";
export async function DELETE() {
  try {
    await quoteActor("edit");
    throw new QuoteError(
      "새 견적 화면에서 버전별 첨부 제거를 사용해 주세요.",
      409,
    );
  } catch (e) {
    return quoteFailure(e);
  }
}
