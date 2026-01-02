// src/app/proforma/[id]/page.tsx
"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";

// jsPDF + autoTable 추가
import jsPDF from "jspdf";
// 타입 경고 방지용
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import autoTable from "jspdf-autotable";

export default function PIViewPage({ params }: any) {
  const supabase = createSupabaseBrowserClient();
  const { id } = params;

  const [header, setHeader] = useState<any>(null);
  const [lines, setLines] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // 숫자 포맷 헬퍼들
  const formatQty = (v: any) =>
    new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 0,
    }).format(Number(v || 0));

  const formatAmount = (v: any) =>
    new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(v || 0));

  // Unit Price: 소수점 2자리 + 천단위 콤마
  const formatUnitPrice = (v: any) => {
    const n = Number(v || 0);
    const intPart = Math.trunc(n).toString();
    const dec = Math.round((n - Math.trunc(n)) * 100);
    const decStr = dec.toString().padStart(2, "0");
    const intWithComma = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `${intWithComma}.${decStr}`;
  };

  useEffect(() => {
    const load = async () => {
      // 헤더
      const { data: h } = await supabase
        .from("proforma_invoices")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      // 라인
      const { data: l } = await supabase
        .from("proforma_invoice_lines")
        .select("*")
        .eq("proforma_invoice_id", id)
        .order("line_no", { ascending: true });

      setHeader(h);
      setLines(l || []);
      setLoading(false);
    };

    load();
  }, [id, supabase]);

  if (loading) return <div className="p-6">Loading...</div>;
  if (!header) return <div className="p-6 text-red-500">PI Not Found</div>;

  const totalDisplay = formatAmount(header.total_amount || 0);

  // 🔹 인쇄창 대신 jsPDF로 바로 PDF 다운로드
  const handleDownloadPdf = () => {
    if (!header) return;

    const doc = new jsPDF("p", "mm", "a4");
    const pageWidth = doc.internal.pageSize.getWidth();
    const marginLeft = 15;
    let cursorY = 15;

    // Title
    doc.setFontSize(16);
    doc.text("Proforma Invoice", pageWidth / 2, cursorY, {
      align: "center",
    });

    // 기본 정보
    cursorY += 8;
    doc.setFontSize(10);
    const invoiceNo = header.invoice_no || "";
    const dateText = header.issue_date
      ? String(header.issue_date).slice(0, 10)
      : "-";
    const totalText = `${formatAmount(
      header.total_amount || 0
    )} ${header.currency || "USD"}`;

    doc.text(`Invoice No: ${invoiceNo}`, marginLeft, cursorY);
    doc.text(`Date: ${dateText}`, pageWidth - marginLeft, cursorY, {
      align: "right",
    });

    cursorY += 6;
    doc.text(`Total: ${totalText}`, marginLeft, cursorY);

    // 테이블 헤더/바디 준비
    cursorY += 10;

    const tableHead = [
      [
        "Line",
        "Style",
        "Description",
        "Color",
        "Size",
        "Qty",
        "Unit Price",
        "Amount",
      ],
    ];

    const tableBody = lines.map((l) => {
      const styleNo =
        l.style_no || l.buyer_style_no || l.jm_style_no || "";

      return [
        l.line_no ?? "",
        styleNo,
        l.description || "",
        l.color || "",
        l.size || "",
        formatQty(l.qty),
        formatUnitPrice(l.unit_price),
        formatAmount(l.amount),
      ];
    });

    // autoTable로 라인 아이템 테이블 생성
    // @ts-ignore
    autoTable(doc, {
      startY: cursorY,
      head: tableHead,
      body: tableBody,
      styles: {
        fontSize: 8,
      },
      headStyles: {
        fontStyle: "bold",
      },
      columnStyles: {
        0: { cellWidth: 10 }, // Line
        1: { cellWidth: 25 }, // Style
        2: { cellWidth: 60 }, // Description
        3: { cellWidth: 18 }, // Color
        4: { cellWidth: 15 }, // Size
        5: { cellWidth: 15 }, // Qty
        6: { cellWidth: 22 }, // Unit Price
        7: { cellWidth: 25 }, // Amount
      },
    });

    const fileName = invoiceNo ? `${invoiceNo}.pdf` : "proforma.pdf";
    doc.save(fileName);
  };

  return (
    <div className="p-6 space-y-6">
      {/* 상단 제목 + 버튼 */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">
          Proforma Invoice: {header.invoice_no}
        </h1>

        {/* 🔽 여기 버튼이 이제 jsPDF 다운로드 호출 */}
        <Button onClick={handleDownloadPdf}>Download PDF</Button>
      </div>

      {/* 요약 박스 */}
      <div className="border p-4 rounded-md bg-gray-50 space-y-1">
        <p>
          <b>Total:</b> {totalDisplay} {header.currency || "USD"}
        </p>
        <p>
          <b>Date:</b>{" "}
          {header.issue_date ? String(header.issue_date).slice(0, 10) : "-"}
        </p>
      </div>

      {/* 라인 테이블 (화면용) */}
      <table className="w-full border text-sm">
        <thead className="bg-gray-100">
          <tr>
            <th className="p-3 text-left w-[6%]">Line</th>
            <th className="p-3 text-left w-[14%]">Style</th>
            <th className="p-3 text-left w-[30%]">Description</th>
            <th className="p-3 text-left w-[10%]">Color</th>
            <th className="p-3 text-left w-[8%]">Size</th>
            <th className="p-3 text-right w-[10%]">Qty</th>
            <th className="p-3 text-right w-[11%]">Unit Price</th>
            <th className="p-3 text-right w-[11%]">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const styleNo =
              l.style_no || l.buyer_style_no || l.jm_style_no || "";

            return (
              <tr key={l.id} className="border-b">
                <td className="p-3">{l.line_no}</td>
                <td className="p-3">{styleNo}</td>
                <td className="p-3">{l.description}</td>
                <td className="p-3">{l.color}</td>
                <td className="p-3">{l.size}</td>
                <td className="p-3 text-right">{formatQty(l.qty)}</td>
                <td className="p-3 text-right">
                  {formatUnitPrice(l.unit_price)}
                </td>
                <td className="p-3 text-right">
                  {formatAmount(l.amount)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
