import { randomUUID } from "crypto";
import { supabaseAdmin as db } from "@/lib/supabaseAdmin";
import {
  sampleActor,
  sampleRequestAccess,
  SampleAccessError,
} from "@/lib/sampleRequestAccess";
import { HISTORY_BUCKET, validateHistoryFile } from "@/lib/sampleHistoryRules";
import { sampleOk, sampleFailure } from "@/lib/sampleHistoryServer";
export const dynamic = "force-dynamic";
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const actor = await sampleActor();
    await sampleRequestAccess(id, actor, true);
    const body = await req.json();
    if (
      !Array.isArray(body.files) ||
      !body.files.length ||
      body.files.length > 5
    )
      throw new SampleAccessError("Select one to five files.");
    const files = body.files.map(validateHistoryFile);
    const uploads = [];
    for (const file of files) {
      const path = `${id}/${actor.user.id}/${randomUUID()}.${file.extension}`;
      const { data, error } = await db.storage
        .from(HISTORY_BUCKET)
        .createSignedUploadUrl(path, { upsert: false });
      if (error || !data)
        throw new Error(error?.message || "Could not prepare upload.");
      uploads.push({
        path,
        token: data.token,
        name: file.name,
        size: file.size,
      });
    }
    return sampleOk({ uploads, bucket: HISTORY_BUCKET });
  } catch (e) {
    return sampleFailure(e);
  }
}
