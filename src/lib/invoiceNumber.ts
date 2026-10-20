import { supabaseAdmin } from "@/lib/supabaseAdmin";

export function invoiceToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function invoiceDatePrefix(buyerCode: string, invoiceDate: unknown): string {
  const date = String(invoiceDate ?? "").slice(0, 10);
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error("A valid invoice date is required to generate the invoice number.");
  }
  return `JMI-${buyerCode.trim().toUpperCase()}-${date.slice(2).replace(/-/g, "")}`;
}

export async function generateInvoiceNumber(buyerCode: string, invoiceDate: unknown) {
  const prefix = invoiceDatePrefix(buyerCode, invoiceDate);
  // Include deleted invoices so issued numbers are never reused.
  const { data, error } = await supabaseAdmin.from("invoice_headers")
    .select("invoice_no").like("invoice_no", `${prefix}%`).limit(10000);
  if (error) throw error;
  let max = 0;
  for (const row of data || []) {
    const value = String(row.invoice_no || "");
    if (value === prefix) max = Math.max(max, 1);
    else if (value.startsWith(`${prefix}-`)) {
      const suffix = value.slice(prefix.length + 1);
      if (/^\d{2,}$/.test(suffix)) max = Math.max(max, Number(suffix));
    }
  }
  return max === 0 ? prefix : `${prefix}-${String(max + 1).padStart(2, "0")}`;
}
