"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

type ExpenseType = {
  code: string;
  name: string;
  category: string;
  default_scope: string;
  default_allocation: string;
};

type CompanyLite = {
  id: string;
  company_name?: string | null;
  code?: string | null;
  company_type?: string | null;
};

type SiteLite = {
  id: string;
  site_name?: string | null;
  code?: string | null;
  currency?: string | null;
};

export type AllocationRow = {
  target_type: "PO" | "SHIPMENT" | "LINE" | "SITE" | "NONE";
  po_header_id?: string | null;
  shipment_id?: string | null;
  po_line_id?: string | null;
  site_id?: string | null;
  share_pct?: number | null;
  amount_usd?: number | null;
  note?: string | null;
};

export type ExpenseHeaderDraft = {
  id?: string;
  expense_no?: string;
  expense_type_code: string;
  vendor_id?: string | null;
  expense_date: string; // YYYY-MM-DD
  posting_month: string; // YYYY-MM-01
  currency: "USD" | "CNY" | "VND";
  fx_rate_to_usd: number; // currency per 1 USD (USD=1)
  total_amount_original: number;
  scope_type: "PO" | "SHIPMENT" | "LINE" | "FACTORY" | "GENERAL" | "MULTI";
  allocation_method: "BY_REVENUE" | "BY_CBM" | "BY_GW" | "BY_QTY" | "MANUAL" | "NONE";
  note?: string | null;
};

function toNumber(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function monthStartISO(d: string) {
  const dt = new Date(d + "T00:00:00");
  const m = new Date(dt.getFullYear(), dt.getMonth(), 1);
  return m.toISOString().slice(0, 10);
}

function calcUsd(currency: string, amountOriginal: number, fx: number) {
  if (currency === "USD") return amountOriginal;
  return fx > 0 ? amountOriginal / fx : 0;
}

export default function ExpenseForm({
  mode,
  initialHeader,
  initialAllocations,
  onSaved,
}: {
  mode: "create" | "edit";
  initialHeader?: Partial<ExpenseHeaderDraft>;
  initialAllocations?: AllocationRow[];
  onSaved?: (id: string) => void;
}) {
  const router = useRouter();

  const [loading, setLoading] = React.useState(false);
  const [lookupsLoading, setLookupsLoading] = React.useState(true);

  const [types, setTypes] = React.useState<ExpenseType[]>([]);
  const [companies, setCompanies] = React.useState<CompanyLite[]>([]);
  const [sites, setSites] = React.useState<SiteLite[]>([]);

  const today = new Date().toISOString().slice(0, 10);

  const [header, setHeader] = React.useState<ExpenseHeaderDraft>({
    expense_type_code: initialHeader?.expense_type_code || "OTHER",
    vendor_id: initialHeader?.vendor_id ?? null,
    expense_date: initialHeader?.expense_date || today,
    posting_month: initialHeader?.posting_month || monthStartISO(initialHeader?.expense_date || today),
    currency: (initialHeader?.currency as any) || "USD",
    fx_rate_to_usd: toNumber(initialHeader?.fx_rate_to_usd || 1),
    total_amount_original: toNumber(initialHeader?.total_amount_original || 0),
    scope_type: (initialHeader?.scope_type as any) || "PO",
    allocation_method: (initialHeader?.allocation_method as any) || "BY_REVENUE",
    note: initialHeader?.note ?? "",
  });

  const [allocations, setAllocations] = React.useState<AllocationRow[]>(
    initialAllocations?.length ? initialAllocations : [{ target_type: "PO" }]
  );

  React.useEffect(() => {
    (async () => {
      try {
        setLookupsLoading(true);
        const res = await fetch("/api/finance/expenses/lookups", { cache: "no-store" });
        const json = await res.json();
        if (!json?.ok) throw new Error(json?.error || "Lookups failed");
        setTypes(json.data.expense_types || []);
        setCompanies(json.data.companies || []);
        setSites(json.data.sites || []);
      } catch (e: any) {
        console.error(e);
        alert(e?.message || String(e));
      } finally {
        setLookupsLoading(false);
      }
    })();
  }, []);

  const selectedType = React.useMemo(
    () => types.find((t) => t.code === header.expense_type_code),
    [types, header.expense_type_code]
  );

  React.useEffect(() => {
    // If user changes type, auto-apply defaults (only if user hasn't customized yet much)
    if (!selectedType) return;

    setHeader((prev) => ({
      ...prev,
      scope_type: (selectedType.default_scope as any) || prev.scope_type,
      allocation_method: (selectedType.default_allocation as any) || prev.allocation_method,
    }));

    setAllocations((prev) => {
      const scope = selectedType.default_scope;
      if (scope === "FACTORY") return [{ target_type: "SITE" }];
      if (scope === "SHIPMENT") return [{ target_type: "SHIPMENT" }];
      if (scope === "LINE") return [{ target_type: "LINE" }];
      if (scope === "GENERAL") return [{ target_type: "NONE" }];
      return prev?.length ? prev : [{ target_type: "PO" }];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [header.expense_type_code]);

  const usdPreview = React.useMemo(() => {
    return calcUsd(header.currency, header.total_amount_original, header.fx_rate_to_usd);
  }, [header.currency, header.total_amount_original, header.fx_rate_to_usd]);

  const save = async () => {
    setLoading(true);
    try {
      const payload = {
        ...header,
        total_amount_usd: usdPreview,
        allocations,
      };

      const url = mode === "edit" ? `/api/finance/expenses/${(initialHeader as any)?.id}` : "/api/finance/expenses";
      const method = mode === "edit" ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || "Save failed");

      const id = json?.data?.id || (initialHeader as any)?.id;
      if (onSaved) onSaved(id);
      router.push(`/finance/expenses/${id}`);
    } catch (e: any) {
      console.error(e);
      alert(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const renderAllocationHelp = () => {
    if (header.scope_type === "PO")
      return "PO scope: choose one PO (po_header_id). Allocation within PO uses selected method.";
    if (header.scope_type === "MULTI")
      return "MULTI scope: add multiple POs with share_pct (sum=1.0 recommended). Each PO is then allocated internally.";
    if (header.scope_type === "SHIPMENT")
      return "SHIPMENT scope: choose shipment_id. Allocation uses BY_CBM if possible, else BY_GW, else BY_REVENUE.";
    if (header.scope_type === "LINE")
      return "LINE scope: direct to po_line_id (manual or equal split).";
    if (header.scope_type === "FACTORY")
      return "FACTORY scope: monthly overhead, allocated across all PO lines with revenue in posting_month.";
    return "GENERAL scope: not allocated to PO/lines (summary-only).";
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{mode === "create" ? "New Expense" : "Edit Expense"}</CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant="outline">OPEX</Badge>
          {selectedType ? <Badge variant="secondary">{selectedType.category}</Badge> : null}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>Expense Type</Label>
            <Select
              value={header.expense_type_code}
              onValueChange={(v) => setHeader((p) => ({ ...p, expense_type_code: v }))}
              disabled={lookupsLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent className="max-h-[320px]">
                {types.map((t) => (
                  <SelectItem key={t.code} value={t.code}>
                    {t.name} ({t.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Vendor (Optional)</Label>
            <Select
              value={header.vendor_id || "NONE"}
              onValueChange={(v) => setHeader((p) => ({ ...p, vendor_id: v === "NONE" ? null : v }))}
              disabled={lookupsLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select vendor" />
              </SelectTrigger>
              <SelectContent className="max-h-[320px]">
                <SelectItem value="NONE">(None)</SelectItem>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.company_name || c.code || c.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Expense Date</Label>
            <Input
              type="date"
              value={header.expense_date}
              onChange={(e) => {
                const d = e.target.value;
                setHeader((p) => ({ ...p, expense_date: d, posting_month: monthStartISO(d) }));
              }}
            />
          </div>

          <div className="space-y-2">
            <Label>Posting Month (Overhead)</Label>
            <Input
              type="date"
              value={header.posting_month}
              onChange={(e) => setHeader((p) => ({ ...p, posting_month: e.target.value }))}
            />
          </div>

          <div className="space-y-2">
            <Label>Currency</Label>
            <Select
              value={header.currency}
              onValueChange={(v: any) => setHeader((p) => ({ ...p, currency: v }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Currency" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="USD">USD</SelectItem>
                <SelectItem value="CNY">CNY</SelectItem>
                <SelectItem value="VND">VND</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>FX Rate (currency per 1 USD)</Label>
            <Input
              inputMode="decimal"
              value={String(header.fx_rate_to_usd)}
              onChange={(e) => setHeader((p) => ({ ...p, fx_rate_to_usd: toNumber(e.target.value) }))}
              placeholder="e.g., 7.23 for CNY, 24500 for VND"
            />
          </div>

          <div className="space-y-2">
            <Label>Total Amount (Original)</Label>
            <Input
              inputMode="decimal"
              value={String(header.total_amount_original)}
              onChange={(e) => setHeader((p) => ({ ...p, total_amount_original: toNumber(e.target.value) }))}
            />
          </div>

          <div className="space-y-2">
            <Label>Total (USD preview)</Label>
            <Input value={usdPreview.toFixed(2)} readOnly />
          </div>

          <div className="space-y-2">
            <Label>Scope</Label>
            <Select
              value={header.scope_type}
              onValueChange={(v: any) => setHeader((p) => ({ ...p, scope_type: v }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Scope" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PO">PO</SelectItem>
                <SelectItem value="MULTI">MULTI (multi-PO)</SelectItem>
                <SelectItem value="SHIPMENT">SHIPMENT</SelectItem>
                <SelectItem value="LINE">LINE</SelectItem>
                <SelectItem value="FACTORY">FACTORY (monthly overhead)</SelectItem>
                <SelectItem value="GENERAL">GENERAL (summary-only)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Allocation Method</Label>
            <Select
              value={header.allocation_method}
              onValueChange={(v: any) => setHeader((p) => ({ ...p, allocation_method: v }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Method" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="BY_REVENUE">BY_REVENUE</SelectItem>
                <SelectItem value="BY_CBM">BY_CBM</SelectItem>
                <SelectItem value="BY_GW">BY_GW</SelectItem>
                <SelectItem value="BY_QTY">BY_QTY</SelectItem>
                <SelectItem value="MANUAL">MANUAL</SelectItem>
                <SelectItem value="NONE">NONE</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2 md:col-span-3">
            <Label>Note</Label>
            <Textarea value={header.note || ""} onChange={(e) => setHeader((p) => ({ ...p, note: e.target.value }))} />
          </div>
        </div>

        <Separator />

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="font-medium">Targets / Allocations</div>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAllocations((p) => [...p, { target_type: "PO" }])}
            >
              + Add Row
            </Button>
          </div>
          <div className="text-xs text-muted-foreground">{renderAllocationHelp()}</div>

          <div className="space-y-2">
            {allocations.map((a, idx) => (
              <div key={idx} className="grid grid-cols-1 gap-2 rounded-md border p-3 md:grid-cols-6">
                <div className="md:col-span-1">
                  <Label className="text-xs">Target</Label>
                  <Select
                    value={a.target_type}
                    onValueChange={(v: any) => {
                      const next = [...allocations];
                      next[idx] = { ...next[idx], target_type: v };
                      setAllocations(next);
                    }}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PO">PO</SelectItem>
                      <SelectItem value="SHIPMENT">SHIPMENT</SelectItem>
                      <SelectItem value="LINE">LINE</SelectItem>
                      <SelectItem value="SITE">SITE</SelectItem>
                      <SelectItem value="NONE">NONE</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="md:col-span-2">
                  <Label className="text-xs">PO Header ID</Label>
                  <Input
                    className="h-9"
                    value={a.po_header_id || ""}
                    onChange={(e) => {
                      const next = [...allocations];
                      next[idx] = { ...next[idx], po_header_id: e.target.value || null };
                      setAllocations(next);
                    }}
                    placeholder="uuid"
                  />
                </div>

                <div className="md:col-span-1">
                  <Label className="text-xs">Shipment ID</Label>
                  <Input
                    className="h-9"
                    value={a.shipment_id || ""}
                    onChange={(e) => {
                      const next = [...allocations];
                      next[idx] = { ...next[idx], shipment_id: e.target.value || null };
                      setAllocations(next);
                    }}
                    placeholder="uuid"
                  />
                </div>

                <div className="md:col-span-1">
                  <Label className="text-xs">PO Line ID</Label>
                  <Input
                    className="h-9"
                    value={a.po_line_id || ""}
                    onChange={(e) => {
                      const next = [...allocations];
                      next[idx] = { ...next[idx], po_line_id: e.target.value || null };
                      setAllocations(next);
                    }}
                    placeholder="uuid"
                  />
                </div>

                <div className="md:col-span-1">
                  <Label className="text-xs">Site</Label>
                  <Select
                    value={a.site_id || "NONE"}
                    onValueChange={(v) => {
                      const next = [...allocations];
                      next[idx] = { ...next[idx], site_id: v === "NONE" ? null : v };
                      setAllocations(next);
                    }}
                    disabled={lookupsLoading}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="(None)" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[260px]">
                      <SelectItem value="NONE">(None)</SelectItem>
                      {sites.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.site_name || s.code || s.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="md:col-span-2">
                  <Label className="text-xs">Share % (MULTI)</Label>
                  <Input
                    className="h-9"
                    inputMode="decimal"
                    value={a.share_pct ?? ""}
                    onChange={(e) => {
                      const next = [...allocations];
                      next[idx] = { ...next[idx], share_pct: e.target.value === "" ? null : toNumber(e.target.value) };
                      setAllocations(next);
                    }}
                    placeholder="0.25"
                  />
                </div>

                <div className="md:col-span-2">
                  <Label className="text-xs">Manual USD (optional)</Label>
                  <Input
                    className="h-9"
                    inputMode="decimal"
                    value={a.amount_usd ?? ""}
                    onChange={(e) => {
                      const next = [...allocations];
                      next[idx] = { ...next[idx], amount_usd: e.target.value === "" ? null : toNumber(e.target.value) };
                      setAllocations(next);
                    }}
                    placeholder="123.45"
                  />
                </div>

                <div className="md:col-span-2">
                  <Label className="text-xs">Note</Label>
                  <Input
                    className="h-9"
                    value={a.note || ""}
                    onChange={(e) => {
                      const next = [...allocations];
                      next[idx] = { ...next[idx], note: e.target.value };
                      setAllocations(next);
                    }}
                    placeholder="optional"
                  />
                </div>

                <div className="md:col-span-6 flex justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setAllocations((p) => p.filter((_, i) => i !== idx))}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" type="button" onClick={() => router.back()} disabled={loading}>
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={loading}>
            {loading ? "Saving..." : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
