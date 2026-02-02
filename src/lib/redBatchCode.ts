// src/lib/redBatchCode.ts
// RED buyer only batch code: J + YEAR_CODE + WEEK(2) + DAY_CODE + LABEL_TYPE + VERSION

const YEAR_CODE: Record<number, string> = {
  2016: "P",
  2017: "Q",
  2018: "R",
  2019: "S",
  2020: "T",
  2021: "U",
  2022: "V",
  2023: "W",
  2024: "X",
  2025: "Y",
  2026: "Z",
  2027: "A",
  2028: "B",
  2029: "C",
  2030: "D",
  2031: "E",
  2032: "F",
  2033: "G",
  2034: "H",
  2035: "I",
  2036: "J",
  2037: "K",
};

function dayCode(d: Date): string {
  const js = d.getDay(); // 0=Sun..6=Sat
  const map: Record<number, string> = {
    1: "A",
    2: "B",
    3: "C",
    4: "D",
    5: "E",
    6: "F",
    0: "G",
  };
  return map[js];
}

function weekOfYear52(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 1);
  const diffDays = Math.floor((date.getTime() - start.getTime()) / 86400000) + 1; // 1-based
  let week = Math.ceil(diffDays / 7);
  if (week < 1) week = 1;
  if (week > 52) week = 52;
  return week;
}

export function makeRedBatchCode(args: {
  vendorInitial?: string; // default "J"
  mfgDate: string | Date; // YYYY-MM-DD recommended
  labelType?: string; // default "M"
  version?: number; // default 0
}) {
  const vendor = (args.vendorInitial ?? "J").trim().toUpperCase();
  if (!vendor || vendor.length !== 1) throw new Error("vendorInitial must be 1 letter.");

  const d = typeof args.mfgDate === "string" ? new Date(`${args.mfgDate}T00:00:00`) : args.mfgDate;
  if (Number.isNaN(d.getTime())) throw new Error("Invalid mfgDate.");

  const year = d.getFullYear();
  const y = YEAR_CODE[year];
  if (!y) throw new Error(`No YEAR_CODE mapping for year ${year}. Extend YEAR_CODE.`);

  const week2 = String(weekOfYear52(d)).padStart(2, "0");
  const day = dayCode(d);

  const labelType = (args.labelType ?? "M").trim().toUpperCase() || "M";

  const v = typeof args.version === "number" && Number.isFinite(args.version) ? Math.floor(args.version) : 0;
  if (v < 0) throw new Error("version must be >= 0.");

  return `${vendor}${y}${week2}${day}${labelType}${v}`;
}
