import { createRedRevision, redFailure, redJson } from "@/lib/redQuoteServer";
export const dynamic = "force-dynamic";
export async function POST(
  req: Request,
  { params }: { params: { versionId: string } },
) {
  try {
    const body = await req.json().catch(() => ({}));
    return redJson({
      data: await createRedRevision(
        params.versionId,
        String(body.change_summary || ""),
      ),
    });
  } catch (e) {
    return redFailure(e);
  }
}
