"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabaseClient";
import type { AppRole } from "@/config/menuConfig";
import AppShell from "@/components/layout/AppShell";
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export default function HomePage() {
  const router = useRouter();
  const supabase = React.useMemo(() => createSupabaseBrowserClient(), []);
  const [role, setRole] = React.useState<AppRole | null>(null);
  const [loading, setLoading] = React.useState(true);

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
      href: "/dev/sample-requests",
    },
    {
      title: "Trade",
      description:
        "Manage buyer POs, shipments, invoices and receipts.",
      href: "/trade/orders",
    },
    {
      title: "Production",
      description:
        "Manage work orders, purchase orders and production status.",
      href: "/production/work-orders",
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
        <h2 className="text-sm font-semibold mb-2">
          Today&apos;s summary (simple)
        </h2>
        <p className="text-xs text-slate-500">
          Later we can show cards for &quot;This month shipments&quot;, &quot;Open
          POs&quot;, &quot;Pending samples&quot;, etc. here.
        </p>
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
