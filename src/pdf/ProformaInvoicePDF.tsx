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

// =====================
// Types (필요 필드만)
// =====================
export type ProformaHeaderPDF = {
  invoice_no?: string | null;
  issue_date?: string | null;

  po_no?: string | null;

  buyer_name?: string | null;
  buyer_brand_name?: string | null;
  buyer_dept_name?: string | null;

  shipper_name?: string | null;
  shipper_address?: string | null;

  payment_term?: string | null;
  remarks?: string | null;

  consignee_text?: string | null;
  notify_party_text?: string | null;

  port_of_loading?: string | null;
  final_destination?: string | null;

  incoterm?: string | null;
  ship_mode?: string | null;

  coo_text?: string | null;
};

export type ProformaLinePDF = {
  po_no?: string | null;
  buyer_style_no?: string | null;
  description?: string | null;
  hs_code?: string | null;
  qty?: number | null;
  uom?: string | null;
  unit_price?: number | null;
  amount?: number | null;
};

// ✅ B안: signatureUrl 지원 (옵션)
export default function ProformaInvoicePDF(props: {
  header: ProformaHeaderPDF;
  lines: ProformaLinePDF[];
  signatureUrl?: string; // ✅ 추가
}) {
  const header = props.header ?? {};
  const lines = props.lines ?? [];
  const signatureUrl = (props.signatureUrl ?? "").toString().trim();

  const money2 = (v: any) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return "0.00";
    return n.toFixed(2);
  };
  const intFmt = (v: any) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return "0";
    return Math.round(n).toLocaleString("en-US");
  };

  const safe = (v: any) => (v ?? "").toString().trim();

  const formatDateLike = (v?: string | null) => {
    const s = safe(v);
    if (!s) return "";
    // allow YYYY-MM-DD or ISO
    const ymd = /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
    const d = new Date(ymd);
    if (Number.isNaN(d.getTime())) return ymd;
    // "2026. 1. 6."
    const yy = d.getFullYear();
    const mm = d.getMonth() + 1;
    const dd = d.getDate();
    return `${yy}. ${mm}. ${dd}.`;
  };

  const subtotal = lines.reduce((acc, l) => acc + (Number(l.amount) || 0), 0);

  // =====================
  // ✅ Multiline renderer
  // - \n 있으면 그대로
  // - 없으면 콤마(,) 기준으로 줄바꿈해서 주소가 박스 안에 예쁘게 보이게
  // =====================
  const splitAddressLines = (text?: string | null) => {
    const s = safe(text);
    if (!s) return [];
    if (s.includes("\n")) {
      return s
        .split(/\r?\n/)
        .map((x) => x.trim())
        .filter(Boolean);
    }
    // 콤마 기준 줄바꿈 (주소/Intercom 포함 텍스트를 자연스럽게 분리)
    const parts = s
      .split(/\s*,\s*/)
      .map((x) => x.trim())
      .filter(Boolean);

    // 너무 잘게 쪼개지면 2개씩 묶어서 줄로 만들기
    const out: string[] = [];
    for (let i = 0; i < parts.length; i += 2) {
      const a = parts[i];
      const b = parts[i + 1];
      out.push(b ? `${a}, ${b}` : a);
    }
    return out.length ? out : [s];
  };

  const Multiline = ({ text }: { text?: string | null }) => {
    const arr = splitAddressLines(text);
    if (!arr.length) return null;
    return (
      <>
        {arr.map((line, i) => (
          <Text key={i} style={styles.boxText}>
            {line}
          </Text>
        ))}
      </>
    );
  };

  // Fallbacks
  const buyerName = safe(header.buyer_name) || "-";
  const consigneeText = safe(header.consignee_text) || buyerName;
  const notifyText = safe(header.notify_party_text) || buyerName;

  const brandDept = [safe(header.buyer_brand_name), safe(header.buyer_dept_name)]
    .filter(Boolean)
    .join(" / ");

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Title */}
        <Text style={styles.title}>Proforma Invoice</Text>

        {/* Top row */}
        <View style={styles.topRow}>
          <View style={styles.topLeft}>
            <Text style={styles.topLine}>
              <Text style={styles.topLabel}>Buyer: </Text>
              {buyerName}
            </Text>
            <Text style={styles.topLine}>
              <Text style={styles.topLabel}>Brand / Dept: </Text>
              {brandDept || "-"}
            </Text>
          </View>

          <View style={styles.topRight}>
            <Text style={styles.topLine}>
              <Text style={styles.topLabel}>Invoice No: </Text>
              {safe(header.invoice_no) || "-"}
            </Text>
            <Text style={styles.topLine}>
              <Text style={styles.topLabel}>Date: </Text>
              {formatDateLike(header.issue_date) || "-"}
            </Text>
          </View>
        </View>

        {/* Box: Shipper/Exporter & Invoice/Terms */}
        <View style={styles.row2}>
          <View style={styles.box}>
            <Text style={styles.boxTitle}>Shipper / Exporter</Text>
            <Text style={styles.boxText}>
              {safe(header.shipper_name) || "JM INTERNATIONAL CO.,LTD"}
            </Text>
            {safe(header.shipper_address) ? (
              <Multiline text={header.shipper_address} />
            ) : (
              <>
                <Text style={styles.boxText}>
                  Lot16, CN4 Series, Khuc Xuyen Service Village Industrial cluster
                </Text>
                <Text style={styles.boxText}>Khuc Xuyen ward, Bac Ninh City</Text>
                <Text style={styles.boxText}>VIETNAM</Text>
              </>
            )}
          </View>

          <View style={styles.box}>
            <Text style={styles.boxTitle}>Invoice & Terms</Text>
            <Text style={styles.boxText}>
              <Text style={styles.bold}>Terms: </Text>
              {safe(header.payment_term) || "-"}
            </Text>

            <Text style={[styles.boxText, { marginTop: 10 }]}>
              <Text style={styles.bold}>Remarks: </Text>
            </Text>
            <Multiline text={header.remarks || ""} />
          </View>
        </View>

        {/* Box: Consignee / Notify */}
        <View style={styles.row2}>
          <View style={styles.box}>
            <Text style={styles.boxTitle}>Consignee</Text>
            <Multiline text={consigneeText} />
          </View>
          <View style={styles.box}>
            <Text style={styles.boxTitle}>Notify Party</Text>
            <Multiline text={notifyText} />
          </View>
        </View>

        {/* Box: Port / Final Destination */}
        <View style={styles.row2}>
          <View style={styles.box}>
            <Text style={styles.boxTitle}>Port of Loading</Text>
            <Text style={styles.boxText}>
              {safe(header.port_of_loading) || "-"}
            </Text>
          </View>
          <View style={styles.box}>
            <Text style={styles.boxTitle}>Final Destination</Text>
            <Text style={styles.boxText}>
              {safe(header.final_destination) || "-"}
            </Text>
          </View>
        </View>

        {/* COO / Certification */}
        <View style={styles.fullBox}>
          <Text style={styles.boxTitle}>COO / Certification</Text>
          <Text style={styles.boxText}>{safe(header.coo_text) || "COO: -"}</Text>
          <Text style={styles.boxText}>
            WE CERTIFY THERE IS NO WOOD PACKING MATERIAL USED IN THIS SHIPMENT.
          </Text>
          <Text style={styles.boxText}>
            Incoterm: {safe(header.incoterm) || "-"} &nbsp;&nbsp;|&nbsp;&nbsp;
            Ship Mode: {safe(header.ship_mode) || "-"}
          </Text>
        </View>

        {/* Table */}
        <View style={styles.table}>
          <View style={styles.trHead}>
            {[
              "PO #",
              "Buyer Style",
              "Description",
              "HS Code",
              "Qty",
              "UOM",
              "Unit Price",
              "Amount",
            ].map((h, i) => (
              <Text key={i} style={[styles.th, colStyle(i)]}>
                {h}
              </Text>
            ))}
          </View>

          {lines.map((l, idx) => (
            <View key={idx} style={styles.tr}>
              <Text style={[styles.td, colStyle(0)]}>
                {safe(l.po_no) || safe(header.po_no) || "-"}
              </Text>
              <Text style={[styles.td, colStyle(1)]}>
                {safe(l.buyer_style_no) || "-"}
              </Text>
              <Text style={[styles.td, colStyle(2)]}>
                {safe(l.description) || "-"}
              </Text>
              <Text style={[styles.td, colStyle(3)]}>
                {safe(l.hs_code) || "-"}
              </Text>
              <Text style={[styles.td, colStyle(4), styles.tdRight]}>
                {intFmt(l.qty)}
              </Text>
              <Text style={[styles.td, colStyle(5)]}>{safe(l.uom) || "-"}</Text>
              <Text style={[styles.td, colStyle(6), styles.tdRight]}>
                {money2(l.unit_price)}
              </Text>
              <Text style={[styles.td, colStyle(7), styles.tdRight]}>
                {money2(l.amount)}
              </Text>
            </View>
          ))}
        </View>

        {/* Subtotal */}
        <View style={styles.subtotalRow}>
          <Text style={styles.subtotalLabel}>Subtotal</Text>
          <Text style={styles.subtotalValue}>USD {money2(subtotal)}</Text>
        </View>

        {/* ✅ Signature (B안) */}
        {signatureUrl ? (
          <View style={styles.signatureRow}>
            <View style={styles.signatureBox}>
              <Text style={styles.signatureTitle}>Authorized Signature</Text>
              <Image src={signatureUrl} style={styles.signatureImage} />
              <Text style={styles.signatureHint}>JM INTERNATIONAL CO.,LTD</Text>
            </View>
          </View>
        ) : null}
      </Page>
    </Document>
  );
}

// =====================
// Styles
// =====================
const BORDER = 1;

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingHorizontal: 40,
    paddingBottom: 40,
    fontSize: 10,
    fontFamily: "Helvetica",
  },
  title: {
    fontSize: 22,
    textAlign: "center",
    marginBottom: 20,
    fontWeight: 700 as any,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  topLeft: { width: "60%" },
  topRight: { width: "40%", alignItems: "flex-end" },
  topLine: { marginBottom: 6, fontSize: 11 },
  topLabel: { fontWeight: 700 as any },

  row2: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 10,
  },
  box: {
    flex: 1,
    borderWidth: BORDER,
    borderColor: "#000",
    padding: 10,
    minHeight: 80,
  },
  fullBox: {
    borderWidth: BORDER,
    borderColor: "#000",
    padding: 10,
    marginBottom: 14,
    minHeight: 70,
  },
  boxTitle: {
    fontSize: 12,
    fontWeight: 700 as any,
    marginBottom: 6,
  },
  boxText: {
    fontSize: 10,
    lineHeight: 1.35,
  },
  bold: { fontWeight: 700 as any },

  table: {
    borderWidth: BORDER,
    borderColor: "#999",
  },
  trHead: {
    flexDirection: "row",
    borderBottomWidth: BORDER,
    borderColor: "#999",
    backgroundColor: "#eee",
  },
  tr: {
    flexDirection: "row",
    borderBottomWidth: BORDER,
    borderColor: "#ddd",
  },
  th: {
    paddingVertical: 6,
    paddingHorizontal: 6,
    fontSize: 10,
    fontWeight: 700 as any,
    textAlign: "center",
    borderRightWidth: BORDER,
    borderColor: "#999",
  },
  td: {
    paddingVertical: 6,
    paddingHorizontal: 6,
    fontSize: 10,
    borderRightWidth: BORDER,
    borderColor: "#ddd",
  },
  tdRight: {
    textAlign: "right",
  },

  subtotalRow: {
    marginTop: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  subtotalLabel: {
    fontSize: 12,
    fontWeight: 700 as any,
  },
  subtotalValue: {
    fontSize: 12,
    fontWeight: 700 as any,
  },

  // ✅ Signature
  signatureRow: {
    marginTop: 18,
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  signatureBox: {
    width: 200,
    borderWidth: BORDER,
    borderColor: "#000",
    padding: 10,
    alignItems: "center",
  },
  signatureTitle: {
    fontSize: 11,
    fontWeight: 700 as any,
    marginBottom: 6,
  },
  signatureImage: {
    width: 160,
    height: 50,
    objectFit: "contain",
  },
  signatureHint: {
    marginTop: 6,
    fontSize: 9,
  },
});

// Table column widths (비율)
function colStyle(i: number) {
  // PO, BuyerStyle, Desc, HS, Qty, UOM, Unit, Amount
  const widths = [14, 14, 30, 10, 8, 8, 10, 10];
  const w = widths[i] ?? 10;
  return { width: `${w}%` as any };
}
