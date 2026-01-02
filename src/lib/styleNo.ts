// src/lib/styleNo.ts

export type StyleCategoryCode =
  | "N"
  | "E"
  | "B"
  | "K"
  | "A"
  | "R"
  | "H"
  | "S"
  | "O";

/** 카테고리에서 프리픽스(JN, JE, ...) 생성 */
export function getStylePrefix(category: StyleCategoryCode): string {
  return `J${category}`;
}

/** JM 스타일 번호 생성: J + 카테고리 + YY + 4자리 + (선택) 색상 suffix */
export function buildStyleNo(
  category: StyleCategoryCode,
  yearYY: string,
  seq: number,
  colorSuffix?: string
): string {
  const prefix = getStylePrefix(category);
  const seqStr = String(seq).padStart(4, "0");
  const base = `${prefix}${yearYY}${seqStr}`;
  if (colorSuffix && colorSuffix.trim()) {
    return `${base}${colorSuffix.trim().toUpperCase()}`;
  }
  return base;
}

/** 스타일 번호 형식 체크: JN250001, JN250001A 등 */
export function isValidStyleNo(styleNo: string): boolean {
  if (!styleNo) return false;
  const s = styleNo.trim().toUpperCase();
  // J + 카테고리 + YY + 4자리 + 선택 1글자 suffix
  return /^J[NEBRHKASO][0-9]{2}[0-9]{4}[A-Z]?$/.test(s);
}

/** (필요하면) 파싱용 */
export function parseStyleNo(styleNo: string) {
  const s = styleNo.trim().toUpperCase();
  if (!/^J[NEBRHKASO][0-9]{2}[0-9]{4}[A-Z]?$/.test(s)) return null;
  const category = s[1] as StyleCategoryCode;
  const yearYY = s.slice(2, 4);
  const seq = Number(s.slice(4, 8));
  const colorSuffix = s.length > 8 ? s.slice(8) : "";
  return { category, yearYY, seq, colorSuffix };
}
