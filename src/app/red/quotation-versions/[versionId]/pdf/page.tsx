import React from "react";
import PrintButton from "./PrintButton";
import { redActor, readRedDocument } from "@/lib/redQuoteServer";
import { commercialRedData } from "@/lib/redQuoteExport";
export const dynamic = "force-dynamic";
export default async function RedQuotationVersionPdfPage({
  params,
  searchParams,
}: {
  params: { versionId: string };
  searchParams: { package?: string };
}) {
  try {
    await redActor();
    const s = await readRedDocument(params.versionId),
      d = commercialRedData(
        s.document,
        s.version,
        String(searchParams.package || "A").toUpperCase(),
      );
    return (
      <main className="mx-auto max-w-4xl space-y-4 p-8 text-sm">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold">QUOTATION</h1>
            <p>
              {d.quotationNo} · v{d.versionNo} · {d.status}
            </p>
          </div>
          <div className="print:hidden">
            <PrintButton />
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-2">
          <div>Buyer: {d.buyer}</div>
          <div>Date: {d.date}</div>
          <div>Title: {d.title}</div>
          <div>Style: {d.style}</div>
          <div>Ship From: {d.shipFrom}</div>
          <div>Terms: {d.incoterm} · USD / pkg</div>
        </dl>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {["Package", "PCS / PKG", "MOQ (PKG)", "Offer (USD / PKG)"].map(
                (h) => (
                  <th key={h} className="border p-2 text-left">
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {d.rows.map((r) => (
              <tr key={r.pcs + ":" + r.moq}>
                <td className="border p-2">{d.packageCode}</td>
                <td className="border p-2">{r.pcs}</td>
                <td className="border p-2">{r.moq.toLocaleString()}</td>
                <td className="border p-2 text-right">
                  {r.offerUsd.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    );
  } catch (e: any) {
    return (
      <main className="p-8">
        <h1 className="text-lg font-semibold">견적을 출력할 수 없습니다.</h1>
        <p className="mt-2 text-sm">{e.message}</p>
      </main>
    );
  }
}
