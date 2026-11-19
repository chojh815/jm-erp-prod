export type RedBatchManufacturingOrigin = "CN" | "VN";
// KISS vendor assignments confirmed by the user: China Q, Vietnam J.
export const RED_BATCH_MANUFACTURERS = [
  { origin: "CN" as const, label: "중국 · Qingdao JM", vendorInitial: "Q" },
  { origin: "VN" as const, label: "베트남 · JM Vietnam", vendorInitial: "J" },
];
export function redBatchManufacturer(origin: string | null | undefined) {
  const normalized = (origin || "").trim().toUpperCase();
  return (
    RED_BATCH_MANUFACTURERS.find((item) => item.origin === normalized) || null
  );
}
export function redBatchManufacturerFromPo(po: {
  shipping_origin_code?: string | null;
  origin_code?: string | null;
}) {
  for (const code of [po.shipping_origin_code, po.origin_code]) {
    const normalized = (code || "").trim().toUpperCase();
    if (["CN", "CHINA", "CN_QINGDAO", "CN_JIAOZHOU"].includes(normalized))
      return redBatchManufacturer("CN");
    if (["VN", "VIETNAM", "VN_BACNINH"].includes(normalized))
      return redBatchManufacturer("VN");
  }
  return null;
}
