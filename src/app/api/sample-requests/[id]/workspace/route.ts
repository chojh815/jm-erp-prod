import { supabaseAdmin as db } from "@/lib/supabaseAdmin";
import {
  sampleActor,
  sampleRequestAccess,
  requireSampleManagement,
  SampleAccessError,
} from "@/lib/sampleRequestAccess";
import { sampleOk, sampleFailure } from "@/lib/sampleHistoryServer";
import { isSampleManager } from "@/lib/sampleHistoryRules";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(_: Request, ctx: Context) {
  try {
    const { id } = await ctx.params;
    const actor = await sampleActor();
    await sampleRequestAccess(id, actor);
    const [topics, members] = await Promise.all([
      db
        .from("sample_request_topics")
        .select("*")
        .eq("request_id", id)
        .order("created_at"),
      db
        .from("sample_request_members")
        .select("user_id,created_at")
        .eq("request_id", id),
    ]);
    if (topics.error || members.error)
      throw new Error(topics.error?.message || members.error?.message);
    const manager =
      isSampleManager(actor.role) &&
      actor.permissions.includes("dev.sample_requests.edit");
    let users: any[] = [];
    if (manager || (members.data?.length ?? 0) > 0) {
      let query = db
        .from("user_profiles")
        .select("user_id,name,email,role,is_active");
      if (!manager)
        query = query.in(
          "user_id",
          (members.data ?? []).map((r) => r.user_id),
        );
      const result = await query;
      if (result.error) throw new Error(result.error.message);
      users = (result.data ?? []).filter((r) => r.is_active !== false);
    }
    return sampleOk({
      topics: topics.data,
      members: members.data,
      users,
      canManage: manager,
      canContribute: manager || actor.role === "staff",
    });
  } catch (e) {
    return sampleFailure(e);
  }
}
export async function POST(req: Request, ctx: Context) {
  try {
    const { id } = await ctx.params;
    const actor = await sampleActor();
    requireSampleManagement(actor);
    await sampleRequestAccess(id, actor);
    const body = await req.json();
    if (body.action === "topic") {
      const title = String(body.title ?? "").trim();
      if (!title || title.length > 200)
        throw new SampleAccessError(
          "Enter a Sub Title (up to 200 characters).",
        );
      const result = await db
        .from("sample_request_topics")
        .insert({ request_id: id, title, created_by: actor.user.id })
        .select("*")
        .single();
      if (result.error)
        throw new SampleAccessError(
          result.error.code === "23505"
            ? "This Sub Title already exists."
            : result.error.message,
          result.error.code === "23505" ? 409 : 500,
        );
      return sampleOk({ topic: result.data });
    }
    if (body.action !== "member")
      throw new SampleAccessError("Unknown action.");
    const userId = String(body.user_id ?? "");
    const user = await db
      .from("user_profiles")
      .select("user_id,is_active")
      .eq("user_id", userId)
      .maybeSingle();
    if (user.error) throw new Error(user.error.message);
    if (!user.data || user.data.is_active === false)
      throw new SampleAccessError("Select an active employee.");
    const result = await db
      .from("sample_request_members")
      .upsert(
        { request_id: id, user_id: userId, added_by: actor.user.id },
        { onConflict: "request_id,user_id", ignoreDuplicates: true },
      );
    if (result.error) throw new Error(result.error.message);
    return sampleOk({});
  } catch (e) {
    return sampleFailure(e);
  }
}
export async function DELETE(req: Request, ctx: Context) {
  try {
    const { id } = await ctx.params;
    const actor = await sampleActor();
    requireSampleManagement(actor);
    await sampleRequestAccess(id, actor);
    const userId = new URL(req.url).searchParams.get("user_id");
    if (!userId) throw new SampleAccessError("Employee ID is required.");
    const result = await db
      .from("sample_request_members")
      .delete()
      .eq("request_id", id)
      .eq("user_id", userId);
    if (result.error) throw new Error(result.error.message);
    return sampleOk({});
  } catch (e) {
    return sampleFailure(e);
  }
}
