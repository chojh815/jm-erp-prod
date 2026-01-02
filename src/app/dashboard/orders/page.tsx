// /src/app/dashboard/orders/page.tsx
import OrdersDashboardClient from "./_client";

export const metadata = {
  title: "Orders Dashboard",
};

export const dynamic = "force-dynamic"; // (선택) 페이지 캐시 방지

export default function Page() {
  return <OrdersDashboardClient />;
}
