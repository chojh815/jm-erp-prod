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

type LookupPO = {
  id: string;
  po_no: string;
  buyer_name?: string | null;
  buyer_code?: string | null;
  site_id?: string | null;
  site_code?: string | null;
};

type LookupShipment = {
  id: string;
  shipment_no: string;
  po_no?: string | null;
  buyer_name?: string | null;
  buyer_code?: string | null;
  site_id?: string | null;
  site_code?: string | null;
};

type LookupPoLine = {
  id: string;
  buyer_style_no?: string | null;
  jm_style_no?: string | null;
  po_no?: string | null;
  buyer_name?: string | null;
  buyer_code?: string | null;
  po_header_id?: string | null;
  site_id?: string | null;
  site_code?: string | null;
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

  // UI-only labels
  po_no?: string | null;
  shipment_no?: string | null;
  po_line_label?: string | null;
};

export type ExpenseHeaderDraft = {
  id?: string;
  expense_no?: string;
  expense_type_code: string;
  vendor_id?: string | null;
  expense_date: string;
  posting_month: string;
  currency: "USD" | "CNY" | "VND";
  fx_rate_to_usd: number | string;
  fx_as_of?: string | null;
  fx_source?: string | null;
  total_amount_original: number | string;
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

function calcUsd(currency: string, amountOriginal: number | string, fx: number | string) {
  const amountNum = toNumber(amountOriginal);
  const fxNum = toNumber(fx);
  if (currency === "USD") return amountNum;
  return fxNum > 0 ? amountNum / fxNum : 0;
}

function useDebounced<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = React.useState<T>(value);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

const DECIMAL_RE = /^(\d+)?(\.\d{0,6})?$/;
const MONEY_DECIMAL_RE = /^(\d+)?(\.\d{0,2})?$/;

function siteLabel(s: { code?: string | null; site_name?: string | null; id?: string | null }) {
  const code = String(s.code || "").toUpperCase();
  if (code.startsWith("VN")) return `Vietnam (${code})`;
  if (code.startsWith("CN")) return `China (${code})`;
  return s.code || s.site_name || s.id || "";
}


function SearchSelect<T extends { id: string }>({
  label,
  placeholder,
  valueLabel,
  fetcher,
  renderItem,
  onPick,
  onClear,
  disabled,
}: {
  label: string;
  placeholder: string;
  valueLabel: string | null;
  fetcher: (q: string) => Promise<T[]>;
  renderItem: (item: T) => React.ReactNode;
  onPick: (item: T) => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const dq = useDebounced(q, 250);
  const [items, setItems] = React.useState<T[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    async function run() {
      if (!open) return;
      setLoading(true);
      setErr(null);
      try {
        const rows = await fetcher(dq);
        if (!alive) return;
        setItems(rows || []);
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message || String(e));
      } finally {
        if (alive) setLoading(false);
      }
    }
    run();
    return () => {
      alive = false;
    };
  }, [dq, fetcher, open]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs">{label}</Label>
        {valueLabel ? (
          <button
            type="button"
            className="text-xs text-muted-foreground hover:underline"
            onClick={() => {
              onClear();
              setQ("");
            }}
          >
            Clear
          </button>
        ) : null}
      </div>

      <div className="relative">
        <Input
          className="h-9"
          disabled={disabled}
          value={valueLabel ?? q}
          placeholder={placeholder}
          onFocus={() => {
            if (!disabled) setOpen(true);
          }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(e) => {
            if (valueLabel) onClear();
            setQ(e.target.value);
            setOpen(true);
          }}
        />

        {open ? (
          <div className="absolute z-50 mt-2 w-full rounded-md border bg-background shadow-sm">
            <div className="max-h-64 overflow-auto p-1">
              {loading ? (
                <div className="p-2 text-sm text-muted-foreground">Loading…</div>
              ) : err ? (
                <div className="p-2 text-sm text-destructive">{err}</div>
              ) : items.length === 0 ? (
                <div className="p-2 text-sm text-muted-foreground">No results</div>
              ) : (
                items.map((it) => (
                  <button
                    key={it.id}
                    type="button"
                    className="w-full rounded-sm px-2 py-2 text-left text-sm hover:bg-muted"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      onPick(it);
                      setOpen(false);
                      setQ("");
                    }}
                  >
                    {renderItem(it)}
                  </button>
                ))
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
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
    fx_rate_to_usd: initialHeader?.fx_rate_to_usd != null ? String(initialHeader.fx_rate_to_usd) : "1",
    fx_as_of: initialHeader?.fx_as_of || null,
    fx_source: initialHeader?.fx_source || null,
    total_amount_original: toNumber(initialHeader?.total_amount_original || 0),
    scope_type: (initialHeader?.scope_type as any) || "PO",
    allocation_method: (initialHeader?.allocation_method as any) || "BY_REVENUE",
    note: initialHeader?.note ?? "",
  });

  const [allocations, setAllocations] = React.useState<AllocationRow[]>(
    initialAllocations?.length ? initialAllocations : [{ target_type: "PO" }]
  );

  const [fxLoading, setFxLoading] = React.useState(false);
  const [fxManual, setFxManual] = React.useState<boolean>((initialHeader?.fx_source || "") === "manual");

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

  const fetchPOs = React.useCallback(async (q: string): Promise<LookupPO[]> => {
    const url = new URL("/api/finance/lookup/pos", window.location.origin);
    if (q) url.searchParams.set("q", q);
    url.searchParams.set("limit", "20");
    const r = await fetch(url.toString(), { cache: "no-store" });
    const j = await r.json();
    return Array.isArray(j?.items) ? j.items : [];
  }, []);

  const fetchShipments = React.useCallback(async (q: string): Promise<LookupShipment[]> => {
    const url = new URL("/api/finance/lookup/shipments", window.location.origin);
    if (q) url.searchParams.set("q", q);
    url.searchParams.set("limit", "20");
    const r = await fetch(url.toString(), { cache: "no-store" });
    const j = await r.json();
    return Array.isArray(j?.items) ? j.items : [];
  }, []);

  const fetchPoLines = React.useCallback(async (q: string): Promise<LookupPoLine[]> => {
    const url = new URL("/api/finance/lookup/po-lines", window.location.origin);
    if (q) url.searchParams.set("q", q);
    url.searchParams.set("limit", "30");
    const r = await fetch(url.toString(), { cache: "no-store" });
    const j = await r.json();
    return Array.isArray(j?.items) ? j.items : [];
  }, []);

  const selectedType = React.useMemo(
    () => types.find((t) => t.code === header.expense_type_code),
    [types, header.expense_type_code]
  );

  React.useEffect(() => {
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
  }, [header.expense_type_code, selectedType]);

  const usdPreview = React.useMemo(() => {
    return calcUsd(header.currency, header.total_amount_original, header.fx_rate_to_usd);
  }, [header.currency, header.total_amount_original, header.fx_rate_to_usd]);

  const loadFx = React.useCallback(
    async (opts?: { force?: boolean }) => {
      if (header.currency === "USD") {
        setHeader((p) => ({
          ...p,
          fx_rate_to_usd: "1",
          fx_as_of: header.expense_date,
          fx_source: "fixed_usd",
        }));
        return;
      }

      if (fxManual && !opts?.force) return;

      try {
        setFxLoading(true);
        const qs = new URLSearchParams({
          date: header.expense_date,
          base: "USD",
          quote: header.currency,
        });

        const res = await fetch(`/api/fx/rates?${qs.toString()}`, { cache: "no-store" });
        const json = await res.json();
        if (!json?.ok) throw new Error(json?.error || "FX load failed");

        const rate = json?.rate;
        if (rate == null) throw new Error("No FX rate returned");

        setHeader((p) => ({
          ...p,
          fx_rate_to_usd: String(rate),
          fx_as_of: json?.as_of || header.expense_date,
          fx_source: json?.source || "frankfurter",
        }));
      } catch (e: any) {
        console.error(e);
        alert(e?.message || String(e));
      } finally {
        setFxLoading(false);
      }
    },
    [fxManual, header.currency, header.expense_date]
  );

  React.useEffect(() => {
    if (header.currency === "USD") {
      setHeader((p) => ({
        ...p,
        fx_rate_to_usd: "1",
        fx_as_of: header.expense_date,
        fx_source: "fixed_usd",
      }));
      return;
    }
    loadFx();
  }, [header.currency, header.expense_date, loadFx]);

  const save = async () => {
    setLoading(true);
    try {
      const payload = {
        ...header,
        fx_rate_to_usd: toNumber(header.fx_rate_to_usd),
        fx_as_of: header.fx_as_of || header.expense_date,
        fx_source: fxManual ? "manual" : (header.fx_source || "frankfurter"),
        total_amount_original: toNumber(header.total_amount_original),
        total_amount_usd: usdPreview,
        allocations: allocations.map((a) => ({
          target_type: a.target_type,
          po_header_id: a.po_header_id ?? null,
          shipment_id: a.shipment_id ?? null,
          po_line_id: a.po_line_id ?? null,
          site_id: a.site_id ?? null,
          share_pct: a.share_pct ?? null,
          amount_usd: a.amount_usd ?? null,
          note: a.note ?? null,
        })),
      };

      const url =
        mode === "edit"
          ? `/api/finance/expenses/${(initialHeader as any)?.id}`
          : "/api/finance/expenses";
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
      return "PO scope: choose one PO by PO No. Allocation within PO uses selected method.";
    if (header.scope_type === "MULTI")
      return "MULTI scope: add multiple POs with share_pct (sum=1.0 recommended). Each PO is then allocated internally.";
    if (header.scope_type === "SHIPMENT")
      return "SHIPMENT scope: choose Shipment No. Allocation uses BY_CBM if possible, else BY_GW, else BY_REVENUE.";
    if (header.scope_type === "LINE")
      return "LINE scope: choose PO line by PO / Buyer Style / JM Style.";
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
              value={header.fx_rate_to_usd ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "" || DECIMAL_RE.test(v)) {
                  setFxManual(true);
                  setHeader((p) => ({ ...p, fx_rate_to_usd: v, fx_source: "manual" }));
                }
              }}
              onBlur={() => {
                const normalized =
                  header.fx_rate_to_usd === "" ? "" : String(toNumber(header.fx_rate_to_usd));
                setHeader((p) => ({ ...p, fx_rate_to_usd: normalized }));
              }}
              placeholder="e.g., 7.23 for CNY, 24500 for VND"
            />
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>
                {header.currency === "USD"
                  ? "USD uses fixed rate 1"
                  : `As of: ${header.fx_as_of || "-"} / Source: ${header.fx_source || "-"}${fxManual ? " / manual override" : ""}`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setFxManual(false);
                  loadFx({ force: true });
                }}
                disabled={fxLoading || header.currency === "USD"}
              >
                {fxLoading ? "Loading FX..." : "Auto Load FX"}
              </Button>
              {header.currency !== "USD" ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setFxManual((v) => !v)}
                >
                  {fxManual ? "Manual On" : "Manual Off"}
                </Button>
              ) : null}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Total Amount (Original)</Label>
            <Input
              inputMode="decimal"
              value={String(header.total_amount_original)}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "" || MONEY_DECIMAL_RE.test(v)) {
                  setHeader((p) => ({ ...p, total_amount_original: v }));
                }
              }}
              onBlur={() => {
                const v = header.total_amount_original;
                setHeader((p) => ({
                  ...p,
                  total_amount_original: v === "" ? 0 : toNumber(v),
                }));
              }}
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
            <Textarea
              value={header.note || ""}
              onChange={(e) => setHeader((p) => ({ ...p, note: e.target.value }))}
            />
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
                      next[idx] = {
                        ...next[idx],
                        target_type: v,
                        po_header_id: null,
                        shipment_id: null,
                        po_line_id: null,
                        po_no: null,
                        shipment_no: null,
                        po_line_label: null,
                      };
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
                  {a.target_type === "PO" ? (
                    <SearchSelect<LookupPO>
                      label="PO No"
                      placeholder="Search PO No / Buyer"
                      valueLabel={a.po_no || null}
                      fetcher={fetchPOs}
                      onClear={() => {
                        const next = [...allocations];
                        next[idx] = { ...next[idx], po_header_id: null, po_no: null };
                        setAllocations(next);
                      }}
                      onPick={(it) => {
                        const next = [...allocations];
                        next[idx] = {
                          ...next[idx],
                          po_header_id: it.id,
                          po_no: it.po_no,
                          site_id: it.site_id ?? next[idx].site_id ?? null,
                        };
                        setAllocations(next);
                      }}
                      renderItem={(it) => (
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-medium">{it.po_no}</div>
                          <div className="text-xs text-muted-foreground">
                            {it.buyer_code || it.buyer_name || ""}{it.site_code ? ` · ${it.site_code}` : ""}
                          </div>
                        </div>
                      )}
                    />
                  ) : a.target_type === "SHIPMENT" ? (
                    <SearchSelect<LookupShipment>
                      label="Shipment No"
                      placeholder="Search Shipment No / PO / Buyer"
                      valueLabel={a.shipment_no || null}
                      fetcher={fetchShipments}
                      onClear={() => {
                        const next = [...allocations];
                        next[idx] = { ...next[idx], shipment_id: null, shipment_no: null };
                        setAllocations(next);
                      }}
                      onPick={(it) => {
                        const next = [...allocations];
                        next[idx] = {
                          ...next[idx],
                          shipment_id: it.id,
                          shipment_no: it.shipment_no,
                          site_id: it.site_id ?? next[idx].site_id ?? null,
                        };
                        setAllocations(next);
                      }}
                      renderItem={(it) => (
                        <div className="space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-medium">{it.shipment_no}</div>
                            <div className="text-xs text-muted-foreground">
                              {it.po_no ? `PO ${it.po_no}` : ""}
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {it.buyer_code || it.buyer_name || ""}{it.site_code ? ` · ${it.site_code}` : ""}
                          </div>
                        </div>
                      )}
                    />
                  ) : a.target_type === "LINE" ? (
                    <SearchSelect<LookupPoLine>
                      label="PO Line"
                      placeholder="Search PO / Buyer Style / JM Style"
                      valueLabel={a.po_line_label || null}
                      fetcher={fetchPoLines}
                      onClear={() => {
                        const next = [...allocations];
                        next[idx] = {
                          ...next[idx],
                          po_line_id: null,
                          po_line_label: null,
                          po_header_id: null,
                        };
                        setAllocations(next);
                      }}
                      onPick={(it) => {
                        const label = `${it.po_no ? `PO ${it.po_no} · ` : ""}${it.buyer_style_no || ""}${it.jm_style_no ? ` · ${it.jm_style_no}` : ""}`.trim();
                        const next = [...allocations];
                        next[idx] = {
                          ...next[idx],
                          po_line_id: it.id,
                          po_line_label: label,
                          po_header_id: it.po_header_id ?? null,
                          site_id: it.site_id ?? next[idx].site_id ?? null,
                        };
                        setAllocations(next);
                      }}
                      renderItem={(it) => (
                        <div className="space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-medium">
                              {it.buyer_style_no || "(no buyer style)"}{it.jm_style_no ? ` · ${it.jm_style_no}` : ""}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {it.po_no ? `PO ${it.po_no}` : ""}
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {it.buyer_code || it.buyer_name || ""}{it.site_code ? ` · ${it.site_code}` : ""}
                          </div>
                        </div>
                      )}
                    />
                  ) : (
                    <div className="space-y-2">
                      <Label className="text-xs">
                        {a.target_type === "SITE" ? "Site" : "Target"}
                      </Label>
                      <div className="h-9 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                        {a.target_type === "NONE" ? "No target needed" : "Select target type"}
                      </div>
                    </div>
                  )}
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
                          {siteLabel(s)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="md:col-span-1">
                  <Label className="text-xs">Share % (MULTI)</Label>
                  <Input
                    className="h-9"
                    inputMode="decimal"
                    value={a.share_pct ?? ""}
                    onChange={(e) => {
                      const next = [...allocations];
                      next[idx] = {
                        ...next[idx],
                        share_pct: e.target.value === "" ? null : toNumber(e.target.value),
                      };
                      setAllocations(next);
                    }}
                    placeholder="0.25"
                  />
                </div>

                <div className="md:col-span-1">
                  <Label className="text-xs">Manual USD</Label>
                  <Input
                    className="h-9"
                    inputMode="decimal"
                    value={a.amount_usd ?? ""}
                    onChange={(e) => {
                      const next = [...allocations];
                      next[idx] = {
                        ...next[idx],
                        amount_usd: e.target.value === "" ? null : toNumber(e.target.value),
                      };
                      setAllocations(next);
                    }}
                    placeholder="123.45"
                  />
                </div>

                <div className="md:col-span-5">
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

                <div className="md:col-span-1 flex items-end justify-end">
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
