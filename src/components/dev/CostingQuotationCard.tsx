"use client";

import * as React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Props = {
  costingId: string;
  styleNo?: string | null;
  buyerName?: string | null;
  currency?: string | null;
  offerUsd?: number | null;
  onCreated?: (quotationId: string) => void;
};

function normalizeQtyTiers(input: string): number[] {
  const parts = input
    .split(/[,\s]+/g)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(String(s).replace(/[^0-9.]/g, "")))
    .filter((n) => Number.isFinite(n) && n > 0);

  const uniq = Array.from(new Set(parts.map((n) => Math.round(n))));
  uniq.sort((a, b) => a - b);
  return uniq;
}

export default function CostingQuotationCard({
  costingId,
  styleNo,
  buyerName,
  currency,
  offerUsd,
  onCreated,
}: Props) {
  const [tiersText, setTiersText] = React.useState("100, 500, 1000, 3000");
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  async function createQuotation() {
    setErr(null);

    if (!costingId) {
      setErr("costingId is missing (page did not pass the id)");
      return;
    }

    const qtyTiers = normalizeQtyTiers(tiersText);
    if (!qtyTiers.length) {
      setErr("MOQ tiers is empty");
      return;
    }
    if (!window.confirm("Do you want to create a quotation from this costing?")) return;

    setLoading(true);
    try {
      const res = await fetch("/api/quotations/from-costings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // ✅ accept both shapes (route is flexible)
          costing_id: costingId,
          costing_ids: [costingId],

          moq_tiers: qtyTiers, // preferred
          moq_tiers_text: tiersText, // for debug / backward compat
        }),
      });

      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j?.error || j?.message || `HTTP ${res.status}`);
        return;
      }

      const quotationId: string | undefined = j?.quotation_id || j?.id;
      if (quotationId) onCreated?.(quotationId);
      // if API returns redirect url, move
      if (j?.redirect_url) window.location.href = j.redirect_url;
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="mt-6">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle>Quotation (Create from this Costing)</CardTitle>
          <div className="text-sm text-muted-foreground">
            Buyer-facing snapshot. One quotation can later include multiple styles; for now this creates a quotation with this style only.
          </div>
        </div>
        <div>
          <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
            Costings → Quotations
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">Style</div>
            <div className="text-base font-medium">{styleNo || "-"}</div>
          </div>

          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">Buyer</div>
            <div className="text-base font-medium">{buyerName || "-"}</div>
          </div>

          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">Currency</div>
            <div className="text-base font-medium">{currency || "USD"}</div>
          </div>

          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">Offer (USD)</div>
            <div className="text-base font-medium">{offerUsd ?? "-"}</div>
          </div>

          <div className="space-y-1 md:col-span-2">
            <div className="text-sm text-muted-foreground">MOQ tiers (qty breaks)</div>
            <Input value={tiersText} onChange={(e) => setTiersText(e.target.value)} />
          </div>
        </div>

        {err ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {err}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <Button onClick={createQuotation} disabled={loading}>
            {loading ? "Creating..." : "Create Quotation"}
          </Button>
          <Button variant="secondary" asChild>
            <a href="/quotations">Go to Quotations</a>
          </Button>
        </div>

        <div className="text-xs text-muted-foreground">
          * 네고 시에는: Quotation v2를 만들고(복사) → qty tiers(100/500/1000/3000) 가격만 조정하면 됩니다.
        </div>
      </CardContent>
    </Card>
  );
}
