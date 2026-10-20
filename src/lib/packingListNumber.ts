export function packingListNumberFromInvoice(invoiceNo: string): string {
  const value = invoiceNo.trim();
  if (!value) throw new Error("Invoice number is required for packing list numbering.");
  return /^JMI-/i.test(value) ? value.replace(/^JMI-/i, "JMPL-") : `JMPL-${value}`;
}
