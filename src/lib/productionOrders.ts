export type ProductionOrderStatus = "DRAFT" | "CONFIRMED" | "CANCELLED";

export type ProductionOrderVendor = {
  id: string;
  company_name: string | null;
  code?: string | null;
  default_currency?: string | null;
};

export type ProductionOrderLineInput = {
  id?: string;
  process_type: string;
  description: string;
  qty: number;
  unit: string;
  unit_price: number;
  remarks: string;
};

export type ProductionOrderHeaderInput = {
  order_no?: string;
  order_date: string;
  vendor_id?: string | null;
  vendor_name: string;
  supplier_contact: string;
  delivery_date: string;
  buyer_po_ref: string;
  work_sheet_ref: string;
  payment_terms: string;
  delivery_address: string;
  currency: string;
  material_supplied_by_jm: boolean;
  special_instructions: string;
  notes: string;
  prepared_by: string;
  approved_by: string;
  supplier_confirmation: string;
  status: ProductionOrderStatus;
};

export type ProductionOrderLineRow = ProductionOrderLineInput & {
  id: string;
  header_id: string;
  line_no: number;
  amount: number;
};

export type ProductionOrderHeaderRow = ProductionOrderHeaderInput & {
  id: string;
  subtotal_amount: number;
  created_at?: string | null;
  updated_at?: string | null;
};

export type ProductionOrderDetail = {
  header: ProductionOrderHeaderRow;
  lines: ProductionOrderLineRow[];
};

export const PRODUCTION_ORDER_PROCESS_OPTIONS = [
  { value: "MATERIAL_PURCHASE", label: "材料采购 / Material Purchase" },
  { value: "PLATING", label: "电镀 / Plating" },
  { value: "EPOXY", label: "点胶 / Epoxy" },
  { value: "POLISH", label: "抛光 / Polish" },
  { value: "BONDING", label: "粘合 / Bonding" },
  { value: "SOLDERING", label: "焊接 / Soldering" },
  { value: "HANGING", label: "挂镀 / Hanging" },
  { value: "ASSEMBLY", label: "组装 / Assembly" },
  { value: "PACKING", label: "包装 / Packing" },
  { value: "OTHER", label: "其他 / Other" },
] as const;

export function processTypeLabel(value?: string | null) {
  const key = String(value ?? "").trim().toUpperCase();
  return (
    PRODUCTION_ORDER_PROCESS_OPTIONS.find((item) => item.value === key)?.label ||
    key ||
    "-"
  );
}

export function createEmptyProductionOrderLine(): ProductionOrderLineInput {
  return {
    process_type: "MATERIAL_PURCHASE",
    description: "",
    qty: 0,
    unit: "PCS",
    unit_price: 0,
    remarks: "",
  };
}

export function calculateLineAmount(line: Pick<ProductionOrderLineInput, "qty" | "unit_price">) {
  const qty = Number(line.qty || 0);
  const unitPrice = Number(line.unit_price || 0);
  const amount = qty * unitPrice;
  return Number.isFinite(amount) ? amount : 0;
}

export function calculateOrderSubtotal(lines: Array<Pick<ProductionOrderLineInput, "qty" | "unit_price">>) {
  return lines.reduce((sum, line) => sum + calculateLineAmount(line), 0);
}

export function fmtCny(value: number | null | undefined) {
  const n = Number(value || 0);
  return `CNY ${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

