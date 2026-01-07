// src/app/proforma/page.tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import type { AppRole } from "@/config/menuConfig";
import { createSupabaseBrowserClient } from "@/lib/supabaseClient";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

import jsPDF from "jspdf";
// @ts-ignore
import autoTable from "jspdf-autotable";

type DevRole = AppRole;

interface ProformaListItem {
  id: string;
  invoiceNo: string;
  poNo: string;
  buyerName: string;
  currency: string;
  createdAt: string;
  subtotal: number;
}

export default function ProformaListPage() {
  const router = useRouter();
  const supabase = React.useMemo(() => createSupabaseBrowserClient(), []);

  const [loading, setLoading] = React.useState(true);
  const [role, setRole] = React.useState<DevRole | null>(null);

  const [keyword, setKeyword] = React.useState("");
  const [searching, setSearching] = React.useState(false);
  const [items, setItems] = React.useState<ProformaListItem[]>([]);
  const [exportingId, setExportingId] = React.useState<string | null>(null);

  // ==============================
  // Auth & Role
  // ==============================
  React.useEffect(() => {
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.replace("/login?redirectTo=/trade/proforma");
        return;
      }
      const meta = (session.user.user_metadata || {}) as any;
      const r: AppRole = meta.role || "viewer";

      setRole(r as DevRole);
      setLoading(false);

      if (r === "viewer") {
        alert("You do not have permission to view Proforma Invoices.");
        router.replace("/");
      }
    })();
  }, [router, supabase]);

  // ==============================
  // List Load
  // ==============================
  const fetchList = React.useCallback(
    async (kw: string) => {
      setSearching(true);
      try {
        const params = new URLSearchParams();
        if (kw.trim()) params.set("keyword", kw.trim());

        const res = await fetch(`/api/proforma/list?${params.toString()}`, { cache: 'no-store' });
        const data = await res.json().catch(() => null);

        if (!res.ok) {
          console.error("Failed to load proforma list:", data);
          alert(
            (data && (data.error || data.message)) ||
              `Failed to load proforma invoices (status ${res.status}).`
          );
          return;
        }

        setItems((data?.items as ProformaListItem[]) || []);
      } catch (err) {
        console.error("Unexpected error loading proforma list:", err);
        alert("Unexpected error while loading proforma invoices.");
      } finally {
        setSearching(false);
      }
    },
    []
  );

  React.useEffect(() => {
    if (!loading && role && role !== "viewer") {
      fetchList("");
    }
  }, [loading, role, fetchList]);

  // ==============================
  // jsPDF Export (직접 다운로드)
  // ==============================
  const handleExportPdf = async (pi: ProformaListItem) => {
    try {
      setExportingId(pi.id);

      // 1) Proforma 헤더 + 라인
      const params = new URLSearchParams();
      params.set("invoiceNo", pi.invoiceNo);

      const res = await fetch(`/api/proforma/detail?${params.toString()}`);
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        console.error("Failed to load proforma detail:", data);
        alert(
          (data && (data.error || data.message)) ||
            `Failed to load Proforma Invoice (status ${res.status}).`
        );
        return;
      }

      const header = data.header as {
        id: string;
        invoiceNo: string;
        poNo: string | null;
        buyerId: string | null;
        buyerName: string | null;
        currency: string | null;
        paymentTerm?: string | null;
        shipMode?: string | null;
        destination?: string | null;
        incoterm?: string | null;
        createdAt: string | null;
        consigneeText?: string | null;
        notifyPartyText?: string | null;
        finalDestinationText?: string | null;
        buyerBrand?: string | null;
        buyerDept?: string | null;
      };

      const lines = (data.lines || []) as Array<{
        line_no: number;
        buyer_style_no?: string | null;
        jm_style_no?: string | null;
        description?: string | null;
        color?: string | null;
        size?: string | null;
        hs_code?: string | null;
        qty?: number | null;
        uom?: string | null;
        unit_price?: number | null;
        amount?: number | null;
        upc_code?: string | null;
        plating_color?: string | null;
      }>;

      const subtotal = lines.reduce((sum, l) => sum + (l.amount ?? 0), 0);
      const subtotalText = Number(subtotal).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

      // 통화 코드 (PDF 하단 Subtotal 표시용)
      const currencyCode = header.currency || pi.currency || "USD";

      // 2) PO 헤더
      let poHeader: any | null = null;
      if (header.poNo) {
        try {
          const poRes = await fetch(
            `/api/orders?poNo=${encodeURIComponent(header.poNo)}`
          );
          const poData = await poRes.json().catch(() => null);
          if (poRes.ok && poData?.header) {
            poHeader = poData.header;
          } else {
            console.warn("No PO header found for PI", header.poNo, poData);
          }
        } catch (err) {
          console.error("Failed to load PO header for proforma:", err);
        }
      }

      // 3) Buyer 정보
      let buyer: any | null = null;
      const buyerIdFromHeader: string | null = header.buyerId;
      const buyerIdFromPO: string | undefined =
        poHeader?.buyer_id || poHeader?.buyerId;
      const buyerNameFromHeader = (header.buyerName || "").trim();

      const buyerSelectColumns = [
        "id",
        "name",
        "buyer_consignee",
        "buyer_notify_party",
        "buyer_final_destination",
        "buyer_brand",
        "buyer_dept",
        "buyer_payment_term",
        "buyer_default_incoterm",
        "buyer_default_ship_mode",
        "origin_mark",
        "factory_sea_port",
        "factory_air_port",
      ].join(",");

      try {
        if (buyerIdFromHeader) {
          const { data: r1, error: e1 } = await supabase
            .from("buyers")
            .select(buyerSelectColumns)
            .eq("id", buyerIdFromHeader)
            .maybeSingle();
          if (!e1) buyer = r1;
        }

        if (!buyer && buyerIdFromPO) {
          const { data: r2, error: e2 } = await supabase
            .from("buyers")
            .select(buyerSelectColumns)
            .eq("id", buyerIdFromPO)
            .maybeSingle();
          if (!e2) buyer = r2;
        }

        if (!buyer && buyerNameFromHeader) {
          const { data: r3, error: e3 } = await supabase
            .from("buyers")
            .select(buyerSelectColumns)
            .ilike("name", buyerNameFromHeader)
            .maybeSingle();
          if (!e3) buyer = r3;
        }
      } catch (err) {
        console.error("Unexpected error loading buyer for proforma:", err);
      }

      const toPlainLines = (txt?: string | null) =>
        (txt || "")
          .replace(/\r\n/g, "\n")
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.length > 0);

      const buyerName = header.buyerName || buyer?.name || "";

      // ✅ IMPORTANT:
      // Brand/Dept는 companies/buyers에서 "전체 목록"을 긁어오면 안 됨.
      // PO Header에 저장된 스냅샷( buyer_brand_name / buyer_dept_name )만 사용.
      const poBuyerBrandName: string =
        (poHeader?.buyer_brand_name ||
          poHeader?.buyerBrandName ||
          poHeader?.buyer_brand ||
          "") as string;
      const poBuyerDeptName: string =
        (poHeader?.buyer_dept_name ||
          poHeader?.buyerDeptName ||
          poHeader?.buyer_dept ||
          "") as string;

      const buyerBrand: string = ((poBuyerBrandName || header.buyerBrand || "") as string).trim();

      const buyerDept: string = ((poBuyerDeptName || header.buyerDept || "") as string).trim();

      const paymentTermText: string =
        header.paymentTerm ||
        buyer?.buyer_payment_term ||
        poHeader?.payment_term ||
        "";

      const incoterm: string =
        header.incoterm ||
        buyer?.buyer_default_incoterm ||
        poHeader?.incoterm ||
        "";

      const shipMode: string =
        header.shipMode ||
        buyer?.buyer_default_ship_mode ||
        poHeader?.ship_mode ||
        "";

      const destination: string =
        header.destination ||
        header.finalDestinationText ||
        buyer?.buyer_final_destination ||
        poHeader?.final_destination ||
        "";

      const consigneeText: string =
        header.consigneeText ||
        buyer?.buyer_consignee ||
        buyerName ||
        "";

      const notifyPartyText: string =
        header.notifyPartyText ||
        buyer?.buyer_notify_party ||
        consigneeText;

      const finalDestinationText: string =
        header.finalDestinationText ||
        buyer?.buyer_final_destination ||
        destination ||
        "";

      // 4) Shipper / Origin / Port
      type OriginCode =
        | "KR_SEOUL"
        | "CN_QINGDAO"
        | "CN_JIAOZHOU"
        | "VN_BACNINH";

      const originCode: OriginCode | undefined =
        poHeader?.origin_code ||
        poHeader?.originCode ||
        poHeader?.shipping_origin_code ||
        poHeader?.shippingOriginCode;

      let shipperBlock = "";
      let portOfLoading = "";
      let cooDisplay = "";

      if (originCode === "VN_BACNINH") {
        shipperBlock =
          "JM INTERNATIONAL CO.,LTD\n" +
          "Lot16, CN4 Series, Khuc Xuyen Service Village Industrial cluster\n" +
          "Khuc Xuyen ward, Bac Ninh City\n" +
          "VIETNAM";
        portOfLoading =
          buyer?.factory_sea_port ||
          buyer?.factory_air_port ||
          "Haiphong, Vietnam";
        cooDisplay = "MADE IN VIETNAM";
      } else if (originCode === "KR_SEOUL") {
        shipperBlock = "JMI KOREA\nSeoul\nKOREA";
        portOfLoading =
          buyer?.factory_sea_port ||
          buyer?.factory_air_port ||
          "Incheon, Korea";
        cooDisplay = "MADE IN KOREA";
      } else if (originCode === "CN_QINGDAO" || originCode === "CN_JIAOZHOU") {
        shipperBlock = "JM INTERNATIONAL CO.,LTD\nQingdao\nCHINA";
        portOfLoading =
          buyer?.factory_sea_port ||
          buyer?.factory_air_port ||
          "Qingdao, China";
        cooDisplay = "MADE IN CHINA";
      } else {
        shipperBlock = "JM INTERNATIONAL (origin not specified in PO).";
        portOfLoading =
          buyer?.factory_sea_port ||
          buyer?.factory_air_port ||
          destination ||
          "-";
        cooDisplay = buyer?.origin_mark || "";
      }

      if (!cooDisplay) cooDisplay = "-";

      const poNoForLines: string =
        header.poNo || poHeader?.po_no || poHeader?.poNo || "";

      // ==============================
      // jsPDF 생성 (박스 + grid + 도장 이미지)
      // ==============================
      const doc = new jsPDF("p", "mm", "a4");
      const pageWidth = doc.internal.pageSize.getWidth();
      const marginLeft = 8;
      const marginRight = 8;
      const contentWidth = pageWidth - marginLeft * 2;
      const halfWidth = contentWidth / 2;
      let cursorY = 15;

      // ----- HEADER -----
      const dateText = header.createdAt
        ? new Date(header.createdAt).toLocaleDateString()
        : "-";

      // Proforma Invoice 타이틀 크게
      doc.setFontSize(20);
      doc.setFont("helvetica", "bold");
      doc.text("Proforma Invoice", pageWidth / 2, cursorY, {
        align: "center",
      });

      cursorY += 10;

      // Buyer / Brand & Dept (왼쪽)
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");

      // Buyer 줄
      doc.text(`Buyer: ${buyerName || "-"}`, marginLeft, cursorY);
      cursorY += 6;

      // Brand / Dept는 PO header snapshot만 사용 (buyers/companies 전체 브랜드 금지)
      const brandParts: string[] = [];
      if (buyerBrand && buyerBrand.trim() !== "") brandParts.push(buyerBrand);
      if (buyerDept && buyerDept.trim() !== "") brandParts.push(buyerDept);

      if (brandParts.length > 0) {
        // Brand / Dept 둘 중 하나라도 있을 때만 출력
        doc.text(`Brand / Dept: ${brandParts.join(" / ")}`, marginLeft, cursorY);
        cursorY += 6;
      }

      // Invoice No / Date (오른쪽)
      doc.text(
        `Invoice No: ${header.invoiceNo}`,
        pageWidth - marginLeft,
        cursorY - 6,
        { align: "right" }
      );
      doc.text(`Date: ${dateText}`, pageWidth - marginLeft, cursorY, {
        align: "right",
      });

      cursorY += 10;

      // ===== Shipper / Invoice & Terms (2열 박스) =====
      const shipperLines = doc.splitTextToSize(
        shipperBlock || "-",
        halfWidth - 4
      );
      const termsLines = doc.splitTextToSize(
        [
          `Terms: ${paymentTermText || "-"}`,
          "",
          "Remarks:",
          "",
          "TRACKING#",
        ].join("\n"),
        halfWidth - 4
      );

      const cellLineHeight = 4;
      const blockHeight =
        Math.max(shipperLines.length, termsLines.length) * cellLineHeight + 8;

      doc.rect(marginLeft, cursorY, halfWidth, blockHeight);
      doc.rect(marginLeft + halfWidth, cursorY, halfWidth, blockHeight);

      doc.setFont("helvetica", "bold");
      doc.text("Shipper / Exporter", marginLeft + 2, cursorY + 5);
      doc.text("Invoice & Terms", marginLeft + halfWidth + 2, cursorY + 5);
      doc.setFont("helvetica", "normal");

      doc.text(shipperLines, marginLeft + 2, cursorY + 10);
      doc.text(termsLines, marginLeft + halfWidth + 2, cursorY + 10);

      cursorY += blockHeight + 4;

      // ===== Consignee + Notify Party (2열) =====

      // 텍스트 라인 분리
      const consigneeTextFull = toPlainLines(consigneeText).join("\n") || "-";
      const notifyTextFull = toPlainLines(notifyPartyText).join("\n") || "-";

      // 텍스트 줄 수 비교 → 더 많은 줄 기준으로 박스 높이 설정
      const consLines = doc.splitTextToSize(consigneeTextFull, halfWidth - 4);
      const noteLines = doc.splitTextToSize(notifyTextFull, halfWidth - 4);

      const bothHeight =
        Math.max(consLines.length, noteLines.length) * cellLineHeight + 8;

      // 외곽 박스
      doc.rect(marginLeft, cursorY, halfWidth, bothHeight);
      doc.rect(marginLeft + halfWidth, cursorY, halfWidth, bothHeight);

      // 좌측 Consignee
      doc.setFont("helvetica", "bold");
      doc.text("Consignee", marginLeft + 2, cursorY + 5);
      doc.setFont("helvetica", "normal");
      doc.text(consLines, marginLeft + 2, cursorY + 10);

      // 우측 Notify Party
      doc.setFont("helvetica", "bold");
      doc.text("Notify Party", marginLeft + halfWidth + 2, cursorY + 5);
      doc.setFont("helvetica", "normal");
      doc.text(noteLines, marginLeft + halfWidth + 2, cursorY + 10);

      cursorY += bothHeight + 4;

      // ===== Port of Loading / Final Destination =====
      const portBlockHeight = 14;

      doc.rect(marginLeft, cursorY, halfWidth, portBlockHeight);
      doc.rect(marginLeft + halfWidth, cursorY, halfWidth, portBlockHeight);

      doc.setFont("helvetica", "bold");
      doc.text("Port of Loading", marginLeft + 2, cursorY + 5);
      doc.text("Final Destination", marginLeft + halfWidth + 2, cursorY + 5);
      doc.setFont("helvetica", "normal");
      doc.text(portOfLoading || "-", marginLeft + 2, cursorY + 10);
      doc.text(
        finalDestinationText || "-",
        marginLeft + halfWidth + 2,
        cursorY + 10
      );

      cursorY += portBlockHeight + 4;

      // ===== COO / Certification =====
      const cooLines = [
        `COO: ${cooDisplay}`,
        "WE CERTIFY THERE IS NO WOOD PACKING MATERIAL USED IN THIS SHIPMENT.",
        `Incoterm: ${incoterm || "-"}   |   Ship Mode: ${shipMode || "-"}`,
      ];
      const cooHeight = cooLines.length * cellLineHeight + 8;

      doc.rect(marginLeft, cursorY, contentWidth, cooHeight);
      doc.setFont("helvetica", "bold");
      doc.text("COO / Certification", marginLeft + 2, cursorY + 5);
      doc.setFont("helvetica", "normal");
      doc.text(cooLines, marginLeft + 2, cursorY + 10);

      cursorY += cooHeight + 6;

      // ==============================
      // Line Items Table (grid)
      // ==============================
      const buyerUpper = (buyerName || "").toUpperCase();
      const isRED = buyerUpper.includes("RED BEAUTY");

      const showPlatingColumn = !isRED;
      const showUPCColumn = false; // 더 이상 사용 안 함

      // 헤더
      let tableHead: string[] = ["PO #", "Buyer Style", "Description"];
      if (showPlatingColumn) tableHead.push("Plating Color");
      tableHead.push("HS Code", "Qty", "UOM", "Unit Price", "Amount");
      const tableHeadWrapper = [tableHead];

      // 바디
      const tableBody = lines.map((l) => {
        const qtyText =
          l.qty == null
            ? ""
            : l.qty.toLocaleString("en-US", { maximumFractionDigits: 0 });

        const unitPriceText = Number(l.unit_price ?? 0).toLocaleString(
          "en-US",
          {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }
        );

        const amountText = Number(l.amount ?? 0).toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });

        const row: (string | number)[] = [
          poNoForLines || "",
          l.buyer_style_no || "",
          l.description || "",
        ];

        if (showPlatingColumn) {
          row.push(l.plating_color || "");
        }

        row.push(
          l.hs_code || "",
          qtyText,
          l.uom || "",
          unitPriceText,
          amountText
        );

        return row;
      });

      // 컬럼 스타일 (★ Description 중앙 정렬 + 숫자 오른쪽 정렬)
      let columnStyles: any = {};

      if (showPlatingColumn) {
        // 일반 바이어 + LDC : Plating Color 있음
        columnStyles = {
          0: {}, // PO #
          1: {}, // Buyer Style
          2: { halign: "center" }, // Description (center)
          3: {}, // Plating Color
          4: {}, // HS Code
          5: { halign: "right" }, // Qty
          6: {}, // UOM
          7: { halign: "right" }, // Unit Price
          8: { halign: "right" }, // Amount
        };
      } else {
        // RED : Plating Color 없음
        columnStyles = {
          0: {}, // PO #
          1: {}, // Buyer Style
          2: { halign: "center" }, // Description (center)
          3: {}, // HS Code
          4: { halign: "right" }, // Qty
          5: {}, // UOM
          6: { halign: "right" }, // Unit Price
          7: { halign: "right" }, // Amount
        };
      }

      (autoTable as any)(doc, {
        startY: cursorY,
        margin: { left: marginLeft, right: marginLeft },
        tableWidth: "auto",
        head: tableHeadWrapper,
        body: tableBody,
        theme: "grid",
        styles: {
          fontSize: 8,
          cellPadding: 1.8,
          lineColor: [180, 180, 180],
          lineWidth: 0.2,
          halign: "center",
          valign: "middle",
        },
        headStyles: {
          fontStyle: "bold",
          fillColor: [235, 242, 248],
          textColor: [0, 0, 0],
          halign: "center",
        },
        columnStyles,
      });

      const lastTableY =
        (doc as any).lastAutoTable?.finalY || cursorY + 20;

      // ----- Subtotal -----
      // ----- Subtotal Dashed Divider -----
      doc.setDrawColor(150, 150, 150);
      doc.setLineWidth(0.4);
      doc.setLineDashPattern([1, 1], 0); // 점선 적용

      doc.line(
        marginLeft,
        lastTableY + 2,
        pageWidth - marginLeft,
        lastTableY + 2
      );

      // 점선 스타일 리셋 (이후 영향 없도록)
      doc.setLineDashPattern([], 0);

      // ----- Subtotal Text -----
      const subtotalLabel = "Subtotal";
      const subtotalX = marginLeft;
      const subtotalValueX = pageWidth - marginLeft;

      doc.setFontSize(10);
      doc.setTextColor(0, 0, 0);

      doc.text(subtotalLabel, subtotalX, lastTableY + 8, {
        align: "left",
      });

      const subtotalDisplay = `${currencyCode} ${subtotalText}`;
      doc.text(subtotalDisplay, subtotalValueX, lastTableY + 8, {
        align: "right",
      });

      // ==============================
      // 도장 이미지 + 서명
      // ==============================
      let stampY = lastTableY + 24;
      if (stampY > 260) {
        doc.addPage();
        stampY = 40;
      }

      const stampImg = new Image();
      stampImg.src = "/images/jm_stamp_vn.jpg";

      await new Promise<void>((resolve, reject) => {
        stampImg.onload = () => resolve();
        stampImg.onerror = () => reject(new Error("Stamp image load error"));
      });

      const stampWidth = 60;
      const stampHeight = 30;
      const stampX = pageWidth - marginLeft - stampWidth;
      doc.addImage(stampImg, "JPEG", stampX, stampY, stampWidth, stampHeight);

      doc.setFontSize(11);
      doc.text("Signed by", pageWidth - marginLeft, stampY - 2, {
        align: "right",
      });
      doc.setFontSize(11);
      doc.text(
        "JM International Co.,Ltd",
        pageWidth - marginLeft,
        stampY + stampHeight + 6,
        { align: "right" }
      );

      const fileName = `${header.invoiceNo || "proforma"}.pdf`;
      doc.save(fileName);
    } catch (err) {
      console.error("Unexpected error exporting proforma PDF:", err);
      alert("Unexpected error while exporting Proforma Invoice.");
    } finally {
      setExportingId(null);
    }
  };

  // ==============================
  // Render
  // ==============================
  if (loading || !role) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="text-sm text-slate-500">Loading...</div>
      </div>
    );
  }

  return (
    <AppShell
      role={role}
      title="Proforma Invoices"
      description="List of proforma invoices created from POs."
    >
      <div className="p-4">
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <CardTitle className="text-xl">Proforma Invoices</CardTitle>
              <p className="text-xs text-zinc-500 mt-1">
                Search and open Proforma Invoices created from Purchase Orders.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 px-3 text-xs"
              onClick={() => router.push("/po/create")}
            >
              Go to PO Create
            </Button>
          </CardHeader>

          <CardContent>
            {/* 검색 영역 */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <Input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="Search by Invoice No, PO No, Buyer..."
                className="max-w-xs text-sm"
              />
              <Button
                type="button"
                size="sm"
                onClick={() => fetchList(keyword)}
                disabled={searching}
                className="h-8 px-3 text-xs"
              >
                {searching ? "Searching..." : "Search"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setKeyword("");
                  fetchList("");
                }}
                className="h-8 px-3 text-xs"
              >
                Reset
              </Button>
            </div>

            {/* 리스트 테이블 */}
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-zinc-50 border-b">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">
                      Invoice No
                    </th>
                    <th className="px-3 py-2 text-left font-medium">PO No</th>
                    <th className="px-3 py-2 text-left font-medium">Buyer</th>
                    <th className="px-3 py-2 text-left font-medium">
                      Created At
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      Subtotal
                    </th>
                    <th className="px-3 py-2 text-center font-medium">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-3 py-6 text-center text-zinc-500"
                      >
                        No Proforma Invoice found.
                      </td>
                    </tr>
                  )}
                  {items.map((pi) => (
                    <tr key={pi.id} className="border-b last:border-0">
                      <td className="px-3 py-2">{pi.invoiceNo}</td>
                      <td className="px-3 py-2">
                        {pi.poNo || <span className="text-zinc-400">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        {pi.buyerName || (
                          <span className="text-zinc-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {new Date(pi.createdAt).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {(pi.currency || "USD") + " "}
                        {pi.subtotal.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 px-3 text-[11px]"
                            onClick={() =>
                              pi.poNo
                                ? router.push(
                                    `/po/create?poNo=${encodeURIComponent(
                                      pi.poNo
                                    )}`
                                  )
                                : alert("This Proforma has no linked PO No.")
                            }
                          >
                            Open PO
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            className="h-7 px-3 text-[11px]"
                            onClick={() => handleExportPdf(pi)}
                            disabled={exportingId === pi.id}
                          >
                            {exportingId === pi.id ? "Making PDF..." : "PDF"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
