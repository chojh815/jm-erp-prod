"use client";

import * as React from "react";
import Link from "next/link";

import {
  fmtCny,
  processTypeLabel,
  type ProductionOrderDetail,
} from "@/lib/productionOrders";

export default function ProductionOrderPrintPage({
  params,
}: {
  params: { id: string };
}) {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [detail, setDetail] = React.useState<ProductionOrderDetail | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        const res = await fetch(`/api/production/purchase-orders/${params.id}`, {
          cache: "no-store",
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) {
          throw new Error(json?.error || "Failed to load print data");
        }
        if (!cancelled) setDetail(json);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load print data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  const header = detail?.header;
  const lines = detail?.lines || [];
  const referenceImages = (header?.reference_images || []).filter((item) => item?.url);

  return (
    <div className="min-h-screen bg-slate-200 py-6 print:bg-white print:py-0">
      <style jsx global>{`
        @page {
          size: A4 portrait;
          margin: 12mm;
        }
        @media print {
          .po-print-actions {
            display: none !important;
          }
          body {
            background: #ffffff !important;
          }
        }
      `}</style>

      <div className="po-print-actions mx-auto mb-4 flex w-[210mm] max-w-full items-center justify-between gap-3 px-2">
        <div className="text-sm text-slate-600">Printable production order</div>
        <div className="flex gap-2">
          <Link
            href={`/production/purchase-orders/${params.id}`}
            className="inline-flex h-9 items-center rounded-md border border-slate-300 bg-white px-4 text-sm hover:bg-slate-50"
          >
            Back
          </Link>
          <button
            className="inline-flex h-9 items-center rounded-md bg-slate-900 px-4 text-sm text-white hover:bg-slate-800"
            onClick={() => window.print()}
          >
            Print / Save PDF
          </button>
        </div>
      </div>

      <div className="mx-auto w-[210mm] max-w-full bg-white px-[12mm] py-[12mm] shadow print:shadow-none">
        {loading ? (
          <div className="py-24 text-center text-sm text-slate-500">Loading...</div>
        ) : error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : !header ? (
          <div className="py-24 text-center text-sm text-slate-500">No print data</div>
        ) : (
          <div className="space-y-6 text-[12px] text-slate-800">
            <div className="flex items-start justify-between border-b border-slate-300 pb-4">
              <div>
                <div className="text-[14px] font-semibold tracking-[0.04em] text-slate-500">
                  JM INTERNATIONAL ERP
                </div>
                <div className="mt-2 text-[28px] font-bold text-slate-950">
                  生产订单
                </div>
                <div className="text-[14px] font-semibold text-slate-600">
                  PRODUCTION ORDER
                </div>
              </div>
              <div className="w-[72mm] space-y-1 text-right">
                <div>
                  <span className="font-semibold">订单号 / Order No:</span> {header.order_no}
                </div>
                <div>
                  <span className="font-semibold">日期 / Date:</span> {header.order_date || "-"}
                </div>
                <div>
                  <span className="font-semibold">币种 / Currency:</span> {header.currency || "CNY"}
                </div>
                <div>
                  <span className="font-semibold">状态 / Status:</span> {header.status}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-md border border-slate-300 p-3">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Supplier Information
                </div>
                <div><span className="font-semibold">供应商 / Supplier:</span> {header.vendor_name || "-"}</div>
                <div><span className="font-semibold">联系人 / Contact:</span> {header.supplier_contact || "-"}</div>
                <div><span className="font-semibold">交期 / Delivery Date:</span> {header.delivery_date || "-"}</div>
              </div>
              <div className="rounded-md border border-slate-300 p-3">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  References
                </div>
                <div><span className="font-semibold">客户PO / Buyer PO:</span> {header.buyer_po_ref || "-"}</div>
                <div><span className="font-semibold">Work Sheet:</span> {header.work_sheet_ref || "-"}</div>
                <div><span className="font-semibold">付款条件 / Payment Terms:</span> {header.payment_terms || "-"}</div>
              </div>
            </div>

            <div className="rounded-md border border-slate-300 p-3">
              <div className="font-semibold">交货地址 / Delivery Address</div>
              <div className="mt-1 min-h-8 whitespace-pre-wrap text-slate-700">
                {header.delivery_address || "-"}
              </div>
            </div>

            {referenceImages.length ? (
              <div className="rounded-md border border-slate-300 bg-slate-50/70 p-3">
                <div className="mb-3 text-[12px] font-semibold">
                  参考图片 / Reference Images
                </div>
                <div className="grid grid-cols-4 gap-3">
                  {referenceImages.map((image, index) => (
                    <div key={`${image.url}-${index}`} className="rounded-md border border-slate-300 bg-white p-2">
                      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded border border-slate-200 bg-slate-50">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={image.url}
                          alt={image.caption || `Reference ${index + 1}`}
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <div className="mt-2 text-center text-[10px] font-medium text-slate-600">
                        {image.caption || `Reference ${index + 1}`}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-slate-100 text-left text-[11px] font-semibold text-slate-700">
                  <th className="border border-slate-300 px-2 py-2">#</th>
                  <th className="border border-slate-300 px-2 py-2">工序 / Process</th>
                  <th className="border border-slate-300 px-2 py-2">说明 / Description</th>
                  <th className="border border-slate-300 px-2 py-2 text-right">数量 / Qty</th>
                  <th className="border border-slate-300 px-2 py-2">单位 / Unit</th>
                  <th className="border border-slate-300 px-2 py-2 text-right">单价 / Unit Price</th>
                  <th className="border border-slate-300 px-2 py-2 text-right">金额 / Amount</th>
                  <th className="border border-slate-300 px-2 py-2">备注 / Remarks</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => (
                  <tr key={line.id}>
                    <td className="border border-slate-300 px-2 py-2 align-top">{index + 1}</td>
                    <td className="border border-slate-300 px-2 py-2 align-top">
                      {processTypeLabel(line.process_type)}
                    </td>
                    <td className="border border-slate-300 px-2 py-2 align-top whitespace-pre-wrap">
                      {line.description || "-"}
                    </td>
                    <td className="border border-slate-300 px-2 py-2 text-right align-top">
                      {Number(line.qty || 0).toLocaleString()}
                    </td>
                    <td className="border border-slate-300 px-2 py-2 align-top">{line.unit || "-"}</td>
                    <td className="border border-slate-300 px-2 py-2 text-right align-top">
                      {fmtCny(Number(line.unit_price || 0))}
                    </td>
                    <td className="border border-slate-300 px-2 py-2 text-right align-top">
                      {fmtCny(Number(line.amount || 0))}
                    </td>
                    <td className="border border-slate-300 px-2 py-2 align-top whitespace-pre-wrap">
                      {line.remarks || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex justify-end">
              <div className="w-[72mm] rounded-md border border-slate-300">
                <div className="flex items-center justify-between border-b border-slate-300 px-3 py-2">
                  <span className="font-semibold">总金额 / Total Amount</span>
                  <span className="font-semibold text-slate-950">
                    {fmtCny(Number(header.subtotal_amount || 0))}
                  </span>
                </div>
                <div className="flex items-center justify-between px-3 py-2 text-[11px] text-slate-600">
                  <span>JM供料 / Material supplied by JM</span>
                  <span>{header.material_supplied_by_jm ? "YES" : "NO"}</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-md border border-slate-300 p-3">
                <div className="font-semibold">特别说明 / Special Instructions</div>
                <div className="mt-2 min-h-16 whitespace-pre-wrap text-slate-700">
                  {header.special_instructions || "-"}
                </div>
              </div>
              <div className="rounded-md border border-slate-300 p-3">
                <div className="font-semibold">备注 / Notes</div>
                <div className="mt-2 min-h-16 whitespace-pre-wrap text-slate-700">
                  {header.notes || "-"}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 pt-4">
              <div className="rounded-md border border-slate-300 p-3">
                <div className="font-semibold">制单 / Prepared By</div>
                <div className="mt-10 border-t border-dashed border-slate-300 pt-2">
                  {header.prepared_by || " "}
                </div>
              </div>
              <div className="rounded-md border border-slate-300 p-3">
                <div className="font-semibold">批准 / Approved By</div>
                <div className="mt-10 border-t border-dashed border-slate-300 pt-2">
                  {header.approved_by || " "}
                </div>
              </div>
              <div className="rounded-md border border-slate-300 p-3">
                <div className="font-semibold">供应商确认 / Supplier Confirmation</div>
                <div className="mt-10 border-t border-dashed border-slate-300 pt-2">
                  {header.supplier_confirmation || " "}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
