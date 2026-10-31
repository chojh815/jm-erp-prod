export const HISTORY_BUCKET = "sample-request-history";
export const MAX_HISTORY_FILE_BYTES = 40 * 1024 * 1024;
export const HISTORY_KINDS = [
  "COST",
  "REVISION",
  "BUYER_REQUEST",
  "PROGRESS",
  "OTHER",
] as const;
export const HISTORY_SOURCES = [
  "EMAIL",
  "WECHAT",
  "INTERNAL",
  "OTHER",
] as const;
export class SampleAccessError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const isSampleManager = (role: string) =>
  ["admin", "owner", "manager"].includes(role);
export function canReadSample(
  actor: { user: { id: string; email?: string | null }; role: string },
  row: any,
  memberIds: string[] = [],
) {
  if (!row || row.is_deleted) return false;
  return (
    isSampleManager(actor.role) ||
    row.owner_id === actor.user.id ||
    memberIds.includes(actor.user.id) ||
    (!!actor.user.email &&
      !!row.owner_email &&
      row.owner_email.trim().toLowerCase() ===
        actor.user.email.trim().toLowerCase())
  );
}
export function validateHistoryFile(file: any) {
  const name = String(file?.name ?? "").trim();
  if (!name || name.length > 240 || /[\x00-\x1f]/.test(name))
    throw new SampleAccessError("A valid filename is required.");
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  if (
    ![
      "xlsx",
      "xls",
      "csv",
      "pdf",
      "png",
      "jpg",
      "jpeg",
      "webp",
      "gif",
      "txt",
      "docx",
    ].includes(extension)
  )
    throw new SampleAccessError(
      "Use Excel, CSV, PDF, image, Word or text files.",
    );
  if (
    !Number.isSafeInteger(file.size) ||
    file.size <= 0 ||
    file.size > MAX_HISTORY_FILE_BYTES
  )
    throw new SampleAccessError("Each file must be between 1 byte and 40 MB.");
  return { name, size: file.size as number, extension };
}
export function historyInput(body: any) {
  const title = String(body?.title ?? "").trim();
  const note = String(body?.note ?? "").trim();
  const date = String(body?.received_date ?? "");
  if (!title || title.length > 200)
    throw new SampleAccessError("Enter a title (up to 200 characters).");
  const parsed = new Date(date + "T00:00:00Z");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  )
    throw new SampleAccessError("Enter a valid received date.");
  if (!HISTORY_KINDS.includes(body.entry_kind))
    throw new SampleAccessError("Select a document type.");
  if (!HISTORY_SOURCES.includes(body.source))
    throw new SampleAccessError("Select a source.");
  if (note.length > 10000)
    throw new SampleAccessError("Notes must be under 10,000 characters.");
  const files: any[] = Array.isArray(body.files) ? body.files : [];
  if (files.length > 5 || (!files.length && !note))
    throw new SampleAccessError(
      "Add a file or a progress note (up to five files).",
    );
  return {
    title,
    note,
    received_date: date,
    entry_kind: String(body.entry_kind),
    source: String(body.source),
    sender: String(body.sender ?? "")
      .trim()
      .slice(0, 200),
    topic_id: body.topic_id || null,
    previous_entry_id: body.previous_entry_id || null,
  };
}
