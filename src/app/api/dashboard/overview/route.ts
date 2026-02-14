import { GET as DashboardsOverviewGET } from "../../dashboards/overview/route";

export const dynamic = "force-dynamic";

// Backward-compatible alias:
// /api/dashboard/overview  -> /api/dashboards/overview
export const GET = DashboardsOverviewGET;
