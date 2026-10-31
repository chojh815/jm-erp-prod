import { RedError, type RedDocument } from "@/lib/redQuoteDocument";
export function commercialRedData(
  document: RedDocument,
  version: { version_no: number; status: string },
  packageCode: string,
) {
  const p = document.packages[packageCode];
  if (!p) throw new RedError("패키지를 찾을 수 없습니다.", 404);
  const active = p.cells.filter(
    (c) =>
      c.price_fob_per_pkg !== null || c.override_price_fob_per_pkg !== null,
  );
  if (
    !active.length ||
    active.some((c) => c.offer_usd === null || c.offer_usd <= 0)
  )
    throw new RedError(
      "출력할 최종 USD 오퍼가 없습니다. 환율·매출총이익률과 가격을 확인하고 저장해 주세요.",
      409,
    );
  const h = document.header;
  return {
    quotationNo: h.red_quotation_no || "",
    title: h.title || "",
    buyer: h.buyer_name || "",
    style: h.style_no || "",
    shipFrom: h.ship_from_code || "",
    incoterm: h.incoterm || "FOB",
    currency: "USD",
    date: h.quotation_date || "",
    versionNo: version.version_no,
    status: version.status,
    packageCode,
    rows: active.map((c) => ({
      pcs: c.pcs_per_pkg,
      moq: c.moq_packages,
      offerUsd: c.offer_usd!,
    })),
  };
}
