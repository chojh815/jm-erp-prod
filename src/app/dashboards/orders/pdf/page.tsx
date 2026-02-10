// src/app/dashboards/orders/pdf/page.tsx
import OrdersDashboardPdfClient from "./_client";

export const dynamic = "force-dynamic";

export default function OrdersDashboardPdfPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  const start = typeof searchParams?.start === "string" ? searchParams?.start : "";
  const end = typeof searchParams?.end === "string" ? searchParams?.end : "";
  const buyer_ids = typeof searchParams?.buyer_ids === "string" ? searchParams?.buyer_ids : "";

  return <OrdersDashboardPdfClient start={start} end={end} buyerIdsCsv={buyer_ids} />;
}
