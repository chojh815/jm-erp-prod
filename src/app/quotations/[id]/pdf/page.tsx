import React from "react";
import { quoteActor, readQuote } from "@/lib/generalQuoteServer";
import { commercialQuote } from "@/lib/generalQuoteRules";
import PrintButton from "@/app/red/quotation-versions/[versionId]/pdf/PrintButton";
export const dynamic = "force-dynamic";
export default async function QuotationPdf({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { version_id?: string };
}) {
  try {
    await quoteActor();
    const s = await readQuote(params.id, searchParams.version_id),
      d = commercialQuote(
        s.document,
        s.quotation.quotation_no,
        s.version.version_no,
        s.version.status,
      );
    return (
      <main className="mx-auto max-w-5xl space-y-4 p-8 text-sm">
        <div className="flex justify-between">
          <div>
            <h1 className="text-2xl font-semibold">QUOTATION</h1>
            <p>
              {d.quotation_no} · v{d.version_no} · {d.status}
            </p>
          </div>
          <div className="print:hidden">
            <PrintButton />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <p>Buyer: {d.buyer_name}</p>
          <p>Date: {d.quotation_date}</p>
          <p>Subject: {d.subject}</p>
          <p>Brand: {d.brand}</p>
          <p>Terms: {d.incoterm}</p>
          <p>
            Currency: {d.currency} · Valid Until: {d.valid_until}
          </p>
        </div>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {[
                "Style / Description",
                "Qty / Unit",
                "Offer / Unit",
                "Amount",
              ].map((h) => (
                <th key={h} className="border p-2 text-left">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l, i) => (
              <React.Fragment key={i}>
                <tr>
                  <td className="border p-2">
                    <strong>{l.style_no}</strong>
                    <div>{l.description}</div>
                    <div>{l.remarks}</div>
                    {s.files
                      .filter(
                        (f: any) =>
                          f.quotation_line_id === s.document.lines[i].id &&
                          /\.(png|jpe?g|webp)$/i.test(f.file_name),
                      )
                      .slice(0, 1)
                      .map((f: any) => (
                        <img
                          key={f.id}
                          alt={l.style_no}
                          className="mt-2 max-h-24 max-w-32 object-contain"
                          src={
                            "/api/quotations/" +
                            params.id +
                            "/files?version_id=" +
                            s.version.id +
                            "&file_id=" +
                            f.id
                          }
                        />
                      ))}
                  </td>
                  <td className="border p-2">
                    {l.qty} {l.unit}
                  </td>
                  <td className="border p-2">{String(l.offer_price)}</td>
                  <td className="border p-2">{l.amount.toFixed(2)}</td>
                </tr>
                {l.tiers.map((t, j) => (
                  <tr key={j}>
                    <td className="border p-2">
                      MOQ · {t.ship_from} · {t.remarks}
                    </td>
                    <td className="border p-2">
                      {t.qty} {l.unit}
                    </td>
                    <td className="border p-2">{String(t.offer_price)}</td>
                    <td className="border p-2">—</td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
        <p className="text-right font-semibold">
          Total: {d.currency}{" "}
          {d.lines.reduce((n, l) => n + l.amount, 0).toFixed(2)}
        </p>
        <p>Remarks: {d.remarks}</p>
      </main>
    );
  } catch (e: any) {
    return (
      <main className="p-8">
        <h1>견적을 출력할 수 없습니다.</h1>
        <p>{e.message}</p>
      </main>
    );
  }
}
