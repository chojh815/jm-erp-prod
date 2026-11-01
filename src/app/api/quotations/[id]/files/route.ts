import { UUID } from "@/lib/generalQuoteRules";

import {
  quoteActor,
  quoteJson,
  quoteFailure,
  readQuote,
  writeQuote,
  db,
  QuoteError,
} from "@/lib/generalQuoteServer";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
const bucket = "quotation-version-files";
const extensions = new Set([
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "xlsx",
  "xls",
  "csv",
  "doc",
  "docx",
  "txt",
]);
function fileInput(f: any) {
  const name = String(f?.name || "").trim(),
    size = Number(f?.size),
    ext = name.toLowerCase().split(".").pop() || "";
  if (
    !name ||
    name.length > 240 ||
    /[\x00-\x1f]/.test(name) ||
    !extensions.has(ext) ||
    !Number.isSafeInteger(size) ||
    size < 1 ||
    size > 10485760
  )
    throw new QuoteError("파일은 허용 형식, 파일당 10MB 이하여야 합니다.");
  return { name, size, ext };
}
export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    await quoteActor();
    const p = new URL(req.url).searchParams,
      s = await readQuote(params.id, p.get("version_id") || undefined),
      f = s.files.find((x: any) => x.id === p.get("file_id"));
    if (
      !f ||
      !["quotation-version-files", "quotation-attachments"].includes(
        f.bucket_name,
      )
    )
      throw new QuoteError("첨부가 없습니다.", 404);
    const r = await db.storage
      .from(f.bucket_name)
      .createSignedUrl(
        f.file_path,
        300,
        p.get("download") === "1" ? { download: f.file_name } : undefined,
      );
    if (r.error) throw r.error;
    return NextResponse.redirect(r.data.signedUrl, {
      headers: {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (e) {
    return quoteFailure(e);
  }
}
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const actor = await quoteActor("edit"),
      b = await req.json();
    if (!UUID.test(String(b.version_id || "")))
      throw new QuoteError("올바른 버전이 필요합니다.");
    const s = await readQuote(params.id, b.version_id);
    if (
      s.version.status !== "DRAFT" ||
      s.quotation.archived_at ||
      !s.document ||
      s.revision === 0
    )
      throw new QuoteError("수정 가능한 버전을 먼저 저장해 주세요.", 409);
    if (!s.document.lines.some((l) => l.id === b.line_id))
      throw new QuoteError("이 버전의 행이 아닙니다.", 400);
    if (!Number.isSafeInteger(b.revision) || b.revision !== s.revision)
      throw new QuoteError("다시 불러온 후 첨부해 주세요.", 409);
    if (b.action === "sign") {
      const f = fileInput(b.file),
        path =
          params.id +
          "/" +
          b.version_id +
          "/" +
          actor.user.id +
          "/" +
          randomUUID() +
          "." +
          f.ext;
      const r = await db.storage
        .from(bucket)
        .createSignedUploadUrl(path, { upsert: false });
      if (r.error) throw r.error;
      return quoteJson({ bucket, path, token: r.data.token });
    }
    if (b.action === "remove")
      return quoteJson(
        await writeQuote(
          "file_remove",
          actor,
          params.id,
          b.version_id,
          b.revision,
          null,
          "",
          { id: b.file_id, line_id: b.line_id },
        ),
      );
    if (b.action !== "finalize")
      throw new QuoteError("유효하지 않은 첨부 요청입니다.");
    const f = fileInput(b.file),
      prefix = params.id + "/" + b.version_id + "/" + actor.user.id + "/",
      path = String(b.file.path || "");
    if (
      !path.startsWith(prefix) ||
      !/^[0-9a-f-]{36}\.[a-z0-9]+$/.test(path.slice(prefix.length)) ||
      !path.endsWith("." + f.ext)
    )
      throw new QuoteError("올바른 업로드 파일이 아닙니다.");
    const slash = path.lastIndexOf("/"),
      list = await db.storage
        .from(bucket)
        .list(path.slice(0, slash), {
          search: path.slice(slash + 1),
          limit: 10,
        });
    if (list.error) throw list.error;
    const actual = list.data?.find((x) => x.name === path.slice(slash + 1));
    if (!actual || Number(actual.metadata?.size) !== f.size)
      throw new QuoteError("파일 업로드를 완료한 후 다시 등록해 주세요.");
    return quoteJson(
      await writeQuote(
        "file_add",
        actor,
        params.id,
        b.version_id,
        b.revision,
        null,
        "",
        {
          line_id: b.line_id,
          name: f.name,
          size: f.size,
          path,
          type: String(actual.metadata?.mimetype || "application/octet-stream"),
          email: actor.user.email || "",
        },
      ),
    );
  } catch (e) {
    return quoteFailure(e);
  }
}
