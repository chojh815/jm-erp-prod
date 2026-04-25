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
  /**
   * permission key(s)
   * - string: 단일 권한
   * - string[]: OR 조건(배열 중 하나라도 있으면 노출)
   */
  perm?: string | string[];
}

export interface MenuSection {
  label: string;
  items: MenuItem[];
}

/**
 * ✅ permission 기반 메뉴 정의
 * Sidebar에서는 usePermissions().has(item.perm) 으로 필터링
 *
 * 규칙
 * - 기존 프로젝트에서 이미 사용 중인 perm 키는 그대로 유지
 * - 새 기능/메뉴는 가능한 한 "도메인.기능" 형태로 명확히 부여
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
        perm: "dev.product.view",
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
        label: "RED Quotations",
        href: "/red/quotations",
        // RED 전용 견적(기존 Costing/Quotation 플로우와 독립)
        // 우선 기존 Quotations와 동일 권한으로 노출
        perm: "dev.costings.view",
      },
      {
       label: "Sample Requests",
       href: "/sample-requests",
       perm: "dev.sample_requests.view",
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
        label: "Subcontract Payables",
        href: "/production/subcontract-payables",
        perm: "work_sheet.view",
      },
      {
        label: "Inhouse Payables",
        href: "/production/inhouse-payables",
        perm: "work_sheet.view",
      },
      {
        label: "Work Orders",
        href: "/production/work-orders",
        perm: "work_order.view",
      },
      {
        label: "Production Orders",
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
        // Orders/Shipments performance (buyer/brand dimension)
        label: "Performance",
        href: "/dashboards/performance",
        perm: "dashboard.performance",
      },
      {
  label: "Receivables",
  href: "/dashboards/receivables",
  perm: ["receipts.view", "dashboard.finance", "dashboard.profitability"],
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
        label: "Vendor Dashboard",
        href: "/dashboards/vendors",
        perm: ["dashboard.production", "dashboard.performance", "dashboard.profitability"],
      },
      {
        // ✅ Profitability 페이지
        // - 새로운 권한 키: dashboard.profitability
        // - 과거/임시 키를 쓰고 있었다면 dashboard.finance 로도 접근 가능하게 OR 처리
        label: "Profitability",
        href: "/dashboards/profitability",
        perm: ["dashboard.profitability", "dashboard.finance"],
      },
      {
        label: "Expected Margin",
        href: "/dashboards/expected-profitability",
        perm: ["dashboard.profitability", "dashboard.finance"],
      },
      {
        label: "Expense Dashboard",
        href: "/finance/expense-dashboard",
        perm: ["receipts.view", "dashboard.finance", "dashboard.profitability"],
      },
      {
      label: "A/R Aging",
      href: "/dashboards/ar-aging",
      perm: "receipts.view",
    },
    ],
  },

  {
    label: "Finance",
    items: [
      { label: "Cashbook", href: "/finance/cashbook", perm: "receipts.view" },
      { label: "Bank Accounts", href: "/bank-accounts", perm: "receipts.view" },
      { label: "Receipts", href: "/receipts", perm: "receipts.view" },
      { label: "Expenses", href: "/finance/expenses", perm: "receipts.view" },
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
