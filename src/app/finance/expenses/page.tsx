"use client";

import * as React from "react";

import AppShell from "@/components/layout/AppShell";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

type Currency = "USD" | "CNY" | "VND";
type ExpenseScope = "PO" | "OVERHEAD"; // (A안) 감가상각 X
type AllocationTarget = "PO" | "PO_LINE" | "SHIPMENT" | "SITE";

type LookupPO = {
  id: string;
  po_no: string;
  buyer_name: string | null;
  buyer_code: string | null;
  site_id: string | null;
  site_code: string | null;
};

type LookupShipment = {
  id: string;
  shipment_no: string;
  po_no: string | null;
  buyer_name: string | null;
  buyer_code: string | null;
  site_id: string | null;
  site_code: string | null;
};

type LookupPoLine = {
  id: string;
  buyer_style_no: string | null;
  jm_style_no: string | null;
  po_no: string | null;
  buyer_name: string | null;
  buyer_code: string | null;
  po_header_id: string | null;
  site_id: string | null;
  site_code: string | null;
};

type LookupSite = {
  id: string;
  code: string;
  name: string | null;
};

type AllocationRow = {
  id: string;
  target_type: AllocationTarget;

  // stored IDs for API
  po_header_id: string | null;
  shipment_id: string | null;
  po_line_id: string | null;
  site_id: string | null;

  // user-facing labels
  label: string | null;

  // allocation
  share_pct: string; // keep as raw string for UX
  manual_usd: string; // keep as raw string for UX
  note: string;
};

function uid(prefix = "row") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

function toNumberOrNull(s: string) {
  const t = (s ?? "").toString().trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function fmt(n: number | null | undefined, digits = 2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function useDebounced<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = React.useState<T>(value);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

function normalizeSharePct(s: string) {
  // allow: 0.25 / 25 / 25%  -> store as 0.25
  const t = (s ?? "").trim();
  if (!t) return "";
  const cleaned = t.replace(/%/g, "");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return s;
  if (n > 1) return String(n / 100);
  return String(n);
}

function SearchSelect<T extends { id: string }>({
  label,
  placeholder,
  valueLabel,
  onClear,
  fetcher,
  renderItem,
  onPick,
  disabled,
}: {
  label: string;
  placeholder: string;
  valueLabel: string | null;
  onClear: () => void;
  fetcher: (q: string) => Promise<T[]>;
  renderItem: (item: T) => React.ReactNode;
  onPick: (item: T) => void;
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
      setErr(null);
      setLoading(true);
      try {
        const res = await fetcher(dq);
        if (!alive) return;
        setItems(res);
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message ?? String(e));
      } finally {
        if (alive) setLoading(false);
      }
    }
    run();
    return () => {
      alive = false;
    };
  }, [dq, open, fetcher]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        {valueLabel ? (
          <button
            type="button"
            onClick={() => {
              onClear();
              setQ("");
            }}
            className="text-xs text-muted-foreground hover:underline"
          >
            Clear
          </button>
        ) : null}
      </div>

      <div className="relative">
        <Input
          disabled={disabled}
          value={valueLabel ?? q}
          placeholder={placeholder}
          onFocus={() => {
            if (!disabled) setOpen(true);
          }}
          onBlur={() => {
            // tiny delay so click registers
            setTimeout(() => setOpen(false), 150);
          }}
          onChange={(e) => {
            if (valueLabel) {
              // if already selected, typing starts a new search
              onClear();
            }
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
                    type="button"
                    key={it.id}
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

export default function FinanceExpensesPage() {
  // Header (Expense)
  const [scope, setScope] = React.useState<ExpenseScope>("PO");
  const [date, setDate] = React.useState<string>(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  });
  const [category, setCategory] = React.useState<string>("FORWARDER");
  const [description, setDescription] = React.useState<string>("");
  const [currency, setCurrency] = React.useState<Currency>("USD");
  const [amountLocal, setAmountLocal] = React.useState<string>("");
  const [fxToUsd, setFxToUsd] = React.useState<string>("1");
  const [note, setNote] = React.useState<string>("");

  const amountLocalNum = toNumberOrNull(amountLocal) ?? 0;
  const fxNum = toNumberOrNull(fxToUsd) ?? 1;
  const computedUsd = currency === "USD" ? amountLocalNum : amountLocalNum * fxNum;

  // Sites list (for OVERHEAD)
  const [sites, setSites] = React.useState<LookupSite[]>([]);
  const [sitesLoading, setSitesLoading] = React.useState(false);
  const [overheadMonth, setOverheadMonth] = React.useState<string>(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${yyyy}-${mm}`;
  });
  const [overheadSiteId, setOverheadSiteId] = React.useState<string>("ALL");

  // Allocations
  const [allocations, setAllocations] = React.useState<AllocationRow[]>(() => [
    {
      id: uid("alloc"),
      target_type: "PO",
      po_header_id: null,
      shipment_id: null,
      po_line_id: null,
      site_id: null,
      label: null,
      share_pct: "1",
      manual_usd: "",
      note: "",
    },
  ]);

  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [okMsg, setOkMsg] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    async function loadSites() {
      setSitesLoading(true);
      try {
        const r = await fetch(`/api/finance/lookup/sites?limit=200`);
        const j = await r.json();
        if (!alive) return;
        setSites(Array.isArray(j?.items) ? j.items : []);
      } catch {
        // ignore
      } finally {
        if (alive) setSitesLoading(false);
      }
    }
    loadSites();
    return () => {
      alive = false;
    };
  }, []);

  // Allocation validation: Share% should sum to 1.0 when used
  const shareRows = React.useMemo(() => {
    return allocations.filter((a) => a.target_type === "PO" && a.share_pct.trim() !== "");
  }, [allocations]);

  const shareSum = React.useMemo(() => {
    let s = 0;
    for (const a of shareRows) {
      const n = toNumberOrNull(normalizeSharePct(a.share_pct));
      if (n !== null) s += n;
    }
    return s;
  }, [shareRows]);

  const shareSumOk = shareRows.length <= 1 ? true : Math.abs(shareSum - 1) < 0.0001;

  const setAlloc = (id: string, patch: Partial<AllocationRow>) => {
    setAllocations((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  };

  const addRow = () => {
    setAllocations((prev) => [
      ...prev,
      {
        id: uid("alloc"),
        target_type: "PO",
        po_header_id: null,
        shipment_id: null,
        po_line_id: null,
        site_id: null,
        label: null,
        share_pct: "",
        manual_usd: "",
        note: "",
      },
    ]);
  };

  const removeRow = (id: string) => {
    setAllocations((prev) => (prev.length <= 1 ? prev : prev.filter((a) => a.id !== id)));
  };

  async function fetchPOs(q: string): Promise<LookupPO[]> {
    const url = new URL(`/api/finance/lookup/pos`, window.location.origin);
    if (q) url.searchParams.set("q", q);
    url.searchParams.set("limit", "20");
    const r = await fetch(url.toString());
    const j = await r.json();
    return Array.isArray(j?.items) ? j.items : [];
  }

  async function fetchShipments(q: string): Promise<LookupShipment[]> {
    const url = new URL(`/api/finance/lookup/shipments`, window.location.origin);
    if (q) url.searchParams.set("q", q);
    url.searchParams.set("limit", "20");
    const r = await fetch(url.toString());
    const j = await r.json();
    return Array.isArray(j?.items) ? j.items : [];
  }

  async function fetchPoLines(q: string): Promise<LookupPoLine[]> {
    const url = new URL(`/api/finance/lookup/po-lines`, window.location.origin);
    if (q) url.searchParams.set("q", q);
    url.searchParams.set("limit", "30");
    const r = await fetch(url.toString());
    const j = await r.json();
    return Array.isArray(j?.items) ? j.items : [];
  }

  const reset = () => {
    setError(null);
    setOkMsg(null);
    setScope("PO");
    setCategory("FORWARDER");
    setDescription("");
    setCurrency("USD");
    setAmountLocal("");
    setFxToUsd("1");
    setNote("");
    setAllocations([
      {
        id: uid("alloc"),
        target_type: "PO",
        po_header_id: null,
        shipment_id: null,
        po_line_id: null,
        site_id: null,
        label: null,
        share_pct: "1",
        manual_usd: "",
        note: "",
      },
    ]);
  };

  const canSave = React.useMemo(() => {
    if (!date) return false;
    if (!category) return false;
    if ((toNumberOrNull(amountLocal) ?? 0) <= 0) return false;
    if (scope === "OVERHEAD") return true;
    // PO scope
    const hasAnyTarget = allocations.some((a) => !!(a.po_header_id || a.po_line_id || a.shipment_id || a.site_id));
    if (!hasAnyTarget) return false;
    if (!shareSumOk) return false;
    return true;
  }, [date, category, amountLocal, scope, allocations, shareSumOk]);

  async function onSave() {
    setError(null);
    setOkMsg(null);
    setSaving(true);
    try {
      const payload = {
        header: {
          scope,
          date,
          category,
          description: description || null,
          currency,
          amount_local: toNumberOrNull(amountLocal),
          fx_rate_to_usd: currency === "USD" ? 1 : toNumberOrNull(fxToUsd),
          note: note || null,
          // overhead helpers
          overhead_month: scope === "OVERHEAD" ? overheadMonth : null,
          overhead_site_id: scope === "OVERHEAD" && overheadSiteId !== "ALL" ? overheadSiteId : null,
        },
        allocations:
          scope === "OVERHEAD"
            ? []
            : allocations.map((a) => ({
                target_type: a.target_type,
                po_header_id: a.po_header_id,
                shipment_id: a.shipment_id,
                po_line_id: a.po_line_id,
                site_id: a.site_id,
                share_pct: toNumberOrNull(normalizeSharePct(a.share_pct)),
                manual_usd: toNumberOrNull(a.manual_usd),
                note: a.note || null,
              })),
      };

      const r = await fetch(`/api/finance/expenses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok === false) {
        throw new Error(j?.error || `Save failed (${r.status})`);
      }
      setOkMsg("Saved.");
      reset();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Finance · Expenses</h1>
            <p className="text-sm text-muted-foreground">
              Enter operational expenses (forwarder / transport / overtime / materials logistics). Saved expenses will be
              allocated into Profitability dashboards.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={reset} disabled={saving}>
              Reset
            </Button>
            <Button onClick={onSave} disabled={saving || !canSave}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>

        {error ? (
          <Card className="border-destructive">
            <CardContent className="py-3 text-sm text-destructive">{error}</CardContent>
          </Card>
        ) : null}
        {okMsg ? (
          <Card className="border-emerald-500">
            <CardContent className="py-3 text-sm text-emerald-700">{okMsg}</CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Expense</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label>Scope</Label>
                <Select value={scope} onValueChange={(v) => setScope(v as ExpenseScope)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PO">PO / Shipment / Style</SelectItem>
                    <SelectItem value="OVERHEAD">Factory Overhead (Monthly)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Date</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>

              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FORWARDER">Forwarder</SelectItem>
                    <SelectItem value="TRANSPORT">Transport</SelectItem>
                    <SelectItem value="LABOR">Temporary Labor</SelectItem>
                    <SelectItem value="CUSTOMS">Customs / Clearance</SelectItem>
                    <SelectItem value="PACKAGING">Packaging Purchase</SelectItem>
                    <SelectItem value="EQUIPMENT">Equipment (expense)</SelectItem>
                    <SelectItem value="OTHER">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2 md:col-span-2">
                <Label>Description</Label>
                <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
              </div>

              <div className="space-y-2">
                <Label>Currency</Label>
                <Select value={currency} onValueChange={(v) => setCurrency(v as Currency)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="CNY">CNY</SelectItem>
                    <SelectItem value="VND">VND</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label>Amount (Local)</Label>
                <Input value={amountLocal} onChange={(e) => setAmountLocal(e.target.value)} placeholder="e.g., 1234.56" />
              </div>

              <div className="space-y-2">
                <Label>FX to USD</Label>
                <Input
                  value={fxToUsd}
                  onChange={(e) => setFxToUsd(e.target.value)}
                  disabled={currency === "USD"}
                  placeholder={currency === "USD" ? "1" : "e.g., 0.14"}
                />
                <div className="text-xs text-muted-foreground">
                  {currency === "USD" ? "USD expense uses FX=1" : "USD = Local × FX"}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Computed USD</Label>
                <div className="flex h-10 items-center rounded-md border bg-muted px-3 text-sm">
                  {fmt(computedUsd, 2) || "-"}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Note</Label>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
            </div>

            {scope === "OVERHEAD" ? (
              <>
                <Separator />
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Overhead Month</Label>
                    <Input type="month" value={overheadMonth} onChange={(e) => setOverheadMonth(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Site</Label>
                    <Select value={overheadSiteId} onValueChange={setOverheadSiteId}>
                      <SelectTrigger>
                        <SelectValue placeholder="All Sites" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">All Sites</SelectItem>
                        {sites.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.code} {s.name ? `· ${s.name}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {sitesLoading ? <div className="text-xs text-muted-foreground">Loading sites…</div> : null}
                    <div className="text-xs text-muted-foreground">
                      Overhead is allocated monthly (default: by revenue) when Profitability runs.
                    </div>
                  </div>
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>

        {scope === "PO" ? (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Targets / Allocations</CardTitle>
              <Button onClick={addRow} variant="secondary">
                + Add Row
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-sm text-muted-foreground">
                ✅ UUID 직접 입력은 하지 않습니다. 아래 검색으로 PO / Shipment / Style(PO Line)을 선택하세요.
              </div>

              {!shareSumOk ? (
                <div className="rounded-md border border-amber-400 bg-amber-50 p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">Warning</Badge>
                    <div>
                      Share% 합계가 <b>1.0</b>이 아닙니다. (현재: <b>{shareSum.toFixed(4)}</b>)
                    </div>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    여러 PO로 나눌 때만 Share%를 쓰고, 합계가 1.0이 되게 맞춰주세요.
                  </div>
                </div>
              ) : null}

              {allocations.map((a, idx) => (
              <Card key={a.id} className="border-muted">
                <CardHeader className="py-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium text-muted-foreground">
                      Allocation #{idx + 1}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => removeRow(a.id)}
                    >
                      Remove
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
<div className="grid gap-4 md:grid-cols-12">
                      <div className="space-y-2 md:col-span-2">
                        <Label>Target</Label>
                        <Select
                          value={a.target_type}
                          onValueChange={(v) => {
                            const t = v as AllocationTarget;
                            // reset IDs/labels when target changes
                            setAlloc(a.id, {
                              target_type: t,
                              po_header_id: null,
                              shipment_id: null,
                              po_line_id: null,
                              site_id: null,
                              label: null,
                            });
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="PO">PO</SelectItem>
                            <SelectItem value="SHIPMENT">Shipment</SelectItem>
                            <SelectItem value="PO_LINE">PO Line (Style)</SelectItem>
                            <SelectItem value="SITE">Site</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="md:col-span-7">
                        {a.target_type === "PO" ? (
                          <SearchSelect<LookupPO>
                            label="PO (search by PO No / Buyer)"
                            placeholder="Type to search…"
                            valueLabel={a.label}
                            onClear={() =>
                              setAlloc(a.id, { po_header_id: null, site_id: null, label: null })
                            }
                            fetcher={fetchPOs}
                            renderItem={(it) => (
                              <div className="flex items-center justify-between gap-2">
                                <div className="font-medium">{it.po_no}</div>
                                <div className="text-xs text-muted-foreground">
                                  {it.buyer_code || it.buyer_name || ""}
                                  {it.site_code ? ` · ${it.site_code}` : ""}
                                </div>
                              </div>
                            )}
                            onPick={(it) => {
                              setAlloc(a.id, {
                                po_header_id: it.id,
                                site_id: it.site_id ?? null, // ✅ PO 선택하면 site 자동
                                label: `${it.po_no} · ${it.buyer_code || it.buyer_name || ""}`.trim(),
                              });
                            }}
                          />
                        ) : null}

                        {a.target_type === "SHIPMENT" ? (
                          <SearchSelect<LookupShipment>
                            label="Shipment (search by Shipment No / PO No / Buyer)"
                            placeholder="Type to search…"
                            valueLabel={a.label}
                            onClear={() =>
                              setAlloc(a.id, { shipment_id: null, site_id: null, label: null })
                            }
                            fetcher={fetchShipments}
                            renderItem={(it) => (
                              <div className="space-y-1">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="font-medium">{it.shipment_no}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {it.po_no ? `PO ${it.po_no}` : ""}
                                  </div>
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {it.buyer_code || it.buyer_name || ""}
                                  {it.site_code ? ` · ${it.site_code}` : ""}
                                </div>
                              </div>
                            )}
                            onPick={(it) => {
                              setAlloc(a.id, {
                                shipment_id: it.id,
                                site_id: it.site_id ?? null,
                                label: `${it.shipment_no}${it.po_no ? ` · PO ${it.po_no}` : ""}`,
                              });
                            }}
                          />
                        ) : null}

                        {a.target_type === "PO_LINE" ? (
                          <SearchSelect<LookupPoLine>
                            label="PO Line (search by PO No / Buyer Style / JM Style)"
                            placeholder="Type to search…"
                            valueLabel={a.label}
                            onClear={() =>
                              setAlloc(a.id, {
                                po_line_id: null,
                                po_header_id: null,
                                site_id: null,
                                label: null,
                              })
                            }
                            fetcher={fetchPoLines}
                            renderItem={(it) => (
                              <div className="space-y-1">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="font-medium">
                                    {it.buyer_style_no || "(no buyer style)"}
                                    {it.jm_style_no ? ` · ${it.jm_style_no}` : ""}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    {it.po_no ? `PO ${it.po_no}` : ""}
                                  </div>
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {it.buyer_code || it.buyer_name || ""}
                                  {it.site_code ? ` · ${it.site_code}` : ""}
                                </div>
                              </div>
                            )}
                            onPick={(it) => {
                              const lbl = `${it.po_no ? `PO ${it.po_no} · ` : ""}${
                                it.buyer_style_no || ""
                              }${it.jm_style_no ? ` · ${it.jm_style_no}` : ""}`.trim();
                              setAlloc(a.id, {
                                po_line_id: it.id,
                                po_header_id: it.po_header_id ?? null,
                                site_id: it.site_id ?? null,
                                label: lbl,
                              });
                            }}
                          />
                        ) : null}

                        {a.target_type === "SITE" ? (
                          <div className="space-y-2">
                            <Label>Site</Label>
                            <Select
                              value={a.site_id ?? ""}
                              onValueChange={(v) => {
                                const s = sites.find((x) => x.id === v);
                                setAlloc(a.id, {
                                  site_id: v || null,
                                  label: s ? `${s.code} ${s.name ? `· ${s.name}` : ""}` : null,
                                });
                              }}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select site" />
                              </SelectTrigger>
                              <SelectContent>
                                {sites.map((s) => (
                                  <SelectItem key={s.id} value={s.id}>
                                    {s.code} {s.name ? `· ${s.name}` : ""}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        ) : null}
                      </div>

                      <div className="space-y-2 md:col-span-3">
                        <Label>Site (auto)</Label>
                        <div className="flex h-10 items-center rounded-md border bg-muted px-3 text-sm">
                          {(() => {
                            const s = sites.find((x) => x.id === a.site_id);
                            return s ? `${s.code}${s.name ? ` · ${s.name}` : ""}` : "-";
                          })()}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          PO/Shipment/Style를 선택하면 자동으로 채워집니다.
                        </div>
                      </div>
                    </div>

                    <Separator className="my-4" />

                    <div className="grid gap-4 md:grid-cols-12">
                      <div className="space-y-2 md:col-span-3">
                        <Label>Share %</Label>
                        <Input
                          value={a.share_pct}
                          onChange={(e) => setAlloc(a.id, { share_pct: e.target.value })}
                          onBlur={() => setAlloc(a.id, { share_pct: normalizeSharePct(a.share_pct) })}
                          placeholder="e.g., 0.25 or 25%"
                        />
                        <div className="text-xs text-muted-foreground">
                          여러 PO를 분할할 때만 사용 (합계 1.0).
                        </div>
                      </div>

                      <div className="space-y-2 md:col-span-3">
                        <Label>Manual USD (optional)</Label>
                        <Input
                          value={a.manual_usd}
                          onChange={(e) => setAlloc(a.id, { manual_usd: e.target.value })}
                          placeholder="e.g., 123.45"
                        />
                        <div className="text-xs text-muted-foreground">특정 타겟에 고정 금액으로 배정할 때.</div>
                      </div>

                      <div className="space-y-2 md:col-span-5">
                        <Label>Note</Label>
                        <Input value={a.note} onChange={(e) => setAlloc(a.id, { note: e.target.value })} />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </AppShell>
  );
}
