import { NextResponse } from "next/server";
import { supabaseAdmin as db } from "@/lib/supabaseAdmin";
import {
  sampleActor,
  sampleRequestAccess,
  SampleAccessError,
} from "@/lib/sampleRequestAccess";
import { HISTORY_BUCKET } from "@/lib/sampleHistoryRules";
import { historyEntry, sampleFailure } from "@/lib/sampleHistoryServer";
export const dynamic = "force-dynamic";
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; entryId: string }> },
) {
  try {
    const { id, entryId } = await ctx.params;
    const actor = await sampleActor();
    await sampleRequestAccess(id, actor);
    const entry = await historyEntry(id, entryId, actor.role);
    const url = new URL(req.url);
    const index = Number(url.searchParams.get("index") ?? 0);
    if (!Number.isSafeInteger(index) || index < 0 || !entry.files?.[index])
      throw new SampleAccessError("File not found.", 404);
    const file = entry.files[index];
    if (!String(file.path).startsWith(id + "/"))
      throw new SampleAccessError("Invalid file reference.");
    const { data, error } = await db.storage
      .from(HISTORY_BUCKET)
      .createSignedUrl(
        file.path,
        300,
        url.searchParams.get("download") === "1" ? { download: file.name } : {},
      );
    if (error || !data?.signedUrl)
      throw new Error(error?.message || "File is unavailable.");
    const response = NextResponse.redirect(data.signedUrl);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch (e) {
    return sampleFailure(e);
  }
}
