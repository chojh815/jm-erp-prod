import { supabaseAdmin as db } from "@/lib/supabaseAdmin";
import {
  sampleActor,
  sampleRequestAccess,
  assertSampleTopic,
  SampleAccessError,
} from "@/lib/sampleRequestAccess";
import { historyInput, isSampleManager } from "@/lib/sampleHistoryRules";
import {
  sampleOk,
  sampleFailure,
  verifyHistoryFiles,
  historyEntry,
} from "@/lib/sampleHistoryServer";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(req: Request, ctx: Context) {
  try {
    const { id } = await ctx.params;
    const actor = await sampleActor();
    await sampleRequestAccess(id, actor);
    const params = new URL(req.url).searchParams;
    const page = Math.max(
      1,
      Math.min(10000, Math.floor(Number(params.get("page")) || 1)),
    );
    const topic = params.get("topic");
    const size = 25;
    let query = db
      .from("sample_request_history")
      .select("*", { count: "exact" })
      .eq("request_id", id);
    if (!isSampleManager(actor.role)) query = query.eq("visibility", "TEAM");
    if (topic === "common") query = query.is("topic_id", null);
    else if (topic) {
      await assertSampleTopic(id, topic);
      query = query.eq("topic_id", topic);
    }
    const search = (params.get("q") ?? "")
      .trim()
      .replace(/[(),.%_\\"\x00-\x1f]/g, " ")
      .slice(0, 100)
      .trim();
    if (search)
      query = query.or(
        ["title", "note", "sender", "created_by_name", "search_filenames"]
          .map((key) => `${key}.ilike.%${search}%`)
          .join(","),
      );
    const from = params.get("from"),
      to = params.get("to");
    if (from && /^\d{4}-\d{2}-\d{2}$/.test(from))
      query = query.gte("received_date", from);
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to))
      query = query.lte("received_date", to);
    const { data, error, count } = await query
      .order("received_date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range((page - 1) * size, page * size - 1);
    if (error) throw new Error(error.message);
    return sampleOk({
      items: (data ?? []).map(({ search_filenames, ...row }) => row),
      total: count ?? 0,
      page,
      pageSize: size,
    });
  } catch (e) {
    return sampleFailure(e);
  }
}
export async function POST(req: Request, ctx: Context) {
  try {
    const { id } = await ctx.params;
    const actor = await sampleActor();
    await sampleRequestAccess(id, actor, true);
    const body = await req.json();
    const input = historyInput(body);
    await assertSampleTopic(id, input.topic_id);
    const visibility = body.visibility === "MANAGEMENT" ? "MANAGEMENT" : "TEAM";
    if (visibility === "MANAGEMENT" && !isSampleManager(actor.role))
      throw new SampleAccessError(
        "Only managers can register management-only entries.",
        403,
      );
    if (input.previous_entry_id) {
      const previous = await historyEntry(
        id,
        input.previous_entry_id,
        actor.role,
      );
      if (previous.topic_id !== input.topic_id)
        throw new SampleAccessError(
          "A revision must use the same Sub Title as its previous entry.",
        );
    }
    const files = await verifyHistoryFiles(
      id,
      actor.user.id,
      Array.isArray(body.files) ? body.files : [],
    );
    const { data, error } = await db
      .from("sample_request_history")
      .insert({
        ...input,
        visibility,
        request_id: id,
        files,
        search_filenames: files.map((f) => f.name).join(" "),
        created_by: actor.user.id,
        created_by_name: actor.user.name || actor.user.email || "Employee",
        created_by_email: actor.user.email || "",
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return sampleOk({ item: data });
  } catch (e) {
    return sampleFailure(e);
  }
}
