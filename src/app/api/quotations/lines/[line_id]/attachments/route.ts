import {
  quoteActor,
  quoteJson,
  quoteFailure,
  readQuote,
  db,
  checkDb,
  QuoteError,
} from "@/lib/generalQuoteServer";
export async function GET(
  req: Request,
  { params }: { params: { line_id: string } },
) {
  try {
    await quoteActor();
    const key = checkDb(
      await db
        .from("quotation_line_keys")
        .select("quotation_id")
        .eq("id", params.line_id)
        .maybeSingle(),
    );
    if (!key) throw new QuoteError("견적 행이 없습니다.", 404);
    const p = new URL(req.url).searchParams,
      s = await readQuote(key.quotation_id, p.get("version_id") || undefined);
    return quoteJson({
      items: s.files
        .filter((f: any) => f.quotation_line_id === params.line_id)
        .map((f: any) => ({
          ...f,
          signed_url:
            "/api/quotations/" +
            key.quotation_id +
            "/files?version_id=" +
            s.version.id +
            "&file_id=" +
            f.id,
        })),
    });
  } catch (e) {
    return quoteFailure(e);
  }
}
export async function POST() {
  try {
    await quoteActor("edit");
    throw new QuoteError(
      "새 견적 화면에서 버전별 직접 업로드를 사용해 주세요.",
      409,
    );
  } catch (e) {
    return quoteFailure(e);
  }
}
