import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

/* =========================
   Types
========================= */
export interface ProformaHeaderPDF {
  buyer_name?: string | null;
  buyer_brand_name?: string | null;
  invoice_no?: string | null;
  issue_date?: string | null;

  po_no?: string | null;
  shipper_name?: string | null;
  shipper_address?: string | null;

  consignee_text?: string | null;
  notify_party_text?: string | null;


  remarks?: string | null;
  port_of_loading?: string | null;
  final_destination?: string | null;

  currency?: string | null;
  incoterm?: string | null;
  ship_mode?: string | null;
  payment_term?: string | null;

  coo_text?: string | null;

  // allow additional fields without breaking builds
  [key: string]: any;
}

export interface ProformaLinePDF {
  po_no?: string | null;
  buyer_style_no?: string | null;
  description?: string | null;
  hs_code?: string | null;
  qty?: number;
  uom?: string | null;
  unit_price?: number;
  amount?: number;
}

/* =========================
   Utils
========================= */
const n = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);

const money = (v: any) =>
  n(v).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const intComma = (v: any) =>
  n(v).toLocaleString("en-US", { maximumFractionDigits: 0 });

const show = (v?: string | null) => (v && v.trim() ? v : "-");

/**
 * ✅ React-PDF는 공백/하이픈이 없는 "긴 토큰"을 줄바꿈 못해서 옆 칸 침범함.
 * 해결: 일정 간격마다 Zero-Width Space(\u200B)를 삽입해 강제로 줄바꿈 포인트를 만든다.
 */
function softWrapToken(v?: string | null, every = 6) {
  const s = (v ?? "").toString();
  if (!s.trim()) return "-";
  // 이미 공백이 있거나 짧으면 그대로
  if (s.length <= every || /\s/.test(s)) return s;

  // 하이픈 등 구분자는 유지하되, 구분자 없는 덩어리(alnum)만 잘라서 ZWSP 삽입
  return s.replace(/[A-Za-z0-9]{12,}/g, (m) => {
    let out = "";
    for (let i = 0; i < m.length; i += every) out += m.slice(i, i + every) + "\u200B";
    return out;
  });
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out.length ? out : [[]];
}

/* =========================
   Constants
========================= */
const BORDER = 1;

// ✅ 표 숫자가 칸을 넘는 문제 방지: 테이블 글꼴을 더 작게
const FONT_BASE = 10;
const FONT_TABLE = 8;        // ↓ 조금 더 축소
const FONT_TABLE_HEAD = 8.5; // ↓ 조금 더 축소

// ✅ 페이지당 라인 수 (헤더 반복 포함)
const ROWS_PER_PAGE = 18;

/* =========================
   Styles
========================= */
const styles = StyleSheet.create({
  page: {
    paddingTop: 22,
    paddingHorizontal: 40,
    paddingBottom: 40,
    fontSize: FONT_BASE,
    fontFamily: "Helvetica",
  },

  /* Title */
  title: {
    fontSize: 18,
    fontWeight: 700 as any,
    textAlign: "center",
    marginBottom: 6,
    letterSpacing: 0.2,
  },

  /* Top Info */
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  topLine: {
    fontSize: 10,
    marginBottom: 2,
  },
  topLabel: {
    fontWeight: 700 as any,
  },

  /* Grid */
  grid: {
    borderWidth: BORDER,
    borderColor: "#000",
    marginBottom: 10,
  },
  gridRow: {
    flexDirection: "row",
    borderBottomWidth: BORDER,
    borderColor: "#000",
  },
  gridCellL: {
    width: "50%",
    borderRightWidth: BORDER,
    borderColor: "#000",
    padding: 9,
  },
  gridCellR: {
    width: "50%",
    padding: 9,
  },
  gridTitle: {
    fontSize: 9.8,
    fontWeight: 700 as any,
    marginBottom: 3,
  },
  gridText: {
    fontSize: 9.6,
    lineHeight: 1.25,
  },

  /* Thin row (Port / Final) */
  gridRowThin: {
    flexDirection: "row",
    borderBottomWidth: BORDER,
    borderColor: "#000",
  },
  gridCellThinL: {
    width: "50%",
    borderRightWidth: BORDER,
    borderColor: "#000",
    paddingVertical: 4,
    paddingHorizontal: 9,
  },
  gridCellThinR: {
    width: "50%",
    paddingVertical: 4,
    paddingHorizontal: 9,
  },
  gridTitleThin: {
    fontSize: 9.8,
    fontWeight: 700 as any,
    marginBottom: 1,
  },
  gridTextThin: {
    fontSize: 9.6,
    lineHeight: 1.05,
  },

  /* Table */
  table: {
    borderWidth: BORDER,
    borderColor: "#999",
  },
  tr: {
    flexDirection: "row",
  },
  th: {
    backgroundColor: "#eef3f7",
    fontSize: FONT_TABLE_HEAD,
    fontWeight: 700 as any,
    paddingVertical: 4,
    paddingHorizontal: 3,
    borderRightWidth: BORDER,
    borderColor: "#999",
    textAlign: "center",
  },
  td: {
    fontSize: FONT_TABLE,
    paddingVertical: 4,
    paddingHorizontal: 3,
    borderRightWidth: BORDER,
    borderColor: "#ddd",
  },
  tdRight: { textAlign: "right" },
  tdCenter: { textAlign: "center" },
  tdLeft: { textAlign: "left" },

  /* Subtotal */
  subtotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
  },
  subtotalLabel: {
    fontSize: 12,
    fontWeight: 700 as any,
  },
  subtotalValue: {
    fontSize: 12,
    fontWeight: 700 as any,
  },

  /* Signed by fixed (absolute) */
  signedBox: {
    position: "absolute",
    right: 40,
    bottom: 40,
    width: 200,
    borderWidth: BORDER,
    borderColor: "#000",
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  signedTitle: {
    fontSize: 10,
    fontWeight: 700 as any,
    marginBottom: 8,
  },
  signedLine: {
    height: 34,
    borderBottomWidth: 1,
    borderColor: "#000",
    marginBottom: 6,
  },
  signedBy: {
    fontSize: 10,
    textAlign: "right",
  },
});

/* =========================
   Blocks
========================= */
function HeaderBlock({ header }: { header: ProformaHeaderPDF }) {
  return (
    <>
      <Text style={styles.title}>Proforma Invoice</Text>

      <View style={styles.topRow}>
        <View>
          <Text style={styles.topLine}>
            <Text style={styles.topLabel}>Buyer: </Text>
            {show(header.buyer_name)}
          </Text>
          <Text style={styles.topLine}>
            <Text style={styles.topLabel}>Brand / Dept: </Text>
            {show(header.buyer_brand_name)}
          </Text>
        </View>
        <View>
          <Text style={styles.topLine}>
            <Text style={styles.topLabel}>Invoice No: </Text>
            {show(header.invoice_no)}
          </Text>
          <Text style={styles.topLine}>
            <Text style={styles.topLabel}>Date: </Text>
            {show(header.issue_date)}
          </Text>
        </View>
      </View>

      <View style={styles.grid}>
        {/* Shipper / Invoice Info */}
        <View style={styles.gridRow}>
          <View style={styles.gridCellL}>
            <Text style={styles.gridTitle}>Shipper / Exporter</Text>
            <Text style={styles.gridText}>{show(header.shipper_name)}</Text>
            <Text style={styles.gridText}>{show(header.shipper_address)}</Text>
          </View>
          <View style={styles.gridCellR}>
            <Text style={styles.gridTitle}>Invoice Info</Text>
            <Text style={styles.gridText}>
              Invoice No: {show(header.invoice_no)}
            </Text>
            <Text style={styles.gridText}>Date: {show(header.issue_date)}</Text>
            <Text style={styles.gridText}>
              Currency: {show(header.currency || "USD")}
            </Text>
            <Text style={styles.gridText}>Incoterm: {show(header.incoterm)}</Text>
            <Text style={styles.gridText}>
              Ship Mode: {show(header.ship_mode)}
            </Text>
            <Text style={styles.gridText}>
              Payment Term: {show(header.payment_term)}
            </Text>
          </View>
        </View>

        {/* Consignee / Notify */}
        <View style={styles.gridRow}>
          <View style={styles.gridCellL}>
            <Text style={styles.gridTitle}>Consignee</Text>
            <Text style={styles.gridText}>{show(header.consignee_text)}</Text>
          </View>
          <View style={styles.gridCellR}>
            <Text style={styles.gridTitle}>Notify Party</Text>
            <Text style={styles.gridText}>{show(header.notify_party_text)}</Text>
          </View>
        </View>

        {/* Port / Final (Thin) */}
        <View style={styles.gridRowThin}>
          <View style={styles.gridCellThinL}>
            <Text style={styles.gridTitleThin}>Port of Loading</Text>
            <Text style={styles.gridTextThin}>
              {show(header.port_of_loading)}
            </Text>
          </View>
          <View style={styles.gridCellThinR}>
            <Text style={styles.gridTitleThin}>Final Destination</Text>
            <Text style={styles.gridTextThin}>
              {show(header.final_destination)}
            </Text>
          </View>
        </View>

        {/* COO */}
        <View style={styles.gridRow}>
          <View style={{ width: "100%", padding: 9 }}>
            <Text style={styles.gridTitle}>COO / Certification</Text>
            <Text style={styles.gridText}>{show(header.coo_text)}</Text>
            <Text style={styles.gridText}>
              WE CERTIFY THERE IS NO WOOD PACKING MATERIAL USED IN THIS SHIPMENT.
            </Text>
          </View>
        </View>
      </View>
    </>
  );
}

function TableHeader() {
  return (
    <View style={styles.tr}>
      {/* ✅ PO 폭 확대 + Description 정렬 보정 */}
      <Text style={[styles.th, { width: "16%" }]}>PO #</Text>
      <Text style={[styles.th, styles.tdCenter, { width: "14%" }]}>Buyer Style</Text>
      <Text style={[styles.th, styles.tdCenter, { width: "24%" }]}>Description</Text>
      <Text style={[styles.th, { width: "12%" }]}>HS Code</Text>
      <Text style={[styles.th, { width: "7%" }]}>Qty</Text>
      <Text style={[styles.th, { width: "7%" }]}>UOM</Text>
      <Text style={[styles.th, { width: "10%" }]}>Unit Price</Text>
      <Text style={[styles.th, { width: "10%" }]}>Amount</Text>
    </View>
  );
}

/* =========================
   Component
========================= */
const ProformaInvoicePDF: React.FC<{
  header: ProformaHeaderPDF;
  lines: ProformaLinePDF[];
}> = ({ header, lines }) => {
  const subtotal = lines.reduce((s, l) => s + n(l.amount), 0);
  const pages = chunk(lines, ROWS_PER_PAGE);

  return (
    <Document>
      {pages.map((pageLines, pageIdx) => {
        const isLast = pageIdx === pages.length - 1;

        return (
          <Page key={pageIdx} size="A4" style={styles.page}>
            {/* ✅ 2페이지 넘어가도 헤더 반복 */}
            <HeaderBlock header={header} />

            {/* Table */}
            <View style={styles.table}>
              <TableHeader />
              {pageLines.map((l, i) => (
                <View key={`${pageIdx}-${i}`} style={styles.tr}>
                  <Text style={[styles.td, { width: "16%" }]}>
                    {softWrapToken(l.po_no)}
                  </Text>
                  <Text style={[styles.td, styles.tdCenter, { width: "14%" }]}>
                    {softWrapToken(l.buyer_style_no)}
                  </Text>
                  <Text style={[styles.td, styles.tdCenter, { width: "24%" }]}>
                    {show(l.description)}
                  </Text>
                  <Text style={[styles.td, styles.tdCenter, { width: "12%" }]}>
                    {softWrapToken(l.hs_code, 5)}
                  </Text>
                  <Text style={[styles.td, styles.tdRight, { width: "7%" }]}>
                    {intComma(l.qty)}
                  </Text>
                  <Text style={[styles.td, styles.tdCenter, { width: "7%" }]}>
                    {show(l.uom)}
                  </Text>
                  <Text style={[styles.td, styles.tdRight, { width: "10%" }]}>
                    {money(l.unit_price)}
                  </Text>
                  <Text style={[styles.td, styles.tdRight, { width: "10%" }]}>
                    {money(l.amount)}
                  </Text>
                </View>
              ))}
            </View>

            {/* ✅ 마지막 페이지에서만 Subtotal + Signed by */}
            {isLast ? (
              <>
                <View style={styles.subtotalRow}>
                  <Text style={styles.subtotalLabel}>Subtotal</Text>
                  <Text style={styles.subtotalValue}>USD {money(subtotal)}</Text>
                </View>

                {/* ✅ Signed by 스탬프 위치 고정 */}
                <View style={styles.signedBox}>
                  <Text style={styles.signedTitle}>Authorized Signature</Text>
                  <View style={styles.signedLine} />
                  <Text style={styles.signedBy}>Signed by</Text>
                </View>
              </>
            ) : null}
          </Page>
        );
      })}
    </Document>
  );
};

export default ProformaInvoicePDF;
