import { redirect } from "next/navigation";

function toQueryString(searchParams?: Record<string, string | string[] | undefined>) {
  const sp = new URLSearchParams();
  Object.entries(searchParams || {}).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item) sp.append(key, item);
      });
      return;
    }
    if (value) sp.set(key, value);
  });
  const q = sp.toString();
  return q ? `?${q}` : "";
}

export default function LegacyFinanceArPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  redirect(`/dashboards/receivables${toQueryString(searchParams)}`);
}
