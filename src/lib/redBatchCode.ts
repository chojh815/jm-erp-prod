// KISS Batch Management 4.0. Calendar calculations use date-only UTC values.
const YEAR_CODES = "PQRSTUVWXYZABCDEFGHIJK"; // ISO week-years 2016–2037
const DAY_CODES = ["ABCDEFG", "HJKLNPQ", "RSTUWXY"];
export const RED_BATCH_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type RedBatchInput = {
  vendorInitial?: string;
  mfgDate: string | Date;
  labelType?: string;
  runNo?: number;
  version?: number;
};

export function redBatchDetails(args: RedBatchInput) {
  const dateText =
    args.mfgDate instanceof Date
      ? Number.isNaN(args.mfgDate.getTime())
        ? ""
        : args.mfgDate.toISOString().slice(0, 10)
      : args.mfgDate;
  if (typeof dateText !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateText))
    throw new Error("생산 시작일을 YYYY-MM-DD 형식으로 입력해 주세요.");
  const date = new Date(dateText + "T00:00:00Z");
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== dateText
  )
    throw new Error("유효한 생산 시작일을 입력해 주세요.");

  const vendor = (args.vendorInitial ?? "J").trim().toUpperCase();
  if (!/^[A-Z]$/.test(vendor))
    throw new Error("KISS 업체코드는 영문 한 글자입니다.");
  const labelType = (args.labelType ?? "").trim().toUpperCase();
  if (!["V", "M"].includes(labelType))
    throw new Error("제품 유형 V 또는 M을 선택해 주세요.");
  const runNo = args.runNo ?? 1;
  if (!Number.isInteger(runNo) || runNo < 1 || runNo > 3)
    throw new Error("동일 SKU의 당일 생산 차수는 1~3차를 선택해 주세요.");
  const version = args.version ?? 0;
  if (!Number.isInteger(version) || version < 0 || version > 9)
    throw new Error("라벨 수정 버전은 0~9입니다.");

  const weekday = (date.getUTCDay() + 6) % 7; // Monday = 0
  const thursday = new Date(date);
  thursday.setUTCDate(date.getUTCDate() + 3 - weekday);
  const isoYear = thursday.getUTCFullYear();
  if (isoYear < 2016 || isoYear > 2037)
    throw new Error("지원하는 ISO 연도는 2016~2037입니다.");
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const isoWeek = Math.ceil(
    ((thursday.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  const yearCode = YEAR_CODES[isoYear - 2016];
  const dayCode = DAY_CODES[runNo - 1][weekday];
  const weekCode = String(isoWeek).padStart(2, "0");
  return {
    batchCode: `${vendor}${yearCode}${weekCode}${dayCode}${labelType}${version}`,
    isoYear,
    isoWeek,
    yearCode,
    dayCode,
    vendor,
    labelType,
    runNo,
    version,
    weekday: ["월", "화", "수", "목", "금", "토", "일"][weekday],
  };
}

export function makeRedBatchCode(args: RedBatchInput) {
  return redBatchDetails(args).batchCode;
}
