import {
  db,
  rpcError,
  RedError as QuoteError,
  redActor as quoteActor,
} from "@/lib/redQuoteServer";
function checkDb(r: any) {
  rpcError(r.error);
  return r.data;
}
import { UUID } from "@/lib/generalQuoteRules";
export async function pendingPurgeCleanups(actorId: string) {
  const r = await db
    .from("red_quotation_file_cleanup_jobs")
    .select("quote_id")
    .eq("created_by", actorId)
    .in("state", ["pending", "processing"])
    .limit(1000);
  if (r.error && ["42P01", "PGRST205"].includes(r.error.code)) return [];
  const rows = checkDb(r) || [];
  const counts = new Map<string, number>();
  for (const row of rows)
    counts.set(row.quote_id, (counts.get(row.quote_id) || 0) + 1);
  if (!counts.size) return [];
  const names =
    checkDb(
      await db
        .from("red_quotation_number_reservations")
        .select("quote_id,quotation_no")
        .in("quote_id", [...counts.keys()]),
    ) || [];
  return [...counts.entries()].map(([id, pending]) => ({
    id,
    pending,
    quotation_no:
      names.find((n: any) => n.quote_id === id)?.quotation_no || "삭제된 견적",
  }));
}
export async function purgePreview(id: string) {
  if (!UUID.test(id)) throw new QuoteError("견적 ID를 확인해 주세요.");
  return checkDb(await db.rpc("red_purge_preview", { p_quote: id }));
}
export async function cleanPurgedQuoteFiles(id: string, actorId: string) {
  const claim = checkDb(
    await db.rpc("red_purge_cleanup_claim", {
      p_quote: id,
      p_actor: actorId,
      p_limit: 10,
    }),
  );
  let removed = 0,
    failed = 0;
  for (const job of claim.jobs || []) {
    let error: string | null = null;
    try {
      if (
        !["red-quotation-images"].includes(job.bucket) ||
        !job.path ||
        /(^|\/)\.\.(\/|$)/.test(job.path)
      )
        throw new Error("첨부 저장 경로 확인이 필요합니다.");
      const r = await db.storage.from(job.bucket).remove([job.path]);
      if (r.error) throw new Error("첨부파일 정리를 완료하지 못했습니다.");
      removed++;
    } catch {
      error = "첨부파일 정리를 완료하지 못했습니다. 다시 시도해 주세요.";
      failed++;
    }
    try {
      checkDb(
        await db.rpc("red_purge_cleanup_finish", {
          p_job: job.id,
          p_actor: actorId,
          p_error: error,
        }),
      );
    } catch {
      if (!error) {
        removed--;
        failed++;
      }
    }
  }
  return {
    removed,
    pending: Math.max(0, Number(claim.pending || 0) - removed),
    retained: Number(claim.retained || 0),
    failed,
  };
}
export async function purgeTestQuote(id: string, body: any) {
  const actor = await quoteActor("delete");
  if (
    !UUID.test(id) ||
    body?.confirmed !== true ||
    typeof body.confirmation_no !== "string" ||
    !body.confirmation_no.trim() ||
    body.confirmation_no.length > 200 ||
    typeof body.confirmation_token !== "string" ||
    !/^[0-9a-f]{32}$/.test(body.confirmation_token)
  )
    throw new QuoteError(
      "경고 내용을 확인하고 견적번호를 정확히 입력해 주세요.",
    );
  const result = checkDb(
    await db.rpc("red_purge_commit", {
      p_quote: id,
      p_confirmation_no: body.confirmation_no.trim(),
      p_token: body.confirmation_token,
      p_actor: actor.user.id,
    }),
  );
  // Return committed deletion before any Storage work. The UI starts cleanup in
  // a separate request so its failure cannot hide successful business deletion.
  return {
    ...result,
    cleanup: {
      removed: 0,
      pending: Number(
        result.cleanup_pending ??
          result.counts?.quotation_line_attachments ??
          0,
      ),
      retained: 0,
      failed: 0,
    },
  };
}
