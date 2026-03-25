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

type PoHeader = {
  id?: string;
  po_no: string;
  buyer_id?: string | null;
  buyer_name?: string | null;
  currency?: string | null;
  payment_term?: string | null;
  ship_mode?: string | null;
  destination?: string | null;
  incoterm?: string | null;
  subtotal?: number | null;
  created_at?: string | null;
};

type PoLine = {
  id?: string;
  buyer_style_no?: string | null;
  jm_style_no?: string | null;
  description?: string | null;
  color?: string | null;
  size?: string | null;
  plating_color?: string | null;
  hs_code?: string | null;
  qty?: number | null;
  uom?: string | null;
  unit_price?: number | null;
  currency?: string | null;
  amount?: number | null;
  upc?: string | null;
};

type LoadedPo = {
  header: PoHeader;
  lines: PoLine[];
};

function toNumber(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export default function ProformaCreatePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = React.useMemo(() => createSupabaseBrowserClient(), []);

  const [loading, setLoading] = React.useState(true);
  const [role, setRole] = React.useState<DevRole | null>(null);

  const [poNo, setPoNo] = React.useState(searchParams.get("poNo") || "");
  const [po, setPo] = React.useState<LoadedPo | null>(null);
  const [creating, setCreating] = React.useState(false);

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

  const loadPo = React.useCallback(async () => {
    const trimmed = poNo.trim();
    if (!trimmed) {
      alert("Please enter PO No.");
      return;
    }

    setPo(null);

    try {
      const res = await fetch(`/api/orders?poNo=${encodeURIComponent(trimmed)}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.header) {
        alert(data?.error || "PO not found.");
        return;
      }

      const loaded: LoadedPo = {
        header: data.header as PoHeader,
        lines: Array.isArray(data.lines) ? (data.lines as PoLine[]) : [],
      };

      if (!loaded.lines.length) {
        alert("PO loaded, but no lines were found.");
        return;
      }

      setPo(loaded);
    } catch (err) {
      console.error(err);
      alert("Failed to load PO.");
    }
  }, [poNo]);

  React.useEffect(() => {
    if (!searchParams.get("poNo")) return;
    void loadPo();
  }, [searchParams, loadPo]);

  const createProforma = async () => {
    if (!po?.header || !po.lines.length) {
      alert("Please load a valid PO first.");
      return;
    }

    const h = po.header;

    if (!h.buyer_id) {
      alert("This PO is missing buyer_id, so Proforma cannot be created.");
      return;
    }

    if (!h.currency) {
      alert("This PO is missing currency, so Proforma cannot be created.");
      return;
    }

    if (
      !confirm(
        `Create Proforma Invoice from PO ${h.po_no}?\n\nThis will copy the current PO header and lines snapshot.`
      )
    ) {
      return;
    }

    setCreating(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const payload = {
        header: {
          po_no: h.po_no || undefined,
          buyer_id: h.buyer_id || undefined,
          buyer_name: h.buyer_name || undefined,
          currency: h.currency || undefined,
          payment_term: h.payment_term || undefined,
          ship_mode: h.ship_mode || undefined,
          destination: h.destination || undefined,
          incoterm: h.incoterm || undefined,
        },
        lines: (po.lines || []).map((line) => ({
          buyerStyleNo: line.buyer_style_no || null,
          jmStyleNo: line.jm_style_no || null,
          description: line.description || null,
          color: line.color || null,
          size: line.size || null,
          plating_color: line.plating_color || null,
          hsCode: line.hs_code || null,
          qty: toNumber(line.qty, 0),
          uom: line.uom || null,
          unitPrice: toNumber(line.unit_price, 0),
          currency: line.currency || h.currency || null,
          amount:
            line.amount != null
              ? toNumber(line.amount, 0)
              : toNumber(line.qty, 0) * toNumber(line.unit_price, 0),
          upcCode: line.upc || null,
        })),
        audit: {
          created_by: session?.user?.id || null,
          created_by_email: session?.user?.email || null,
          created_at: new Date().toISOString(),
        },
      };

      console.log("PROFORMA CREATE PAYLOAD:", payload);

      const res = await fetch("/api/proforma/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        alert(data?.error || "Failed to create Proforma Invoice.");
        return;
      }

      const invoiceNo = data?.invoice_no || data?.invoiceNo || null;
      if (!invoiceNo) {
        alert("Proforma created but invoice number is missing.");
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

  const header = po?.header ?? null;
  const lineCount = po?.lines?.length ?? 0;

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
              Proforma Invoice is created by copying the current Purchase Order snapshot.
            </p>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <Input
                value={poNo}
                onChange={(e) => setPoNo(e.target.value)}
                placeholder="Enter PO No"
                className="text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void loadPo();
                }}
              />
              <Button size="sm" onClick={() => void loadPo()}>
                Load PO
              </Button>
            </div>

            {header && (
              <div className="border rounded-lg p-3 text-sm space-y-1 bg-zinc-50">
                <div>
                  <span className="text-zinc-500">PO No:</span> <strong>{header.po_no}</strong>
                </div>
                <div>
                  <span className="text-zinc-500">Buyer:</span> {header.buyer_name || "-"}
                </div>
                <div>
                  <span className="text-zinc-500">Currency:</span> {header.currency || "USD"}
                </div>
                <div>
                  <span className="text-zinc-500">Incoterm:</span> {header.incoterm || "-"}
                </div>
                <div>
                  <span className="text-zinc-500">Ship Mode:</span> {header.ship_mode || "-"}
                </div>
                <div>
                  <span className="text-zinc-500">Payment Term:</span> {header.payment_term || "-"}
                </div>
                <div>
                  <span className="text-zinc-500">Destination:</span> {header.destination || "-"}
                </div>
                <div>
                  <span className="text-zinc-500">Lines:</span> {lineCount}
                </div>
                <div>
                  <span className="text-zinc-500">Total Amount:</span>{" "}
                  {toNumber(header.subtotal, 0).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => router.push("/proforma")}>
                Cancel
              </Button>
              <Button onClick={createProforma} disabled={!po || creating}>
                {creating ? "Creating..." : "Create Proforma"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
