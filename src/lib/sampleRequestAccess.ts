import { getApiIdentity } from "@/lib/apiIdentity";
import { supabaseAdmin as db } from "@/lib/supabaseAdmin";
import {
  canReadSample,
  isSampleManager,
  SampleAccessError,
} from "@/lib/sampleHistoryRules";
export { SampleAccessError };
export async function sampleActor() {
  const actor = await getApiIdentity();
  if (!actor.permissions.includes("dev.sample_requests.view"))
    throw new SampleAccessError("Sample Request access is required.", 403);
  return actor;
}
export function requireSampleManagement(
  actor: Awaited<ReturnType<typeof sampleActor>>,
  action: "create" | "edit" | "delete" = "edit",
) {
  if (
    !isSampleManager(actor.role) ||
    !actor.permissions.includes(`dev.sample_requests.${action}`)
  )
    throw new SampleAccessError(
      "Only an authorized manager can change requests or assignments.",
      403,
    );
}
export async function sampleRequestAccess(
  id: string,
  actor: Awaited<ReturnType<typeof sampleActor>>,
  write = false,
) {
  if (!/^[0-9a-f-]{36}$/i.test(id))
    throw new SampleAccessError("Invalid request ID.");
  const { data: row, error } = await db
    .from("sample_requests")
    .select("*")
    .eq("id", id)
    .eq("is_deleted", false)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new SampleAccessError("Request not found.", 404);
  let members: any[] = [];
  if (!isSampleManager(actor.role)) {
    const result = await db
      .from("sample_request_members")
      .select("user_id")
      .eq("request_id", id)
      .eq("user_id", actor.user.id);
    if (result.error) throw new Error(result.error.message);
    members = result.data ?? [];
  }
  if (
    !canReadSample(
      actor,
      row,
      members.map((r) => r.user_id),
    )
  )
    throw new SampleAccessError("This request is not assigned to you.", 403);
  if (
    write &&
    isSampleManager(actor.role) &&
    !actor.permissions.includes("dev.sample_requests.edit")
  )
    throw new SampleAccessError("You have read-only access.", 403);
  if (write && !isSampleManager(actor.role) && actor.role !== "staff")
    throw new SampleAccessError("You have read-only access.", 403);
  return row;
}
export async function assertSampleTopic(
  requestId: string,
  topicId: string | null,
) {
  if (!topicId) return;
  const { data, error } = await db
    .from("sample_request_topics")
    .select("id")
    .eq("id", topicId)
    .eq("request_id", requestId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data)
    throw new SampleAccessError("Sub Title does not belong to this request.");
}
