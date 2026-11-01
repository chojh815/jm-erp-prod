import ExcelJS from "exceljs";
import { quoteActor, quoteFailure, readQuote } from "@/lib/generalQuoteServer";
import { commercialQuote } from "@/lib/generalQuoteRules";
export const dynamic = "force-dynamic";
export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    await quoteActor();
    const s = await readQuote(
        params.id,
        new URL(req.url).searchParams.get("version_id") || undefined,
      ),
      d = commercialQuote(
        s.document,
        s.quotation.quotation_no,
        s.version.version_no,
        s.version.status,
      ),
      w = new ExcelJS.Workbook(),
      sheet = w.addWorksheet("Quotation");
    sheet.columns = [
      { width: 20 },
      { width: 32 },
      { width: 15 },
      { width: 12 },
      { width: 20 },
      { width: 22 },
    ];
    sheet.mergeCells("A1:F1");
    sheet.getCell("A1").value = "QUOTATION";
    sheet.getCell("A1").font = { bold: true, size: 18 };
    sheet.addRow([
      "Quotation",
      d.quotation_no,
      "Version",
      d.version_no,
      "Status",
      d.status,
    ]);
    sheet.addRow([
      "Buyer",
      d.buyer_name,
      "Date",
      d.quotation_date,
      "Valid Until",
      d.valid_until,
    ]);
    sheet.addRow(["Subject", d.subject, "Brand", d.brand, "Terms", d.incoterm]);
    sheet.addRow(["Currency", d.currency]);
    sheet.addRow([]);
    const hr = sheet.addRow([
      "Style",
      "Description",
      "Qty",
      "Unit",
      "Offer / Unit",
      "Amount",
    ]);
    hr.font = { bold: true, color: { argb: "FFFFFFFF" } };
    hr.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF203B5C" },
    };
    for (const l of d.lines) {
      const row = sheet.addRow([
        l.style_no,
        l.description,
        l.qty,
        l.unit,
        l.offer_price,
        l.amount,
      ]);
      row.getCell(5).numFmt = "0.###############";
      row.getCell(6).numFmt = "0.00";
      if (l.remarks) sheet.addRow(["", l.remarks]);
      for (const t of l.tiers) {
        const r = sheet.addRow([
          "MOQ " + t.qty,
          t.ship_from,
          t.qty,
          l.unit,
          t.offer_price,
          t.remarks,
        ]);
        r.getCell(5).numFmt = "0.###############";
      }
    }
    sheet
      .addRow([
        "Total (" + d.currency + ")",
        "",
        "",
        "",
        "",
        d.lines.reduce((n, l) => n + l.amount, 0),
      ])
      .getCell(6).numFmt = "0.00";
    sheet.addRow(["Remarks", d.remarks]);
    sheet.pageSetup = {
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    };
    const bytes = await w.xlsx.writeBuffer();
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition":
          'attachment; filename="' +
          String(d.quotation_no).replace(/[^A-Za-z0-9_-]/g, "_") +
          "_v" +
          d.version_no +
          '.xlsx"',
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return quoteFailure(e);
  }
}
