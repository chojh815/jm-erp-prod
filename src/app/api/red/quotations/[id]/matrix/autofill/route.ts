import { redActor, redFailure, RedError } from "@/lib/redQuoteServer";
export async function POST() {
  try {
    await redActor("edit");
    throw new RedError(
      "견적 버전 화면에서 원가·환율·마진과 가격을 함께 저장해 주세요.",
      409,
    );
  } catch (e) {
    return redFailure(e);
  }
}
