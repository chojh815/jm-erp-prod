const inactiveStatuses = new Set(["DELETED", "CANCELLED", "CANCELED", "VOID"]);
const completedStatuses = new Set(["SHIPPED", "CLOSED", "DELIVERED", "INVOICED", "COMPLETED"]);

type DocumentStatus = { status?: string | null; is_deleted?: boolean | null };
type Invoice = DocumentStatus & { id: string; shipment_id?: string | null };
type InvoiceShipment = DocumentStatus & { invoice_id: string; shipment_id: string };

const statusOf = (row: DocumentStatus) => String(row.status ?? "").trim().toUpperCase();

export function isActiveShippingRecord(row: DocumentStatus) {
  return row.is_deleted !== true && !inactiveStatuses.has(statusOf(row));
}

export function isCompletedDashboardShipment(row: DocumentStatus) {
  return isActiveShippingRecord(row) && completedStatuses.has(statusOf(row));
}

export function shipmentIdsByInvoice(invoices: Invoice[], links: InvoiceShipment[]) {
  const shipmentsByInvoice = new Map<string, Set<string>>();
  for (const invoice of invoices.filter(isActiveShippingRecord)) {
    shipmentsByInvoice.set(invoice.id, new Set(invoice.shipment_id ? [invoice.shipment_id] : []));
  }
  for (const link of links.filter(isActiveShippingRecord)) {
    if (link.shipment_id) shipmentsByInvoice.get(link.invoice_id)?.add(link.shipment_id);
  }
  return shipmentsByInvoice;
}

export function belongsOnlyToInactiveOrders(
  orderIds: (string | null)[],
  orders: ReadonlyMap<string, DocumentStatus>,
) {
  return orderIds.length > 0 && orderIds.every((id) => {
    const order = id ? orders.get(id) : undefined;
    return order !== undefined && !isActiveShippingRecord(order);
  });
}
