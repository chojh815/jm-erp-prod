"use client";

import * as React from "react";
import AppShell from "@/components/layout/AppShell";
import type { AppRole } from "@/config/menuConfig";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type DevRole = AppRole;

type BankAccount = {
  id: string;
  account_name?: string | null;
  currency?: string | null;
  site_code?: string | null;
};

type MonthRow = {
  month: number;
  opening: number;
  inflow: number;
  outflow: number;
  net: number;
  closing: number;
  credit: number;
};

type ReportRow = {
  bank_account_id: string;
  account_name: string;
  currency: string | null;
  site_code: string | null;
  opening_balance: number;
  months: MonthRow[];
};

function money(n: any) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "";
  return x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function BankBalanceMonthlyPage() {
  const role: DevRole = "admin";

  const [year, setYear] = React.useState(String(new Date().getFullYear()));
  const [bankId, setBankId] = React.useState("");
  const [banks, setBanks] = React.useState<BankAccount[]>([]);
  const [rows, setRows] = React.useState<ReportRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  const loadBanks = React.useCallback(async () => {
    try {
      const res = await fetch("/api/bank-accounts/list?active_only=1", { cache: "no-store" });
      const j = await res.json();
      if (!j?.success) throw new Error(j?.error || "Failed to load bank accounts");
      setBanks(j.rows || []);
    } catch (e: any) {
      setBanks([]);
      setError(e?.message ?? String(e));
    }
  }, []);

  React.useEffect(() => {
    loadBanks();
  }, [loadBanks]);

  async function run() {
    setLoading(true);
    setError("");
    try {
      const y = Number(year);
      const params = new URLSearchParams({ year: String(y) });
      if (bankId) params.set("bank_account_id", bankId);

      const res = await fetch(`/api/reports/bank-balance-monthly?${params.toString()}`, { cache: "no-store" });
      const j = await res.json();
      if (!j?.success) throw new Error(j?.error || "Failed to load report");
      setRows(j.rows || []);
    } catch (e: any) {
      setRows([]);
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppShell role={role}>
      <div className="p-6 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Monthly Bank Balance Dashboard</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <div>
                <div className="text-xs text-muted-foreground mb-1">Year</div>
                <Input value={year} onChange={(e) => setYear(e.target.value)} placeholder="2026" />
              </div>

              <div>
                <div className="text-xs text-muted-foreground mb-1">Bank Account (optional)</div>
                <select
                  className="w-full border rounded-md h-10 px-2 text-sm"
                  value={bankId}
                  onChange={(e) => setBankId(e.target.value)}
                >
                  <option value="">All Active Accounts</option>
                  {banks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {(b.account_name ?? "(no name)")} {b.currency ? `(${b.currency})` : ""} {b.site_code ? `- ${b.site_code}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <Button className="w-full" onClick={run} disabled={loading}>
                  {loading ? "Loading..." : "Search"}
                </Button>
              </div>
            </div>

            {error ? (
              <div className="text-sm text-red-600">{error}</div>
            ) : rows.length === 0 ? (
              <div className="text-sm text-muted-foreground">No data. Pick a year and click Search.</div>
            ) : null}
          </CardContent>
        </Card>

        {rows.map((r) => (
          <Card key={r.bank_account_id}>
            <CardHeader>
              <CardTitle className="text-base">
                {r.account_name} {r.currency ? `(${r.currency})` : ""} {r.site_code ? `- ${r.site_code}` : ""}
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead className="text-right">Opening</TableHead>
                    <TableHead className="text-right">Inflow</TableHead>
                    <TableHead className="text-right">Outflow</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead className="text-right">Closing</TableHead>
                    <TableHead className="text-right">Credit (no cash)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.months.map((m) => (
                    <TableRow key={m.month}>
                      <TableCell>{m.month}</TableCell>
                      <TableCell className="text-right">{money(m.opening)}</TableCell>
                      <TableCell className="text-right">{money(m.inflow)}</TableCell>
                      <TableCell className="text-right">{money(m.outflow)}</TableCell>
                      <TableCell className="text-right">{money(m.net)}</TableCell>
                      <TableCell className="text-right">{money(m.closing)}</TableCell>
                      <TableCell className="text-right">{money(m.credit)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
