"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabaseClient";
import type { AppRole } from "@/config/menuConfig";
import AppShell from "@/components/layout/AppShell";
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

type SummaryCard = {
  title: string;
  value: string;
  sub: string;
  href: string;
  tone?: "default" | "warning";
};

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function money(v: any) {
  const n = Number(v ?? 0);
  const ok = Number.isFinite(n) ? n : 0;
  return ok.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function countText(v: any, unit = "") {
  const n = Number(v ?? 0);
  const ok = Number.isFinite(n) ? n : 0;
  return `${ok.toLocaleString()}${unit}`;
}

function findKpi(rows: any[], key: string) {
  return rows.find((x) => String(x?.key ?? "") === key) ?? null;
}

function fmtTotalsByCurrency(totals: Record<string, number> | null | undefined) {
  if (!totals) return money(0);
  const entries = Object.entries(totals).filter(([, v]) => Number.isFinite(Number(v)));
  if (!entries.length) return money(0);
  if (entries.length === 1) {
    const [cur, v] = entries[0];
    return `${cur || "USD"} ${Number(v ?? 0).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })}`;
  }
  return entries
    .map(([cur, v]) => `${cur || "USD"} ${Number(v ?? 0).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })}`)
    .join(" | ");
}

export default function HomePage() {
  const router = useRouter();
  const supabase = React.useMemo(() => createSupabaseBrowserClient(), []);
  const [role, setRole] = React.useState<AppRole | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [summaryLoading, setSummaryLoading] = React.useState(true);
  const [summaryError, setSummaryError] = React.useState("");
  const [summaryCards, setSummaryCards] = React.useState<SummaryCard[]>([]);

  React.useEffect(() => {
    const loadSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.replace("/login?redirectTo=/home");
        return;
      }

      const r =
        ((session.user.user_metadata as any)?.role as AppRole | undefined) ||
        "staff";
      setRole(r);
      setLoading(false);
    };

    loadSession();
  }, [supabase, router]);

  React.useEffect(() => {
    if (!role) return;

    let mounted = true;
    const today = todayISO();

    async function loadSummary() {
      try {
        setSummaryLoading(true);
        setSummaryError("");

        const [todayRes, openPoRes, watchRes, marginRes] = await Promise.all([
          fetch(`/api/dashboards/overview?preset=CUSTOM&start=${today}&end=${today}`, {
            cache: "no-store",
            credentials: "include",
          }),
          fetch("/api/orders/list?status=OPEN&page=1&pageSize=1", {
            cache: "no-store",
            credentials: "include",
          }),
          fetch(`/api/dashboards/overview?preset=LAST_12_MONTHS&end=${today}`, {
            cache: "no-store",
            credentials: "include",
          }),
          fetch("/api/dashboards/expected-profitability?missing_only=true", {
            cache: "no-store",
            credentials: "include",
          }),
        ]);

        const [todayJson, openPoJson, watchJson, marginJson] = await Promise.all([
          todayRes.ok ? todayRes.json() : null,
          openPoRes.ok ? openPoRes.json() : null,
          watchRes.ok ? watchRes.json() : null,
          marginRes.ok ? marginRes.json() : null,
        ]);

        if (!mounted) return;

        const todayKpis = Array.isArray(todayJson?.kpis) ? todayJson.kpis : [];
        const watchKpis = Array.isArray(watchJson?.kpis) ? watchJson.kpis : [];

        const shippedToday = findKpi(todayKpis, "shipped");
        const invoicedToday = findKpi(todayKpis, "invoiced");
        const ar = findKpi(watchKpis, "ar");
        const sampleOverdue = Number(watchJson?.sample_overdue ?? 0);
        const sampleWaiting = Number(watchJson?.sample_waiting_feedback ?? 0);
        const missingCost = Number(marginJson?.summary?.missing_count ?? 0);
        const alertCount =
          (Number.isFinite(sampleOverdue) ? sampleOverdue : 0) +
          (Number.isFinite(sampleWaiting) ? sampleWaiting : 0) +
          (Number.isFinite(missingCost) ? missingCost : 0);

        setSummaryCards([
          {
            title: "Shipments Today",
            value: countText(shippedToday?.sub_value, " due"),
            sub: `${money(shippedToday?.value_usd)} shipped`,
            href: "/shipments/list",
          },
          {
            title: "Open POs",
            value: countText(openPoJson?.total, " open"),
            sub: fmtTotalsByCurrency(openPoJson?.grandTotalsByCurrency),
            href: "/po/list?status=OPEN",
          },
          {
            title: "Invoices Today",
            value: countText(invoicedToday?.sub_value, " created"),
            sub: `${money(invoicedToday?.value_usd)} invoiced`,
            href: "/invoices",
          },
          {
            title: "Receivable",
            value: money(ar?.value_usd),
            sub: `${countText(ar?.sub_value)} open invoices`,
            href: "/dashboards/ar-aging",
          },
          {
            title: "Alerts",
            value: countText(alertCount),
            sub: `${countText(missingCost)} missing costs / ${countText(sampleOverdue + sampleWaiting)} sample follow-ups`,
            href: "/dashboards/expected-profitability",
            tone: alertCount > 0 ? "warning" : "default",
          },
        ]);
      } catch (e: any) {
        if (!mounted) return;
        setSummaryError(e?.message || "Failed to load summary.");
      } finally {
        if (mounted) setSummaryLoading(false);
      }
    }

    loadSummary();

    return () => {
      mounted = false;
    };
  }, [role]);

  if (loading || !role) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="text-sm text-slate-500">Loading...</div>
      </div>
    );
  }

  const homeCards = [
    {
      title: "Basic",
      description: "Manage users, companies and master data.",
      href: "/companies",
    },
    {
      title: "Development",
      description: "Manage sample requests, costings and BOMs.",
      href: "/costings",
    },
    {
      title: "Trade",
      description:
        "Manage buyer POs, shipments, invoices and receipts.",
      href: "/po/list",
    },
    {
      title: "Production",
      description:
        "Manage work orders, purchase orders and production status.",
      href: "/production/status",
    },
    {
      title: "Dashboards",
      description:
        "View key KPIs for orders, samples, production and profits.",
      href: "/dashboards/overview",
    },
  ];

  return (
    <AppShell
      role={role}
      title="Home"
      description="JM International ERP main menu"
    >
      <section className="mb-6">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Today&apos;s summary</h2>
            <p className="mt-1 text-xs text-slate-500">
              Action-focused snapshot for shipments, POs, invoices, receivables and alerts.
            </p>
          </div>
          {summaryLoading && <div className="text-xs text-slate-500">Loading summary...</div>}
        </div>

        {summaryError ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
            {summaryError}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {(summaryCards.length ? summaryCards : [
              { title: "Shipments Today", value: "-", sub: "No data loaded", href: "/shipments/list" },
              { title: "Open POs", value: "-", sub: "No data loaded", href: "/po/list" },
              { title: "Invoices Today", value: "-", sub: "No data loaded", href: "/invoices" },
              { title: "Receivable", value: "-", sub: "No data loaded", href: "/dashboards/ar-aging" },
              { title: "Alerts", value: "-", sub: "No data loaded", href: "/dashboards/expected-profitability" },
            ]).map((card) => (
              <Link key={card.title} href={card.href}>
                <Card className={[
                  "h-full cursor-pointer transition-shadow hover:shadow-md",
                  card.tone === "warning" ? "border-amber-300 bg-amber-50/60" : "",
                ].filter(Boolean).join(" ")}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">{card.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-semibold tracking-normal text-slate-950">
                      {card.value}
                    </div>
                    <p className="mt-1 text-xs text-slate-600">{card.sub}</p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold mb-3">Main modules</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {homeCards.map((card) => (
            <Link key={card.href} href={card.href}>
              <Card className="h-full hover:shadow-md transition-shadow cursor-pointer">
                <CardHeader>
                  <CardTitle className="text-base">
                    {card.title}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-slate-600">
                    {card.description}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
