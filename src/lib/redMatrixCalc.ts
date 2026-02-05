import { clampMin, toNumberSafe } from "@/lib/redNumber";

export type MatrixRow = Record<string, any>;

/**
 * v6.6 계산 규칙 (기본):
 * - FOB(CNY) = base_cost_cny * (1 + margin_percent/100)
 * - Offer(USD) = FOB(CNY) / fx_rate_cny_per_usd
 *
 * ✅ ADAPT ME:
 * - 프로젝트의 matrix row에 원가(CNY)가 어디에 있는지 키를 맞추세요.
 *   기본은 row.base_cost_cny (없으면 row.cost_cny도 시도)
 * - 결과는 row.fob_cny, row.offer_usd 로 세팅합니다.
 */
export function applyFxMarginToRows(
  rows: MatrixRow[],
  fx_rate_cny_per_usd: number,
  margin_percent: number
): MatrixRow[] {
  const fx = clampMin(fx_rate_cny_per_usd, 0.0000001);
  const m = margin_percent;

  return rows.map((row) => {
    const baseCost =
      toNumberSafe(row.base_cost_cny) ??
      toNumberSafe(row.cost_cny) ??
      toNumberSafe(row.total_cost_cny) ??
      0;

    const fob = baseCost * (1 + m / 100);
    const offer = fob / fx;

    return {
      ...row,
      fob_cny: fob,
      offer_usd: offer,
      fx_rate_snapshot: fx_rate_cny_per_usd,
      margin_snapshot: margin_percent,
      computed_at: new Date().toISOString(),
    };
  });
}
