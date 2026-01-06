// src/config/permissions.ts
// JM ERP - Permission keys (single source of truth)

export const PERMISSIONS = [
  // ===== BASIC / ADMIN =====
  "users.manage",
  "roles.manage",
  "companies.manage",

  // ===== TRADE - PO =====
  "po.view",
  "po.create",
  "po.edit",
  "po.delete",

  // ===== TRADE - Proforma / Invoices / Packing =====
  "proforma.view",
  "proforma.create",
  "proforma.edit",
  "proforma.delete",

  "shipment.view",
  "shipment.create",
  "shipment.edit",
  "shipment.delete",

  "invoice.view",
  "invoice.create",
  "invoice.edit",
  "invoice.delete",

  "packing_list.view",
  "packing_list.create",
  "packing_list.edit",
  "packing_list.delete",

  "receipts.view",
  "receipts.create",
  "receipts.edit",
  "receipts.delete",

  // ===== DEVELOPMENT =====
  "dev.product.view",
  "dev.product.create",
  "dev.product.edit",
  "dev.product.delete",

  "dev.sample_requests.view",
  "dev.sample_requests.create",
  "dev.sample_requests.edit",
  "dev.sample_requests.delete",

  "dev.costings.view",
  "dev.costings.create",
  "dev.costings.edit",
  "dev.costings.delete",

  "dev.bom.view",
  "dev.bom.create",
  "dev.bom.edit",
  "dev.bom.delete",

  // ===== PRODUCTION =====
  "production_status.view",
  "production_status.export",

  "work_sheet.view",
  "work_sheet.create",
  "work_sheet.edit",
  "work_sheet.delete",
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number];

export const PERMISSION_GROUPS: Array<{
  group: string;
  items: PermissionKey[];
}> = [
  { group: "Admin", items: ["users.manage", "roles.manage", "companies.manage"] },
  { group: "Trade - PO", items: ["po.view", "po.create", "po.edit", "po.delete"] },
  {
    group: "Trade - Proforma",
    items: ["proforma.view", "proforma.create", "proforma.edit", "proforma.delete"],
  },
  {
    group: "Trade - Shipments",
    items: ["shipment.view", "shipment.create", "shipment.edit", "shipment.delete"],
  },
  {
    group: "Trade - Invoices",
    items: ["invoice.view", "invoice.create", "invoice.edit", "invoice.delete"],
  },
  {
    group: "Trade - Packing Lists",
    items: ["packing_list.view", "packing_list.create", "packing_list.edit", "packing_list.delete"],
  },
  {
    group: "Trade - Receipts",
    items: ["receipts.view", "receipts.create", "receipts.edit", "receipts.delete"],
  },
  {
    group: "Development",
    items: [
      "dev.product.view",
      "dev.product.create",
      "dev.product.edit",
      "dev.product.delete",
      "dev.sample_requests.view",
      "dev.sample_requests.create",
      "dev.sample_requests.edit",
      "dev.sample_requests.delete",
      "dev.costings.view",
      "dev.costings.create",
      "dev.costings.edit",
      "dev.costings.delete",
      "dev.bom.view",
      "dev.bom.create",
      "dev.bom.edit",
      "dev.bom.delete",
    ],
  },
  {
    group: "Production",
    items: [
      "production_status.view",
      "production_status.export",
      "work_sheet.view",
      "work_sheet.create",
      "work_sheet.edit",
      "work_sheet.delete",
    ],
  },
];

// role 기본값(“정석 A안” baseline)
export const ROLE_DEFAULT_PERMISSIONS: Record<string, PermissionKey[]> = {
  admin: [...PERMISSIONS],

  manager: [
    // trade
    "po.view",
    "po.create",
    "po.edit",
    "proforma.view",
    "proforma.create",
    "proforma.edit",
    "shipment.view",
    "shipment.create",
    "shipment.edit",
    "invoice.view",
    "invoice.create",
    "invoice.edit",
    "packing_list.view",
    "packing_list.create",
    "packing_list.edit",
    "receipts.view",
    "receipts.create",
    "receipts.edit",

    // dev
    "dev.product.view",
    "dev.product.create",
    "dev.product.edit",
    "dev.sample_requests.view",
    "dev.sample_requests.create",
    "dev.sample_requests.edit",
    "dev.costings.view",
    "dev.costings.create",
    "dev.costings.edit",
    "dev.bom.view",
    "dev.bom.create",
    "dev.bom.edit",

    // production
    "production_status.view",
    "production_status.export",
    "work_sheet.view",
    "work_sheet.create",
    "work_sheet.edit",
  ],

  staff: [
    // mostly view
    "po.view",
    "proforma.view",
    "shipment.view",
    "invoice.view",
    "packing_list.view",
    "receipts.view",

    "dev.product.view",
    "dev.sample_requests.view",
    "dev.costings.view",
    "dev.bom.view",

    "production_status.view",
    "work_sheet.view",
  ],

  // user_profiles default가 viewer라서 넣어둠
  viewer: ["po.view", "shipment.view", "invoice.view", "packing_list.view"],
};
