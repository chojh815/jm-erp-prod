export type AppRole = "admin" | "manager" | "staff" | "viewer";

export interface MenuItem {
  label: string;
  href: string;
  roles?: AppRole[]; // 없으면 모두에게 보임
}

export interface MenuSection {
  label: string;
  items: MenuItem[];
}

export const menuSections: MenuSection[] = [
  { label: "Home", items: [{ label: "Home", href: "/home" }] },
  {
    label: "Basic",
    items: [
      { label: "Users", href: "/users", roles: ["admin", "manager"] },
      { label: "Companies", href: "/companies" },
      { label: "Roles & Permissions", href: "/roles", roles: ["admin"] },
    ],
  },
  {
    label: "Development",
    items: [
      { label: "Sample Requests", href: "/dev/product-register" },
      { label: "Costings", href: "/dev/costings" },
      { label: "BOM Library", href: "/dev/bom-library" },
    ],
  },
  {
    label: "Trade",
    items: [
      { label: "Create PO", href: "/po/create" },
      { label: "PO List", href: "/po/list" },
      { label: "Proforma Invoices", href: "/proforma" },
      { label: "Shipments", href: "/shipments" },
      { label: "Invoices & Packing", href: "/invoices" },
      { label: "Receipts", href: "/receipts" },
      { label: "After Service", href: "/after-service" },
    ],
  },
  {
    label: "Production",
    items: [
      { label: "Work Sheets", href: "/work-sheets" },
      { label: "Work Orders", href: "/production/work-orders" },
      { label: "Purchase Orders", href: "/production/purchase-orders" },
      { label: "Production Status", href: "/production/status" },
    ],
  },
  {
    label: "Dashboards",
    items: [
      { label: "Overview", href: "/dashboards/overview" },
      { label: "Order Dashboard", href: "/dashboards/orders" },
      { label: "Sample Dashboard", href: "/dashboards/samples" },
      { label: "Production Dashboard", href: "/dashboards/production" },
      { label: "Profitability", href: "/dashboards/finance" },
    ],
  },
  {
    label: "Admin",
    items: [{ label: "ERP Users", href: "/admin/users", roles: ["admin"] }],
  },
];

export function filterMenuByRole(role: AppRole): MenuSection[] {
  return menuSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (!item.roles || item.roles.length === 0) return true;
        return item.roles.includes(role);
      }),
    }))
    .filter((section) => section.items.length > 0);
}
