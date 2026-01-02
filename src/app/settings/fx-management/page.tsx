"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";

type FxRow = {
  id: string;
  base: string;
  quote: string;
  rate: number;
  effective_from: string;
  is_active: boolean;
  note: string | null;
  updated_at: string;
};

function fmtTs(ts?: string) {
  if (!ts) return "";
  return ts.replace("T", " ").slice(0, 16);
}

const COMMON_QUOTES = ["CNY", "VND", "KRW", "USD", "THB", "EUR", "JPY"];

export default function FxManagementPage() {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [active, setActive] = React.useState<FxRow[]>([]);
  const [recent, setRecent] = React.useState<FxRow[]>([]);

  const [open, setOpen] = React.useState(false);
  const [quote, setQuote] = React.useState("CNY");
  const [rate, setRate] = React.useState("");
  const [effectiveFrom, setEffectiveFrom] = React.useState(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  });
  const [note, setNote] = React.useState("");

  async function load() {
    try {
      setError(null);
      setLoading(true);
      const res = await fetch("/api/fx/management", { cache: "no-store" as any });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.success) throw new Error(j?.error || "Failed to load");
      setActive(Array.isArray(j.active) ? j.active : []);
      setRecent(Array.isArray(j.recent) ? j.recent : []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    void load();
  }, []);

  function openCreate(initialQuote: string) {
    setQuote(initialQuote);
    setRate("");
    setNote("");
    setOpen(true);
  }

  async function save() {
    try {
      setError(null);
      const r = Number(rate);
      if (!Number.isFinite(r) || r <= 0) {
        alert("rate는 0보다 큰 숫자여야 합니다.");
        return;
      }
      setLoading(true);
      const res = await fetch("/api/fx/management", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quote,
          rate: r,
          effective_from: effectiveFrom || null,
          note: note || null,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.success) throw new Error(j?.error || "Save failed");
      setOpen(false);
      await load();
    } catch (e: any) {
      setError(e?.message ?? "Save failed");
    } finally {
      setLoading(false);
    }
  }

  const activeMap = React.useMemo(() => {
    const m = new Map<string, FxRow>();
    for (const r of active) m.set(r.quote, r);
    return m;
  }, [active]);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xl font-semibold">Management FX Rates</div>
          <div className="text-sm text-muted-foreground">
            Base currency is fixed to <b>USD</b>. Rate means <b>1 USD = X QUOTE</b>.
          </div>
        </div>
        <Button onClick={() => openCreate("CNY")} disabled={loading}>
          Add / Update Rate
        </Button>
      </div>

      {error ? (
        <div className="text-sm text-red-600">{error}</div>
      ) : null}

      <Card className="p-4">
        <div className="font-medium mb-3">Active Rates</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="p-2 w-[90px]">QUOTE</th>
                <th className="p-2">Rate (1 USD = X)</th>
                <th className="p-2">Effective From</th>
                <th className="p-2">Updated</th>
                <th className="p-2">Note</th>
                <th className="p-2 w-[140px]"></th>
              </tr>
            </thead>
            <tbody>
              {COMMON_QUOTES.filter((q) => q !== "USD").map((q) => {
                const r = activeMap.get(q) || null;
                return (
                  <tr key={q} className="border-t">
                    <td className="p-2 font-medium">{q}</td>
                    <td className="p-2">{r ? String(r.rate) : <span className="text-muted-foreground">-</span>}</td>
                    <td className="p-2">{r ? r.effective_from : <span className="text-muted-foreground">-</span>}</td>
                    <td className="p-2">{r ? fmtTs(r.updated_at) : <span className="text-muted-foreground">-</span>}</td>
                    <td className="p-2">{r?.note ?? <span className="text-muted-foreground">-</span>}</td>
                    <td className="p-2 text-right">
                      <Button variant="outline" size="sm" onClick={() => openCreate(q)} disabled={loading}>
                        Set
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-4">
        <div className="font-medium mb-3">Recent Changes</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="p-2">QUOTE</th>
                <th className="p-2">Rate</th>
                <th className="p-2">Effective</th>
                <th className="p-2">Active</th>
                <th className="p-2">Updated</th>
                <th className="p-2">Note</th>
              </tr>
            </thead>
            <tbody>
              {(recent ?? []).slice(0, 50).map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-2">{r.quote}</td>
                  <td className="p-2">{String(r.rate)}</td>
                  <td className="p-2">{r.effective_from}</td>
                  <td className="p-2">{r.is_active ? "YES" : "NO"}</td>
                  <td className="p-2">{fmtTs(r.updated_at)}</td>
                  <td className="p-2">{r.note ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Set Management FX</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              기준: <b>1 USD = X {quote}</b> (예: 6.50)
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-xs mb-1">QUOTE</div>
                <Input value={quote} onChange={(e) => setQuote(e.target.value.toUpperCase())} />
              </div>
              <div>
                <div className="text-xs mb-1">RATE</div>
                <Input value={rate} onChange={(e) => setRate(e.target.value)} placeholder="e.g. 6.50" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-xs mb-1">EFFECTIVE FROM</div>
                <Input value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} placeholder="YYYY-MM-DD" />
              </div>
              <div>
                <div className="text-xs mb-1">NOTE</div>
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" />
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
              Cancel
            </Button>
            <Button onClick={save} disabled={loading}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
