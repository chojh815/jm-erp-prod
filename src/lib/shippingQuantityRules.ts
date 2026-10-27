export class QuantityConflict extends Error {
  readonly status = 409;
}
export function quantity(value: unknown): number {
  const n = Number(value);
  if (
    value == null ||
    value === "" ||
    typeof value === "boolean" ||
    !Number.isSafeInteger(n) ||
    n < 0
  )
    throw new QuantityConflict("Quantity must be a non-negative integer.");
  return n;
}
export function cancellableQuantity(ordered: unknown, allocated: unknown) {
  return Math.max(0, quantity(ordered) - quantity(allocated));
}
const text = (v: any) => String(v ?? "").trim();
const styleKey = (po: any, style: any) =>
  JSON.stringify([text(po), text(style)]);
// Carton splits preserve the total for each PO/style. Old documents may use JM style aliases.
export function assertDocumentQuantities(
  source: any[],
  document: any[],
  label: string,
) {
  const aliases = new Map<string, string>();
  const shipmentIds = new Map<string, string>();
  const poLineIds = new Map<string, string>();
  const expected = new Map<string, number>();
  for (const row of source.filter((r) => !r.is_deleted)) {
    const po = row.po_lines ?? {};
    const poNo = po.po_headers?.po_no ?? row.po_no;
    const style =
      po.buyer_style_no ||
      po.buyer_style_code ||
      po.jm_style_no ||
      po.jm_style_code ||
      row.buyer_style_no ||
      row.style_no;
    const key = styleKey(poNo, style);
    expected.set(
      key,
      (expected.get(key) ?? 0) + quantity(row.shipped_qty ?? row.qty),
    );
    shipmentIds.set(text(row.id), key);
    if (row.po_line_id) poLineIds.set(text(row.po_line_id), key);
    for (const alias of [
      style,
      row.style_no,
      row.buyer_style_no,
      po.buyer_style_no,
      po.buyer_style_code,
      po.jm_style_no,
      po.jm_style_code,
    ]) {
      if (text(alias)) aliases.set(styleKey(poNo, alias), key);
    }
  }
  if (!expected.size)
    throw new QuantityConflict("Shipment has no active lines.");
  const actual = new Map<string, number>();
  for (const row of document.filter((r) => !r.is_deleted)) {
    const key = row.shipment_line_id
      ? shipmentIds.get(text(row.shipment_line_id))
      : row.po_line_id
        ? poLineIds.get(text(row.po_line_id))
        : aliases.get(styleKey(row.po_no, row.buyer_style_no || row.style_no));
    if (!key)
      throw new QuantityConflict(
        `${label}: line does not belong to the linked Shipment.`,
      );
    if (
      row.po_no &&
      (row.buyer_style_no || row.style_no) &&
      aliases.get(styleKey(row.po_no, row.buyer_style_no || row.style_no)) !==
        key
    )
      throw new QuantityConflict(
        `${label}: PO/style does not match the Shipment source line.`,
      );
    actual.set(
      key,
      (actual.get(key) ?? 0) + quantity(row.qty ?? row.shipped_qty),
    );
  }
  for (const [key, qty] of expected) {
    if ((actual.get(key) ?? 0) !== qty)
      throw new QuantityConflict(
        `${label}: quantity must match Shipment for PO/style ${key} (Shipment ${qty}, document ${actual.get(key) ?? 0}).`,
      );
  }
}
