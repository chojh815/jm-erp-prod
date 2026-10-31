import {
  createRedRevision,
  redActor,
  redFailure,
  redJson,
  db,
  RedError,
} from "@/lib/redQuoteServer";
export const dynamic = "force-dynamic";
export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const actor = await redActor();
    const [q, v] = await Promise.all([
      db.from("red_quotations").select("*").eq("id", params.id).maybeSingle(),
      db
        .from("red_quotation_versions")
        .select("*")
        .eq("red_quotation_id", params.id)
        .order("version_no", { ascending: false }),
    ]);
    if (q.error) throw q.error;
    if (v.error) throw v.error;
    if (!q.data) throw new RedError("견적이 없습니다.", 404);
    return redJson({
      data: {
        quotation: q.data,
        versions: (v.data || []).map((r) => ({
          ...r,
          version_key: "v" + r.version_no,
        })),
        canEdit: actor.permissions.includes("dev.costings.edit"),
        canCreate: actor.permissions.includes("dev.costings.create"),
      },
    });
  } catch (e) {
    return redFailure(e);
  }
}
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    await redActor("create");
    const body = await req.json();
    const base = await db
      .from("red_quotation_versions")
      .select("id")
      .eq("id", body.from_version_id)
      .eq("red_quotation_id", params.id)
      .maybeSingle();
    if (base.error) throw base.error;
    if (!base.data) throw new RedError("같은 견적의 원본 버전이 필요합니다.");
    const created = await createRedRevision(
      base.data.id,
      String(body.change_summary || ""),
    );
    return redJson({ data: { ...created, version: created } });
  } catch (e) {
    return redFailure(e);
  }
}
