"use client";

import * as React from "react";
import { format2, toNumberSafe } from "@/lib/redNumber";

/**
 * v6.6 Matrix Header Bar (FX + Margin + Auto-fill)
 * - FX Rate: CNY per 1 USD
 * - Margin: %
 * - Auto-fill: 서버에 저장 + 계산 + 스냅샷 저장 후 최신 rows를 돌려받아 UI 갱신
 */
export default function MatrixFxMarginBar(props: {
  quotationId: string;
  initialFxRate?: number | null;
  initialMargin?: number | null;
  onApplied: (next: {
    fx_rate_cny_per_usd: number;
    margin_percent: number;
    rows: any[];
  }) => void;
}) {
  const [fx, setFx] = React.useState<string>(
    props.initialFxRate !== null && props.initialFxRate !== undefined
      ? format2(Number(props.initialFxRate))
      : ""
  );
  const [margin, setMargin] = React.useState<string>(
    props.initialMargin !== null && props.initialMargin !== undefined
      ? format2(Number(props.initialMargin))
      : ""
  );
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  async function onAutoFill() {
    setErr(null);
    const fxN = toNumberSafe(fx);
    const mN = toNumberSafe(margin);

    if (!fxN || fxN <= 0) return setErr("Enter a valid FX Rate (CNY per 1 USD).");
    if (mN === null || mN < 0) return setErr("Enter Margin (%) greater than or equal to 0.");
    if (!window.confirm("This will auto-fill and overwrite matrix values. Continue?")) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/red/quotations/${props.quotationId}/matrix/autofill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fx_rate_cny_per_usd: fxN,
          margin_percent: mN,
        }),
      });

      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(j?.error || `Auto-fill failed (${res.status})`);
      }

      props.onApplied({
        fx_rate_cny_per_usd: j.fx_rate_cny_per_usd,
        margin_percent: j.margin_percent,
        rows: j.rows || [],
      });
    } catch (e: any) {
      setErr(e?.message || "Auto-fill error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mb-3 rounded-xl border bg-background p-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 md:gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              FX Rate (CNY per 1 USD)
            </span>
            <input
              className="h-10 rounded-md border bg-background px-3 text-sm"
              value={fx}
              onChange={(e) => setFx(e.target.value)}
              inputMode="decimal"
              placeholder="e.g. 7.20"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Margin (%)</span>
            <input
              className="h-10 rounded-md border bg-background px-3 text-sm"
              value={margin}
              onChange={(e) => setMargin(e.target.value)}
              inputMode="decimal"
              placeholder="e.g. 18.00"
            />
          </label>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onAutoFill}
            disabled={loading}
            className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {loading ? "Applying..." : "Auto-fill"}
          </button>
        </div>
      </div>

      {err ? <p className="mt-2 text-sm text-red-600">{err}</p> : null}
      <p className="mt-2 text-xs text-muted-foreground">
        Auto-fill calculates FOB (CNY) and Offer (USD), saves a DB snapshot, and refreshes the latest Matrix.
      </p>
    </div>
  );
}
