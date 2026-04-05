"use client";

import useSWR from "swr";
import AppShell from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const fetcher = async (url: string) => {
  const r = await fetch(url, { cache: "no-store" });
  return r.json();
};

function fmtPct(n: number) { return `${Number(n || 0).toFixed(2)}%`; }
function alertBadgeClass(v: string) {
  const s = (v || "").toUpperCase();
  if (s === "OVERDUE") return "bg-rose-100 text-rose-700 border border-rose-200";
  if (s === "FOLLOW_UP_DUE") return "bg-amber-100 text-amber-700 border border-amber-200";
  if (s === "WAITING_FEEDBACK") return "bg-sky-100 text-sky-700 border border-sky-200";
  return "bg-slate-100 text-slate-700 border border-slate-200";
}

export default function SampleDashboardPage() {
  const { data } = useSWR("/api/dashboards/samples", fetcher);
  const kpis = data?.kpis || {};
  const buyerRanking = data?.buyer_ranking || [];
  const monthlyRequests = data?.monthly_requests || [];
  const monthlyConverted = data?.monthly_converted || [];
  const aging = data?.aging || [];
  const alerts = data?.alerts || [];

  return (
    <AppShell title="Sample Dashboard">
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-7">
          {[
            ["Total Requests", kpis.total_requests || 0, ""],
            ["In Progress", kpis.in_progress || 0, ""],
            ["Completed", kpis.completed || 0, ""],
            ["Converted", kpis.converted_requests || 0, ""],
            ["Conversion %", fmtPct(kpis.conversion_pct || 0), ""],
            ["Overdue", kpis.overdue || 0, "text-rose-600"],
            ["Avg Lead Time", `${kpis.avg_lead_time_days || 0} days`, ""],
          ].map(([title, value, valueClass], idx) => (
            <Card key={idx}>
              <CardContent className="flex h-[132px] flex-col justify-between p-6">
                <div className="min-h-[44px] text-sm font-medium leading-5 text-muted-foreground">{title as string}</div>
                <div className={`text-3xl font-bold leading-none ${valueClass as string}`}>{String(value)}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-12">
          <div className="lg:col-span-7 space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">Buyer Ranking</CardTitle>
                <Button type="button" variant="outline" onClick={() => window.open("/sample-requests", "_blank")}>Open Sample Requests</Button>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="p-2 text-left">Buyer</th>
                      <th className="p-2 text-right">Requests</th>
                      <th className="p-2 text-right">Converted</th>
                      <th className="p-2 text-right">Conversion %</th>
                      <th className="p-2 text-right">Overdue</th>
                      <th className="p-2 text-right">Waiting</th>
                    </tr>
                  </thead>
                  <tbody>
                    {buyerRanking.map((r: any, idx: number) => (
                      <tr key={idx} className="border-b">
                        <td className="p-2">{r.buyer_name}</td>
                        <td className="p-2 text-right">{r.requests}</td>
                        <td className="p-2 text-right">{r.converted}</td>
                        <td className="p-2 text-right">{fmtPct(r.conversion_pct)}</td>
                        <td className="p-2 text-right">{r.overdue}</td>
                        <td className="p-2 text-right">{r.waiting}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Monthly Requests / Converted</CardTitle></CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <div>
                  <div className="mb-2 text-sm font-medium">Requests</div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b"><th className="p-2 text-left">Month</th><th className="p-2 text-right">Requests</th></tr>
                    </thead>
                    <tbody>
                      {monthlyRequests.map((r: any) => (
                        <tr key={r.month} className="border-b"><td className="p-2">{r.month}</td><td className="p-2 text-right">{r.requests}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div>
                  <div className="mb-2 text-sm font-medium">Converted</div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b"><th className="p-2 text-left">Month</th><th className="p-2 text-right">Converted</th></tr>
                    </thead>
                    <tbody>
                      {monthlyConverted.map((r: any) => (
                        <tr key={r.month} className="border-b"><td className="p-2">{r.month}</td><td className="p-2 text-right">{r.converted}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-5 space-y-6">
            <Card>
              <CardHeader><CardTitle className="text-base">Aging</CardTitle></CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b"><th className="p-2 text-left">Bucket</th><th className="p-2 text-right">Count</th></tr>
                  </thead>
                  <tbody>
                    {aging.map((r: any) => (
                      <tr key={r.bucket} className="border-b"><td className="p-2">{r.bucket} days</td><td className="p-2 text-right">{r.count}</td></tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Alert List</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {alerts.length === 0 ? (
                  <div className="rounded border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">No alert items.</div>
                ) : alerts.map((r: any) => (
                  <div key={r.id} className="rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium">{r.request_title || "(Untitled request)"}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{r.request_no} · {r.buyer_name || "—"}</div>
                        <div className="mt-1 text-xs text-muted-foreground">Target Ship: {r.target_ship_date || "—"} · Days Open: {r.days_open ?? 0}</div>
                      </div>
                      <span className={`inline-flex rounded-full px-2 py-1 text-xs ${alertBadgeClass(r.alert_status)}`}>{r.alert_status}</span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
