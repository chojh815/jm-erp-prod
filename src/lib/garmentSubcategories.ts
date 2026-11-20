export const garmentSubcategories = {
  HAT_CAP: "Hat / Cap",
  SOCKS: "Socks",
  T_SHIRT: "T-shirt",
  PANTS: "Pants",
  OTHER: "Other",
} as const;

export type GarmentSubcategory = keyof typeof garmentSubcategories;

export function isGarmentSubcategory(value: unknown): value is GarmentSubcategory {
  return typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(garmentSubcategories, value);
}
