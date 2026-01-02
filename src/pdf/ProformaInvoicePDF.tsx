// src/pdf/ProformaInvoicePDF.tsx
import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
} from "@react-pdf/renderer";

// ========= 타입 정의 =========

export interface ProformaHeader {
  invoice_no: string;
  issue_date?: string | null;
  buyer_name?: string | null;
  currency?: string | null;
  incoterm?: string | null;
  payment_terms?: string | null;

  total_amount?: number | null;
  // 서버에서 미리 포맷한 문자열이 있으면 우선 사용
  total_display?: string | null;
}

export interface ProformaLine {
  line_no?: number | null;

  style_no?: string | null;
  buyer_style_no?: string | null;
  jm_style_no?: string | null;

  description?: string | null;
  color?: string | null;
  size?: string | null;
  qty?: number | null;
  unit_price?: number | null;
  amount?: number | null;
}

export interface ProformaInvoicePDFProps {
  header: ProformaHeader;
  lines: ProformaLine[];
  signatureUrl?: string | null;
}

// ========= 숫자 포맷 헬퍼 =========

function formatQty(v?: number | null): string {
  const n = typeof v === "number" ? v : 0;
  return n.toLocaleString("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  });
}

// Unit price: 소수점 4자리, 마지막 두자리가 00이면 2자리만 표기
function formatUnitPrice(v?: number | null): string {
  const n = typeof v === "number" ? v : 0;
  const fixed = n.toFixed(2); // "1.9200"
  const [i, d] = fixed.split(".");
  const intWithComma = i.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  if (d.endsWith("00")) {
    return `${intWithComma}.${d.slice(0, 2)}`;
  }
  return `${intWithComma}.${d}`;
}

function formatAmount(v?: number | null): string {
  const n = typeof v === "number" ? v : 0;
  const fixed = n.toFixed(2); // "1920.00"
  const [i, d] = fixed.split(".");
  const intWithComma = i.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${intWithComma}.${d}`;
}

// ========= 스타일 =========

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingHorizontal: 40,
    paddingBottom: 40,
    fontSize: 10,
    fontFamily: "Helvetica",
  },
  title: {
    fontSize: 20,
    textAlign: "center",
    marginBottom: 24,
    fontWeight: "bold",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  headerBlock: {
    width: "48%",
  },
  headerLabel: {
    fontSize: 10,
    fontWeight: "bold",
    marginBottom: 4,
  },
  headerText: {
    fontSize: 10,
  },
  headerLine: {
    fontSize: 10,
    marginBottom: 2,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: "bold",
    marginTop: 4,
    marginBottom: 4,
  },
  sectionBox: {
    borderWidth: 1,
    borderColor: "#000000",
    padding: 6,
    minHeight: 24,
    justifyContent: "center",
  },
  table: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: "#000000",
  },
  tableHeaderRow: {
    flexDirection: "row",
    backgroundColor: "#eaeaea",
    borderBottomWidth: 1,
    borderColor: "#000000",
  },
  tableHeaderCell: {
    paddingVertical: 4,
    paddingHorizontal: 3,
    fontSize: 9,
    fontWeight: "bold",
    borderRightWidth: 1,
    borderColor: "#000000",
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderColor: "#000000",
  },
  tableCell: {
    paddingVertical: 3,
    paddingHorizontal: 3,
    fontSize: 9,
    borderRightWidth: 1,
    borderColor: "#000000",
  },
  textRight: {
    textAlign: "right",
  },
  textCenter: {
    textAlign: "center",
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 8,
  },
  totalLabel: {
    fontSize: 10,
    fontWeight: "bold",
    marginRight: 6,
  },
  totalValue: {
    fontSize: 10,
    fontWeight: "bold",
  },
  signatureBlock: {
    marginTop: 40,
    alignItems: "flex-end",
  },
  signatureLabel: {
    fontSize: 10,
    marginBottom: 12,
  },
  signatureImage: {
    width: 120,
    height: 40,
    marginBottom: 6,
  },
  signatureLine: {
    fontSize: 9,
    marginBottom: 2,
  },
  // 스탬프 스타일
  stampImage: {
    width: 70,
    height: 70,
    marginBottom: 8,
  },
});

// ========= 메인 컴포넌트 =========

const ProformaInvoicePDF: React.FC<ProformaInvoicePDFProps> = ({
  header,
  lines,
  signatureUrl,
}) => {
  const issueDate = header.issue_date
    ? String(header.issue_date).slice(0, 10)
    : "";

  const currency = header.currency || "USD";
  const totalDisplay =
    header.total_display && header.total_display.trim().length > 0
      ? header.total_display
      : formatAmount(header.total_amount ?? 0);

  // 🔴 스탬프 이미지용 절대 경로 만들기
  // 로컬 개발: http://localhost:3000/images/...
  // 배포 시에는 window.location.origin 기준으로 자동 맞춰짐
  let stampUrl = "/images/jm_stamp_vn.jpg";
  if (typeof window !== "undefined") {
    stampUrl = `${window.location.origin}/images/jm_stamp_vn.jpg`;
  }

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* 타이틀 */}
              <Text style={styles.title}>PROFORMA INVOICE (TEST)</Text>


        {/* 상단: 좌/우 블록 */}
        <View style={styles.headerRow}>
          {/* Shipper / Exporter */}
          <View style={styles.headerBlock}>
            <Text style={styles.headerLabel}>SHIPPER / EXPORTER:</Text>
            <Text style={styles.headerLine}>JM INTERNATIONAL</Text>
            <Text style={styles.headerLine}>KOREA</Text>
          </View>

          {/* Invoice Details */}
          <View style={styles.headerBlock}>
            <Text style={styles.headerLabel}>INVOICE DETAILS:</Text>
            <Text style={styles.headerLine}>
              Invoice No: {header.invoice_no || "-"}
            </Text>
            <Text style={styles.headerLine}>Date: {issueDate || "-"}</Text>
            <Text style={styles.headerLine}>
              Incoterm: {header.incoterm || "-"}
            </Text>
            <Text style={styles.headerLine}>
              Payment: {header.payment_terms || "-"}
            </Text>
          </View>
        </View>

        {/* Consignee */}
        <Text style={styles.sectionLabel}>CONSIGNEE:</Text>
        <View style={styles.sectionBox}>
          <Text style={styles.headerText}>{header.buyer_name || "-"}</Text>
        </View>

        {/* 테이블 헤더 */}
        <View style={styles.table}>
          <View style={styles.tableHeaderRow}>
            <Text style={[styles.tableHeaderCell, { width: "7%" }]}>
              STYLE NO
            </Text>
            <Text style={[styles.tableHeaderCell, { width: "32%" }]}>
              DESCRIPTION
            </Text>
            <Text style={[styles.tableHeaderCell, { width: "11%" }]}>
              COLOR
            </Text>
            <Text style={[styles.tableHeaderCell, { width: "11%" }]}>
              SIZE
            </Text>
            <Text
              style={[
                styles.tableHeaderCell,
                styles.textCenter,
                { width: "11%" },
              ]}
            >
              QTY
            </Text>
            <Text
              style={[
                styles.tableHeaderCell,
                styles.textRight,
                { width: "14%" },
              ]}
            >
              UNIT PRICE
            </Text>
            <Text
              style={[
                styles.tableHeaderCell,
                styles.textRight,
                { width: "14%", borderRightWidth: 0 },
              ]}
            >
              AMOUNT
            </Text>
          </View>

          {/* 테이블 라인들 */}
          {lines.map((line, index) => {
            const styleNo =
              line.style_no ||
              line.buyer_style_no ||
              line.jm_style_no ||
              "";

            return (
              <View key={index} style={styles.tableRow}>
                <Text style={[styles.tableCell, { width: "7%" }]}>
                  {styleNo}
                </Text>
                <Text style={[styles.tableCell, { width: "32%" }]}>
                  {line.description || ""}
                </Text>
                <Text style={[styles.tableCell, { width: "11%" }]}>
                  {line.color || ""}
                </Text>
                <Text style={[styles.tableCell, { width: "11%" }]}>
                  {line.size || ""}
                </Text>
                <Text
                  style={[
                    styles.tableCell,
                    styles.textCenter,
                    { width: "11%" },
                  ]}
                >
                  {formatQty(line.qty)}
                </Text>
                <Text
                  style={[
                    styles.tableCell,
                    styles.textRight,
                    { width: "14%" },
                  ]}
                >
                  {formatUnitPrice(line.unit_price)}
                </Text>
                <Text
                  style={[
                    styles.tableCell,
                    styles.textRight,
                    { width: "14%", borderRightWidth: 0 },
                  ]}
                >
                  {formatAmount(line.amount)}
                </Text>
              </View>
            );
          })}
        </View>

        {/* 총액 */}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>TOTAL:</Text>
          <Text style={styles.totalValue}>
            ${totalDisplay} {currency}
          </Text>
        </View>

        {/* 서명 블록 */}
        <View style={styles.signatureBlock}>
          <Text style={styles.signatureLabel}>Authorized Signature:</Text>

          {/* 🔴 스탬프 이미지 */}
          <Image style={styles.stampImage} src="/images/jm_stamp_vn.jpg" />

          {/* (있다면) 사인 이미지 */}
          {signatureUrl ? (
            <Image style={styles.signatureImage} src={signatureUrl} />
          ) : null}

          <Text style={styles.signatureLine}>
            ____________________________________________
          </Text>
          <Text style={styles.signatureLine}>Name: ______________________</Text>
          <Text style={styles.signatureLine}>Title: _______________________</Text>
          <Text style={styles.signatureLine}>Date: _______________________</Text>
        </View>
      </Page>
    </Document>
  );
};

export default ProformaInvoicePDF;
