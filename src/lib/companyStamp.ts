export type CompanyStampFormat = "PNG" | "JPEG";

export type CompanyStamp = {
  publicPath: string;
  format: CompanyStampFormat;
  companyName: string;
  boxW: number;
  boxH: number;
};

function normalizeOriginCode(originCode?: string | null) {
  return String(originCode ?? "").trim().toUpperCase();
}

export function isChinaOrigin(originCode?: string | null) {
  const origin = normalizeOriginCode(originCode);
  return (
    origin.startsWith("CN") ||
    origin.includes("CHINA") ||
    origin.includes("QINGDAO")
  );
}

export function getCompanyStampByOrigin(originCode?: string | null): CompanyStamp {
  if (isChinaOrigin(originCode)) {
    return {
      publicPath: "/images/stamp_cn.png",
      format: "PNG",
      companyName: "JM International Co.,Ltd",
      boxW: 60,
      boxH: 34,
    };
  }

  return {
    publicPath: "/images/jm_stamp_vn.jpg",
    format: "JPEG",
    companyName: "JM International Co.,Ltd",
    boxW: 60,
    boxH: 30,
  };
}
