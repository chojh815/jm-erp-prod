import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";

export interface PackingPdfHeader {
  invoiceNo: string;
  invoiceDate: string;
  buyerName: string;
  destination: string;
  totalCartons: number;
  totalGw: number;
  totalNw: number;
}

export interface PackingPdfLine {
  lineNo: number;
  poNo?: string;
  styleNo?: string;
  description?: string;
  color?: string;
  size?: string;
  cartons: number;
  gw: number;
  nw: number;
}

const styles = StyleSheet.create({
  page: {
    padding: 24,
    fontSize: 9,
  },
  title: {
    fontSize: 14,
    textAlign: "center",
    marginBottom: 12,
  },
  section: {
    marginBottom: 8,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  fieldLabel: {
    fontSize: 8,
  },
  fieldValue: {
    fontSize: 9,
    fontWeight: "bold",
  },
  table: {
    marginTop: 8,
    borderWidth: 0.5,
    borderColor: "#000",
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#eee",
    borderBottomWidth: 0.5,
    borderColor: "#000",
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderColor: "#ddd",
  },
  cell: {
    padding: 2,
    borderRightWidth: 0.5,
    borderColor: "#ddd",
  },
  footer: {
    marginTop: 12,
  },
});

export interface PackingListPDFProps {
  header: PackingPdfHeader;
  lines: PackingPdfLine[];
}

const PackingListPDF: React.FC<PackingListPDFProps> = ({ header, lines }) => {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>PACKING LIST</Text>

        <View style={styles.section}>
          <View style={styles.row}>
            <View style={{ width: "50%" }}>
              <Text style={styles.fieldLabel}>Exporter</Text>
              <Text style={styles.fieldValue}>JM INTERNATIONAL</Text>
            </View>
            <View style={{ width: "45%" }}>
              <Text style={styles.fieldLabel}>Invoice No / Date</Text>
              <Text style={styles.fieldValue}>
                {header.invoiceNo} / {header.invoiceDate}
              </Text>
              <Text style={styles.fieldLabel}>Buyer</Text>
              <Text style={styles.fieldValue}>{header.buyerName}</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.fieldLabel}>Destination</Text>
          <Text style={styles.fieldValue}>{header.destination}</Text>
        </View>

        {/* Table */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.cell, { width: "6%" }]}>No</Text>
            <Text style={[styles.cell, { width: "12%" }]}>PO No</Text>
            <Text style={[styles.cell, { width: "14%" }]}>Style</Text>
            <Text style={[styles.cell, { width: "28%" }]}>Description</Text>
            <Text style={[styles.cell, { width: "10%" }]}>Color</Text>
            <Text style={[styles.cell, { width: "8%" }]}>Size</Text>
            <Text style={[styles.cell, { width: "10%", textAlign: "right" }]}>
              Cartons
            </Text>
            <Text style={[styles.cell, { width: "12%", textAlign: "right" }]}>
              G.W.
            </Text>
            <Text style={[styles.cell, { width: "10%", textAlign: "right" }]}>
              N.W.
            </Text>
          </View>
          {lines.map((l, idx) => (
            <View key={idx} style={styles.tableRow}>
              <Text style={[styles.cell, { width: "6%" }]}>{l.lineNo}</Text>
              <Text style={[styles.cell, { width: "12%" }]}>{l.poNo}</Text>
              <Text style={[styles.cell, { width: "14%" }]}>{l.styleNo}</Text>
              <Text style={[styles.cell, { width: "28%" }]}>
                {l.description}
              </Text>
              <Text style={[styles.cell, { width: "10%" }]}>{l.color}</Text>
              <Text style={[styles.cell, { width: "8%" }]}>{l.size}</Text>
              <Text
                style={[
                  styles.cell,
                  { width: "10%", textAlign: "right" },
                ]}
              >
                {l.cartons}
              </Text>
              <Text
                style={[
                  styles.cell,
                  { width: "12%", textAlign: "right" },
                ]}
              >
                {l.gw}
              </Text>
              <Text
                style={[
                  styles.cell,
                  { width: "10%", textAlign: "right" },
                ]}
              >
                {l.nw}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.footer}>
          <Text>
            Total Cartons: {header.totalCartons}   Total G.W.: {header.totalGw}   Total
            N.W.: {header.totalNw}
          </Text>
        </View>
      </Page>
    </Document>
  );
};

export default PackingListPDF;
