export const RED_MOQS = [1000, 3000, 5000] as const;
export const RED_PCS_PRESET = [3, 4, 6, 10, 12, 14] as const;

export type Moq = typeof RED_MOQS[number];

export function clampInt(v: number, min: number, max: number) {
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.trunc(v)));
}

export function fmtDelta(n: number) {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}`;
}

export type MatrixCell = {
  package_code: string;
  pcs_per_pkg: number;
  moq_packages: number;
  price_fob_per_pkg: number | null;
};

export type DiffCell =
  | { state: "SAME"; base: number | null; target: number | null; delta: 0 }
  | { state: "UP"; base: number; target: number; delta: number }
  | { state: "DOWN"; base: number; target: number; delta: number }
  | { state: "NEW"; base: null; target: number | null; delta: null }
  | { state: "REMOVED"; base: number | null; target: null; delta: null };

export function keyOf(packageCode: string, pcs: number, moq: number) {
  return `${packageCode}::${pcs}::${moq}`;
}

export function buildIndex(cells: MatrixCell[]) {
  const m = new Map<string, MatrixCell>();
  for (const c of cells) m.set(keyOf(c.package_code, c.pcs_per_pkg, c.moq_packages), c);
  return m;
}

export function unionPCS(base: MatrixCell[], target: MatrixCell[]) {
  const s = new Set<number>();
  for (const c of base) s.add(c.pcs_per_pkg);
  for (const c of target) s.add(c.pcs_per_pkg);
  return Array.from(s.values()).sort((a, b) => a - b);
}

export function diffCell(base: MatrixCell | undefined, target: MatrixCell | undefined): DiffCell {
  const b = base?.price_fob_per_pkg ?? null;
  const t = target?.price_fob_per_pkg ?? null;

  if (base && !target) return { state: "REMOVED", base: b, target: null, delta: null };
  if (!base && target) return { state: "NEW", base: null, target: t, delta: null };
  if (b === null && t === null) return { state: "SAME", base: null, target: null, delta: 0 };

  if (typeof b === "number" && typeof t === "number") {
    const d = +(t - b).toFixed(4);
    if (d === 0) return { state: "SAME", base: b, target: t, delta: 0 };
    if (d > 0) return { state: "UP", base: b, target: t, delta: d };
    return { state: "DOWN", base: b, target: t, delta: d };
  }

  // one side null, other number => treat as change
  if (b === null && typeof t === "number") return { state: "NEW", base: null, target: t, delta: null };
  if (typeof b === "number" && t === null) return { state: "REMOVED", base: b, target: null, delta: null };

  return { state: "SAME", base: b, target: t, delta: 0 };
}

export function isChanged(d: DiffCell) {
  return d.state !== "SAME";
}
