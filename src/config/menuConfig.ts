// src/config/menuConfig.ts

export type AppRole = "admin" | "manager" | "staff" | "viewer";

/**
 * 메뉴 아이템
 * - perm 이 없으면: 로그인한 모든 사용자에게 표시
 * - perm 이 있으면: 해당 permission 보유 시에만 표시
 */
export interface MenuItem {
  label: string;
  href: string;
  perm?: string | string[]; // ✅ 핵심 변경
}

export interface MenuSection {
  label: string;
  items: MenuItem[];
}

/**
 * ✅ permission 기반 메뉴 정의
 * Sidebar에서는 usePermissions().has(item.perm) 으로 필터링
 */
export const MENU_SECTIONS: MenuSection[] = [
  {
    label: "Home",
    items: [{ label: "Home", href: "/home", perm: "home.view" }],
  },

  {
    label: "Basic",
    items: [
      { label: "Users", href: "/users", perm: "users.manage" },
      { label: "Companies", href: "/companies", perm: "companies.manage" },
      {
        label: "Roles & Permissions",
        href: "/roles",
        perm: "roles.manage",
      },
    ],
  },

  {
    label: "Development",
    items: [
      {
        label: "Product Development",
        href: "/dev/product-register",
        perm: "dev.samples.view",
      },
      {
        label: "Costings",
        href: "/costings",
        perm: "dev.costings.view",
      },
      {
        label: "Quotations",
        href: "/quotations",
        // Quotation은 Costing에서 생성되는 결과물.
        // 권한명이 아직 확정되지 않았으므로, 우선 Costings와 동일 권한으로 노출.
        perm: "dev.costings.view",
      },
      {
        label: "BOM Library",
        href: "/dev/bom-library",
        perm: "dev.bom.view",
      },
    ],
  },

  {
    label: "Trade",
    items: [
      { label: "Create PO", href: "/po/create", perm: "po.create" },
      { label: "PO List", href: "/po/list", perm: "po.view" },
      {
        label: "Proforma Invoices",
        href: "/proforma",
        perm: "proforma.view",
      },
      { label: "Shipments", href: "/shipments", perm: "shipment.view" },
      {
        label: "Invoices & Packing",
        href: "/invoices",
        perm: "invoice.view",
      },
      {
        label: "After Service",
        href: "/after-service",
        perm: "after_service.view",
      },
    ],
  },

  {
    label: "Production",
    items: [
      { label: "Work Sheets", href: "/work-sheets", perm: "work_sheet.view" },
      {
        label: "Work Orders",
        href: "/production/work-orders",
        perm: "work_order.view",
      },
      {
        label: "Purchase Orders",
        href: "/production/purchase-orders",
        perm: "purchase_order.view",
      },
      {
        label: "Production Status",
        href: "/production/status",
        perm: "production_status.view",
      },
      {
        label: "Batches (RED)",
        href: "/production/batches",
        perm: "production_batches.view",
      },
    ],
  },

  {
    label: "Dashboards",
    items: [
      {
        label: "Overview",
        href: "/dashboards/overview",
        perm: "dashboard.overview",
      },
      {
        label: "Order Dashboard",
        href: "/dashboards/orders",
        perm: "dashboard.orders",
      },
      {
        label: "Sample Dashboard",
        href: "/dashboards/samples",
        perm: "dashboard.samples",
      },
      {
        label: "Production Dashboard",
        href: "/dashboards/production",
        perm: "dashboard.production",
      },
      {
        label: "Profitability",
        href: "/dashboards/finance",
        perm: "dashboard.finance",
      },
    ],
  },

  {
    label: "Finance",
    items: [
      { label: "Bank Accounts", href: "/bank-accounts", perm: "receipts.view" },
      { label: "Receipts", href: "/receipts", perm: "receipts.view" },
      { label: "Credit Notes", href: "/credits", perm: "receipts.view" },
      {
        label: "Bank Balance (Monthly)",
        href: "/reports/bank-balance-monthly",
        perm: "receipts.view",
      },
    ],
  },

  {
    label: "Admin",
    items: [
      {
        label: "ERP Users",
        href: "/admin/users",
        perm: "users.manage",
      },
    ],
  },
];

/**
 * ❌ 기존 role 기반 필터링은 더 이상 사용하지 않음
 * - filterMenuByRole 제거
 * - Sidebar에서 permission 기준으로 필터링
 */
