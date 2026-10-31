import ExcelJS from "exceljs";
import { redActor, readRedDocument, redFailure } from "@/lib/redQuoteServer";
import { commercialRedData } from "@/lib/redQuoteExport";
export const dynamic = "force-dynamic";
export async function GET(
  req: Request,
  { params }: { params: { versionId: string } },
) {
  try {
    await redActor();
    const s = await readRedDocument(params.versionId),
      code = (
        new URL(req.url).searchParams.get("package") || "A"
      ).toUpperCase(),
      data = commercialRedData(s.document, s.version, code);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "JM ERP";
    const sheet = workbook.addWorksheet("Quotation");
    sheet.columns = [
      { width: 18 },
      { width: 20 },
      { width: 22 },
      { width: 24 },
    ];
    sheet.mergeCells("A1:D1");
    sheet.getCell("A1").value = "JM ERP — QUOTATION";
    sheet.getCell("A1").font = { bold: true, size: 18 };
    sheet.getRow(1).height = 30;
    const meta = [
      [
        "Quotation",
        data.quotationNo,
        "Version",
        "v" + data.versionNo + " (" + data.status + ")",
      ],
      ["Buyer", data.buyer, "Date", data.date],
      ["Title", data.title, "Style", data.style],
      ["Ship From", data.shipFrom, "Terms", data.incoterm],
      ["Package", data.packageCode, "Currency / Unit", "USD / pkg"],
    ];
    meta.forEach((r) => sheet.addRow(r));
    sheet.addRow([]);
    const header = sheet.addRow([
      "Package",
      "PCS / PKG",
      "MOQ (PKG)",
      "Offer (USD / PKG)",
    ]);
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF203B5C" },
    };
    for (const r of data.rows) {
      const row = sheet.addRow([code, r.pcs, r.moq, r.offerUsd]);
      row.getCell(3).numFmt = "#,##0";
      row.getCell(4).numFmt = "0.00";
    }
    sheet.views = [{ state: "frozen", ySplit: 8 }];
    sheet.pageSetup = {
      paperSize: 9,
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    };
    const buffer = await workbook.xlsx.writeBuffer();
    const name =
      (data.quotationNo || "RED_Quotation").replace(/[^A-Za-z0-9_-]/g, "_") +
      "_v" +
      data.versionNo +
      "_" +
      code +
      ".xlsx";
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="' + name + '"',
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return redFailure(e);
  }
}
