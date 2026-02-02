"use client";

import * as React from "react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type BuyerOption = {
  id: string;
  company_name?: string | null;
  code?: string | null;
};

export function BuyerSelect({
  value,
  onChange,
  disabled,
  placeholder = "Select buyer",
  className,
}: {
  value?: string | null;
  onChange: (buyer: BuyerOption | null) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const [loading, setLoading] = React.useState(true);
  const [buyers, setBuyers] = React.useState<BuyerOption[]>([]);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        setErr(null);
        const res = await fetch("/api/companies/buyers", { cache: "no-store" });
        const j = await res.json().catch(() => null);
        if (!mounted) return;

        if (!res.ok || !j?.success) {
          setErr(j?.error || `HTTP ${res.status}`);
          setBuyers([]);
          return;
        }

        setBuyers(Array.isArray(j.buyers) ? j.buyers : []);
      } catch (e: any) {
        if (!mounted) return;
        setErr(e?.message || "Failed to load buyers");
        setBuyers([]);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const selected = value ? buyers.find((b) => b.id === value) : null;

  if (loading) {
    return <div className={(className || "h-10 w-full") + " animate-pulse rounded-md bg-muted"} />;
  }

  return (
    <div className={className}>
      <Select
        value={value || ""}
        onValueChange={(v) => {
          const b = buyers.find((x) => x.id === v) || null;
          onChange(b);
        }}
        disabled={disabled}
      >
        <SelectTrigger>
          <SelectValue placeholder={err ? `Error: ${err}` : placeholder}>
            {selected ? `${selected.code ? `${selected.code} - ` : ""}${selected.company_name || ""}` : undefined}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {buyers.length === 0 ? (
            <SelectItem value="__none__" disabled>
              No buyers
            </SelectItem>
          ) : (
            buyers.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.code ? `${b.code} - ` : ""}
                {b.company_name || b.id}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
    </div>
  );
}