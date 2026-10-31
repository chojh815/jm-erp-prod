import {
  redActor,
  redFailure,
  redJson,
  db,
  RedError,
} from "@/lib/redQuoteServer";
export const dynamic = "force-dynamic";
export async function PUT(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    await redActor("edit");
    const body = await req.json(),
      patch: any = { updated_at: new Date().toISOString() };
    for (const k of ["buyer_name", "style_no", "ship_from_code", "title"])
      if (k in body) {
        patch[k] = String(body[k] || "").trim() || null;
        if (patch[k]?.length > 300)
          throw new RedError("입력은 300자 이내로 작성해 주세요.");
      }
    const r = await db
      .from("red_quotations")
      .update(patch)
      .eq("id", params.id)
      .is("archived_at", null)
      .select("*")
      .maybeSingle();
    if (r.error) throw r.error;
    if (!r.data) throw new RedError("견적이 없거나 보관되어 있습니다.", 409);
    return redJson({ data: r.data });
  } catch (e) {
    return redFailure(e);
  }
}
export async function DELETE(
  _: Request,
  { params }: { params: { id: string } },
) {
  try {
    const actor = await redActor("delete");
    const r = await db
      .from("red_quotations")
      .update({
        archived_at: new Date().toISOString(),
        archived_by: actor.user.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", params.id)
      .select("id")
      .maybeSingle();
    if (r.error) throw r.error;
    if (!r.data) throw new RedError("견적이 없습니다.", 404);
    return redJson({ success: true, archived: true });
  } catch (e) {
    return redFailure(e);
  }
}
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    await redActor("delete");
    const body = await req.json();
    if (body.action !== "restore")
      throw new RedError("유효하지 않은 작업입니다.");
    const r = await db
      .from("red_quotations")
      .update({
        archived_at: null,
        archived_by: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", params.id)
      .select("id")
      .maybeSingle();
    if (r.error) throw r.error;
    if (!r.data) throw new RedError("견적이 없습니다.", 404);
    return redJson({ success: true });
  } catch (e) {
    return redFailure(e);
  }
}
