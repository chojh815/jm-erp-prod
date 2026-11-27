import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isActiveShippingRecord } from "@/lib/dashboardShipping";

type Row = {
  id: string;
  status?: string | null;
  is_deleted?: boolean | null;
  po_no?: string | null;
  shipment_id?: string | null;
  invoice_id?: string | null;
  invoice_no?: string | null;
  shipment_no?: string | null;
  packing_list_no?: string | null;
  packing_list_id?: string | null;
  invoice_header_id?: string | null;
  buyer_name?: string | null;
};

export type TraceDocument = {
  id: string;
  number: string | null;
  status: string | null;
  linkedBy: string;
};

const selectActive = (table: string, columns: string) =>
  supabaseAdmin.from(table).select(columns).or("is_deleted.is.null,is_deleted.eq.false");

async function rows(query: PromiseLike<{ data: unknown; error: unknown }>): Promise<Row[]> {
  const { data, error } = await query;
  if (error) throw error;
  return (data as Row[] | null) ?? [];
}

async function byIds(table: string, columns: string, column: string, ids: string[]) {
  const found: Row[] = [];
  for (let start = 0; start < ids.length; start += 100) {
    found.push(...await rows(selectActive(table, columns).in(column, ids.slice(start, start + 100))));
  }
  return found;
}

function values(items: Row[], key: keyof Row) {
  return [...new Set(items.map(item => item[key]).filter((value): value is string => typeof value === "string" && value !== ""))];
}

function activeUnique(records: Row[]) {
  return [...new Map(records.filter(isActiveShippingRecord).map(record => [record.id, record])).values()];
}

function documents(records: Row[], numberField: "shipment_no" | "invoice_no" | "packing_list_no", directIds: string[], otherLink: string): TraceDocument[] {
  const direct = new Set(directIds);
  return records.map(record => ({
    id: record.id,
    number: record[numberField] ?? null,
    status: record.status ?? null,
    linkedBy: direct.has(record.id) ? "PO" : otherLink,
  })).sort((a, b) => (a.number ?? "").localeCompare(b.number ?? ""));
}

export async function tracePO(poNo: string, access: { shipment: boolean; invoice: boolean; packing: boolean }) {
  const matches = await rows(selectActive("po_headers", "id,po_no,buyer_name,status").ilike("po_no", poNo));
  if (matches.length !== 1) return { po: null, ambiguous: matches.length > 1 };
  const { po_no, buyer_name, status } = matches[0];
  const po = { number: po_no ?? poNo, buyer: buyer_name ?? null, status: status ?? null };
  const empty = Promise.resolve<Row[]>([]);
  const shipmentColumns = "id,shipment_no,status,is_deleted";
  const invoiceColumns = "id,invoice_no,shipment_id,status,is_deleted";
  const packingColumns = "id,packing_list_no,shipment_id,invoice_id,status,is_deleted";

  const [shipmentHeaders, shipmentPOs, shipmentLines, invoiceLines, packingLines] = await Promise.all([
    access.shipment || access.invoice || access.packing ? rows(selectActive("shipments", shipmentColumns).eq("po_no", po.number)) : empty,
    access.shipment || access.invoice || access.packing ? rows(supabaseAdmin.from("shipment_pos").select("shipment_id").eq("po_no", po.number)) : empty,
    access.shipment || access.invoice || access.packing ? rows(selectActive("shipment_lines", "shipment_id").eq("po_no", po.number)) : empty,
    access.invoice || access.packing ? rows(selectActive("invoice_lines", "invoice_header_id").eq("po_no", po.number)) : empty,
    access.packing ? rows(selectActive("packing_list_lines", "packing_list_id").eq("po_no", po.number)) : empty,
  ]);
  const relatedShipmentIds = values([...shipmentPOs, ...shipmentLines], "shipment_id");
  const shipments = activeUnique([
    ...shipmentHeaders,
    ...await byIds("shipments", shipmentColumns, "id", relatedShipmentIds),
  ]);
  const shipmentIds = values(shipments, "id");
  const directInvoiceIds = values(invoiceLines, "invoice_header_id");
  const [invoicesByPO, invoicesByShipment, invoiceLinks, packingByPO, packingByShipment] = await Promise.all([
    byIds("invoice_headers", invoiceColumns, "id", directInvoiceIds),
    access.invoice || access.packing ? byIds("invoice_headers", invoiceColumns, "shipment_id", shipmentIds) : empty,
    access.invoice || access.packing ? byIds("invoice_shipments", "invoice_id,shipment_id", "shipment_id", shipmentIds) : empty,
    byIds("packing_list_headers", packingColumns, "id", values(packingLines, "packing_list_id")),
    access.packing ? byIds("packing_list_headers", packingColumns, "shipment_id", shipmentIds) : empty,
  ]);
  const invoices = activeUnique([
    ...invoicesByPO, ...invoicesByShipment,
    ...await byIds("invoice_headers", invoiceColumns, "id", values(invoiceLinks, "invoice_id")),
  ]);
  const packingByInvoice = access.packing ? await byIds("packing_list_headers", packingColumns, "invoice_id", values(invoices, "id")) : [];

  return {
    po,
    shipments: access.shipment ? documents(shipments, "shipment_no", shipmentIds, "PO") : null,
    invoices: access.invoice ? documents(invoices, "invoice_no", directInvoiceIds, "Shipment") : null,
    packingLists: access.packing ? documents(activeUnique([...packingByPO, ...packingByShipment, ...packingByInvoice]),
      "packing_list_no", values(packingLines, "packing_list_id"), "Shipment / Invoice") : null,
  };
}
