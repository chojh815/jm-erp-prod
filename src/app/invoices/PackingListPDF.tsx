// src/app/invoices/PackingListPDF.tsx
"use client";

import React from "react";
import {
  Page,
  Text,
  View,
  Document,
  StyleSheet,
  Font,
} from "@react-pdf/renderer";

// 기본 폰트 등록 (다른 곳에서 이미 했다면 중복 호출되어도 문제 없음)
Font.register({
  family: "Helvetica",
  fonts: [{ src: "/fonts/Helvetica.ttf" }],
});

const styles = StyleSheet.create({
  page: {
    padding: 25,
    fontSize: 10,
    fontFamily: "Helvetica",
  },
  section: {
    marginBottom: 10,
  },
  title: {
    fontSize: 18,
    textAlign: "center",
    marginBottom: 10,
    fontWeight: "bold",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  label: {
    fontWeight: "bold",
  },
  table: {
    display: "table",
    width: "auto",
    borderStyle: "solid",
    borderWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
  },
  tableRow: {
    flexDirection: "row",
  },
  tableColHeader: {
    borderStyle: "solid",
    borderWidth: 1,
    backgroundColor: "#efefef",
    padding: 3,
  },
  tableCol: {
    borderStyle: "solid",
    borderWidth: 1,
    padding: 3,
  },
  // 컬럼별 width (Packing List에 맞게 조정)
  colCarton: { width: "10%" },
  colStyle: { width: "14%" },
  colDesc: { width: "24%" },
  colColor: { width: "10%" },
  colSize: { width: "8%" },
  colQty: { width: "10%" },
  colGW: { width: "12%" },
  colNW: { width: "12%" },
  tableHeaderText: {
    fontWeight: "bold",
    fontSize: 9,
  },
  tableCellText: {
    fontSize: 9,
  },
  footer: {
    marginTop: 20,
    textAlign: "center",
    fontSize: 9,
  },
});

// 숫자 포맷 (소수 2자리 또는 3자리 + 천단위 콤마)
const formatNumber = (num: any, digits = 2) => {
  if (num === null || num === undefined) return "";
  const n = Number(num);
  if (Number.isNaN(n)) return "";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
};

type PackingHeader = {
  invoice_no?: string | null;
  buyer_name?: string | null;
  ship_to?: string | null;
  shipping_origin_code?: string | null;
  destination?: string | null;
  etd?: string | null;
  eta?: string | null;
  total_cartons?: number | null;
  total_gw?: number | null;
  total_nw?: number | null;
};

type PackingLine = {
  po_no?: string | null;
  style_no?: string | null;
  description?: string | null;
  color?: string | null;
  size?: string | null;
  qty?: number | null;
  cartons?: number | null;
  gw?: number | null;
  nw?: number | null;
};

type PackingShipment = {
  shipment_id?: string | null;
  invoice_id?: string | null;
  created_at?: string | null;
};

interface PackingListPDFProps {
  header: PackingHeader;
  lines: PackingLine[];
  shipments: PackingShipment[];
}

/**
 * 현재 버전은 invoice_lines 의 cartons / gw / nw 를 사용해서
 * 스타일별 포장정보를 보여주는 Packing List.
 * (향후 박스번호 컬럼 생기면 box_no 기준으로 그룹핑 확장 가능)
 */
const PackingListPDF: React.FC<PackingListPDFProps> = ({
  header,
  lines,
  shipments,
}) => {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* ===== TITLE ===== */}
        <Text style={styles.title}>PACKING LIST</Text>

        {/* ===== HEADER ===== */}
        <View style={styles.section}>
          <View style={styles.headerRow}>
            <Text>
              <Text style={styles.label}>Invoice No: </Text>
              {header?.invoice_no}
            </Text>
            <Text>
              <Text style={styles.label}>Buyer: </Text>
              {header?.buyer_name}
            </Text>
          </View>

          <View style={styles.headerRow}>
            <Text>
              <Text style={styles.label}>Ship To: </Text>
              {header?.ship_to}
            </Text>
          </View>

          <View style={styles.headerRow}>
            <Text>
              <Text style={styles.label}>Origin: </Text>
              {header?.shipping_origin_code}
            </Text>
            <Text>
              <Text style={styles.label}>Destination: </Text>
              {header?.destination}
            </Text>
          </View>

          <View style={styles.headerRow}>
            <Text>
              <Text style={styles.label}>ETD: </Text>
              {header?.etd}
            </Text>
            <Text>
              <Text style={styles.label}>ETA: </Text>
              {header?.eta}
            </Text>
          </View>

          <View style={styles.headerRow}>
            <Text>
              <Text style={styles.label}>Total Cartons: </Text>
              {formatNumber(header?.total_cartons)}
            </Text>
            <Text>
              <Text style={styles.label}>Total GW: </Text>
              {formatNumber(header?.total_gw, 3)}
            </Text>
            <Text>
              <Text style={styles.label}>Total NW: </Text>
              {formatNumber(header?.total_nw, 3)}
            </Text>
          </View>
        </View>

        {/* ===== TABLE (라인 기준 Packing 정보) ===== */}
        <View style={[styles.section, styles.table]}>
          {/* 테이블 헤더 */}
          <View style={styles.tableRow}>
            <View style={[styles.tableColHeader, styles.colCarton]}>
              <Text style={styles.tableHeaderText}>Cartons</Text>
            </View>
            <View style={[styles.tableColHeader, styles.colStyle]}>
              <Text style={styles.tableHeaderText}>Style No</Text>
            </View>
            <View style={[styles.tableColHeader, styles.colDesc]}>
              <Text style={styles.tableHeaderText}>Description</Text>
            </View>
            <View style={[styles.tableColHeader, styles.colColor]}>
              <Text style={styles.tableHeaderText}>Color</Text>
            </View>
            <View style={[styles.tableColHeader, styles.colSize]}>
              <Text style={styles.tableHeaderText}>Size</Text>
            </View>
            <View style={[styles.tableColHeader, styles.colQty]}>
              <Text style={styles.tableHeaderText}>Qty</Text>
            </View>
            <View style={[styles.tableColHeader, styles.colGW]}>
              <Text style={styles.tableHeaderText}>GW (KGS)</Text>
            </View>
            <View style={[styles.tableColHeader, styles.colNW]}>
              <Text style={styles.tableHeaderText}>NW (KGS)</Text>
            </View>
          </View>

          {/* 라인들 */}
          {lines?.map((line, idx) => (
            <View style={styles.tableRow} key={idx}>
              <View style={[styles.tableCol, styles.colCarton]}>
                <Text style={styles.tableCellText}>
                  {formatNumber(line.cartons)}
                </Text>
              </View>
              <View style={[styles.tableCol, styles.colStyle]}>
                <Text style={styles.tableCellText}>{line.style_no}</Text>
              </View>
              <View style={[styles.tableCol, styles.colDesc]}>
                <Text style={styles.tableCellText}>{line.description}</Text>
              </View>
              <View style={[styles.tableCol, styles.colColor]}>
                <Text style={styles.tableCellText}>{line.color}</Text>
              </View>
              <View style={[styles.tableCol, styles.colSize]}>
                <Text style={styles.tableCellText}>{line.size}</Text>
              </View>
              <View style={[styles.tableCol, styles.colQty]}>
                <Text style={styles.tableCellText}>
                  {formatNumber(line.qty)}
                </Text>
              </View>
              <View style={[styles.tableCol, styles.colGW]}>
                <Text style={styles.tableCellText}>
                  {formatNumber(line.gw, 3)}
                </Text>
              </View>
              <View style={[styles.tableCol, styles.colNW]}>
                <Text style={styles.tableCellText}>
                  {formatNumber(line.nw, 3)}
                </Text>
              </View>
            </View>
          ))}
        </View>

        {/* ===== SHIPMENT 정보 (간단 요약) ===== */}
        <View style={styles.section}>
          <Text style={[styles.label, { marginBottom: 5 }]}>
            SHIPMENT INFO
          </Text>

          {(!shipments || shipments.length === 0) && (
            <Text>No shipment records</Text>
          )}

          {shipments?.map((s, i) => (
            <View key={i} style={{ marginBottom: 4 }}>
              <Text>
                <Text style={styles.label}>Shipment ID: </Text>
                {s.shipment_id}
              </Text>
              <Text>
                <Text style={styles.label}>Invoice ID: </Text>
                {s.invoice_id}
              </Text>
              <Text>
                <Text style={styles.label}>Created At: </Text>
                {s.created_at?.substring(0, 10)}
              </Text>
            </View>
          ))}
        </View>

        {/* ===== FOOTER ===== */}
        <Text style={styles.footer}>
          JM INTERNATIONAL CO., LTD{"\n"}
          Excellence in Every Detail
        </Text>
      </Page>
    </Document>
  );
};

export default PackingListPDF;
