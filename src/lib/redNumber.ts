export function format2(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "";
  return Number(n).toFixed(2);
}

export function toNumberSafe(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

export function clampMin(n: number, min: number): number {
  return n < min ? min : n;
}
