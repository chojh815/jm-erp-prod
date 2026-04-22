"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type Props = {
  costingId: string;
  styleNo?: string | null;
  buyerName?: string | null;
  currency?: string | null;
  offerUsd?: number | null;
};

function toIntArray(v: string): number[] {
  // "100, 500 1000" -> [100,500,1000]
  return v
    .split(/[,\s]+/g)
    .map((x) => Number(String(x).trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

export default function CostingQuotationCard({
  costingId,
  styleNo,
  buyerName,
  currency,
  offerUsd,
}: Props) {
  const router = useRouter();
  const [qtyText, setQtyText] = React.useState("100, 500, 1000, 3000");
  const [creating, setCreating] = React.useState(false);
  const [createdId, setCreatedId] = React.useState<string | null>(null);
  const [createdNo, setCreatedNo] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function createQuotation() {
    if (!window.confirm("Do you want to create a quotation from this costing?")) return;
    setCreating(true);
    setError(null);
    setCreatedId(null);
    setCreatedNo(null);

    try {
      const quantities = toIntArray(qtyText);
      const res = await fetch("/api/quotations/from-costings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          costing_id: costingId,
          quantities: quantities.length ? quantities : [100, 500, 1000, 3000],
        }),
      });

      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.success) throw new Error(j?.error ?? `HTTP ${res.status}`);

      setCreatedId(j.quotation_id);
      setCreatedNo(j.quotation_no ?? null);

      // 바로 상세로 이동
      router.push(`/quotations/${j.quotation_id}`);
      router.refresh();
    } catch (e: any) {
      setError(e?.message ?? "Create failed");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Quotation (Create from this Costing)</CardTitle>
          <div className="mt-1 text-xs text-muted-foreground">
            Buyer-facing snapshot. One quotation can later include multiple styles; for now this creates a quotation with this style only.
          </div>
        </div>
        <Badge variant="secondary">Costings → Quotations</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-4 gap-3 text-sm">
          <div className="col-span-2">
            <div className="text-xs text-muted-foreground mb-1">Style</div>
            <div className="font-medium">{styleNo || "-"}</div>
          </div>
          <div className="col-span-2">
            <div className="text-xs text-muted-foreground mb-1">Buyer</div>
            <div className="font-medium">{buyerName || "-"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Currency</div>
            <div className="font-medium">{currency || "USD"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Offer (USD)</div>
            <div className="font-medium">{offerUsd ?? "-"}</div>
          </div>
          <div className="col-span-2">
            <div className="text-xs text-muted-foreground mb-1">MOQ tiers (qty breaks)</div>
            <Input value={qtyText} onChange={(e) => setQtyText(e.target.value)} placeholder="100, 500, 1000, 3000" />
          </div>
        </div>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button onClick={createQuotation} disabled={creating}>
            {creating ? "Creating..." : "Create Quotation"}
          </Button>

          <Button asChild variant="outline">
            <Link href="/quotations">Go to Quotations</Link>
          </Button>

          {createdId ? (
            <Button asChild variant="secondary">
              <Link href={`/quotations/${createdId}`}>Open {createdNo ?? "Quotation"}</Link>
            </Button>
          ) : null}
        </div>

        <div className="text-xs text-muted-foreground">
          * 네고 시에는: Quotation v2를 만들고(복사) → qty tiers(100/500/1000/3000) 가격만 조정하면 됩니다.
        </div>
      </CardContent>
    </Card>
  );
}
