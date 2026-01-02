// src/app/invoices/InvoicePDF.tsx
import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  // Image,
} from "@react-pdf/renderer";

type Tri = "AUTO" | "ON" | "OFF";

type InvoiceHeader = {
  id: string;
  invoice_no: string | null;
  buyer_name: string | null;
  buyer_code?: string | null;

  // PI 상단용
  buyer_brand?: string | null; // Brand / Dept
  buyer_dept?: string | null;

  // party (PI 구조)
  shipper?: string | null; // Shipper / Exporter text (줄바꿈 포함)
  bill_to: string | null;  // fallback consignee
  ship_to: string | null;  // fallback notify
  consignee?: string | null;
  notify_party?: string | null;

  // terms/info
  currency: string | null;
  incoterm: string | null;
  payment_term: string | null;

  shipping_origin_code: string | null;
  destination: string | null;

  // PI의 Port/Final/Ship Mode
  port_of_loading?: string | null;
  final_destination?: string | null;
  ship_mode?: string | null; // SEA / AIR / COURIER etc

  etd: string | null;
  eta: string | null;
  invoice_date?: string | null;

  // PI Invoice & Terms 박스
  terms?: string | null;    // ex) B030 B/L 30 Days
  remarks?: string | null;
  tracking_no?: string | null;

  total_amount: number | null;
  memo: string | null;

  // LDC 표시 제어 (기존 호환)
  show_material_hs?: boolean | null;

  // 선택 토글 (추후 UI에서 붙이면 됨)
  pdf_show_material?: Tri | null;
  pdf_show_hs_code?: Tri | null;
};

type InvoiceLine = {
  id: string;
  po_no: string | null;
  style_no: string | null;       // CI에서 Style No 사용
  buyer_style_no?: string | null; // PI의 Buyer Style 필요하면 사용
  description: string | null;

  material_content: string | null;
  hs_code: string | null;

  uom?: string | null;
  qty: number | null;
  unit_price: number | null;
  amount: number | null;

  is_deleted?: boolean | null;
};

type Props = {
  header: InvoiceHeader;
  lines: InvoiceLine[];
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 28,
    paddingBottom: 28,
    paddingHorizontal: 28,
    fontSize: 10,
    color: "#111",
    fontFamily: "Helvetica",
  },

  // ===== Title / Top Row =====
  title: {
    textAlign: "center",
    fontSize: 18,
    fontWeight: 700,
    marginBottom: 14,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  topLeft: { width: "60%" },
  topRight: { width: "40%", alignItems: "flex-end" },
  topLine: { marginBottom: 6 },

  // ===== Boxes (PI style) =====
  grid2: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 10,
  },
  box: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#222",
    padding: 10,
    minHeight: 68,
  },
  boxTitle: {
    fontWeight: 700,
    marginBottom: 6,
  },
  mono: {
    lineHeight: 1.25,
    whiteSpace: "pre-wrap",
  },

  // small label/value inside right box
  kv: { marginBottom: 6 },

  // ===== COO Box =====
  cooBox: {
    borderWidth: 1,
    borderColor: "#222",
    padding: 10,
    marginBottom: 10,
  },

  // ===== Table =====
  table: {
    borderWidth: 1,
    borderColor: "#222",
  },
  trHead: {
    flexDirection: "row",
    backgroundColor: "#f3f3f3",
    borderBottomWidth: 1,
    borderColor: "#222",
  },
  tr: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderColor: "#ddd",
  },
  th: { padding: 6, fontWeight: 700, fontSize: 9.5 },
  td: { padding: 6, fontSize: 9.5 },

  right: { textAlign: "right" },
  center: { textAlign: "center" },

  subtotalWrap: {
    marginTop: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderColor: "#999",
    paddingTop: 10,
  },
  subtotalLabel: { fontWeight: 700 },
  subtotalValue: { fontWeight: 700 },

  // ===== Signature =====
  signedWrap: {
    marginTop: 24,
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  signedBox: {
    width: 260,
    alignItems: "flex-end",
  },
  signedBy: { marginBottom: 8 },
  companyName: { marginTop: 8, fontSize: 12 },
});

function fmtDate(v?: string | null) {
  if (!v) return "-";
  try {
    return String(v).slice(0, 10);
  } catch {
    return String(v);
  }
}
function fmtNum(v: number | null | undefined, digits = 2) {
  if (v === null || v === undefined) return "-";
  try {
    return Number(v).toLocaleString(undefined, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  } catch {
    return String(v);
  }
}
function toNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function isTruthy(v: any) {
  return v !== null && v !== undefined && String(v).trim() !== "";
}

function isLdcBuyer(header: InvoiceHeader) {
  if (header?.show_material_hs === true) return true;
  if (header?.show_material_hs === false) return false;

  const name = (header?.buyer_name ?? "").toUpperCase();
  const inv = (header?.invoice_no ?? "").toUpperCase();
  const code = (header?.buyer_code ?? "").toUpperCase();
  return name.includes("LDC") || inv.includes("LDC") || code.includes("LDC");
}
function resolveTri(mode: Tri | null | undefined, autoValue: boolean) {
  if (mode === "ON") return true;
  if (mode === "OFF") return false;
  return autoValue;
}

function pickConsignee(header: InvoiceHeader) {
  return (header.consignee ?? header.bill_to ?? "") || "-";
}
function pickNotify(header: InvoiceHeader) {
  return (header.notify_party ?? header.ship_to ?? "") || "-";
}

function formatOriginText(originCode: string | null | undefined) {
  const v = (originCode ?? "").toUpperCase().trim();
  if (!v) return "-";
  if (v.includes("VN")) return "MADE IN VIETNAM";
  if (v.includes("KR")) return "MADE IN KOREA";
  if (v.includes("CN")) return "MADE IN CHINA";
  if (v.startsWith("MADE IN")) return originCode ?? "-";
  return originCode ?? "-";
}

export default function InvoicePDF({ header, lines }: Props) {
  const safeLines = (lines ?? []).filter((x) => !x?.is_deleted);

  // ===== Material/HS 표시 규칙 (PI처럼 “필요할 때만”)
  const ldc = isLdcBuyer(header);
  const hasMat = safeLines.some((r) => isTruthy(r.material_content));
  const hasHs = safeLines.some((r) => isTruthy(r.hs_code));

  const autoMat = ldc || hasMat;
  const autoHs = ldc || hasHs;

  let showMaterial: boolean;
  let showHS: boolean;

  if (header?.show_material_hs === true) {
    showMaterial = true;
    showHS = true;
  } else if (header?.show_material_hs === false) {
    showMaterial = false;
    showHS = false;
  } else {
    showMaterial = resolveTri(header?.pdf_show_material ?? "AUTO", autoMat);
    showHS = resolveTri(header?.pdf_show_hs_code ?? "AUTO", autoHs);
  }

  // ===== Top header strings (PI)
  const brandDept =
    header?.buyer_brand || header?.buyer_dept
      ? `${header?.buyer_brand ?? "-"}${header?.buyer_dept ? ` / ${header.buyer_dept}` : ""}`
      : "-";

  const shipperText = header?.shipper ?? "-";
  const consigneeText = pickConsignee(header);
  const notifyText = pickNotify(header);

  const portLoading = header?.port_of_loading ?? "-";
  const finalDest = header?.final_destination ?? header?.destination ?? "-";

  const originText = formatOriginText(header?.shipping_origin_code);

  const termsText = header?.terms ?? header?.payment_term ?? "-";
  const remarksText = header?.remarks ?? header?.memo ?? "";
  const trackingText = header?.tracking_no ?? "";

  const totalAmount =
    header?.total_amount ??
    safeLines.reduce((sum, r) => sum + toNum(r.amount), 0);

  // ===== Table columns widths (PI 느낌 고정)
  // PO / Style(or Buyer Style) / Desc / (Mat) / HS / Qty / UOM / Unit / Amount
  const W = {
    po: 80,
    style: 70,
    desc: 170,
    mat: 110,
    hs: 70,
    qty: 55,
    uom: 45,
    unit: 60,
    amt: 65,
  };

  // 필요 없는 컬럼 빼면 Description에 폭을 더 줌
  const descExtra =
    (showMaterial ? 0 : W.mat) + (showHS ? 0 : W.hs);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>COMMERCIAL INVOICE</Text>

        {/* ===== Top line (PI style) ===== */}
        <View style={styles.topRow}>
          <View style={styles.topLeft}>
            <Text style={styles.topLine}>Buyer: {header?.buyer_name ?? "-"}</Text>
            <Text style={styles.topLine}>Brand / Dept: {brandDept}</Text>
          </View>
          <View style={styles.topRight}>
            <Text style={styles.topLine}>Invoice No: {header?.invoice_no ?? "-"}</Text>
            <Text style={styles.topLine}>Date: {fmtDate(header?.invoice_date ?? null)}</Text>
          </View>
        </View>

        {/* ===== Row 1: Shipper/Exporter + Invoice & Terms ===== */}
        <View style={styles.grid2}>
          <View style={styles.box}>
            <Text style={styles.boxTitle}>Shipper / Exporter</Text>
            <Text style={styles.mono}>{shipperText}</Text>
          </View>

          <View style={styles.box}>
            <Text style={styles.boxTitle}>Invoice & Terms</Text>
            <Text style={styles.kv}>Terms: {termsText}</Text>
            <Text style={styles.kv}>Remarks:</Text>
            <Text style={styles.mono}>{remarksText || "-"}</Text>
            <Text style={{ marginTop: 8 }}>TRACKING#</Text>
            <Text>{trackingText || "-"}</Text>
          </View>
        </View>

        {/* ===== Row 2: Consignee + Notify Party ===== */}
        <View style={styles.grid2}>
          <View style={styles.box}>
            <Text style={styles.boxTitle}>Consignee</Text>
            <Text style={styles.mono}>{consigneeText}</Text>
          </View>
          <View style={styles.box}>
            <Text style={styles.boxTitle}>Notify Party</Text>
            <Text style={styles.mono}>{notifyText}</Text>
          </View>
        </View>

        {/* ===== Row 3: Port of Loading + Final Destination ===== */}
        <View style={styles.grid2}>
          <View style={styles.box}>
            <Text style={styles.boxTitle}>Port of Loading</Text>
            <Text>{portLoading}</Text>
          </View>
          <View style={styles.box}>
            <Text style={styles.boxTitle}>Final Destination</Text>
            <Text>{finalDest}</Text>
          </View>
        </View>

        {/* ===== COO / Certification (PI style) ===== */}
        <View style={styles.cooBox}>
          <Text style={styles.boxTitle}>COO / Certification</Text>
          <Text>COO: {originText}</Text>
          <Text>WE CERTIFY THERE IS NO WOOD PACKING MATERIAL USED IN THIS SHIPMENT.</Text>
          <Text>
            Incoterm: {header?.incoterm ?? "-"} {"  |  "} Ship Mode: {header?.ship_mode ?? "-"}
          </Text>
        </View>

        {/* ===== Lines Table ===== */}
        <View style={styles.table}>
          <View style={styles.trHead}>
            <Text style={[styles.th, { width: W.po }]}>PO #</Text>
            <Text style={[styles.th, { width: W.style }]}>Style No</Text>
            <Text style={[styles.th, { width: W.desc + descExtra }]}>Description</Text>

            {showMaterial && (
              <Text style={[styles.th, { width: W.mat }]}>Material</Text>
            )}
            {showHS && (
              <Text style={[styles.th, { width: W.hs, textAlign: "center" }]}>HS Code</Text>
            )}

            <Text style={[styles.th, { width: W.qty, textAlign: "right" }]}>Qty</Text>
            <Text style={[styles.th, { width: W.uom, textAlign: "center" }]}>UOM</Text>
            <Text style={[styles.th, { width: W.unit, textAlign: "right" }]}>Unit Price</Text>
            <Text style={[styles.th, { width: W.amt, textAlign: "right" }]}>Amount</Text>
          </View>

          {safeLines.length === 0 ? (
            <View style={styles.tr}>
              <Text style={[styles.td, { width: 580 }]}>No lines</Text>
            </View>
          ) : (
            safeLines.map((r) => (
              <View key={r.id} style={styles.tr}>
                <Text style={[styles.td, { width: W.po }]}>{r.po_no ?? ""}</Text>
                <Text style={[styles.td, { width: W.style }]}>{r.style_no ?? ""}</Text>
                <Text style={[styles.td, { width: W.desc + descExtra }]}>{r.description ?? ""}</Text>

                {showMaterial && (
                  <Text style={[styles.td, { width: W.mat }]}>{r.material_content ?? ""}</Text>
                )}
                {showHS && (
                  <Text style={[styles.td, { width: W.hs, textAlign: "center" }]}>{r.hs_code ?? ""}</Text>
                )}

                <Text style={[styles.td, { width: W.qty, textAlign: "right" }]}>{fmtNum(r.qty, 0)}</Text>
                <Text style={[styles.td, { width: W.uom, textAlign: "center" }]}>{r.uom ?? "PCS"}</Text>
                <Text style={[styles.td, { width: W.unit, textAlign: "right" }]}>{fmtNum(r.unit_price, 2)}</Text>
                <Text style={[styles.td, { width: W.amt, textAlign: "right" }]}>{fmtNum(r.amount, 2)}</Text>
              </View>
            ))
          )}
        </View>

        {/* ===== Subtotal (PI style) ===== */}
        <View style={styles.subtotalWrap}>
          <Text style={styles.subtotalLabel}>Subtotal</Text>
          <Text style={styles.subtotalValue}>
            {header?.currency ?? ""} {fmtNum(totalAmount, 2)}
          </Text>
        </View>

        {/* ===== Signature (PI style) ===== */}
        <View style={styles.signedWrap}>
          <View style={styles.signedBox}>
            <Text style={styles.signedBy}>Signed by</Text>

            {/* 스탬프 이미지가 있으면 사용 (base64 or url)
                <Image src={STAMP_URL_OR_BASE64} style={{ width: 120, height: 120 }} />
            */}

            <Text style={styles.companyName}>JM International Co.,Ltd</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}
