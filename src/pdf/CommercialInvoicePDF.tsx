// src/pdf/CommercialInvoicePDF.tsx
import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";

export interface InvoiceHeaderPDF {
  invoice_no: string | null;
  buyer_name: string | null;
  bill_to: string | null;
  ship_to: string | null;
  currency: string | null;
  incoterm: string | null;
  payment_term: string | null;
  shipping_origin_code: string | null;
  destination: string | null;
  etd: string | null;
  eta: string | null;
  status: string | null;
  total_amount: number | null;
  total_cartons: number | null;
  total_gw: number | null;
  total_nw: number | null;
}

export interface InvoiceLinePDF {
  line_no: number | null;
  style_no: string | null;
  description: string | null;
  color: string | null;
  size: string | null;
  qty: number | null;
  unit_price: number | null;
  amount: number | null;
  cartons: number | null;
  gw: number | null;
  nw: number | null;
  po_no: string | null;
}

interface Props {
  header: InvoiceHeaderPDF;
  lines: InvoiceLinePDF[];
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 24,
    paddingHorizontal: 24,
    fontSize: 9,
    fontFamily: "Helvetica",
  },
  title: {
    fontSize: 14,
    textAlign: "center",
    marginBottom: 12,
    fontWeight: "bold",
  },
  sectionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  col: {
    flex: 1,
  },
  label: {
    fontSize: 8,
    marginBottom: 2,
  },
  value: {
    fontSize: 9,
    marginBottom: 2,
  },
  table: {
    marginTop: 10,
    borderWidth: 0.7,
    borderColor: "#000",
  },
  tableHeaderRow: {
    flexDirection: "row",
    borderBottomWidth: 0.7,
    borderColor: "#000",
    backgroundColor: "#eee",
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderColor: "#ccc",
  },
  cell: {
    paddingVertical: 3,
    paddingHorizontal: 2,
    fontSize: 8,
  },
  footerRow: {
    flexDirection: "row",
    marginTop: 8,
    justifyContent: "flex-end",
  },
});

const CommercialInvoicePDF: React.FC<Props> = ({ header, lines }) => {
  const safe = (v: any) => (v === null || v === undefined ? "" : String(v));

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>COMMERCIAL INVOICE</Text>

        {/* Header */}
        <View style={styles.sectionRow}>
          <View style={styles.col}>
            <Text style={styles.label}>Invoice No</Text>
            <Text style={styles.value}>{safe(header.invoice_no)}</Text>

            <Text style={styles.label}>Buyer</Text>
            <Text style={styles.value}>{safe(header.buyer_name)}</Text>

            <Text style={styles.label}>Bill To</Text>
            <Text style={styles.value}>{safe(header.bill_to)}</Text>

            <Text style={styles.label}>Ship To</Text>
            <Text style={styles.value}>{safe(header.ship_to)}</Text>
          </View>

          <View style={styles.col}>
            <Text style={styles.label}>Currency</Text>
            <Text style={styles.value}>{safe(header.currency)}</Text>

            <Text style={styles.label}>Incoterm</Text>
            <Text style={styles.value}>{safe(header.incoterm)}</Text>

            <Text style={styles.label}>Payment Term</Text>
            <Text style={styles.value}>{safe(header.payment_term)}</Text>

            <Text style={styles.label}>Origin</Text>
            <Text style={styles.value}>{safe(header.shipping_origin_code)}</Text>

            <Text style={styles.label}>Destination</Text>
            <Text style={styles.value}>{safe(header.destination)}</Text>
          </View>

          <View style={styles.col}>
            <Text style={styles.label}>ETD</Text>
            <Text style={styles.value}>{safe(header.etd)}</Text>

            <Text style={styles.label}>ETA</Text>
            <Text style={styles.value}>{safe(header.eta)}</Text>

            <Text style={styles.label}>Status</Text>
            <Text style={styles.value}>{safe(header.status)}</Text>
          </View>
        </View>

        {/* Lines Table */}
        <View style={styles.table}>
          <View style={styles.tableHeaderRow}>
            <Text style={[styles.cell, { width: 22 }]}>Line</Text>
            <Text style={[styles.cell, { width: 60 }]}>PO No</Text>
            <Text style={[styles.cell, { width: 70 }]}>Style No</Text>
            <Text style={[styles.cell, { width: 120 }]}>Description</Text>
            <Text style={[styles.cell, { width: 40 }]}>Color</Text>
            <Text style={[styles.cell, { width: 30 }]}>Size</Text>
            <Text style={[styles.cell, { width: 50, textAlign: "right" }]}>
              Qty
            </Text>
            <Text style={[styles.cell, { width: 50, textAlign: "right" }]}>
              Unit Price
            </Text>
            <Text style={[styles.cell, { width: 60, textAlign: "right" }]}>
              Amount
            </Text>
          </View>

          {lines.map((line, idx) => (
            <View
  key={`${line.po_no ?? ""}-${line.style_no ?? ""}-${line.line_no ?? idx}-${idx}`}
  style={styles.tableRow}
>
              <Text style={[styles.cell, { width: 22 }]}>{safe(line.line_no)}</Text>
              <Text style={[styles.cell, { width: 60 }]}>{safe(line.po_no)}</Text>
              <Text style={[styles.cell, { width: 70 }]}>{safe(line.style_no)}</Text>
              <Text style={[styles.cell, { width: 120 }]}>
                {safe(line.description)}
              </Text>
              <Text style={[styles.cell, { width: 40 }]}>{safe(line.color)}</Text>
              <Text style={[styles.cell, { width: 30 }]}>{safe(line.size)}</Text>
              <Text
                style={[
                  styles.cell,
                  { width: 50, textAlign: "right" },
                ]}
              >
                {safe(line.qty)}
              </Text>
              <Text
                style={[
                  styles.cell,
                  { width: 50, textAlign: "right" },
                ]}
              >
                {safe(line.unit_price)}
              </Text>
              <Text
                style={[
                  styles.cell,
                  { width: 60, textAlign: "right" },
                ]}
              >
                {safe(line.amount)}
              </Text>
            </View>
          ))}
        </View>

        {/* Footer (Totals) */}
        <View style={styles.footerRow}>
          <View>
            <Text>
              Total Cartons: {safe(header.total_cartons)}   Total G.W.:{" "}
              {safe(header.total_gw)}   Total N.W.: {safe(header.total_nw)}
            </Text>
            <Text>
              Total Amount ({safe(header.currency)}): {safe(header.total_amount)}
            </Text>
          </View>
        </View>
      </Page>
    </Document>
  );
};

export default CommercialInvoicePDF;
