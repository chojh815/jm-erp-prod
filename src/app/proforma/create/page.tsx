"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import type { AppRole } from "@/config/menuConfig";
import { createSupabaseBrowserClient } from "@/lib/supabaseClient";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type DevRole = AppRole;

interface PoItem {
  po_no: string;
  buyer_name: string;
  buyer_company_id?: string | null;
  currency?: string | null;
  total_amount?: number | null;
  created_at?: string | null;
}

export default function ProformaCreatePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = React.useMemo(() => createSupabaseBrowserClient(), []);

  const [loading, setLoading] = React.useState(true);
  const [role, setRole] = React.useState<DevRole | null>(null);

  const [poNo, setPoNo] = React.useState(searchParams.get("poNo") || "");
  const [po, setPo] = React.useState<PoItem | null>(null);
  const [creating, setCreating] = React.useState(false);

  // =========================
  // Auth & Role
  // =========================
  React.useEffect(() => {
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.replace("/login?redirectTo=/proforma/create");
        return;
      }

      const meta = session.user.user_metadata as any;
      const r: AppRole = meta?.role || "viewer";

      if (r === "viewer") {
        alert("You do not have permission to create Proforma Invoice.");
        router.replace("/");
        return;
      }

      setRole(r);
      setLoading(false);
    })();
  }, [router, supabase]);

  // =========================
  // Load PO header
  // =========================
  const loadPo = async () => {
    if (!poNo.trim()) {
      alert("Please enter PO No.");
      return;
    }

    setPo(null);

    try {
      const res = await fetch(`/api/orders?poNo=${encodeURIComponent(poNo)}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.header) {
        alert("PO not found.");
        return;
      }

      setPo(data.header as PoItem);
    } catch (err) {
      console.error(err);
      alert("Failed to load PO.");
    }
  };

  // =========================
  // Create Proforma
  // =========================
  const createProforma = async () => {
    if (!po) return;

    if (
      !confirm(
        `Create Proforma Invoice from PO ${po.po_no}?\n\nThis will copy PO snapshot.`
      )
    ) {
      return;
    }

    setCreating(true);
    try {
      const res = await fetch("/api/proforma/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          poNo: po.po_no,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        alert(data?.error || "Failed to create Proforma Invoice.");
        return;
      }

      const invoiceNo = data?.invoiceNo;
      if (!invoiceNo) {
        alert("Proforma created but invoiceNo missing.");
        return;
      }

      router.push(`/proforma/detail?invoiceNo=${encodeURIComponent(invoiceNo)}`);
    } catch (err) {
      console.error(err);
      alert("Unexpected error while creating Proforma.");
    } finally {
      setCreating(false);
    }
  };

  if (loading || !role) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="text-sm text-slate-500">Loading...</div>
      </div>
    );
  }

  return (
    <AppShell
      role={role}
      title="Create Proforma Invoice"
      description="Create Proforma Invoice from Purchase Order"
    >
      <div className="p-4 max-w-3xl mx-auto">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-xl">Create Proforma Invoice</CardTitle>
            <p className="text-xs text-zinc-500 mt-1">
              Proforma Invoice is created by copying Purchase Order snapshot.
            </p>
          </CardHeader>

          <CardContent className="space-y-4">
            {/* PO Input */}
            <div className="flex items-center gap-2">
              <Input
                value={poNo}
                onChange={(e) => setPoNo(e.target.value)}
                placeholder="Enter PO No"
                className="text-sm"
              />
              <Button size="sm" onClick={loadPo}>
                Load PO
              </Button>
            </div>

            {/* PO Summary */}
            {po && (
              <div className="border rounded-lg p-3 text-sm space-y-1 bg-zinc-50">
                <div>
                  <span className="text-zinc-500">PO No:</span>{" "}
                  <strong>{po.po_no}</strong>
                </div>
                <div>
                  <span className="text-zinc-500">Buyer:</span>{" "}
                  {po.buyer_name || "-"}
                </div>
                <div>
                  <span className="text-zinc-500">Currency:</span>{" "}
                  {po.currency || "USD"}
                </div>
                <div>
                  <span className="text-zinc-500">Total Amount:</span>{" "}
                  {Number(po.total_amount || 0).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                onClick={() => router.push("/proforma")}
              >
                Cancel
              </Button>
              <Button
                onClick={createProforma}
                disabled={!po || creating}
              >
                {creating ? "Creating..." : "Create Proforma"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
