export const RED_MOQS = [1000, 3000, 5000];
export type RedInputs = {
  unit_price_per_piece: number | null;
  unit_price_currency: "CNY" | "USD";
  fx_cny_per_usd: number | null;
  margin_pct: number | null;
};
export type RedCell = {
  package_code: string;
  pcs_per_pkg: number;
  moq_packages: number;
  price_fob_per_pkg: number | null;
  override_price_fob_per_pkg: number | null;
  offer_usd: number | null;
};
export type RedDocument = {
  inputs: RedInputs;
  packages: Record<
    string,
    {
      packaging_costs: { moq: number; packaging_cost_per_pkg: number | null }[];
      cells: RedCell[];
    }
  >;
  header: Record<string, any>;
};
export class RedError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
function amount(value: any, label: string): number | null {
  if (value === "" || value === null || value === undefined) return null;
  if (typeof value !== "number" && typeof value !== "string")
    throw new RedError(`${label}: 숫자를 입력해 주세요.`);
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1e10)
    throw new RedError(`${label}: 0 이상의 유효한 숫자를 입력해 주세요.`);
  return n;
}
export function offerUsd(raw: number | null, inputs: RedInputs): number | null {
  if (
    raw === null ||
    !Number.isFinite(raw) ||
    inputs.margin_pct === null ||
    inputs.margin_pct < 0 ||
    inputs.margin_pct >= 100
  )
    return null;
  const fx = inputs.unit_price_currency === "CNY" ? inputs.fx_cny_per_usd : 1;
  if (!fx || fx <= 0) return null;
  const offer =
    Math.round(
      (raw / fx / (1 - inputs.margin_pct / 100) + Number.EPSILON) * 100,
    ) / 100;
  return Number.isFinite(offer) && offer <= 1e12 ? offer : null;
}
export function normalizeRedDocument(body: any): RedDocument {
  const i = body?.inputs || {};
  const currency = String(i.unit_price_currency || "CNY").toUpperCase();
  if (!["CNY", "USD"].includes(currency))
    throw new RedError("지원하는 원가 통화는 CNY와 USD입니다.");
  const inputs: RedInputs = {
    unit_price_per_piece: amount(i.unit_price_per_piece, "개당 원가"),
    unit_price_currency: currency as "CNY" | "USD",
    fx_cny_per_usd: amount(i.fx_cny_per_usd, "환율"),
    margin_pct: amount(i.margin_pct, "매출총이익률"),
  };
  if (inputs.fx_cny_per_usd !== null && inputs.fx_cny_per_usd < 1e-8)
    throw new RedError("환율은 0.00000001 이상이어야 합니다.");
  if (inputs.margin_pct !== null && inputs.margin_pct >= 100)
    throw new RedError("매출총이익률은 100% 미만이어야 합니다.");
  if (
    !body?.packages ||
    typeof body.packages !== "object" ||
    Array.isArray(body.packages)
  )
    throw new RedError("패키지별 자료가 필요합니다.");
  const packages: RedDocument["packages"] = {};
  const entries = Object.entries(body.packages);
  if (!entries.length || entries.length > 20)
    throw new RedError("패키지는 1~20개여야 합니다.");
  for (const [code, value] of entries) {
    if (!/^[A-Z0-9_-]{1,20}$/.test(code))
      throw new RedError("유효하지 않은 패키지 코드입니다.");
    const p = value as any;
    if (
      !Array.isArray(p.cells) ||
      p.cells.length > 300 ||
      !Array.isArray(p.packaging_costs) ||
      p.packaging_costs.length > 300
    )
      throw new RedError("유효하지 않은 가격표입니다.");
    const seen = new Set<string>();
    const cells = p.cells
      .map((c: any): RedCell => {
        const pcs = Number(c.pcs_per_pkg),
          moq = Number(c.moq_packages);
        if (
          !Number.isInteger(pcs) ||
          pcs < 1 ||
          pcs > 1000 ||
          !Number.isInteger(moq) ||
          moq < 1 ||
          moq > 1e8
        )
          throw new RedError("PCS와 MOQ는 양의 정수여야 합니다.");
        const key = `${pcs}:${moq}`;
        if (seen.has(key))
          throw new RedError(`중복 가격 셀: ${code}/${pcs}/${moq}`);
        seen.add(key);
        const price = amount(c.price_fob_per_pkg, `${key} 원가`),
          override = amount(c.override_price_fob_per_pkg, `${key} 보정 원가`);
        return {
          package_code: code,
          pcs_per_pkg: pcs,
          moq_packages: moq,
          price_fob_per_pkg: price,
          override_price_fob_per_pkg: override,
          offer_usd: offerUsd(override ?? price, inputs),
        };
      })
      .sort(
        (a: RedCell, b: RedCell) =>
          a.pcs_per_pkg - b.pcs_per_pkg || a.moq_packages - b.moq_packages,
      );
    const moqs = new Set<number>();
    const packaging_costs = p.packaging_costs.map((r: any) => {
      const moq = Number(r.moq ?? r.moq_packages);
      if (!Number.isInteger(moq) || moq < 1 || moqs.has(moq))
        throw new RedError("포장비 MOQ가 잘못되었거나 중복입니다.");
      moqs.add(moq);
      return {
        moq,
        packaging_cost_per_pkg: amount(r.packaging_cost_per_pkg, "포장비"),
      };
    });
    packages[code] = { cells, packaging_costs };
  }
  return { inputs, packages, header: {} };
}
export function sortedVersions<T extends { version_no: number }>(
  versions: T[],
) {
  return [...versions].sort(
    (a, b) => Number(b.version_no) - Number(a.version_no),
  );
}
export function defaultRedVersion<
  T extends { version_no: number; status: string },
>(versions: T[]) {
  const sorted = sortedVersions(versions);
  return sorted.find((v) => v.status === "DRAFT") || sorted[0];
}
export function allRedCells(doc: RedDocument) {
  return Object.values(doc.packages).flatMap((p) => p.cells);
}
export function assertOfferReady(doc: RedDocument) {
  const cells = allRedCells(doc);
  const active = cells.filter(
    (c) =>
      c.override_price_fob_per_pkg !== null || c.price_fob_per_pkg !== null,
  );
  if (
    !active.length ||
    active.some((c) => c.offer_usd === null || c.offer_usd <= 0)
  )
    throw new RedError(
      "유효한 최종 USD 오퍼가 필요합니다. 환율·매출총이익률과 가격을 저장해 주세요.",
    );
}
