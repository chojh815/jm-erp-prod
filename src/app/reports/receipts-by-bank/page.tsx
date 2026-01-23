"use client";

import * as React from "react";
import AppShell from "@/components/layout/AppShell";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function ReceiptsByBankReport() {
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [rows, setRows] = React.useState<any[]>([]);
  const [total, setTotal] = React.useState(0);

  const load = async () => {
    const res = await fetch(
      `/api/reports/receipts-by-bank?from=${from}&to=${to}`,
      { cache: "no-store" }
    );
    const j = await res.json();
    setRows(j.rows || []);
    setTotal(j.summary?.total_amount || 0);
  };

  return (
    <AppShell>
      <Card>
        <CardHeader>
          <CardTitle>Receipts by Bank Account</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 mb-4">
            <Input type="date" value={from} onChange={e => setFrom(e.target.value)} />
            <Input type="date" value={to} onChange={e => setTo(e.target.value)} />
            <Button onClick={load}>Search</Button>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Bank Account</TableHead>
                <TableHead>Buyer</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Ref</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell>{r.deposit_date}</TableCell>
                  <TableCell>{r.bank_account}</TableCell>
                  <TableCell>{r.buyer_name}</TableCell>
                  <TableCell>{r.method}</TableCell>
                  <TableCell>{r.reference_no}</TableCell>
                  <TableCell className="text-right">
                    {r.amount.toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell colSpan={5} className="font-bold text-right">
                  TOTAL
                </TableCell>
                <TableCell className="font-bold text-right">
                  {total.toLocaleString()}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AppShell>
  );
}
