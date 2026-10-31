import {
  redActor,
  readRedDocument,
  redFailure,
  redJson,
  RedError,
} from "@/lib/redQuoteServer";
export const dynamic = "force-dynamic";
export async function GET(
  req: Request,
  { params }: { params: { versionId: string } },
) {
  try {
    await redActor();
    const s = await readRedDocument(params.versionId);
    const code = (
      new URL(req.url).searchParams.get("package") || "A"
    ).toUpperCase();
    return redJson({
      cost_inputs: s.document.inputs,
      packaging_costs: s.document.packages[code]?.packaging_costs || [],
    });
  } catch (e) {
    return redFailure(e);
  }
}
export async function PUT(
  _: Request,
  { params }: { params: { versionId: string } },
) {
  try {
    await redActor("edit");
    const s = await readRedDocument(params.versionId);
    if (s.version.status !== "DRAFT")
      throw new RedError("발송/확정 버전은 수정할 수 없습니다.", 409);
    throw new RedError(
      "새로고침 후 원가·환율·가격을 함께 저장해 주세요. 기존 자료는 변경하지 않았습니다.",
      409,
    );
  } catch (e) {
    return redFailure(e);
  }
}
