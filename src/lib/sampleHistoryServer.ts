import { NextResponse } from "next/server";
import { supabaseAdmin as db } from "@/lib/supabaseAdmin";
import {
  HISTORY_BUCKET,
  SampleAccessError,
  validateHistoryFile,
  isSampleManager,
} from "@/lib/sampleHistoryRules";
export function sampleFailure(e: any) {
  const message = String(e?.message || "Request failed.");
  const setupMissing =
    /sample_request_(history|topics|members)/.test(message) &&
    /schema cache|does not exist/i.test(message);
  return NextResponse.json(
    {
      ok: false,
      error: setupMissing
        ? "자료 이력의 초기 설정이 필요합니다. 관리자에게 문의해 주세요."
        : message,
    },
    { status: e?.status ?? 500, headers: { "Cache-Control": "no-store" } },
  );
}
export function sampleOk(data: any) {
  return NextResponse.json(
    { ok: true, ...data },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function verifyHistoryFiles(
  requestId: string,
  userId: string,
  incoming: any[],
) {
  if (incoming.length > 5)
    throw new SampleAccessError("Up to five files are allowed.");
  const seen = new Set<string>();
  const verified = [];
  for (const file of incoming) {
    const check = validateHistoryFile(file);
    const path = String(file.path ?? "");
    const expectedPrefix = `${requestId}/${userId}/`;
    if (
      !path.startsWith(expectedPrefix) ||
      !/^[0-9a-f-]{36}\.[a-z0-9]+$/.test(path.slice(expectedPrefix.length)) ||
      path.split(".").pop() !== check.extension ||
      seen.has(path)
    )
      throw new SampleAccessError("Invalid uploaded file reference.");
    seen.add(path);
    const slash = path.lastIndexOf("/");
    const { data, error } = await db.storage
      .from(HISTORY_BUCKET)
      .list(path.slice(0, slash), { search: path.slice(slash + 1), limit: 10 });
    if (error) throw new Error(error.message);
    const actual = data?.find((r) => r.name === path.slice(slash + 1));
    if (!actual || Number(actual.metadata?.size) !== check.size)
      throw new SampleAccessError(
        "File upload is incomplete. Upload it again before registering.",
      );
    verified.push({
      path,
      name: check.name,
      size: check.size,
      type: String(actual.metadata?.mimetype || "application/octet-stream"),
    });
  }
  return verified;
}
export async function historyEntry(
  requestId: string,
  entryId: string,
  role: string,
) {
  const { data, error } = await db
    .from("sample_request_history")
    .select("*")
    .eq("request_id", requestId)
    .eq("id", entryId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new SampleAccessError("History entry not found.", 404);
  if (data.visibility === "MANAGEMENT" && !isSampleManager(role))
    throw new SampleAccessError("History entry not found.", 404);
  return data;
}
