import { supabaseAdmin as db } from "@/lib/supabaseAdmin";
import {
  assertDocumentQuantities,
  quantity,
  QuantityConflict,
} from "@/lib/shippingQuantityRules";
const alive = (q: any) => q.or("is_deleted.is.null,is_deleted.eq.false");
const inactive = (r: any) =>
  r.is_deleted ||
  ["CANCELLED", "CANCELED", "DELETED", "VOID"].includes(
    String(r.status ?? "").toUpperCase(),
  );
async function rows(q: any): Promise<any[]> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}
// Drafts reserve stock; cancelled or deleted shipment headers do not consume it.
export async function allocatedByPoLine(ids: string[]) {
  const totals = new Map<string, number>();
  if (!ids.length) return totals;
  const lines = await rows(
    alive(db.from("shipment_lines").select("*").in("po_line_id", ids)),
  );
  const shipmentIds = [
    ...new Set(lines.map((r) => r.shipment_id).filter(Boolean)),
  ];
  if (!shipmentIds.length) return totals;
  const headers = await rows(
    db.from("shipments").select("*").in("id", shipmentIds),
  );
  const activeIds = new Set(
    headers.filter((r) => !inactive(r)).map((r) => r.id),
  );
  for (const row of lines) {
    if (activeIds.has(row.shipment_id))
      totals.set(
        row.po_line_id,
        (totals.get(row.po_line_id) ?? 0) +
          quantity(row.shipped_qty ?? row.qty),
      );
  }
  return totals;
}
export async function assertShipmentCapacity(
  lines: any[],
  allowedPoIds?: string[],
) {
  const ids = [
    ...new Set(lines.map((r) => String(r.po_line_id ?? r.poLineId ?? ""))),
  ];
  if (!lines.length || ids.some((id) => !id))
    throw new QuantityConflict("Shipment requires valid PO lines.");
  const poLines = await rows(
    alive(db.from("po_lines").select("*").in("id", ids)),
  );
  const byId = new Map(poLines.map((r) => [r.id, r]));
  const allocated = await allocatedByPoLine(ids);
  const requested = new Map<string, number>();
  for (const row of lines) {
    const id = String(row.po_line_id ?? row.poLineId);
    const po = byId.get(id);
    if (
      !po ||
      (allowedPoIds?.length && !allowedPoIds.includes(po.po_header_id))
    )
      throw new QuantityConflict(
        "Shipment line does not belong to the selected PO.",
      );
    const qty = quantity(row.shipped_qty ?? row.shippedQty ?? row.qty);
    if (!qty)
      throw new QuantityConflict(
        "Shipment quantity must be greater than zero.",
      );
    requested.set(id, (requested.get(id) ?? 0) + qty);
  }
  for (const [id, qty] of requested) {
    const po = byId.get(id)!;
    const remaining = Math.max(
      0,
      quantity(po.qty ?? po.order_qty) -
        quantity(po.qty_cancelled ?? 0) -
        (allocated.get(id) ?? 0),
    );
    if (qty > remaining)
      throw new QuantityConflict(
        `Shipment quantity exceeds remaining quantity (${remaining}) for PO line ${id}.`,
      );
  }
}
export async function assertShipmentEditable(id: string) {
  const headers = await rows(db.from("shipments").select("*").eq("id", id));
  if (!headers[0] || inactive(headers[0]))
    throw new QuantityConflict("Shipment is cancelled or deleted.");
  const links = await rows(
    db.from("invoice_shipments").select("*").eq("shipment_id", id),
  );
  const invoiceIds = links
    .filter((r) => !r.is_deleted)
    .map((r) => r.invoice_id)
    .filter(Boolean);
  const direct = await rows(
    alive(db.from("invoice_headers").select("*").eq("shipment_id", id)),
  );
  const linked = invoiceIds.length
    ? await rows(
        alive(db.from("invoice_headers").select("*").in("id", invoiceIds)),
      )
    : [];
  const packing = await rows(
    alive(db.from("packing_list_headers").select("*").eq("shipment_id", id)),
  );
  if ([...direct, ...linked, ...packing].some((r) => !inactive(r)))
    throw new QuantityConflict(
      "Shipment quantities are locked by a linked Invoice or Packing List.",
    );
}
async function shipmentSource(ids: string[]) {
  if (!ids.length)
    throw new QuantityConflict(
      "Document must be linked to a Shipment before saving quantities.",
    );
  const headers = await rows(db.from("shipments").select("*").in("id", ids));
  if (headers.length !== ids.length || headers.some(inactive))
    throw new QuantityConflict(
      "Linked Shipment is missing, cancelled or deleted.",
    );
  return rows(
    alive(
      db
        .from("shipment_lines")
        .select("*, po_lines(*, po_headers(po_no))")
        .in("shipment_id", ids),
    ),
  );
}
export async function invoiceShipmentIds(header: any) {
  const links = await rows(
    db.from("invoice_shipments").select("*").eq("invoice_id", header.id),
  );
  return [
    ...new Set(
      [
        header.shipment_id,
        ...links.filter((r) => !r.is_deleted).map((r) => r.shipment_id),
      ].filter(Boolean),
    ),
  ] as string[];
}
export async function invoiceLines(id: string) {
  return rows(
    db
      .from("invoice_lines")
      .select("*")
      .or(`invoice_id.eq.${id},invoice_header_id.eq.${id}`),
  );
}
export async function validateInvoiceSave(header: any, incoming?: any[]) {
  const saved = await invoiceLines(header.id);
  const merged = new Map(saved.map((r) => [r.id, r]));
  const seen = new Set<string>();
  for (const row of incoming ?? []) {
    if (!row?.id || !merged.has(row.id) || seen.has(row.id))
      throw new QuantityConflict(
        "Invoice lines must use unique existing line IDs.",
      );
    seen.add(row.id);
    const original = merged.get(row.id)!;
    for (const key of [
      "invoice_id",
      "invoice_header_id",
      "shipment_id",
      "shipment_line_id",
      "po_line_id",
    ]) {
      if (row[key] != null && row[key] !== original[key])
        throw new QuantityConflict("Invoice source links cannot be changed.");
    }
    merged.set(row.id, { ...original, ...row });
  }
  assertDocumentQuantities(
    await shipmentSource(await invoiceShipmentIds(header)),
    [...merged.values()],
    "Invoice",
  );
  return merged;
}
export async function validatePackingSave(header: any, lines: any[]) {
  const source = await shipmentSource([header.shipment_id].filter(Boolean));
  // PL persists PO/style columns, so validate the exact same identity fields.
  assertDocumentQuantities(
    source,
    lines.map((r) => ({
      ...r,
      shipment_line_id: undefined,
      po_line_id: undefined,
    })),
    "Packing List",
  );
  if (header.invoice_id) {
    const invoices = await rows(
      alive(db.from("invoice_headers").select("*").eq("id", header.invoice_id)),
    );
    if (!invoices[0] || inactive(invoices[0]))
      throw new QuantityConflict("Linked Invoice is missing or inactive.");
    if (!(await invoiceShipmentIds(invoices[0])).includes(header.shipment_id))
      throw new QuantityConflict(
        "Packing List and Invoice reference different Shipments.",
      );
    await validateInvoiceSave(invoices[0]);
  }
}

export async function validateShipmentSource(id: string) {
  const source = await shipmentSource([id]);
  for (const row of source) {
    if (quantity(row.shipped_qty ?? row.qty) <= 0)
      throw new QuantityConflict(
        "Shipment lines must have positive quantities before issuing documents.",
      );
  }
  if (!source.length)
    throw new QuantityConflict("Shipment has no active lines.");
}
