// src/components/pdf/ReceiptPDF.tsx
import React from "react";
import { Document, Page, Text, View, StyleSheet, Font } from "@react-pdf/renderer";

// Optional font register (safe fallback)
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require("path");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("fs");
  const fontPath = path.join(process.cwd(), "public", "fonts", "NotoSans-Regular.ttf");
  if (fs.existsSync(fontPath)) {
    Font.register({ family: "NotoSans", src: fontPath });
  }
} catch {}

export type ReceiptPdfInvoiceRow = {
  invoice_id?: string | null;
  invoice_no?: string | null;
  invoice_date?: string | null; // YYYY-MM-DD
  invoice_total?: number | null;
  applied_amount: number;
};

export type ReceiptPdfData = {
  receipt_id: string;
  receipt_no?: string | null;
  deposit_date?: string | null; // YYYY-MM-DD
  currency: string; // USD
  buyer_name?: string | null;
  buyer_code?: string | null;

  method?: string | null;
  reference_no?: string | null;
  note?: string | null;

  total_received_amount: number;
  bank_fee_our_amount: number;
  bank_fee_buyer_amount: number;
  claim_deduction_amount: number;
  net_received_amount: number;

  bank_account_name?: string | null;
  bank_account_number?: string | null;
  bank_swift?: string | null;

  company_name?: string | null;
  company_address?: string | null;

  invoices: ReceiptPdfInvoiceRow[];
};

const styles = StyleSheet.create({
  page: { padding: 28, fontSize: 10, fontFamily: "NotoSans" as any },
  title: { fontSize: 16, textAlign: "center", marginBottom: 12, fontWeight: 700 as any },
  row: { flexDirection: "row" },
  col: { flex: 1 },
  box: { borderWidth: 1, borderColor: "#D1D5DB", padding: 10, borderRadius: 6 },
  label: { color: "#6B7280", marginBottom: 2 },
  value: { fontSize: 11 },
  mt8: { marginTop: 8 },
  mt12: { marginTop: 12 },
  mt16: { marginTop: 16 },
  table: { borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 6, overflow: "hidden" },
  thead: { backgroundColor: "#F3F4F6", flexDirection: "row" },
  th: { padding: 8, fontSize: 10, fontWeight: 700 as any },
  tr: { flexDirection: "row", borderTopWidth: 1, borderTopColor: "#E5E7EB" },
  td: { padding: 8, fontSize: 10 },
  right: { textAlign: "right" as any },
  small: { fontSize: 9, color: "#6B7280" },
});

function fmtMoney(n: number, currency: string) {
  const x = Number.isFinite(n) ? n : 0;
  return `${currency} ${x.toFixed(2)}`;
}
function fmtDate(s?: string | null) {
  if (!s) return "";
  return String(s).slice(0, 10);
}

export default function ReceiptPDF({ data }: { data: ReceiptPdfData }) {
  const appliedSum = (data.invoices || []).reduce((sum, r) => sum + (Number(r.applied_amount) || 0), 0);

  return (
    <Document title={data.receipt_no ? `Receipt ${data.receipt_no}` : "Receipt"}>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>RECEIPT</Text>

        <View style={[styles.row, { gap: 10 } as any]}>
          <View style={[styles.col, styles.box]}>
            <Text style={styles.label}>Receipt No</Text>
            <Text style={styles.value}>{data.receipt_no || data.receipt_id}</Text>

            <View style={styles.mt8}>
              <Text style={styles.label}>Deposit Date</Text>
              <Text style={styles.value}>{fmtDate(data.deposit_date)}</Text>
            </View>

            <View style={styles.mt8}>
              <Text style={styles.label}>Buyer</Text>
              <Text style={styles.value}>
                {data.buyer_name || "-"}{data.buyer_code ? ` (${data.buyer_code})` : ""}
              </Text>
            </View>

            <View style={styles.mt8}>
              <Text style={styles.label}>Currency</Text>
              <Text style={styles.value}>{data.currency}</Text>
            </View>
          </View>

          <View style={[styles.col, styles.box]}>
            <Text style={styles.label}>Method</Text>
            <Text style={styles.value}>{data.method || "WIRE"}</Text>

            <View style={styles.mt8}>
              <Text style={styles.label}>Reference No</Text>
              <Text style={styles.value}>{data.reference_no || "-"}</Text>
            </View>

            <View style={styles.mt8}>
              <Text style={styles.label}>Bank Account</Text>
              <Text style={styles.value}>
                {data.bank_account_name || "-"}
                {data.bank_account_number ? ` / ${data.bank_account_number}` : ""}
              </Text>
              {data.bank_swift ? <Text style={styles.small}>SWIFT: {data.bank_swift}</Text> : null}
            </View>
          </View>
        </View>

        <View style={[styles.row, styles.mt12, { gap: 10 } as any]}>
          <View style={[styles.col, styles.box]}>
            <Text style={styles.label}>Total Received</Text>
            <Text style={[styles.value, styles.right]}>{fmtMoney(data.total_received_amount, data.currency)}</Text>

            <View style={styles.mt8}>
              <Text style={styles.label}>Bank Fee (Our Bank)</Text>
              <Text style={[styles.value, styles.right]}>{fmtMoney(data.bank_fee_our_amount, data.currency)}</Text>
            </View>

            <View style={styles.mt8}>
              <Text style={styles.label}>Bank Fee (Buyer Bank)</Text>
              <Text style={[styles.value, styles.right]}>{fmtMoney(data.bank_fee_buyer_amount, data.currency)}</Text>
            </View>

            <View style={styles.mt8}>
              <Text style={styles.label}>Claim Deduction</Text>
              <Text style={[styles.value, styles.right]}>{fmtMoney(data.claim_deduction_amount, data.currency)}</Text>
            </View>

            <View style={[styles.mt8, { borderTopWidth: 1, borderTopColor: "#E5E7EB", paddingTop: 8 } as any]}>
              <Text style={styles.label}>Net Received</Text>
              <Text style={[{ fontSize: 12, fontWeight: 700 as any } as any, styles.right]}>
                {fmtMoney(data.net_received_amount, data.currency)}
              </Text>
            </View>
          </View>

          <View style={[styles.col, styles.box]}>
            <Text style={styles.label}>Applied Total</Text>
            <Text style={[styles.value, styles.right]}>{fmtMoney(appliedSum, data.currency)}</Text>

            <View style={styles.mt8}>
              <Text style={styles.label}>Unapplied (Net - Applied)</Text>
              <Text style={[styles.value, styles.right]}>
                {fmtMoney((data.net_received_amount || 0) - appliedSum, data.currency)}
              </Text>
            </View>

            <View style={styles.mt8}>
              <Text style={styles.label}>Note</Text>
              <Text style={styles.value}>{data.note || "-"}</Text>
            </View>

            {(data.company_name || data.company_address) ? (
              <View style={styles.mt12}>
                <Text style={styles.label}>Company</Text>
                <Text style={styles.value}>{data.company_name || ""}</Text>
                {data.company_address ? <Text style={styles.small}>{data.company_address}</Text> : null}
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.mt16}>
          <Text style={[{ fontSize: 12, fontWeight: 700 as any } as any]}>Applied Invoices</Text>
          <View style={[styles.table, styles.mt8]}>
            <View style={styles.thead}>
              <Text style={[styles.th, { width: "35%" } as any]}>Invoice No</Text>
              <Text style={[styles.th, { width: "20%" } as any]}>Date</Text>
              <Text style={[styles.th, { width: "20%" } as any, styles.right]}>Total</Text>
              <Text style={[styles.th, { width: "25%" } as any, styles.right]}>Applied</Text>
            </View>

            {(data.invoices || []).length === 0 ? (
              <View style={styles.tr}>
                <Text style={[styles.td, { width: "100%" } as any]}>No applications.</Text>
              </View>
            ) : (
              data.invoices.map((r, idx) => (
                <View key={idx} style={styles.tr}>
                  <Text style={[styles.td, { width: "35%" } as any]}>{r.invoice_no || r.invoice_id || "-"}</Text>
                  <Text style={[styles.td, { width: "20%" } as any]}>{fmtDate(r.invoice_date)}</Text>
                  <Text style={[styles.td, { width: "20%" } as any, styles.right]}>
                    {fmtMoney(Number(r.invoice_total || 0), data.currency)}
                  </Text>
                  <Text style={[styles.td, { width: "25%" } as any, styles.right]}>
                    {fmtMoney(Number(r.applied_amount || 0), data.currency)}
                  </Text>
                </View>
              ))
            )}
          </View>

          <Text style={[styles.small, styles.mt8]}>
            Internal use. Currency is fixed to USD.
          </Text>
        </View>
      </Page>
    </Document>
  );
}
