import * as XLSX from "xlsx";
import { supabaseAdmin as db } from "@/lib/supabaseAdmin";
import {
  sampleActor,
  sampleRequestAccess,
  SampleAccessError,
} from "@/lib/sampleRequestAccess";
import { HISTORY_BUCKET } from "@/lib/sampleHistoryRules";
import {
  historyEntry,
  sampleFailure,
  sampleOk,
} from "@/lib/sampleHistoryServer";
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
    const params = new URL(req.url).searchParams;
    const index = Number(params.get("index") ?? 0);
    if (!Number.isSafeInteger(index) || index < 0 || !entry.files?.[index])
      throw new SampleAccessError("File not found.", 404);
    const file = entry.files[index];
    if (
      !String(file.path).startsWith(id + "/") ||
      !/\.(xlsx|xls|csv)$/i.test(file.name)
    )
      throw new SampleAccessError(
        "Table preview supports Excel and CSV files.",
      );
    const { data, error } = await db.storage
      .from(HISTORY_BUCKET)
      .download(file.path);
    if (error || !data)
      throw new Error(error?.message || "File is unavailable.");
    const workbook = XLSX.read(Buffer.from(await data.arrayBuffer()), {
      type: "buffer",
      sheetRows: 101,
      cellHTML: false,
      cellStyles: false,
      bookVBA: false,
    });
    const sheet = params.get("sheet") || workbook.SheetNames[0];
    if (!workbook.SheetNames.includes(sheet))
      throw new SampleAccessError("Worksheet not found.");
    const rows = XLSX.utils
      .sheet_to_json<any[]>(workbook.Sheets[sheet], {
        header: 1,
        raw: false,
        defval: "",
        blankrows: false,
      })
      .slice(0, 100)
      .map((row) =>
        row.slice(0, 20).map((value) => String(value).slice(0, 1000)),
      );
    return sampleOk({
      name: file.name,
      sheets: workbook.SheetNames,
      sheet,
      rows,
      limited: true,
    });
  } catch (e) {
    return sampleFailure(e);
  }
}
