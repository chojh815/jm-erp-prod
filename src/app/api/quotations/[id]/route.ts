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

import { assertQuoteReady } from "@/lib/generalQuoteRules";
export const dynamic = "force-dynamic";
export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const actor = await quoteActor(),
      p = new URL(req.url).searchParams,
      s = await readQuote(
        params.id,
        p.get("version_id") || undefined,
        p.get("source") || undefined,
      );
    return quoteJson({
      ...s,
      header: s.document.header,
      lines: s.document.lines,
      items: s.document.lines,
      canEdit: actor.permissions.includes("dev.costings.edit"),
      canCreate: actor.permissions.includes("dev.costings.create"),
      canPurge: actor.permissions.includes("dev.costings.delete"),
    });
  } catch (e) {
    return quoteFailure(e);
  }
}
export async function PUT(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const actor = await quoteActor("edit"),
      body = await req.json();
    if (
      !body.document ||
      !Number.isSafeInteger(body.revision) ||
      !body.version_id
    )
      throw new QuoteError(
        "새 화면에서 버전·revision과 견적 전체를 함께 저장해 주세요.",
        409,
      );
    const s = await readQuote(params.id, body.version_id, body.source);
    if (s.document.requires_review && !body.acknowledge_review)
      throw new QuoteError("기존 가격 출처를 확인해 주세요.", 409);
    const d = await prepareQuote(body.document, s.document);
    if (
      d.header.currency !== s.document.header.currency &&
      s.document.lines.some((l) => l.offer_price != null) &&
      !body.confirm_currency_change
    )
      throw new QuoteError(
        "통화 변경은 자동 환산되지 않습니다. 단가를 확인해 주세요.",
        409,
      );
    d.requires_review = false;
    d.source_note = s.document.source_note;
    await resolveBuyer(d);
    return quoteJson(
      await writeQuote(
        "save",
        actor,
        params.id,
        body.version_id,
        body.revision,
        d,
      ),
    );
  } catch (e) {
    return quoteFailure(e);
  }
}
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const body = await req.json(),
      action = body.action;
    if (
      !["revise", "sent"].includes(action) ||
      !Number.isSafeInteger(body.revision) ||
      !body.version_id
    )
      throw new QuoteError("올바른 버전 작업이 필요합니다.");
    const actor = await quoteActor(action === "revise" ? "create" : "edit"),
      s = await readQuote(params.id, body.version_id, body.source);
    if (action === "sent") assertQuoteReady(s.document);
    return quoteJson(
      await writeQuote(
        action,
        actor,
        params.id,
        body.version_id,
        body.revision,
        s.document,
        String(body.note || ""),
      ),
    );
  } catch (e) {
    return quoteFailure(e);
  }
}
export async function DELETE(
  _: Request,
  { params }: { params: { id: string } },
) {
  try {
    const actor = await quoteActor("delete");
    return quoteJson(
      await writeQuote("archive", actor, params.id, null, null, null),
    );
  } catch (e) {
    return quoteFailure(e);
  }
}
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const actor = await quoteActor("delete"),
      b = await req.json();
    if (b.action !== "restore") throw new QuoteError("복원 요청이 필요합니다.");
    return quoteJson(
      await writeQuote("restore", actor, params.id, null, null, null),
    );
  } catch (e) {
    return quoteFailure(e);
  }
}
