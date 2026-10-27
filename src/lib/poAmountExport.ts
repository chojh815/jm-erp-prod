import {
  emptyPoAmounts,
  poAmountsByCurrency,
  type PoAmounts,
} from "@/lib/poAmounts";
export const poAmountExportColumns = [
  "PO No",
  "Buyer",
  "Brand",
  "Buyer Style No",
  "Order Date",
  "Req. Ship Date",
  "Ship Mode",
  "Cur.",
  "Order Qty",
  "Unit Price",
  "Order Amount",
  "Shipped Amount",
  "Cancelled Amount",
  "Pending Amount",
  "Status",
];
export type PoAmountExportRow = {
  kind: "line" | "po_total" | "currency_total";
  values: (string | number)[];
};
const moneyCells = (a: PoAmounts) => [
  a.order,
  a.shipped,
  a.cancelled,
  a.pending,
];
export function buildPoAmountExportRows(
  headers: any[],
  linesByHeader: Record<string, any[]>,
): PoAmountExportRow[] {
  const rows: PoAmountExportRow[] = [];
  for (const header of headers) {
    const lines = (linesByHeader[header.id] ?? []).filter(
      (line) => !header.lineIds || header.lineIds.includes(line.id),
    );
    if (lines.length) {
      for (const line of lines)
        rows.push({
          kind: "line",
          values: [
            header.poNo,
            header.buyerName ?? "-",
            header.mainBuyerBrand ?? "-",
            line.buyerStyleNo || line.jmStyleNo || "-",
            header.orderDate ?? "-",
            header.reqShipDate ?? "-",
            header.shipMode ?? "-",
            header.currency ?? "-",
            line.qty ?? 0,
            line.price ?? line.unitPrice ?? 0,
            ...moneyCells(line.amounts ?? emptyPoAmounts()),
            header.status ?? "-",
          ],
        });
    } else {
      rows.push({
        kind: "line",
        values: [
          header.poNo,
          header.buyerName ?? "-",
          header.mainBuyerBrand ?? "-",
          header.mainBuyerStyleNo ?? "-",
          header.orderDate ?? "-",
          header.reqShipDate ?? "-",
          header.shipMode ?? "-",
          header.currency ?? "-",
          header.totals?.orderQty ?? 0,
          "-",
          ...moneyCells(header.amounts),
          header.status ?? "-",
        ],
      });
    }
    rows.push({
      kind: "po_total",
      values: [
        header.poNo,
        "",
        "",
        "PO Total",
        "",
        "",
        "",
        header.currency ?? "-",
        "",
        "",
        ...moneyCells(header.amounts),
        "",
      ],
    });
  }
  const totals = poAmountsByCurrency(
    headers.filter((h) => h.status !== "CANCELLED"),
  );
  for (const [currency, amounts] of Object.entries(totals))
    rows.push({
      kind: "currency_total",
      values: [
        "",
        "",
        "",
        "Grand Total",
        "",
        "",
        "",
        currency,
        "",
        "",
        ...moneyCells(amounts),
        "",
      ],
    });
  return rows;
}
